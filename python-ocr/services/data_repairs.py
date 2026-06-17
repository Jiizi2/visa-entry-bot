from __future__ import annotations

from services.models import ParsedPassportData, ExtractionEvidence

import json
import os
import re
import sys
import time
from datetime import date
from typing import Callable

from services.date_field_extractor import extract_document_dates
from services.image_preprocessor import (
    cleanup_temp_root,
    clear_image_preprocess_cache,
    get_image_preprocessor_stats,
    reset_image_preprocessor_stats,
)
from services.indonesia_field_ocr import (
    build_visual_notes,
    extract_fast_location_fields,
    extract_visual_fields,
    get_fast_location_ocr_stats,
    merge_visual_fields,
    reset_fast_location_ocr_stats,
)
from services.issue_date_extractor import infer_issue_date
from services.mrz_extractor import extract_mrz_data
from services.name_support import is_reasonable_token, repair_common_given_name_spacing, repair_common_name_noise, repair_single_word_name, salvage_family_hints, score_name_fields, token_matches_simple
from services.nusuk_manifest import build_error_record, build_member_record
from services.ocr_result_cache import end_ocr_result_cache_session, get_ocr_result_cache_stats, start_ocr_result_cache_session
from services.panel_fallback import extract_document_panel_fields, fuse_panel_fields, should_use_panel_fallback
from services.passport_page import clear_passport_page_cache, extract_aligned_passport_page
from services.parser import format_date, parse_mrz_data
from services.ocr_runner import get_ocr_stats, reset_ocr_stats
from services.validator import calculate_confidence, validate_member
from services.visual_name_extractor import refine_names_from_scan
from services.scan_context import ScanContext

from services.ocr_constants import (OCR_PROFILE_BUDGET_MS, OCR_BALANCED_PANEL_RECOVERY_FIELDS, OCR_FULL_PANEL_FIELD_SCOPE, OCR_FULL_VISUAL_FIELD_SCOPE, OCR_STAGE_MIN_REMAINING_MS, StepCallback)


def _apply_indonesian_visual_repairs(
    parsed: ParsedPassportData,
    extraction: ExtractionEvidence,
    visual_fields: dict[str, str],
) -> ParsedPassportData:
    updated = ParsedPassportData(**parsed)
    if (visual_fields.get("placeOfBirth") or visual_fields.get("issuingOffice")) and _looks_like_noisy_indonesia_code(
        updated.get("nationality", "")
    ):
        updated["nationality"] = "INDONESIA"
    if not _is_iso_date(updated.get("dob", "")):
        dob = _recover_dob_from_unverified_mrz(extraction)
        if dob:
            updated["dob"] = dob
    return updated

def _apply_fast_mrz_repairs(parsed: ParsedPassportData, extraction: ExtractionEvidence) -> tuple[ParsedPassportData, str]:
    updated = ParsedPassportData(**parsed)
    notes: list[str] = []
    if _has_indonesian_mrz_hint(extraction):
        if _looks_like_noisy_indonesia_code(updated.get("nationality", "")):
            updated["nationality"] = "INDONESIA"
            notes.append("NATIONALITY REPAIRED FROM MRZ HINT IN FAST SCAN")
        if not re.fullmatch(r"[EX]\d{7}", updated.get("passportNumber", "") or ""):
            passport_number = _recover_passport_number_from_mrz(extraction)
            if passport_number:
                updated["passportNumber"] = passport_number
                notes.append("PASSPORT NUMBER REPAIRED FROM MRZ HINT IN FAST SCAN")
        if not _is_iso_date(updated.get("dob", "")):
            dob = _recover_dob_from_unverified_mrz(extraction)
            if dob:
                updated["dob"] = dob
                notes.append("DOB REPAIRED FROM MRZ HINT IN FAST SCAN")
        if updated.get("gender", "") not in {"MALE", "FEMALE"}:
            gender = _recover_gender_from_unverified_mrz(extraction)
            if gender:
                updated["gender"] = gender
                notes.append("GENDER REPAIRED FROM MRZ HINT IN FAST SCAN")
    return updated, "; ".join(notes)

