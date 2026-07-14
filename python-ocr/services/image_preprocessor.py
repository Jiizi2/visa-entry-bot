from __future__ import annotations

import os
import shutil
import uuid
from contextlib import contextmanager
from functools import lru_cache
from time import perf_counter

import numpy as np

try:
    import cv2
except ImportError:  # pragma: no cover - depends on local environment
    cv2 = None

QUALITY_NOTES = (
    (60.0, "Image blur detected.", 0.15),
    (120.0, "Image slightly blurred.", 0.07),
)
DEFAULT_PROCESSED_DOCUMENT_MAX_EDGE = 1800
DEFAULT_MRZ_VARIANT_MAX_EDGE = 2200
_TEMP_ROOT_PREPARED = False
_IMAGE_PREPROCESS_STATS = {
    "requestCount": 0,
    "cacheHitCount": 0,
    "callCount": 0,
    "errorCount": 0,
    "totalMs": 0,
    "maxMs": 0,
    "inputMegaPixels": 0.0,
    "outputMegaPixels": 0.0,
    "estimatedPeakMb": 0.0,
}


def assess_document_quality(file_path: str) -> tuple[float, str]:
    image = _load_image(file_path)
    if image is None:
        return 0.0, ""

    document = detect_passport_data_page_crop(image)
    if document is None:
        document = image
    gray = cv2.cvtColor(document, cv2.COLOR_BGR2GRAY)
    blur_score = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    glare_ratio = float((gray >= 245).sum()) / max(gray.size, 1)

    notes: list[str] = []
    penalty = 0.0
    for threshold, note, weight in QUALITY_NOTES:
        if blur_score < threshold:
            notes.append(note)
            penalty += weight
            break
    if glare_ratio > 0.10:
        notes.append("Image glare detected.")
        penalty += 0.12
    return min(penalty, 0.25), "; ".join(notes)


def build_processed_document_image(file_path: str) -> object | None:
    """Build a light, layout-ready document image for visual OCR fallback."""
    if cv2 is None or _image_preprocess_mode() == "off":
        return None
    max_edge = _processed_document_max_edge()
    before = _build_processed_document_image_cached.cache_info()
    _IMAGE_PREPROCESS_STATS["requestCount"] += 1
    image = _build_processed_document_image_cached(os.path.abspath(file_path), max_edge)
    after = _build_processed_document_image_cached.cache_info()
    if after.hits > before.hits:
        _IMAGE_PREPROCESS_STATS["cacheHitCount"] += 1
    return image


def get_image_preprocessor_stats() -> dict[str, int | float]:
    return {
        **_IMAGE_PREPROCESS_STATS,
        "inputMegaPixels": round(float(_IMAGE_PREPROCESS_STATS["inputMegaPixels"]), 3),
        "outputMegaPixels": round(float(_IMAGE_PREPROCESS_STATS["outputMegaPixels"]), 3),
        "estimatedPeakMb": round(float(_IMAGE_PREPROCESS_STATS["estimatedPeakMb"]), 2),
    }


def reset_image_preprocessor_stats() -> None:
    for key in _IMAGE_PREPROCESS_STATS:
        _IMAGE_PREPROCESS_STATS[key] = 0.0 if key in {"inputMegaPixels", "outputMegaPixels", "estimatedPeakMb"} else 0


def clear_image_preprocess_cache() -> None:
    _build_processed_document_image_cached.cache_clear()


@contextmanager
def temporary_mrz_variants(file_path: str):
    global _TEMP_ROOT_PREPARED
    image = _load_image(file_path)
    if image is None:
        yield [(file_path, "")]
        return

    document = detect_passport_data_page_crop(image)
    variants = [(file_path, "")]
    temp_root = _ensure_temp_root()
    if not _TEMP_ROOT_PREPARED:
        cleanup_temp_root()
        _TEMP_ROOT_PREPARED = True
    temp_paths: list[str] = []
    try:
        for index, (variant, note) in enumerate(_build_mrz_variants(image, document), start=1):
            temp_path = os.path.join(temp_root, f"mrz_variant_{uuid.uuid4().hex}_{index}.png")
            if cv2.imwrite(temp_path, variant):
                variants.append((temp_path, note))
                temp_paths.append(temp_path)
        yield variants
    finally:
        for temp_path in temp_paths:
            try:
                if os.path.exists(temp_path):
                    os.remove(temp_path)
            except OSError:
                continue


