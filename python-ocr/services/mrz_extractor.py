from __future__ import annotations

import os
import re
import shutil
import warnings
from dataclasses import dataclass, replace
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
from services.mrz_validation import MrzValidationResult, validate_td3_line2
from services.tesseract_runner import build_tesseract_config, run_tesseract_ocr

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
    rotation_degrees: int = 0

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
            "rotationDegrees": self.rotation_degrees,
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

    data = _repair_extracted_mrz_data(_to_dictionary(mrz))
    if not data:
        raise ValueError("PassportEye returned empty MRZ data.")
    mrz_validation = _build_mrz_validation(data)

    return {
        "data": data,
        "confidence": _calculate_confidence(mrz, data, quality_penalty),
        "notes": _merge_notes(_build_notes(mrz), source_note, quality_notes, _build_validation_note(mrz_validation)),
        "mrzValidation": mrz_validation.to_dict(),
    }


def _read_best_mrz(file_path: str) -> tuple[Any, str]:
    direct_mrz = _read_direct_mrz(file_path)
    if _is_high_confidence_indonesian_direct_mrz(direct_mrz):
        return direct_mrz, _direct_mrz_note(direct_mrz)

    best_mrz = direct_mrz
    best_note = _direct_mrz_note(direct_mrz) if direct_mrz is not None else ""
    best_score = getattr(direct_mrz, "valid_score", -1) if direct_mrz is not None else -1
    with temporary_mrz_variants(file_path) as variants:
        for variant_path, note in variants:
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

    best_result: DirectMrzResult | None = None
    for candidate_document, rotation_degrees in _direct_mrz_orientation_candidates(document):
        for start_ratio in (0.82, 0.75):
            height = candidate_document.shape[0]
            region = candidate_document[int(height * start_ratio) :, :]
            result = _extract_direct_mrz_from_region(region)
            if result is None:
                continue
            result = replace(result, rotation_degrees=rotation_degrees)
            if best_result is None or result.valid_score > best_result.valid_score:
                best_result = result
            if _is_high_confidence_indonesian_direct_mrz(result):
                return result
    return best_result


def _direct_mrz_orientation_candidates(document: object):
    yield document, 0
    yield _rotate_image_180(document), 180
    yield _rotate_image_90(document), 90
    yield _rotate_image_270(document), 270


def _rotate_image_180(image: object) -> object:
    return _rotate_image(image, 180)


def _rotate_image_90(image: object) -> object:
    return _rotate_image(image, 90)


def _rotate_image_270(image: object) -> object:
    return _rotate_image(image, 270)


def _rotate_image(image: object, degrees: int) -> object:
    rotation = int(degrees or 0) % 360
    if rotation == 90 and hasattr(cv2, "ROTATE_90_CLOCKWISE"):
        return cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    if rotation == 180 and hasattr(cv2, "ROTATE_180"):
        return cv2.rotate(image, cv2.ROTATE_180)
    if rotation == 270 and hasattr(cv2, "ROTATE_90_COUNTERCLOCKWISE"):
        return cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
    if rotation == 90:
        return image.transpose(1, 0, *range(2, len(image.shape)))[:, ::-1].copy()
    if rotation == 180:
        return image[::-1, ::-1].copy()
    if rotation == 270:
        return image.transpose(1, 0, *range(2, len(image.shape)))[::-1, :].copy()
    return image


def _is_high_confidence_indonesian_direct_mrz(mrz: DirectMrzResult | None) -> bool:
    return bool(mrz and mrz.line1.startswith("P<IDN") and mrz.valid_score >= 98 and _score_direct_line2(mrz.line2) == 3)


def _direct_mrz_note(mrz: DirectMrzResult | None) -> str:
    rotation_degrees = int(getattr(mrz, "rotation_degrees", 0) or 0) % 360
    if rotation_degrees:
        return f"MRZ recovered from direct lower-band OCR after {rotation_degrees}-degree rotation."
    return "MRZ recovered from direct lower-band OCR."


def _extract_direct_mrz_from_region(region: object) -> DirectMrzResult | None:
    gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY) if len(region.shape) == 3 else region
    if gray.shape[1] < 1600:
        scale = 1600.0 / max(gray.shape[1], 1)
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    candidates: list[DirectMrzResult] = []
    for variant in _build_direct_mrz_variants(gray):
        for psm in (6, 7, 13):
            config = build_tesseract_config(psm=psm, whitelist="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<", dpi=300)
            text = run_tesseract_ocr(variant, config)
            if not text:
                continue
            lines = _clean_direct_mrz_lines(text)
            candidates.extend(_direct_mrz_candidates_from_lines(lines))
            best_candidate = max(candidates, default=None, key=lambda candidate: candidate.valid_score)
            if _is_high_confidence_indonesian_direct_mrz(best_candidate):
                return best_candidate
    return max(candidates, default=None, key=lambda candidate: candidate.valid_score)