def _recover_passport_number_from_mrz(extraction: ExtractionEvidence) -> str:
    for value in _mrz_text_values(extraction):
        cleaned = re.sub(r"[^A-Z0-9<]", "", value.upper())
        match = re.search(r"\b([EX]\d{7})<", cleaned)
        if match:
            return match.group(1)
    return ""

def _recover_dob_from_unverified_mrz(extraction: ExtractionEvidence) -> str:
    for value in _mrz_text_values(extraction):
        cleaned = re.sub(r"[^A-Z0-9<]", "", value.upper())
        for match in re.finditer(r"(?:IDN|1DN|DN)(\d{6})[0-9<]?[MFP]", cleaned):
            dob = format_date(match.group(1), "birth")
            if _is_iso_date(dob):
                return dob
    return ""

def _recover_gender_from_unverified_mrz(extraction: ExtractionEvidence) -> str:
    for value in _mrz_text_values(extraction):
        cleaned = re.sub(r"[^A-Z0-9<]", "", value.upper())
        for match in re.finditer(r"(?:IDN|1DN|DN)\d{6}[0-9<]?([MFP])", cleaned):
            gender = match.group(1)
            if gender == "M":
                return "MALE"
            if gender in {"F", "P"}:
                return "FEMALE"
    return ""

def _mrz_text_values(extraction: ExtractionEvidence) -> list[str]:
    data = extraction.get("data", {}) if extraction else {}
    values: list[str] = []
    for key in ("line1", "line2", "raw_text", "mrz_text", "text"):
        value = data.get(key)
        if value is None:
            continue
        values.extend(str(value).splitlines())
    return values

def _normalize_mrz_country_hint(value: str) -> str:
    compact = re.sub(r"[^A-Z0-9]", "", str(value or "").upper())
    if compact == "INDONESIA":
        return "IDN"
    return compact.translate(str.maketrans({"1": "I", "L": "I", "0": "D", "O": "D", "Q": "D"}))

def _apply_verified_single_word_name(
    parsed: ParsedPassportData,
    extraction: ExtractionEvidence,
    file_name: str = "",
) -> tuple[ParsedPassportData, str]:
    if not _has_valid_mrz_validation(extraction):
        return parsed, ""
    return repair_single_word_name(parsed)

def _apply_verified_mrz_name_repairs(
    parsed: ParsedPassportData,
    extraction: ExtractionEvidence,
    file_name: str = "",
    ) -> tuple[ParsedPassportData, str]:
    notes = []
    updated, note = repair_common_given_name_spacing(parsed)
    if note:
        notes.append(note)
    updated, note = repair_common_name_noise(updated)
    if note:
        notes.append(note)
    if not _has_valid_mrz_validation(extraction):
        return updated, "; ".join(notes)
    updated, note = _apply_verified_single_word_name(updated, extraction, file_name=file_name)
    if note:
        notes.append(note)
    return updated, "; ".join(notes)

def _apply_final_name_repairs(parsed: ParsedPassportData, file_name: str = "") -> tuple[ParsedPassportData, str]:
    notes = []
    updated, note = repair_common_given_name_spacing(parsed)
    if note:
        notes.append(note)
    updated, note = repair_common_name_noise(updated)
    if note:
        notes.append(note)
    return updated, "; ".join(notes)

def _compact_name_value(value: str) -> str:
    return re.sub(r"[^A-Z]", "", str(value or "").upper())

def _apply_fast_date_repairs(parsed: ParsedPassportData) -> tuple[ParsedPassportData, str]:
    if _is_iso_date(parsed.get("issueDate", "")):
        return parsed, ""
    expiry_date = parsed.get("expiryDate", "")
    if not _is_iso_date(expiry_date):
        return parsed, ""
    inferred_issue = infer_issue_date(parsed.get("dob", ""), expiry_date)
    if not inferred_issue:
        return parsed, ""
    updated = ParsedPassportData(**parsed)
    updated["issueDate"] = inferred_issue
    return updated, "ISSUE DATE INFERRED FROM EXPIRY DATE IN FAST SCAN"

