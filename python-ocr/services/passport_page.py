from __future__ import annotations

import os
import re
import shutil
import warnings
from functools import lru_cache

import numpy as np

try:
    import cv2
except ImportError:  # pragma: no cover - depends on local environment
    cv2 = None

try:
    import pytesseract
except ImportError:  # pragma: no cover - depends on local environment
    pytesseract = None

try:
    from passporteye.mrz.image import MRZPipeline
except ImportError:  # pragma: no cover - depends on local environment
    MRZPipeline = None

from services.image_preprocessor import temporary_mrz_variants
from services.ocr_result_cache import build_region_cache_key, get_cached_lines, store_cached_lines


def extract_aligned_passport_page(file_path: str) -> object | None:
    if cv2 is None or MRZPipeline is None or not configure_tesseract():
        return None
    page = _extract_page_from_path(file_path)
    if page is not None:
        return page
    with temporary_mrz_variants(file_path) as variants:
        for variant_path, _ in variants[1:]:
            page = _extract_page_from_path(variant_path)
            if page is not None:
                return page
    return None


def build_mrz_relative_crops(file_path: str, windows: tuple[tuple[float, float, float, float], ...]) -> list[object]:
    if cv2 is None:
        return []
    image = cv2.imread(file_path)
    if image is None:
        return []

    box = _resolve_mrz_box(file_path)
    if box is None:
        return []

    row, col, mrz_width, mrz_height, *_ = box
    crops = []
    for top_mul, bottom_mul, left_mul, right_mul in windows:
        top = max(int(row - mrz_height * top_mul), 0)
        bottom = max(int(row - mrz_height * bottom_mul), 0)
        left = max(int(col - mrz_width * left_mul), 0)
        right = min(int(col + mrz_width * right_mul), image.shape[1])
        if bottom - top > 20 and right - left > 80:
            crops.append(image[top:bottom, left:right])
    return crops


def crop_relative(image: object, top: float, bottom: float, left: float = 0.0, right: float = 1.0) -> object | None:
    if image is None:
        return None
    height, width = image.shape[:2]
    y1, y2 = int(height * top), int(height * bottom)
    x1, x2 = int(width * left), int(width * right)
    if y2 - y1 <= 0 or x2 - x1 <= 0:
        return None
    return image[y1:y2, x1:x2]


def collect_ocr_lines(
    region: object,
    psm_values: tuple[int, ...] = (6,),
    whitelist: str = "",
    variant_mode: str = "default",
    max_lines: int = 0,
) -> list[str]:
    if region is None or cv2 is None or pytesseract is None or not configure_tesseract():
        return []

    cache_key = build_region_cache_key("collect", region, psm_values, whitelist, variant_mode, max_lines)
    cached = get_cached_lines(cache_key)
    if cached is not None:
        return cached

    config_suffix = f" -c tessedit_char_whitelist={whitelist}" if whitelist else ""
    seen: set[str] = set()
    lines: list[str] = []
    for variant in _build_variants(region, variant_mode):
        for psm in psm_values:
            text = pytesseract.image_to_string(variant, config=f"--oem 3 --psm {psm}{config_suffix}")
            for raw_line in text.splitlines():
                cleaned = re.sub(r"\s+", " ", raw_line).strip()
                if cleaned and cleaned not in seen:
                    seen.add(cleaned)
                    lines.append(cleaned)
                    if max_lines and len(lines) >= max_lines:
                        return store_cached_lines(cache_key, lines)
    return store_cached_lines(cache_key, lines)


def configure_tesseract() -> bool:
    if pytesseract is None:
        return False
    tesseract_cmd = _resolve_tesseract_cmd()
    if tesseract_cmd is None:
        return False
    pytesseract.pytesseract.tesseract_cmd = tesseract_cmd
    return True


