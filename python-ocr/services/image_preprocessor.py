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

    document = detect_document_crop(image)
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

    document = detect_document_crop(image)
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


def _build_mrz_variants(image: object, document: object | None) -> list[tuple[object, str]]:
    variants: list[tuple[object, str]] = []
    seen_shapes: set[tuple[int, int, int]] = set()
    for base, note_prefix in (
        (document, "MRZ recovered from document crop."),
        (image, "MRZ recovered from enhanced image."),
    ):
        if base is None:
            continue
        shape_key = tuple(base.shape)
        if shape_key in seen_shapes:
            continue
        seen_shapes.add(shape_key)
        variants.extend(
            [
                (base, note_prefix),
                (_denoise_document(base), note_prefix),
                (_enhance_for_mrz(base), note_prefix),
                (_enhance_for_mrz(_lower_band(base, 0.45)), note_prefix),
                (_enhance_for_mrz(_lower_band(base, 0.58)), note_prefix),
            ]
        )
    return [(variant, note) for variant, note in variants if variant is not None]


def _enhance_for_mrz(image: object | None) -> object | None:
    if image is None:
        return None
    gray = _to_gray(image)
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
    document = detect_document_crop(image)
    if document is None:
        document = image
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
