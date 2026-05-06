from __future__ import annotations

import os
from time import perf_counter

try:
    import pytesseract
except ImportError:  # pragma: no cover - depends on local environment
    pytesseract = None

DEFAULT_TESSERACT_TIMEOUT_SECONDS = 8.0
_STATS = {
    "callCount": 0,
    "errorCount": 0,
    "totalMs": 0,
    "maxMs": 0,
}


def build_tesseract_config(
    *,
    psm: int,
    whitelist: str = "",
    dpi: int | None = None,
    preserve_interword_spaces: bool = False,
) -> str:
    parts = ["--oem 3", f"--psm {int(psm)}"]
    if dpi is not None:
        parts.append(f"-c user_defined_dpi={int(dpi)}")
    if preserve_interword_spaces:
        parts.append("-c preserve_interword_spaces=1")
    if whitelist:
        parts.append(f"-c tessedit_char_whitelist={whitelist}")
    return " ".join(parts)


def run_tesseract_ocr(image: object, config: str, *, timeout_seconds: float | None = None) -> str:
    if image is None or pytesseract is None:
        return ""
    timeout = _resolve_timeout(timeout_seconds)
    started = perf_counter()
    _STATS["callCount"] += 1
    try:
        return str(pytesseract.image_to_string(image, config=config, timeout=timeout) or "")
    except Exception:  # noqa: BLE001
        _STATS["errorCount"] += 1
        return ""
    finally:
        elapsed_ms = max(0, int((perf_counter() - started) * 1000))
        _STATS["totalMs"] += elapsed_ms
        _STATS["maxMs"] = max(_STATS["maxMs"], elapsed_ms)


def is_tesseract_available() -> bool:
    return pytesseract is not None


def timed_tesseract_ocr(image: object, config: str, *, timeout_seconds: float | None = None) -> tuple[str, int]:
    started = perf_counter()
    text = run_tesseract_ocr(image, config, timeout_seconds=timeout_seconds)
    return text, int((perf_counter() - started) * 1000)


def get_tesseract_ocr_stats() -> dict[str, int | float]:
    return {
        **_STATS,
        "timeoutSeconds": _resolve_timeout(),
    }


def reset_tesseract_ocr_stats() -> None:
    for key in _STATS:
        _STATS[key] = 0


def _resolve_timeout(timeout_seconds: float | None = None) -> float:
    if timeout_seconds is not None:
        return max(float(timeout_seconds), 0.1)
    raw_timeout = os.environ.get("OCR_TESSERACT_TIMEOUT_SECONDS", "")
    try:
        return max(float(raw_timeout), 0.1) if raw_timeout else DEFAULT_TESSERACT_TIMEOUT_SECONDS
    except ValueError:
        return DEFAULT_TESSERACT_TIMEOUT_SECONDS
