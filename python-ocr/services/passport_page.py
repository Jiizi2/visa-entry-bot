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

from services.image_preprocessor import temporary_mrz_variants
from services.ocr_result_cache import build_region_cache_key, get_cached_lines, store_cached_lines
from services.ocr_runner import build_ocr_config, run_rapid_ocr


@lru_cache(maxsize=8)
def extract_aligned_passport_page(file_path: str) -> object | None:
    if cv2 is None:
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


def crop_relative(
    image: object,
    top: float,
    bottom: float,
    left: float = 0.0,
    right: float = 1.0,
    field_lines: list[int] | None = None,
) -> object | None:
    if image is None:
        return None
    height, width = image.shape[:2]
    if field_lines:
        from services.image_preprocessor import snap_crop_to_field_lines
        y1, y2 = snap_crop_to_field_lines(top, bottom, height, field_lines)
    else:
        y1, y2 = int(height * top), int(height * bottom)
    x1, x2 = int(width * left), int(width * right)
    if y2 - y1 <= 0 or x2 - x1 <= 0:
        return None
    return image[y1:y2, x1:x2]



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
    from services.ocr_runner import RAPID_OCR_INSTANCE
    if RAPID_OCR_INSTANCE is None:
        return None

    image = cv2.imread(file_path)
    if image is None:
        return None

    try:
        height, width = image.shape[:2]
        scale = 800.0 / max(height, width)
        if scale < 1.0:
            small_image = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        else:
            small_image = image
            scale = 1.0

        result, _ = RAPID_OCR_INSTANCE(small_image)
        if not result:
            return None
    except Exception:
        return None

    all_points = []
    for box, text, conf in result:
        # Match MRZ lines: containing '<' or long uppercase strings
        if text.count('<') >= 1 or text.count('>') >= 1 or (len(text) > 10 and bool(re.search(r'[A-Z0-9]{10,}', text))):
            for point in box:
                all_points.append([point[0] / scale, point[1] / scale])

    if not all_points:
        return None

    points_array = np.array(all_points, dtype=np.float32)
    rect = cv2.minAreaRect(points_array)
    box_points = cv2.boxPoints(rect)

    points = box_points
    edges = [points[(index + 1) % 4] - points[index] for index in range(4)]
    lengths = [float((edge[0] ** 2 + edge[1] ** 2) ** 0.5) for edge in edges]
    long_edge = edges[lengths.index(max(lengths))]
    length = max(lengths)
    u_x, u_y = float(long_edge[0] / length), float(long_edge[1] / length)
    v_x, v_y = -u_y, u_x
    if v_y > 0:
        v_x, v_y = -v_x, -v_y

    center_x = sum(point[0] for point in points) / 4
    center_y = sum(point[1] for point in points) / 4
    return center_y, center_x, max(lengths), min(lengths), u_x, u_y, v_x, v_y


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


def _to_float32(points: list[tuple[float, float]]) -> object:
    return np.array(points, dtype="float32")


def _to_gray(region: object) -> object:
    if len(region.shape) == 2:
        return region
    return cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)


def collect_ocr_lines(
    region: object,
    psm_values: tuple[int, ...] = (6,),
    whitelist: str = "",
    variant_mode: str = "default",
    max_lines: int = 0,
    stop_when: object = None,
    oem: int = 3,
    user_words_file: object = None
) -> list[str]:
    from services.visual_region_scanner import scan_region_texts
    return scan_region_texts(
        region=region,
        whitelist=whitelist,
        variant_mode=variant_mode,
        max_lines=max_lines or 10,
        stop_when=stop_when,
        include_psm_fallback=False,
        oem=oem,
        user_words_file=user_words_file
    )
