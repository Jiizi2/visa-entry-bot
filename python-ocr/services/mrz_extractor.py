from __future__ import annotations

import os
import shutil
import warnings
from datetime import date, datetime
from typing import Any

try:
    from passporteye import read_mrz
except ImportError:  # pragma: no cover - depends on local environment
    read_mrz = None

try:
    import pytesseract
except ImportError:  # pragma: no cover - depends on local environment
    pytesseract = None

from services.image_preprocessor import assess_document_quality, temporary_mrz_variants

FIELD_NAMES = (
    "names",
    "surname",
    "number",
    "nationality",
    "date_of_birth",
    "expiration_date",
    "sex",
)


def extract_mrz_data(file_path: str) -> dict[str, Any]:
    if read_mrz is None:
        raise RuntimeError("passporteye is not installed.")
    if pytesseract is None:
        raise RuntimeError("pytesseract is not installed.")
    tesseract_cmd = _resolve_tesseract_cmd()
    if tesseract_cmd is None:
        raise RuntimeError("Tesseract executable is not installed or not available on PATH.")
    pytesseract.pytesseract.tesseract_cmd = tesseract_cmd

    quality_penalty, quality_notes = assess_document_quality(file_path)
    mrz, source_note = _read_best_mrz(file_path)
    if mrz is None:
        raise ValueError(_merge_notes("MRZ not detected.", quality_notes))

    data = _to_dictionary(mrz)
    if not data:
        raise ValueError("PassportEye returned empty MRZ data.")

    return {
        "data": data,
        "confidence": _calculate_confidence(mrz, data, quality_penalty),
        "notes": _merge_notes(_build_notes(mrz), source_note, quality_notes),
    }


def _read_best_mrz(file_path: str) -> tuple[Any, str]:
    best_mrz = None
    best_note = ""
    best_score = -1
    with temporary_mrz_variants(file_path) as variants:
        for variant_path, note in variants:
            try:
                mrz = _read_mrz(variant_path)
            except RuntimeError:
                continue
            score = getattr(mrz, "valid_score", -1) if mrz is not None else -1
            if mrz is not None and score > best_score:
                best_mrz = mrz
                best_note = note
                best_score = score
            if mrz is not None and getattr(mrz, "valid", False):
                return mrz, note
    return best_mrz, best_note


def _read_mrz(file_path: str) -> Any:
    try:
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=FutureWarning, module="passporteye")
            warnings.filterwarnings("ignore", category=FutureWarning, module="skimage")
            return read_mrz(file_path, save_roi=False)
    except TypeError:
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=FutureWarning, module="passporteye")
            warnings.filterwarnings("ignore", category=FutureWarning, module="skimage")
            return read_mrz(file_path)
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"PassportEye failed to read image: {exc}") from exc


def _to_dictionary(mrz: Any) -> dict[str, Any]:
    raw_data = {}
    if hasattr(mrz, "to_dict"):
        try:
            raw_data = mrz.to_dict() or {}
        except Exception:  # noqa: BLE001
            raw_data = {}

    data = dict(raw_data) if isinstance(raw_data, dict) else {}
    for field_name in FIELD_NAMES:
        if field_name in data and data[field_name] not in (None, ""):
            continue
        value = getattr(mrz, field_name, None)
        if value not in (None, ""):
            data[field_name] = value

    for key in ("line1", "line2", "text", "mrz_text", "raw_text"):
        value = getattr(mrz, key, None)
        if value not in (None, "") and key not in data:
            data[key] = value
    return data


def _calculate_confidence(mrz: Any, data: dict[str, Any], quality_penalty: float = 0.0) -> float:
    valid_score = getattr(mrz, "valid_score", None)
    if isinstance(valid_score, (int, float)):
        return round(max(0.0, min(float(valid_score) / 100.0, 1.0) - quality_penalty), 2)

    populated_fields = sum(1 for field_name in FIELD_NAMES if _has_value(data.get(field_name)))
    return round(max(0.0, min(0.4 + (populated_fields / len(FIELD_NAMES)) * 0.5, 0.95) - quality_penalty), 2)


def _build_notes(mrz: Any) -> str:
    valid_score = getattr(mrz, "valid_score", None)
    if isinstance(valid_score, (int, float)) and valid_score < 70:
        return "Low PassportEye confidence."
    return ""


def _merge_notes(*values: str) -> str:
    notes = []
    for value in values:
        cleaned = str(value or "").strip()
        if cleaned and cleaned not in notes:
            notes.append(cleaned)
    return "; ".join(notes)


def _has_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, (date, datetime)):
        return True
    return str(value).strip() != ""


def _resolve_tesseract_cmd() -> str | None:
    configured = os.environ.get("TESSERACT_CMD")
    candidates = [
        configured,
        shutil.which("tesseract"),
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    ]
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate
    return None