def detect_document_crop(image: object) -> object | None:
    if cv2 is None or image is None:
        return None

    original_height, original_width = image.shape[:2]
    scale = 1200.0 / max(original_height, original_width, 1)
    resized = image if scale >= 1 else cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 40, 140)
    edges = cv2.dilate(edges, cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5)), iterations=2)

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    min_area = resized.shape[0] * resized.shape[1] * 0.12
    best_box = None
    best_area = 0.0

    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:15]:
        area = cv2.contourArea(contour)
        if area < min_area:
            continue
        box = cv2.boxPoints(cv2.minAreaRect(contour))
        width, height = _rect_size(box)
        if min(width, height) <= 0:
            continue
        aspect_ratio = max(width, height) / min(width, height)
        if not 1.1 <= aspect_ratio <= 3.8:
            continue
        if area > best_area:
            best_area = area
            best_box = box

    if best_box is None:
        return _edge_projection_crop(image)

    if scale < 1:
        best_box = best_box / scale
    return _warp_box(image, best_box)


def resize_to_max_edge(image: object | None, *, max_edge: int) -> object | None:
    if image is None or cv2 is None:
        return image
    return _resize_to_max_edge(image, max_edge=max_edge)


def detect_passport_data_page_crop(image: object) -> object | None:
    document = detect_document_crop(image)
    if document is not None and not _is_plausible_passport_crop(document):
        document = None
    if cv2 is None or image is None or not _should_try_stacked_passport_crop(image):
        return document

    best = document
    best_score = _mrz_band_score(best)
    height = image.shape[0]
    for start_ratio in (0.35, 0.40, 0.45, 0.50, 0.55, 0.65):
        lower_band = image[int(height * start_ratio) :, :]
        candidate = detect_document_crop(lower_band)
        if candidate is None:
            candidate = lower_band
        if not _is_plausible_passport_crop(candidate):
            continue
        score = _mrz_band_score(candidate)
        if _is_better_passport_data_crop(candidate, score, best, best_score):
            best = candidate
            best_score = score
    return best


def _should_try_stacked_passport_crop(image: object) -> bool:
    height, width = image.shape[:2]
    return height > width * 1.15 and height >= 1000


def _is_plausible_passport_crop(image: object | None) -> bool:
    if image is None:
        return False
    height, width = image.shape[:2]
    if min(height, width) < 200:
        return False
    aspect_ratio = max(width, height) / max(min(width, height), 1)
    return 1.1 <= aspect_ratio <= 2.5


def _is_better_passport_data_crop(
    candidate: object,
    candidate_score: float,
    current: object | None,
    current_score: float,
) -> bool:
    if current is not None and _would_overcrop_passport_page(candidate, current) and candidate_score <= current_score + 8.0:
        return False
    if candidate_score > current_score:
        return True
    if current is None:
        return candidate_score > 0.0
    if candidate_score < max(120.0, current_score * 0.92):
        return False
    if _has_full_passport_page_aspect(current) and _is_overly_wide_passport_slice(candidate):
        return False
    candidate_height = candidate.shape[0]
    current_height = current.shape[0]
    return candidate_height < current_height * 0.82


def _would_overcrop_passport_page(candidate: object, current: object) -> bool:
    return _long_side_ratio(candidate) > 1.60 and _long_side_ratio(current) >= 1.18


def _has_full_passport_page_aspect(image: object) -> bool:
    ratio = _long_side_ratio(image)
    return 1.30 <= ratio <= 1.75


def _is_overly_wide_passport_slice(image: object) -> bool:
    return _long_side_ratio(image) > 1.90


def _long_side_ratio(image: object) -> float:
    height, width = image.shape[:2]
    return max(width, height) / max(min(width, height), 1)


