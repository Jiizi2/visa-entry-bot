from __future__ import annotations

import os
import re
from time import perf_counter

try:
    from rapidocr_onnxruntime import RapidOCR
    RAPID_OCR_INSTANCE = RapidOCR()
except ImportError:
    RAPID_OCR_INSTANCE = None

DEFAULT_OCR_TIMEOUT_SECONDS = 8.0
_STATS = {
    "callCount": 0,
    "errorCount": 0,
    "totalMs": 0,
    "maxMs": 0,
}

_SERVICES_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

def _user_words_path(filename: str) -> str | None:
    path = os.path.join(_SERVICES_DATA_DIR, filename)
    return path if os.path.isfile(path) else None

def build_ocr_config(
    *,
    whitelist: str = "",
    dpi: int | None = None,
    preserve_interword_spaces: bool = False,
    user_words_file: str | None = None,
) -> str:
    parts = []
    if dpi is not None:
        parts.append(f"-c user_defined_dpi={int(dpi)}")
    if preserve_interword_spaces:
        parts.append("-c preserve_interword_spaces=1")
    if whitelist:
        parts.append(f"-c tessedit_char_whitelist={whitelist}")
    if user_words_file and os.path.isfile(user_words_file):
        parts.append(f"--user-words \"{user_words_file}\"")
    return " ".join(parts)

def run_rapid_ocr(image: object, config: str, *, timeout_seconds: float | None = None) -> str:
    if image is None or RAPID_OCR_INSTANCE is None:
        return ""
    
    whitelist = ""
    match = re.search(r"tessedit_char_whitelist=([^\s]+)", config)
    if match:
        whitelist = match.group(1).replace("\"", "").replace("'", "")
        
    started = perf_counter()
    _STATS["callCount"] += 1
    try:
        result, _ = RAPID_OCR_INSTANCE(image)
        if not result:
            return ""
            
        lines = []
        for box, text, confidence in result:
            if whitelist:
                filtered = "".join(c for c in text if c in whitelist or c.isspace())
                filtered = filtered.strip()
                if filtered:
                    lines.append(filtered)
            else:
                lines.append(text.strip())
                
        return "\n".join(lines)
    except Exception:  # noqa: BLE001
        _STATS["errorCount"] += 1
        return ""
    finally:
        elapsed_ms = max(0, int((perf_counter() - started) * 1000))
        _STATS["totalMs"] += elapsed_ms
        _STATS["maxMs"] = max(_STATS["maxMs"], elapsed_ms)

def is_ocr_available() -> bool:
    return RAPID_OCR_INSTANCE is not None

def timed_rapid_ocr(image: object, config: str, *, timeout_seconds: float | None = None) -> tuple[str, int]:
    started = perf_counter()
    text = run_rapid_ocr(image, config, timeout_seconds=timeout_seconds)
    return text, int((perf_counter() - started) * 1000)

def get_ocr_stats() -> dict[str, int | float]:
    return {
        **_STATS,
        "timeoutSeconds": _resolve_timeout(),
    }

def reset_ocr_stats() -> None:
    for key in _STATS:
        _STATS[key] = 0

def _resolve_timeout(timeout_seconds: float | None = None) -> float:
    if timeout_seconds is not None:
        return max(float(timeout_seconds), 0.1)
    raw_timeout = os.environ.get("OCR_TIMEOUT_SECONDS", "")
    try:
        return max(float(raw_timeout), 0.1) if raw_timeout else DEFAULT_OCR_TIMEOUT_SECONDS
    except ValueError:
        return DEFAULT_OCR_TIMEOUT_SECONDS