def _build_direct_mrz_variants(gray: object) -> list[object]:
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    sharpened = cv2.addWeighted(clahe, 1.6, cv2.GaussianBlur(clahe, (0, 0), 1.6), -0.6, 0)
    denoised = cv2.fastNlMeansDenoising(sharpened, None, 8, 7, 21)
    _, otsu = cv2.threshold(denoised, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    adaptive = cv2.adaptiveThreshold(denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 9)
    return [gray, clahe, otsu, adaptive]


def _direct_mrz_candidates_from_lines(lines: list[str]) -> list[DirectMrzResult]:
    candidates: list[DirectMrzResult] = []
    for index, line in enumerate(lines):
        if not line.startswith(("P<", "P1", "PI")):
            continue
        line1 = _repair_direct_line1(line)
        for line2 in _direct_line2_candidates(lines[index + 1 :]):
            score = _score_direct_mrz(line1, line2)
            if score >= 70:
                candidates.append(DirectMrzResult(line1=line1, line2=line2, valid_score=score))
    return candidates


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
    return next(iter(_direct_line2_candidates(lines)), "")


def _direct_line2_candidates(lines: list[str]) -> list[str]:
    candidates: list[str] = []
    for line in lines[:4]:
        candidate = _repair_direct_line2(line)
        if _score_direct_line2(candidate) >= 2:
            candidates.append(candidate)
    return sorted(set(candidates), key=_score_direct_line2, reverse=True)


def _repair_direct_line2(value: str) -> str:
    line = value[:44].ljust(44, "<")
    candidates = {line}
    candidates.update(_direct_line2_alignment_repairs(line))
    repaired = {_repair_direct_line2_digits(_repair_direct_line2_country(candidate)) for candidate in candidates}
    repaired.update(_repair_missing_composite_check_digit(candidate) for candidate in list(repaired))
    return max(repaired, key=_line2_repair_score)


def _repair_extracted_mrz_data(data: dict[str, Any]) -> dict[str, Any]:
    updated = dict(data)
    line2 = str(updated.get("line2") or _extract_line2(updated) or "")
    if line2:
        updated["line2"] = _repair_direct_line2(line2)
    return updated


def _direct_line2_alignment_repairs(line: str) -> set[str]:
    repairs: set[str] = set()
    if len(line) != 44:
        return repairs
    if line[0] in {"1", "7", "I", "L"} and line[1:8].isdigit() and line[8] == "<":
        repairs.add("E" + line[1:])
    if re.match(r"^[A-Z0-9][EX]\d{7}<", line):
        repairs.add((line[1:] + "<")[:44].ljust(44, "<"))
    return repairs


def _repair_direct_line2_digits(line: str) -> str:
    chars = list(line)
    digit_table = str.maketrans({"O": "0", "Q": "0", "D": "0", "I": "1", "L": "1", "S": "5", "B": "8", "Z": "2", "G": "6"})
    for index in (9, 42, 43):
        if index < len(chars):
            chars[index] = chars[index].translate(digit_table)
    for start, end in ((13, 20), (21, 28)):
        for index in range(start, min(end, len(chars))):
            chars[index] = chars[index].translate(digit_table)
    if len(chars) > 20 and chars[20] in {"L", "I", "1"}:
        chars[20] = "M"
    if len(chars) > 20 and chars[20] == "P":
        chars[20] = "F"
    return "".join(chars)


def _repair_missing_composite_check_digit(line: str) -> str:
    result = validate_td3_line2(line)
    if result.valid or result.valid_check_count < 4 or len(line) != 44:
        return line
    if line[43].isdigit():
        return line
    chars = list(line)
    chars[43] = _mrz_check_digit(line[0:10] + line[13:20] + line[21:43])
    candidate = "".join(chars)
    return candidate if validate_td3_line2(candidate).valid_check_count > result.valid_check_count else line


def _line2_repair_score(line: str) -> tuple[int, int, int]:
    result = validate_td3_line2(line)
    return (100 if result.valid else 0, result.valid_check_count, _score_direct_line2(line))


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


def _build_mrz_validation(data: dict[str, Any]) -> MrzValidationResult:
    line2 = _extract_line2(data)
    return validate_td3_line2(line2)


def _extract_line2(data: dict[str, Any]) -> str:
    explicit_line2 = str(data.get("line2", "") or "")
    if explicit_line2:
        return explicit_line2
    for key in ("mrz_text", "raw_text", "text"):
        value = data.get(key)
        if value is None:
            continue
        lines = [re.sub(r"[^A-Z0-9<]", "", line.upper()) for line in str(value).splitlines()]
        candidates = [line for line in lines if len(line.replace("<", "")) >= 20]
        if candidates:
            return candidates[-1]
    return ""


def _build_validation_note(result: MrzValidationResult) -> str:
    if result.notes:
        return result.notes
    if result.valid:
        return "MRZ checksum valid."
    failed_fields = [check.field_name for check in result.check_results if not check.valid]
    if failed_fields:
        return f"MRZ checksum partial: {result.valid_check_count}/{len(result.check_results)} valid ({', '.join(failed_fields)} failed)."
    return ""


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