def _mrz_band_score(image: object | None) -> float:
    if image is None or cv2 is None:
        return 0.0
    gray = _to_gray(image)
    if not hasattr(gray, "shape"):
        return []
    height, width = gray.shape[:2]
    if height < 120 or width < 300:
        return 0.0
    band = gray[int(height * 0.62) : int(height * 0.95), :]
    if band.size == 0:
        return 0.0
    dark = band < 110
    row_counts = dark.sum(axis=1)
    strong_rows = row_counts > width * 0.018
    best_coverage = 0.0
    best_dark_ratio = 0.0
    start = None
    for index, is_strong in enumerate(strong_rows.tolist() + [False]):
        if is_strong and start is None:
            start = index
            continue
        if is_strong or start is None:
            continue
        group = dark[start:index, :]
        start = None
        if group.shape[0] < 2:
            continue
        columns = group.any(axis=0)
        coverage = float(columns.sum()) / max(width, 1)
        dark_ratio = float(group.sum()) / max(group.size, 1)
        if coverage > best_coverage:
            best_coverage = coverage
            best_dark_ratio = dark_ratio
    if best_coverage < 0.35:
        return 0.0
    return best_coverage * 100.0 + best_dark_ratio * 1000.0


def _score_mrz_variant_priority(variant: object) -> float:
    """
    Hitung skor prioritas variant berdasarkan karakteristik gambar.
    Variant dengan skor lebih tinggi diproses lebih dulu.
    Menggunakan mrz_band_score yang sudah ada.
    """
    if variant is None:
        return 0.0
    return _mrz_band_score(variant)


def _build_mrz_variants(image: object, document: object | None) -> list[tuple[object, str]]:
    seen_shapes: set[tuple[int, int, int]] = set()
    unsorted_variants: list[tuple[float, object, str]] = []  # (priority, variant, note)

    for base, note_prefix in (
        (document, "MRZ recovered from document crop."),
        (image, "MRZ recovered from enhanced image."),
    ):
        if base is None:
            continue
        base = _resize_to_max_edge(base, max_edge=DEFAULT_MRZ_VARIANT_MAX_EDGE)
        shape_key = tuple(base.shape)
        if shape_key in seen_shapes:
            continue
        seen_shapes.add(shape_key)

        candidate_variants = [
            (base, note_prefix),
            (_denoise_document(base), note_prefix),
            (_enhance_for_mrz(base), note_prefix),
            (_enhance_for_mrz(_lower_band(base, 0.45)), note_prefix),
            (_enhance_for_mrz(_lower_band(base, 0.58)), note_prefix),
        ]
        for variant, note in candidate_variants:
            if variant is not None:
                priority = _score_mrz_variant_priority(variant)
                unsorted_variants.append((priority, variant, note))

    # Urutkan: skor tertinggi lebih dulu
    unsorted_variants.sort(key=lambda x: x[0], reverse=True)
    return [(variant, note) for _, variant, note in unsorted_variants if variant is not None]


def _enhance_for_mrz(image: object | None) -> object | None:
    if image is None:
        return None
    gray = _to_gray(image)
    if _deskew_enabled():
        gray = _to_gray(deskew_image(gray))
    if gray.shape[1] < 1400:
        scale = min(2.0, 1400.0 / max(gray.shape[1], 1))
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    sharpened = cv2.addWeighted(clahe, 1.6, cv2.GaussianBlur(clahe, (0, 0), 2.0), -0.6, 0)
    binary = cv2.adaptiveThreshold(
        sharpened,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        11,
    )
    return binary


def _denoise_document(image: object | None) -> object | None:
    if image is None:
        return None
    return cv2.bilateralFilter(image, 7, 60, 60)


def _lower_band(image: object, start_ratio: float) -> object | None:
    if image is None:
        return None
    height = image.shape[0]
    return image[int(height * start_ratio) :, :]


