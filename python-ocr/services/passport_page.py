from __future__ import annotations

import os
import re
import shutil
import warnings
from functools import lru_cache
from typing import Callable

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
from services.tesseract_runner import build_tesseract_config, run_tesseract_ocr


@lru_cache(maxsize=8)
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


def clear_passport_page_cache() -> None:
    extract_aligned_passport_page.cache_clear()
    _resolve_mrz_box.cache_clear()


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
    stop_when: Callable[[list[str]], bool] | None = None,
) -> list[str]:
    if region is None or cv2 is None or pytesseract is None or not configure_tesseract():
        return []

    cache_key = None if stop_when is not None else build_region_cache_key("collect", region, psm_values, whitelist, variant_mode, max_lines)
    cached = get_cached_lines(cache_key)
    if cached is not None:
        return cached

    seen: set[str] = set()
    lines: list[str] = []
    for variant in _build_variants(region, variant_mode):
        for psm in psm_values:
            config = build_tesseract_config(
                psm=psm,
                whitelist=whitelist,
                dpi=300,
                preserve_interword_spaces=True,
            )
            text = run_tesseract_ocr(variant, config)
            if not text:
                continue
            for raw_line in text.splitlines():
                cleaned = re.sub(r"\s+", " ", raw_line).strip()
                if cleaned and cleaned not in seen:
                    seen.add(cleaned)
                    lines.append(cleaned)
                    if stop_when is not None and stop_when(lines):
                        return store_cached_lines(cache_key, lines)
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
    scale = _ocr_scale(gray)
    enlarged = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    enlarged = _pad_for_tesseract(enlarged)
    normalized = _normalize_background(enlarged)
    deskewed = _deskew(normalized)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(deskewed)
    sharpened = cv2.addWeighted(clahe, 1.55, cv2.GaussianBlur(clahe, (0, 0), 1.4), -0.55, 0)
    denoised = cv2.fastNlMeansDenoising(sharpened, None, 8, 7, 21)
    _, otsu = cv2.threshold(denoised, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    adaptive = cv2.adaptiveThreshold(
        denoised,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        9,
    )
    if mode == "hint":
        return _unique_variants([clahe, denoised, otsu, adaptive])
    if mode == "fast":
        return _unique_variants([clahe, denoised, otsu, adaptive])
    local = cv2.adaptiveThreshold(
        denoised,
        255,
        cv2.ADAPTIVE_THRESH_MEAN_C,
        cv2.THRESH_BINARY,
        41,
        11,
    )
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    closed = cv2.morphologyEx(otsu, cv2.MORPH_CLOSE, kernel)
    if mode == "numeric":
        return _unique_variants([otsu, adaptive, local, closed])
    _, otsu_inv = cv2.threshold(denoised, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    opened = cv2.morphologyEx(otsu, cv2.MORPH_OPEN, kernel)
    return _unique_variants([clahe, denoised, otsu, adaptive, local, opened, closed, otsu_inv])


def _ocr_scale(gray: object) -> float:
    height, width = gray.shape[:2]
    shortest = max(min(height, width), 1)
    target_shortest = 220 if shortest < 140 else 320
    scale = max(1.6, target_shortest / shortest)
    if width < 700:
        scale = max(scale, 2.6)
    if width > 1600:
        scale = min(scale, 1.4)
    return min(scale, 4.0)


def _pad_for_tesseract(gray: object) -> object:
    border = max(12, min(gray.shape[:2]) // 16)
    return cv2.copyMakeBorder(gray, border, border, border, border, cv2.BORDER_CONSTANT, value=255)


def _normalize_background(gray: object) -> object:
    kernel_size = min(15, max(3, (min(gray.shape[:2]) // 8) | 1))
    background = cv2.medianBlur(gray, kernel_size)
    normalized = cv2.divide(gray, background, scale=255)
    return cv2.normalize(normalized, None, 0, 255, cv2.NORM_MINMAX)


def _deskew(gray: object) -> object:
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    coordinates = np.column_stack(np.where(binary > 0))
    if len(coordinates) < 20:
        return gray
    angle = cv2.minAreaRect(coordinates)[-1]
    if angle < -45:
        angle = 90 + angle
    if abs(angle) > 8:
        return gray
    height, width = gray.shape[:2]
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), angle, 1.0)
    return cv2.warpAffine(gray, matrix, (width, height), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def _unique_variants(variants: list[object]) -> list[object]:
    unique: list[object] = []
    seen: set[str] = set()
    for variant in variants:
        array = np.ascontiguousarray(variant)
        key = f"{array.shape}:{array.dtype}:{hash(array.tobytes())}"
        if key not in seen:
            seen.add(key)
            unique.append(variant)
    return unique


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
