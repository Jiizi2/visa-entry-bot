from __future__ import annotations

import re
from collections.abc import Callable

try:
    import cv2
except ImportError:  # pragma: no cover - depends on local environment
    cv2 = None

try:
    import pytesseract
except ImportError:  # pragma: no cover - depends on local environment
    pytesseract = None

from services.ocr_result_cache import build_region_cache_key, get_cached_lines, store_cached_lines
from services.passport_page import collect_ocr_lines
from services.tesseract_runner import build_tesseract_config, run_tesseract_ocr


def scan_region_texts(
    region: object,
    psm: int,
    whitelist: str,
    variant_mode: str = "fast",
    max_lines: int = 10,
    stop_when: Callable[[list[str]], bool] | None = None,
    include_psm_fallback: bool = True,
) -> list[str]:
    cache_key = build_region_cache_key(
        "scan",
        region,
        psm,
        whitelist,
        variant_mode,
        max_lines,
        int(include_psm_fallback),
    )
    cached = get_cached_lines(cache_key)
    if cached is not None:
        return cached
    psm_values = (
        (psm, 6 if psm != 6 else 7)
        if include_psm_fallback
        else (psm,)
    )
    texts = collect_ocr_lines(
        region,
        psm_values=psm_values,
        whitelist=whitelist,
        variant_mode=variant_mode,
        max_lines=max_lines,
        stop_when=stop_when,
    )
    if stop_when is not None and stop_when(texts):
        return store_cached_lines(cache_key, _unique(texts))
    if _has_sufficient_seed_text(texts):
        return store_cached_lines(cache_key, _unique(texts))
    if cv2 is None or pytesseract is None:
        return store_cached_lines(cache_key, _unique(texts))
    config = build_tesseract_config(psm=psm, whitelist=whitelist)
    for variant in _build_variants(region):
        text = run_tesseract_ocr(variant, config).strip()
        if text:
            texts.append(text)
            if stop_when is not None and stop_when(texts):
                return store_cached_lines(cache_key, _unique(texts))
    return store_cached_lines(cache_key, _unique(texts))


def _build_variants(region: object) -> list[object]:
    gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY) if len(region.shape) == 3 else region
    gray = cv2.resize(gray, None, fx=4.0, fy=4.0, interpolation=cv2.INTER_CUBIC)
    return [gray, cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8)).apply(gray)]


def _unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    unique_values: list[str] = []
    for value in values:
        if value not in seen:
            unique_values.append(value)
            seen.add(value)
    return unique_values


def _has_sufficient_seed_text(texts: list[str]) -> bool:
    cleaned = [re.sub(r"[^A-Z0-9]", "", text.upper()) for text in texts if text]
    if len(cleaned) >= 2:
        return True
    return any(len(value) >= 8 for value in cleaned)
