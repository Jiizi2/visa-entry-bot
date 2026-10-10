from __future__ import annotations

import atexit
import importlib.util
import math
import os
import re
from contextvars import ContextVar
from contextlib import contextmanager
from time import perf_counter

from services.ocr_observation import OcrDetailedResult, build_observation
from services.ocr_engine_process import OcrEngineTimeout, OcrEngineUnavailable, ProcessOcrEngine
from services.ocr_constants import OCR_INFERENCE_TIMEOUT_SECONDS
from services.log import logger

max_threads = os.environ.get("PASSPORT_OCR_MAX_THREADS", "").strip()
if max_threads:
    os.environ["OMP_NUM_THREADS"] = max_threads
    os.environ["MKL_NUM_THREADS"] = max_threads
    os.environ["OPENBLAS_NUM_THREADS"] = max_threads
    os.environ["VECLIB_MAXIMUM_THREADS"] = max_threads
    os.environ["NUMEXPR_NUM_THREADS"] = max_threads

RAPID_OCR_INSTANCE = ProcessOcrEngine() if importlib.util.find_spec("rapidocr_onnxruntime") else None
if RAPID_OCR_INSTANCE is not None:
    atexit.register(RAPID_OCR_INSTANCE.close)

_SCAN_DEADLINE: ContextVar[float | None] = ContextVar("ocr_scan_deadline", default=None)


def set_ocr_deadline(deadline: float):
    return _SCAN_DEADLINE.set(deadline)


def reset_ocr_deadline(token) -> None:
    _SCAN_DEADLINE.reset(token)


def ocr_time_remaining() -> float:
    deadline = _SCAN_DEADLINE.get()
    return max(0.0, deadline - perf_counter()) if deadline is not None else float("inf")


@contextmanager
def ocr_stage_budget(seconds: float):
    deadline = perf_counter() + max(0.0, seconds)
    current = _SCAN_DEADLINE.get()
    token = set_ocr_deadline(min(current, deadline) if current is not None else deadline)
    try:
        yield
    finally:
        reset_ocr_deadline(token)


def initialize_ocr_engine() -> None:
    if RAPID_OCR_INSTANCE is None:
        raise OcrEngineUnavailable("RapidOCR belum terpasang. Periksa instalasi OCR worker.")
    if isinstance(RAPID_OCR_INSTANCE, ProcessOcrEngine):
        RAPID_OCR_INSTANCE.warm_up()

DEFAULT_OCR_TIMEOUT_SECONDS = OCR_INFERENCE_TIMEOUT_SECONDS
_STATS = {
    "callCount": 0,
    "errorCount": 0,
    "timeoutCount": 0,
    "budgetSkipCount": 0,
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
    if image is None:
        return OcrDetailedResult((), 0, use_det, use_cls, source)

    timeout = _resolve_timeout(timeout_seconds)
    deadline = _SCAN_DEADLINE.get()
    if deadline is not None:
        timeout = min(timeout, deadline - perf_counter())
        if timeout <= 0:
            _STATS["budgetSkipCount"] += 1
            return OcrDetailedResult((), 0, use_det, use_cls, source)

    started = perf_counter()
    _STATS["callCount"] += 1
    _STATS["detailedCallCount"] += 1
    call_type = _call_type(use_det=use_det, use_rec=use_rec)
    _STATS["callTypes"][call_type] += 1
    try:
        if RAPID_OCR_INSTANCE is None:
            raise OcrEngineUnavailable("RapidOCR engine is unavailable.")
        result, _ = RAPID_OCR_INSTANCE(
            image,
            use_det=use_det,
            use_cls=use_cls,
            use_rec=use_rec,
            timeout_seconds=timeout,
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
    except OcrEngineTimeout as exc:
        _STATS["errorCount"] += 1
        _STATS["timeoutCount"] += 1
        logger.warning("OCR timeout (%s): %s", source, exc)
        return OcrDetailedResult((), _elapsed_since(started), use_det, use_cls, source)
    except Exception as exc:  # noqa: BLE001
        _STATS["errorCount"] += 1
        logger.warning("OCR engine error (%s): %s", source, exc)
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
    for key in ("callCount", "errorCount", "timeoutCount", "budgetSkipCount", "totalMs", "maxMs", "detailedCallCount"):
        _STATS[key] = 0
    for key in _STATS["callTypes"]:
        _STATS["callTypes"][key] = 0

def _resolve_timeout(timeout_seconds: float | None = None) -> float:
    raw_timeout = timeout_seconds if timeout_seconds is not None else os.environ.get("OCR_TIMEOUT_SECONDS", "")
    try:
        value = float(raw_timeout) if raw_timeout != "" else DEFAULT_OCR_TIMEOUT_SECONDS
        return max(value, 0.1) if math.isfinite(value) else DEFAULT_OCR_TIMEOUT_SECONDS
    except (TypeError, ValueError):
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
