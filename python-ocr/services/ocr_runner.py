from __future__ import annotations

import os
import re
from time import perf_counter

from services.ocr_observation import OcrDetailedResult, build_observation

max_threads = os.environ.get("PASSPORT_OCR_MAX_THREADS", "").strip()
if max_threads:
    os.environ["OMP_NUM_THREADS"] = max_threads
    os.environ["MKL_NUM_THREADS"] = max_threads
    os.environ["OPENBLAS_NUM_THREADS"] = max_threads
    os.environ["VECLIB_MAXIMUM_THREADS"] = max_threads
    os.environ["NUMEXPR_NUM_THREADS"] = max_threads

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
    "detailedCallCount": 0,
    "callTypes": {
        "detRec": 0,
        "recOnly": 0,
        "detOnly": 0,
    },
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
    whitelist = ""
    match = re.search(r"tessedit_char_whitelist=([^\s]+)", config)
    if match:
        whitelist = match.group(1).replace("\"", "").replace("'", "")
    return run_rapid_ocr_detailed(
        image,
        whitelist=whitelist,
        timeout_seconds=timeout_seconds,
    ).text


def run_rapid_ocr_detailed(
    image: object,
    *,
    whitelist: str = "",
    timeout_seconds: float | None = None,
    use_det: bool = True,
    use_cls: bool = True,
    use_rec: bool = True,
    source: str = "det_rec",
) -> OcrDetailedResult:
    if image is None or RAPID_OCR_INSTANCE is None:
        return OcrDetailedResult((), 0, use_det, use_cls, source)

    started = perf_counter()
    _STATS["callCount"] += 1
    _STATS["detailedCallCount"] += 1
    call_type = _call_type(use_det=use_det, use_rec=use_rec)
    _STATS["callTypes"][call_type] += 1
    try:
        result, _ = RAPID_OCR_INSTANCE(
            image,
            use_det=use_det,
            use_cls=use_cls,
            use_rec=use_rec,
        )
        if not result:
            return OcrDetailedResult((), _elapsed_since(started), use_det, use_cls, source)

        image_height, image_width = _image_dimensions(image)
        observations = []
        for raw_item in result:
            parsed = _parse_result_item(raw_item, use_det=use_det)
            if parsed is None:
                continue
            box, text, confidence = parsed
            observation = build_observation(
                text=text,
                confidence=confidence,
                box=box,
                image_width=image_width,
                image_height=image_height,
                whitelist=whitelist,
            )
            if observation.normalized_text:
                observations.append(observation)
        return OcrDetailedResult(tuple(observations), _elapsed_since(started), use_det, use_cls, source)
    except Exception:  # noqa: BLE001
        _STATS["errorCount"] += 1
        return OcrDetailedResult((), _elapsed_since(started), use_det, use_cls, source)
    finally:
        elapsed_ms = _elapsed_since(started)
        _STATS["totalMs"] += elapsed_ms
        _STATS["maxMs"] = max(_STATS["maxMs"], elapsed_ms)

def is_ocr_available() -> bool:
    return RAPID_OCR_INSTANCE is not None

def timed_rapid_ocr(image: object, config: str, *, timeout_seconds: float | None = None) -> tuple[str, int]:
    started = perf_counter()
    text = run_rapid_ocr(image, config, timeout_seconds=timeout_seconds)
    return text, int((perf_counter() - started) * 1000)

def get_ocr_stats() -> dict[str, object]:
    return {
        **_STATS,
        "callTypes": dict(_STATS["callTypes"]),
        "timeoutSeconds": _resolve_timeout(),
    }

def reset_ocr_stats() -> None:
    for key in ("callCount", "errorCount", "totalMs", "maxMs", "detailedCallCount"):
        _STATS[key] = 0
    for key in _STATS["callTypes"]:
        _STATS["callTypes"][key] = 0

def _resolve_timeout(timeout_seconds: float | None = None) -> float:
    if timeout_seconds is not None:
        return max(float(timeout_seconds), 0.1)
    raw_timeout = os.environ.get("OCR_TIMEOUT_SECONDS", "")
    try:
        return max(float(raw_timeout), 0.1) if raw_timeout else DEFAULT_OCR_TIMEOUT_SECONDS
    except ValueError:
        return DEFAULT_OCR_TIMEOUT_SECONDS


def _parse_result_item(raw_item: object, *, use_det: bool) -> tuple[object, str, float] | None:
    if not isinstance(raw_item, (list, tuple)):
        return None
    if use_det and len(raw_item) >= 3:
        return raw_item[0], str(raw_item[1] or ""), _safe_float(raw_item[2])
    if not use_det and len(raw_item) >= 2:
        return None, str(raw_item[0] or ""), _safe_float(raw_item[1])
    if len(raw_item) >= 3:
        return raw_item[0], str(raw_item[1] or ""), _safe_float(raw_item[2])
    return None


def _image_dimensions(image: object) -> tuple[int, int]:
    shape = getattr(image, "shape", ())
    if isinstance(shape, tuple) and len(shape) >= 2:
        return max(1, int(shape[0])), max(1, int(shape[1]))
    return 1, 1


def _safe_float(value: object) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _call_type(*, use_det: bool, use_rec: bool) -> str:
    if use_det and not use_rec:
        return "detOnly"
    if not use_det and use_rec:
        return "recOnly"
    return "detRec"


def _elapsed_since(started: float) -> int:
    return max(0, int((perf_counter() - started) * 1000))