def _edge_projection_crop(image: object | None) -> object | None:
    if image is None:
        return None
    gray = _to_gray(image)
    edges = cv2.Canny(gray, 80, 180)
    columns = np.where(edges.mean(axis=0) > 5.0)[0]
    rows = np.where(edges.mean(axis=1) > 5.0)[0]
    if len(columns) == 0 or len(rows) == 0:
        return None

    x1 = max(int(columns.min()) - 20, 0)
    x2 = min(int(columns.max()) + 30, image.shape[1])
    y1 = max(int(rows.min()) - 20, 0)
    y2 = min(int(rows.max()) + 30, image.shape[0])
    if x2 - x1 < image.shape[1] * 0.45 or y2 - y1 < image.shape[0] * 0.45:
        return None
    return image[y1:y2, x1:x2]


def _warp_box(image: object, box: object) -> object | None:
    ordered = _order_points(box)
    width, height = _rect_size(ordered)
    if min(width, height) < 50:
        return None
    destination = np.array(
        [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
        dtype="float32",
    )
    matrix = cv2.getPerspectiveTransform(ordered.astype("float32"), destination)
    return cv2.warpPerspective(image, matrix, (width, height))


def _order_points(points: object) -> object:
    points = np.array(points, dtype="float32")
    sums = points.sum(axis=1)
    diffs = np.diff(points, axis=1).reshape(-1)
    return np.array(
        [
            points[sums.argmin()],
            points[diffs.argmin()],
            points[sums.argmax()],
            points[diffs.argmax()],
        ],
        dtype="float32",
    )


def _rect_size(points: object) -> tuple[int, int]:
    ordered = _order_points(points)
    width = int(max(_distance(ordered[0], ordered[1]), _distance(ordered[2], ordered[3])))
    height = int(max(_distance(ordered[0], ordered[3]), _distance(ordered[1], ordered[2])))
    return width, height


def _distance(point_a: object, point_b: object) -> float:
    return float((((point_a[0] - point_b[0]) ** 2) + ((point_a[1] - point_b[1]) ** 2)) ** 0.5)


def _load_image(file_path: str) -> object | None:
    if cv2 is None:
        return None
    return cv2.imread(file_path)


def _to_gray(image: object) -> object:
    if len(image.shape) == 2:
        return image
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)


def _deskew_enabled() -> bool:
    value = os.environ.get("PASSPORT_DESKEW_ENABLED", "1").strip().lower()
    return value not in {"0", "false", "no", "off"}


def _estimate_skew_angle(gray: object) -> float:
    """
    Estimasi sudut kemiringan dokumen menggunakan Hough Line Transform.
    Hanya digunakan untuk koreksi kecil (-15 hingga +15 derajat).
    Mengembalikan 0.0 jika tidak ada kemiringan yang terdeteksi dengan keyakinan cukup.
    """
    if cv2 is None or gray is None:
        return 0.0
    if not hasattr(gray, "shape"):
        return []
    height, width = gray.shape[:2]
    if height < 200 or width < 300:
        return 0.0
    # Edge detection pada gambar yang sudah di-resize untuk hemat CPU
    scale = min(1.0, 1000.0 / max(width, 1))
    small = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else gray
    edges = cv2.Canny(small, 50, 150, apertureSize=3)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=60, minLineLength=80, maxLineGap=10)
    if lines is None or len(lines) == 0:
        return 0.0
    angles = []
    for line in lines:
        x1, y1, x2, y2 = line[0]
        if x2 == x1:
            continue
        angle = float(np.degrees(np.arctan2(y2 - y1, x2 - x1)))
        # Hanya ambil garis yang mendekati horizontal (kemungkinan besar baris teks)
        if -20 <= angle <= 20:
            angles.append(angle)
    if len(angles) < 5:
        return 0.0
    # Gunakan median agar robust terhadap outlier
    median_angle = float(np.median(angles))
    # Hanya koreksi jika sudut cukup berarti (lebih dari 0.5 derajat)
    return median_angle if abs(median_angle) >= 0.5 else 0.0


