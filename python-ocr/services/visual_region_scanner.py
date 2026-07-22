from __future__ import annotations

import re
import os
from collections.abc import Callable

try:
    import cv2
except ImportError:  # pragma: no cover - depends on local environment
    cv2 = None

from services.ocr_result_cache import build_region_cache_key, get_cached_lines, store_cached_lines
from services.ocr_runner import build_ocr_config, run_rapid_ocr
from services.models import OcrProfile
from services.ocr_constants import OCR_PROFILE_ALIASES

def _get_active_profile() -> str:
    value = os.environ.get("PASSPORT_OCR_PROFILE", OcrProfile.SPEED).strip().lower()
    value = OCR_PROFILE_ALIASES.get(value, value)
    return value if value in {OcrProfile.SPEED, OcrProfile.BALANCED, OcrProfile.HEAVY} else OcrProfile.SPEED



def scan_region_texts(
    region: object,
    whitelist: str,
    variant_mode: str = "fast",
    max_lines: int = 10,
    stop_when: Callable[[list[str]], bool] | None = None,
    include_psm_fallback: bool = True, # Kept for API compatibility, unused
    oem: int = 3, # Kept for API compatibility, unused
    user_words_file: str | None = None,
) -> list[str]:
    cache_key = build_region_cache_key(
        "scan",
        region,
        1, # default psm dummy
        whitelist,
        variant_mode,
        max_lines,
        int(include_psm_fallback),
        oem,
        str(user_words_file),
    )
    cached = get_cached_lines(cache_key)
    if cached is not None:
        return cached

    if cv2 is None or region is None:
        return []

    config = build_ocr_config(
        whitelist=whitelist, 
        user_words_file=user_words_file
    )

    seen: set[str] = set()
    texts: list[str] = []

    for variant in _build_variants(region, variant_mode=variant_mode):
        text_result = run_rapid_ocr(variant, config).strip()
        for raw_line in text_result.splitlines():
            cleaned = re.sub(r"\s+", " ", raw_line).strip()
            if cleaned and cleaned not in seen:
                seen.add(cleaned)
                texts.append(cleaned)
                if max_lines and len(texts) >= max_lines:
                    return store_cached_lines(cache_key, texts)
                if stop_when is not None and stop_when(texts):
                    return store_cached_lines(cache_key, texts)

    return store_cached_lines(cache_key, texts)


def _build_variants(region: object, variant_mode: str = "default") -> list[object]:
    profile = _get_active_profile()

    if len(region.shape) == 3 and region.shape[2] == 4:
        gray = cv2.cvtColor(region, cv2.COLOR_BGRA2GRAY)
    elif len(region.shape) == 3:
        gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
    else:
        gray = region
        
    scale = 2.0 if profile == OcrProfile.SPEED else 4.0
    scaled = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    
    if profile == OcrProfile.SPEED:
        return [scaled]
    
    variants = [scaled]
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8)).apply(scaled)
    variants.append(clahe)

    if variant_mode in {"fast", "hint", "location"}:
        return variants

    if variant_mode == "numeric":
        _, thresholded = cv2.threshold(clahe, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        variants.append(thresholded)
        return variants
    
    sharpened = cv2.addWeighted(clahe, 1.5, cv2.GaussianBlur(clahe, (0, 0), 1.5), -0.5, 0)
    variants.append(sharpened)
    
    if profile == OcrProfile.BALANCED:
        return variants
    
    denoised = cv2.fastNlMeansDenoising(sharpened, None, 10, 7, 21)
    variants.append(denoised)
    
    # Add adaptive thresholding to pierce through heavy hand/phone shadows
    adaptive = cv2.adaptiveThreshold(denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 9)
    variants.append(adaptive)
    
    return variants


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