def _repair_impossible_expiry_date(parsed: ParsedPassportData) -> tuple[ParsedPassportData, str]:
    expiry = _parse_iso_date(parsed.get("expiryDate", ""))
    dob = _parse_iso_date(parsed.get("dob", ""))
    if expiry is None or dob is None or expiry > dob or expiry.year >= 2000:
        return parsed, ""
    repaired_expiry = expiry.replace(year=expiry.year + 80)
    today = date.today()
    if repaired_expiry <= today or repaired_expiry.year > today.year + 20:
        return parsed, ""
    updated = ParsedPassportData(**parsed)
    updated["expiryDate"] = repaired_expiry.isoformat()
    note = "EXPIRY DATE CENTURY REPAIRED FROM MRZ"
    if not _is_iso_date(updated.get("issueDate", "")):
        inferred_issue = infer_issue_date(updated.get("dob", ""), updated.get("expiryDate", ""))
        if inferred_issue:
            updated["issueDate"] = inferred_issue
            note = join_notes(note, "ISSUE DATE INFERRED FROM REPAIRED EXPIRY")
    return updated, note

def _mrz_confidence(extraction: ExtractionEvidence) -> float:
    try:
        return float(extraction.get("confidence", 0.0) or 0.0)
    except (TypeError, ValueError):
        return 0.0

def _is_iso_date(value: str) -> bool:
    return _parse_iso_date(value) is not None

def _parse_iso_date(value: str) -> date | None:
    try:
        return date.fromisoformat(str(value or ""))
    except ValueError:
        return None



def _has_valid_mrz_validation(extraction: ExtractionEvidence) -> bool:
    validation = extraction.get("mrzValidation", {})
    return isinstance(validation, dict) and bool(validation.get("valid"))

def _has_failed_mrz_validation(extraction: ExtractionEvidence) -> bool:
    validation = extraction.get("mrzValidation", {})
    return isinstance(validation, dict) and bool(validation.get("checks")) and validation.get("valid") is not True

def _has_reliable_mrz_for_fast_path(
    parsed: ParsedPassportData,
    extraction: ExtractionEvidence,
    panel_fallback_used: bool,
) -> bool:
    if panel_fallback_used:
        return False
    if _mrz_confidence(extraction) < 0.85:
        return False
    if "LOW PASSPORTEYE CONFIDENCE" in str(extraction.get("notes", "") or "").upper():
        return False
    return bool(
        parsed.get("passportNumber", "")
        and parsed.get("nationality", "")
        and _is_iso_date(parsed.get("dob", ""))
        and _is_iso_date(parsed.get("expiryDate", ""))
        and parsed.get("gender", "") in {"MALE", "FEMALE"}
    )


def _looks_like_noisy_indonesia_code(value: str) -> bool:
    compact = re.sub(r"[^A-Z0-9]", "", str(value or "").upper())
    return compact in {"", "ID", "IDN", "DNI", "DNB", "IO3", "I03", "1O3"}

def _has_indonesian_mrz_hint(extraction: ExtractionEvidence) -> bool:
    data = extraction.get("data", {}) if extraction else {}
    country = _normalize_mrz_country_hint(str(data.get("country", "") or data.get("nationality", "") or ""))
    if country == "IDN":
        return True
    for value in _mrz_text_values(extraction):
        cleaned = re.sub(r"[^A-Z0-9<]", "", value.upper())
        if cleaned.startswith(("P<IDN", "P<DN")):
            return True
        for match in re.finditer(r"[A-Z0-9<]{10}([A-Z0-9]{3})\d{6}[0-9<]?[MFP<]", cleaned):
            if _normalize_mrz_country_hint(match.group(1)) == "IDN":
                return True
    return False


def join_notes(*values: str) -> str:
    notes = []
    for value in values:
        cleaned = str(value or "").strip().upper()
        if cleaned and cleaned not in notes:
            notes.append(cleaned)
    return "; ".join(notes)