def deskew_image(image: object, max_angle: float = 12.0) -> object:
    """
    Koreksi kemiringan gambar berdasarkan estimasi sudut Hough.
    Hanya aktif jika sudut terdeteksi dan dalam batas max_angle.
    Selalu mengembalikan gambar (tidak pernah None).
    """
    if cv2 is None or image is None:
        return image
    gray = _to_gray(image) if hasattr(image, "shape") and len(image.shape) == 3 else image
    angle = _estimate_skew_angle(gray)
    if abs(angle) < 0.5 or abs(angle) > max_angle:
        return image
    height, width = image.shape[:2]
    center = (width / 2, height / 2)
    matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
    rotated = cv2.warpAffine(
        image, matrix, (width, height),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REPLICATE,
    )
    return rotated


def detect_horizontal_field_lines(image: object) -> list[int]:
    """
    Mendeteksi posisi Y dari garis-garis horizontal utama dalam paspor.
    Garis-garis ini sering menjadi pemisah antar field pada paspor Indonesia.
    Mengembalikan daftar koordinat Y (diurutkan dari atas ke bawah).
    """
    if cv2 is None or image is None:
        return []
    
    gray = _to_gray(image) if hasattr(image, "shape") and len(image.shape) == 3 else image
    if not hasattr(gray, "shape"):
        return []
    height, width = gray.shape[:2]
    
    # 1. Edge detection dengan threshold yang sensitif untuk garis
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 30, 100, apertureSize=3)
    
    # 2. Morphological operation untuk menyambung garis putus-putus horizontal
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 1))
    connected = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)
    
    # 3. Proyeksi horizontal (jumlah pixel putih per baris)
    row_sums = np.sum(connected > 0, axis=1)
    
    # 4. Cari puncak proyeksi (baris dengan banyak pixel putih)
    # Garis biasanya memenuhi setidaknya 15% dari lebar halaman
    threshold = width * 0.15 
    peaks = []
    
    # Simple peak finding
    for y in range(1, height - 1):
        if row_sums[y] > threshold and row_sums[y] >= row_sums[y-1] and row_sums[y] >= row_sums[y+1]:
            peaks.append((y, row_sums[y]))
            
    # 5. Filter puncak yang terlalu berdekatan (ambil yang paling kuat)
    merged_peaks = []
    min_distance = height * 0.02 # Minimal jarak antar garis 2% tinggi
    
    for y, strength in sorted(peaks, key=lambda p: p[0]):
        if not merged_peaks:
            merged_peaks.append((y, strength))
        else:
            last_y, last_strength = merged_peaks[-1]
            if y - last_y < min_distance:
                if strength > last_strength:
                    merged_peaks[-1] = (y, strength)
            else:
                merged_peaks.append((y, strength))
                
    return [y for y, _ in merged_peaks]


def snap_crop_to_field_lines(
    y_start_ratio: float,
    y_end_ratio: float,
    image_height: int,
    field_lines: list[int],
    *,
    snap_tolerance_px: int = 20,
) -> tuple[int, int]:
    """
    Sesuaikan batas crop (y_start, y_end) agar sejajar dengan garis horizontal terdekat.
    Mengembalikan (y_start_px, y_end_px) dalam pixel.
    """
    y_start_px = int(y_start_ratio * image_height)
    y_end_px = int(y_end_ratio * image_height)
    if not field_lines:
        return y_start_px, y_end_px
    
    # Snap y_start ke garis terdekat di bawah threshold
    for line_y in field_lines:
        if abs(line_y - y_start_px) <= snap_tolerance_px:
            y_start_px = line_y
            break
            
    # Snap y_end ke garis terdekat di bawah threshold
    for line_y in reversed(field_lines):
        if abs(line_y - y_end_px) <= snap_tolerance_px:
            y_end_px = line_y
            break
            
    return y_start_px, y_end_px


def _ensure_temp_root() -> str:
    service_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    temp_root = os.path.join(service_root, ".tmp")
    os.makedirs(temp_root, exist_ok=True)
    return temp_root


