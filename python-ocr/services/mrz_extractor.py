from __future__ import annotations

import os
import re
import shutil
import warnings
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

try:
    import cv2
except ImportError:  # pragma: no cover - depends on local environment
    cv2 = None

try:
    from passporteye import read_mrz
except ImportError:  # pragma: no cover - depends on local environment
    read_mrz = None

try:
    import pytesseract
except ImportError:  # pragma: no cover - depends on local environment
    pytesseract = None

from services.image_preprocessor import assess_document_quality, detect_document_crop, temporary_mrz_variants

FIELD_NAMES = (
    "names",
    "surname",
    "number",
    "nationality",
    "date_of_birth",
    "expiration_date",
    "sex",
)


@dataclass(frozen=True)
class DirectMrzResult:
    line1: str
    line2: str
    valid_score: int
    valid: bool = True

    @property
    def raw_text(self) -> str:
        return f"{self.line1}\n{self.line2}"

    @property
    def text(self) -> str:
        return self.raw_text

    @property
    def mrz_text(self) -> str:
        return self.raw_text

    def to_dict(self) -> dict[str, str]:
        return {
            "line1": self.line1,
            "line2": self.line2,
            "raw_text": self.raw_text,
            "text": self.raw_text,
            "mrz_text": self.raw_text,
        }


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
    direct_mrz = _read_direct_mrz(file_path)
    if _is_indonesian_direct_mrz(direct_mrz):
        return direct_mrz, "MRZ recovered from direct lower-band OCR."

    best_mrz = None
    best_note = ""
    best_score = -1
    with temporary_mrz_variants(file_path) as variants:
        for index, (variant_path, note) in enumerate(variants):
            mrz = None
            try:
                mrz = _read_mrz(variant_path)
            except RuntimeError:
                mrz = None
            score = getattr(mrz, "valid_score", -1) if mrz is not None else -1
            if mrz is not None and score > best_score:
                best_mrz = mrz
                best_note = note
                best_score = score
            if mrz is not None and getattr(mrz, "valid", False):
                return mrz, note
            if index == 0 and direct_mrz is not None:
                return direct_mrz, "MRZ recovered from direct lower-band OCR."
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


def _read_direct_mrz(file_path: str) -> DirectMrzResult | None:
    if cv2 is None or pytesseract is None:
        return None
    image = cv2.imread(file_path)
    if image is None:
        return None
    document = detect_document_crop(image)
    if document is None:
        document = image

    for start_ratio in (0.82, 0.75):
        height = document.shape[0]
        region = document[int(height * start_ratio) :, :]
        result = _extract_direct_mrz_from_region(region)
        if result is not None:
            return result
    return None


def _is_indonesian_direct_mrz(mrz: DirectMrzResult | None) -> bool:
    return bool(mrz and mrz.line1.startswith("P<IDN"))


def _extract_direct_mrz_from_region(region: object) -> DirectMrzResult | None:
    gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY) if len(region.shape) == 3 else region
    if gray.shape[1] < 1600:
        scale = 1600.0 / max(gray.shape[1], 1)
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    try:
        text = pytesseract.image_to_string(
            gray,
            config="--oem 3 --psm 6 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
        )
    except Exception:  # noqa: BLE001
        return None
    lines = _clean_direct_mrz_lines(text)
    for index, line in enumerate(lines):
        if not line.startswith(("P<", "P1", "PI")):
            continue
        line1 = _repair_direct_line1(line)
        line2 = _pick_direct_line2(lines[index + 1 :])
        if not line2:
            continue
        score = _score_direct_mrz(line1, line2)
        if score >= 70:
            return DirectMrzResult(line1=line1, line2=line2, valid_score=score)
    return None


def _clean_direct_mrz_lines(text: str) -> list[str]:
    lines: list[str] = []
    for raw_line in str(text or "").splitlines():
        cleaned = re.sub(r"[^A-Z0-9<]", "", raw_line.upper())
        if len(cleaned.replace("<", "")) >= 8:
            lines.append(cleaned)
    return lines


def _repair_direct_line1(value: str) -> str:
    line = value.replace("P1", "P<", 1).replace("PI", "P<", 1)
    return line[:44].ljust(44, "<")


def _pick_direct_line2(lines: list[str]) -> str:
    for line in lines[:3]:
        candidate = _repair_direct_line2(line)
        if _score_direct_line2(candidate) >= 2:
            return candidate
    return ""


def _repair_direct_line2(value: str) -> str:
    line = value[:44].ljust(44, "<")
    chars = list(line)
    if len(chars) >= 13 and chars[10] in {"1", "0", "L"} and chars[11:13] == ["D", "N"]:
        chars[10] = "I"
    line = "".join(chars)
    return _repair_direct_line2_country(line)


def _repair_direct_line2_country(line: str) -> str:
    if len(line) < 14:
        return line

    def normalize_country(value: str) -> str:
        table = str.maketrans({"1": "I", "L": "I", "0": "D", "O": "D", "Q": "D"})
        return value.translate(table)

    if normalize_country(line[10:13]) == "IDN":
        return f"{line[:10]}IDN{line[13:]}"[:44].ljust(44, "<")
    if normalize_country(line[11:14]) == "IDN" and line[10] in {"1", "I", "L", "<"}:
        shifted = line[:10] + line[11:] + "<"
        return f"{shifted[:10]}IDN{shifted[13:]}"[:44].ljust(44, "<")
    return line


def _score_direct_mrz(line1: str, line2: str) -> int:
    score = 62 + _score_direct_line2(line2) * 12
    if line1.startswith("P<") and "<<" in line1:
        score += 8
    return min(score, 100)


def _score_direct_line2(line2: str) -> int:
    checks = 0
    checks += _mrz_check_digit(line2[0:9]) == line2[9]
    checks += _mrz_check_digit(line2[13:19]) == line2[19]
    checks += _mrz_check_digit(line2[21:27]) == line2[27]
    return int(checks)


def _mrz_check_digit(value: str) -> str:
    return str(sum(_mrz_char_value(char) * (7, 3, 1)[index % 3] for index, char in enumerate(value)) % 10)


def _mrz_char_value(char: str) -> int:
    if char == "<":
        return 0
    if char.isdigit():
        return int(char)
    if "A" <= char <= "Z":
        return ord(char) - 55
    return 0


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