def _build_variants(region: object, mode: str = "default") -> list[object]:
    gray = _to_gray(region)
    scale = 2.2 if gray.shape[1] < 900 else 1.8
    enlarged = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(enlarged)
    sharpened = cv2.addWeighted(clahe, 1.5, cv2.GaussianBlur(clahe, (0, 0), 1.5), -0.5, 0)
    denoised = cv2.medianBlur(sharpened, 3)
    _, otsu = cv2.threshold(denoised, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    adaptive = cv2.adaptiveThreshold(
        denoised,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        9,
    )
    if mode == "numeric":
        return [otsu]
    if mode == "hint":
        return [clahe, otsu]
    if mode == "fast":
        return [clahe, otsu]
    return [clahe, otsu, adaptive]


def _extract_page_from_path(file_path: str) -> object | None:
    image = cv2.imread(file_path)
    if image is None:
        return None
    box = _resolve_mrz_box(file_path)
    if box is None:
        return None
    return _warp_from_box(image, box)


@lru_cache(maxsize=256)
def _resolve_mrz_box(file_path: str) -> tuple[float, float, float, float, float, float, float, float] | None:
    if MRZPipeline is None or not configure_tesseract():
        return None

    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", category=FutureWarning, module="passporteye")
        warnings.filterwarnings("ignore", category=FutureWarning, module="skimage")
        pipeline = MRZPipeline(file_path)
        box_index = pipeline["box_idx"]
        if box_index is None:
            return None
        box = pipeline["boxes"][box_index]
        scale = 1.0 / pipeline["scale_factor"]

    points = _to_xy_points(box.as_poly() * scale)
    edges = [points[(index + 1) % 4] - points[index] for index in range(4)]
    lengths = [float((edge[0] ** 2 + edge[1] ** 2) ** 0.5) for edge in edges]
    long_edge = edges[lengths.index(max(lengths))]
    length = max(lengths)
    u_x, u_y = float(long_edge[0] / length), float(long_edge[1] / length)
    v_x, v_y = -u_y, u_x
    if v_y > 0:
        v_x, v_y = -v_x, -v_y

    center_x = sum(point[0] for point in points) / len(points)
    center_y = sum(point[1] for point in points) / len(points)
    return center_y, center_x, max(lengths), min(lengths), u_x, u_y, v_x, v_y


def _resolve_tesseract_cmd() -> str | None:
    for candidate in (
        os.environ.get("TESSERACT_CMD"),
        shutil.which("tesseract"),
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    ):
        if candidate and os.path.exists(candidate):
            return candidate
    return None


def _warp_from_box(image: object, box: tuple[float, float, float, float, float, float, float, float]) -> object:
    row, col, mrz_width, mrz_height, u_x, u_y, v_x, v_y = box
    crop_width = mrz_width * 1.08
    top_height = mrz_height * 7.2
    bottom_height = mrz_height * 0.25
    center = (col, row)
    u = (u_x, u_y)
    v = (v_x, v_y)
    src = [
        _point(center, u, v, -crop_width / 2, top_height),
        _point(center, u, v, crop_width / 2, top_height),
        _point(center, u, v, crop_width / 2, -bottom_height),
        _point(center, u, v, -crop_width / 2, -bottom_height),
    ]
    dst_width = int(round(crop_width))
    dst_height = int(round(top_height + bottom_height))
    dst = [(0, 0), (dst_width - 1, 0), (dst_width - 1, dst_height - 1), (0, dst_height - 1)]
    matrix = cv2.getPerspectiveTransform(_to_float32(src), _to_float32(dst))
    return cv2.warpPerspective(image, matrix, (dst_width, dst_height))


def _point(center: tuple[float, float], u: tuple[float, float], v: tuple[float, float], along: float, vertical: float) -> tuple[float, float]:
    return center[0] + u[0] * along + v[0] * vertical, center[1] + u[1] * along + v[1] * vertical


def _to_xy_points(points: object) -> list[tuple[float, float]]:
    return np.array([(float(col), float(row)) for row, col in points], dtype=float)


def _to_float32(points: list[tuple[float, float]]) -> object:
    return np.array(points, dtype="float32")


def _to_gray(region: object) -> object:
    if len(region.shape) == 2:
        return region
    return cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