def cleanup_temp_root() -> None:
    temp_root = _ensure_temp_root()
    if os.path.basename(temp_root) != ".tmp":
        return
    for entry in os.scandir(temp_root):
        try:
            if entry.is_dir():
                shutil.rmtree(entry.path, ignore_errors=True)
            else:
                os.remove(entry.path)
        except OSError:
            continue


@lru_cache(maxsize=4)
def _build_processed_document_image_cached(file_path: str, max_edge: int) -> object | None:
    started = perf_counter()
    input_pixels = 0
    output_pixels = 0
    estimated_peak_mb = 0.0
    try:
        image = _load_image(file_path)
        if image is None:
            return None
        input_pixels = int(image.shape[0] * image.shape[1])
        processed = _preprocess_document_for_visual_ocr(image, max_edge=max_edge)
        if processed is None:
            return None
        output_pixels = int(processed.shape[0] * processed.shape[1])
        estimated_peak_mb = _estimate_preprocess_peak_mb(image, processed)
        return processed
    except Exception:  # noqa: BLE001
        _IMAGE_PREPROCESS_STATS["errorCount"] += 1
        return None
    finally:
        elapsed_ms = max(0, int((perf_counter() - started) * 1000))
        _IMAGE_PREPROCESS_STATS["callCount"] += 1
        _IMAGE_PREPROCESS_STATS["totalMs"] += elapsed_ms
        _IMAGE_PREPROCESS_STATS["maxMs"] = max(_IMAGE_PREPROCESS_STATS["maxMs"], elapsed_ms)
        _IMAGE_PREPROCESS_STATS["inputMegaPixels"] += input_pixels / 1_000_000
        _IMAGE_PREPROCESS_STATS["outputMegaPixels"] += output_pixels / 1_000_000
        _IMAGE_PREPROCESS_STATS["estimatedPeakMb"] = max(
            float(_IMAGE_PREPROCESS_STATS["estimatedPeakMb"]),
            estimated_peak_mb,
        )


def _preprocess_document_for_visual_ocr(image: object, *, max_edge: int) -> object | None:
    document = detect_passport_data_page_crop(image)
    if document is None:
        document = image
    if _deskew_enabled():
        document = deskew_image(document)
    gray = _to_gray(document)
    gray = _resize_to_max_edge(gray, max_edge=max_edge)
    normalized = _normalize_background(gray)
    clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8)).apply(normalized)
    sharpened = cv2.addWeighted(clahe, 1.35, cv2.GaussianBlur(clahe, (0, 0), 1.2), -0.35, 0)
    return cv2.normalize(sharpened, None, 0, 255, cv2.NORM_MINMAX)


def _normalize_background(gray: object) -> object:
    kernel_size = min(31, max(3, (min(gray.shape[:2]) // 18) | 1))
    background = cv2.medianBlur(gray, kernel_size)
    normalized = cv2.divide(gray, background, scale=255)
    return cv2.normalize(normalized, None, 0, 255, cv2.NORM_MINMAX)


def _resize_to_max_edge(image: object, *, max_edge: int) -> object:
    if max_edge <= 0:
        return image
    height, width = image.shape[:2]
    longest = max(height, width, 1)
    if longest <= max_edge:
        return image
    scale = max_edge / longest
    return cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)


def _estimate_preprocess_peak_mb(input_image: object, output_image: object) -> float:
    input_bytes = int(getattr(input_image, "nbytes", 0) or 0)
    output_bytes = int(getattr(output_image, "nbytes", 0) or 0)
    return round((input_bytes + output_bytes * 5) / (1024 * 1024), 2)


def _image_preprocess_mode() -> str:
    value = os.environ.get("PASSPORT_IMAGE_PREPROCESS_MODE", "light").strip().lower()
    return "off" if value in {"0", "false", "no", "off"} else "light"


def _processed_document_max_edge() -> int:
    raw_value = os.environ.get("PASSPORT_IMAGE_PREPROCESS_MAX_EDGE", "")
    try:
        return max(600, int(raw_value)) if raw_value else DEFAULT_PROCESSED_DOCUMENT_MAX_EDGE
    except ValueError:
        return DEFAULT_PROCESSED_DOCUMENT_MAX_EDGE
