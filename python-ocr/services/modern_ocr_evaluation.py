from __future__ import annotations

import importlib
import importlib.metadata
import re
import time
import tracemalloc
from dataclasses import dataclass
from datetime import date
from typing import Any

try:
    import cv2
except ImportError:  # pragma: no cover - depends on local environment
    cv2 = None

from services.passport_page import collect_ocr_lines

MONTHS = ("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC")
ENGINE_MODULES = {
    "paddle": "paddleocr",
    "tesseract": "pytesseract",
}


@dataclass(frozen=True)
class ModernOcrEvaluationResult:
    engine: str
    status: str
    elapsed_ms: int
    text: str
    error: str = ""
    peak_memory_kb: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "engine": self.engine,
            "status": self.status,
            "elapsedMs": self.elapsed_ms,
            "textLength": len(self.text),
            "text": self.text,
            "error": self.error,
            "peakMemoryKb": self.peak_memory_kb,
        }


def evaluate_modern_ocr_engine(file_path: str, engine: str) -> ModernOcrEvaluationResult:
    normalized_engine = engine.strip().lower()
    started = time.perf_counter()
    tracemalloc.start()
    try:
        if normalized_engine == "tesseract":
            text = _run_tesseract_full_image(file_path)
        elif normalized_engine == "paddle":
            text = _run_paddle_full_image(file_path)
        else:
            return ModernOcrEvaluationResult(
                engine=normalized_engine,
                status="UNSUPPORTED",
                elapsed_ms=_elapsed_ms(started),
                text="",
                error=f"Unsupported OCR engine: {engine}",
            )
        _, peak = tracemalloc.get_traced_memory()
        return ModernOcrEvaluationResult(
            engine=normalized_engine,
            status="OK",
            elapsed_ms=_elapsed_ms(started),
            text=text,
            peak_memory_kb=int(peak / 1024),
        )
    except ModuleNotFoundError as exc:
        _, peak = tracemalloc.get_traced_memory()
        return ModernOcrEvaluationResult(
            engine=normalized_engine,
            status="UNAVAILABLE",
            elapsed_ms=_elapsed_ms(started),
            text="",
            error=str(exc),
            peak_memory_kb=int(peak / 1024),
        )
    except Exception as exc:  # noqa: BLE001
        _, peak = tracemalloc.get_traced_memory()
        return ModernOcrEvaluationResult(
            engine=normalized_engine,
            status="ERROR",
            elapsed_ms=_elapsed_ms(started),
            text="",
            error=str(exc),
            peak_memory_kb=int(peak / 1024),
        )
    finally:
        tracemalloc.stop()


def probe_modern_ocr_engine(engine: str) -> dict[str, Any]:
    normalized_engine = engine.strip().lower()
    module_name = ENGINE_MODULES.get(normalized_engine)
    if module_name is None:
        return {
            "engine": normalized_engine,
            "module": "",
            "available": False,
            "status": "UNSUPPORTED",
            "version": "",
            "importMs": 0,
            "error": f"Unsupported OCR engine: {engine}",
        }
    started = time.perf_counter()
    try:
        importlib.import_module(module_name)
        return {
            "engine": normalized_engine,
            "module": module_name,
            "available": True,
            "status": "OK",
            "version": _module_version(module_name),
            "importMs": _elapsed_ms(started),
            "error": "",
        }
    except ModuleNotFoundError as exc:
        return {
            "engine": normalized_engine,
            "module": module_name,
            "available": False,
            "status": "UNAVAILABLE",
            "version": "",
            "importMs": _elapsed_ms(started),
            "error": str(exc),
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "engine": normalized_engine,
            "module": module_name,
            "available": False,
            "status": "ERROR",
            "version": "",
            "importMs": _elapsed_ms(started),
            "error": str(exc),
        }


def evaluate_expected_field_hits(text: str, expected: dict[str, str]) -> dict[str, bool]:
    normalized_text = _normalize_for_match(text)
    return {
        field_name: _expected_value_matches(normalized_text, value)
        for field_name, value in expected.items()
        if field_name != "status"
    }


def summarize_field_hits(records: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    totals: dict[str, int] = {}
    hits: dict[str, int] = {}
    for record in records:
        field_hits = record.get("fieldHits", {})
        if not isinstance(field_hits, dict):
            continue
        for field_name, matched in field_hits.items():
            totals[field_name] = totals.get(field_name, 0) + 1
            if matched:
                hits[field_name] = hits.get(field_name, 0) + 1
    return {
        field_name: {
            "expectedCount": totals[field_name],
            "hitCount": hits.get(field_name, 0),
            "hitRate": round(hits.get(field_name, 0) / totals[field_name], 4),
        }
        for field_name in sorted(totals)
    }


def _run_tesseract_full_image(file_path: str) -> str:
    if cv2 is None:
        raise RuntimeError("OpenCV is not installed.")
    image = cv2.imread(file_path)
    if image is None:
        raise RuntimeError(f"Cannot read image: {file_path}")
    lines = collect_ocr_lines(
        image,
        whitelist="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789< /-",
        variant_mode="fast",
        max_lines=120,
    )
    return "\n".join(lines)


def _run_paddle_full_image(file_path: str) -> str:
    paddleocr = importlib.import_module("paddleocr")
    reader = paddleocr.PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
    result = reader.ocr(file_path, cls=True)
    return "\n".join(_extract_paddle_text_items(result))


def _extract_paddle_text_items(value: object) -> list[str]:
    if isinstance(value, str):
        return [value]
    if not isinstance(value, (list, tuple)):
        return []
    items: list[str] = []
    if len(value) >= 2 and isinstance(value[1], (list, tuple)) and value[1] and isinstance(value[1][0], str):
        items.append(value[1][0])
    for child in value:
        items.extend(_extract_paddle_text_items(child))
    return _dedupe(items)


def _expected_value_matches(normalized_text: str, value: str) -> bool:
    variants = _expected_variants(value)
    return any(variant and variant in normalized_text for variant in variants)


def _expected_variants(value: str) -> list[str]:
    raw = str(value or "")
    variants = [_normalize_for_match(raw)]
    try:
        parsed = date.fromisoformat(raw)
        variants.append(f"{parsed.day:02d}{MONTHS[parsed.month - 1]}{parsed.year}")
        variants.append(f"{parsed.year}{parsed.month:02d}{parsed.day:02d}")
    except ValueError:
        pass
    return _dedupe(variants)


def _normalize_for_match(value: str) -> str:
    return re.sub(r"[^A-Z0-9<]", "", str(value or "").upper())


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    unique_values: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            unique_values.append(value)
    return unique_values


def _elapsed_ms(started_at: float) -> int:
    return max(0, int((time.perf_counter() - started_at) * 1000))


def _module_version(module_name: str) -> str:
    try:
        return importlib.metadata.version(module_name)
    except importlib.metadata.PackageNotFoundError:
        return ""
