from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import date
from typing import Callable

from services.models import OcrProfile, ParsedPassportData, ExtractionEvidence, ReviewStatus, OcrMode
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

from services.scan_budget import (_ocr_profile, _is_speed_first_scan, _is_balanced_scan, _is_heavy_scan, _ocr_budget_ms, _elapsed_ms, _time_left_ms, _has_ocr_budget_for_elapsed, _can_spend_ocr_time, _budget_exceeded, _skip_ocr_stage, _build_budget_notes, _classify_ocr_mode, _ocr_mode_reasons)
from services.data_repairs import (_has_indonesian_mrz_hint, _looks_like_noisy_indonesia_code, _has_valid_mrz_validation, _has_failed_mrz_validation, _has_reliable_mrz_for_fast_path, _apply_indonesian_visual_repairs, _apply_fast_mrz_repairs, _recover_passport_number_from_mrz, _recover_dob_from_unverified_mrz, _recover_gender_from_unverified_mrz, _mrz_text_values, _normalize_mrz_country_hint, _apply_verified_single_word_name, _apply_verified_mrz_name_repairs, _apply_final_name_repairs, _compact_name_value, _apply_fast_date_repairs, _repair_impossible_expiry_date, _mrz_confidence, _is_iso_date, _parse_iso_date)

def _should_run_initial_panel_scan(ocr_profile: str, extraction: ExtractionEvidence) -> bool:
    if ocr_profile == OcrProfile.SPEED:
        return False
    if ocr_profile == OcrProfile.HEAVY:
        return True
    return ocr_profile == OcrProfile.BALANCED and should_use_panel_fallback(extraction)

def _select_profile_panel_field_names(
    ocr_profile: str,
    parsed: ParsedPassportData,
    extraction: ExtractionEvidence,
) -> tuple[str, ...]:
    if ocr_profile == OcrProfile.HEAVY:
        return OCR_FULL_PANEL_FIELD_SCOPE
    return _select_panel_field_names(parsed, extraction)

def _is_indonesian_passport(
    parsed: ParsedPassportData,
    extraction: ExtractionEvidence,
    panel_fields: dict[str, str],
) -> bool:
    country = str(extraction.get("data", {}).get("country", "")).upper()
    nationality = parsed.get("nationality", "")
    return bool(panel_fields) or nationality == "INDONESIA" or country == "IDN" or panel_fields.get("nationality") == "INDONESIA"



def _ocr_rotation_degrees(extraction: ExtractionEvidence) -> int:
    data = extraction.get("data", {}) if extraction else {}
    if isinstance(data, dict):
        for key in ("rotationDegrees", "rotation_degrees"):
            rotation = _normalize_ocr_rotation_degrees(data.get(key))
            if rotation:
                return rotation
    notes = str(extraction.get("notes", "") or "").lower() if extraction else ""
    for match in re.finditer(r"(\d{2,3})[-\s]+degree rotation", notes):
        rotation = _normalize_ocr_rotation_degrees(match.group(1))
        if rotation:
            return rotation
    return 0

def _normalize_ocr_rotation_degrees(value: object) -> int:
    try:
        rotation = int(str(value or "0")) % 360
    except ValueError:
        return 0
    return rotation if rotation in {90, 180, 270} else 0

def _select_visual_field_names(
    parsed: ParsedPassportData,
    extraction: ExtractionEvidence,
    panel_fallback_used: bool,
    panel_fields: dict[str, str],
) -> tuple[str, ...] | None:
    if panel_fallback_used:
        return _select_panel_fallback_visual_field_names(parsed, panel_fields)
    if not _has_reliable_mrz_for_fast_path(parsed, extraction, panel_fallback_used):
        return None

    fields = ["placeOfBirth", "issuingOffice"]
    if not _is_iso_date(parsed.get("issueDate", "")) and not _can_infer_missing_issue_date(parsed):
        fields.append("issueDate")
    if not _is_iso_date(parsed.get("dob", "")):
        fields.append("dob")
    if parsed.get("gender", "") not in {"MALE", "FEMALE"}:
        fields.append("gender")
    if parsed.get("nationality", "") != "INDONESIA":
        fields.append("nationality")
    if not _is_iso_date(parsed.get("expiryDate", "")):
        fields.append("expiryDate")
    if _needs_name_refinement(parsed):
        fields.append("fullName")
    return tuple(dict.fromkeys(fields))

def _select_balanced_visual_field_names(
    parsed: ParsedPassportData,
    extraction: ExtractionEvidence,
    panel_fallback_used: bool,
    panel_fields: dict[str, str],
) -> tuple[str, ...] | None:
    fields = _select_visual_field_names(parsed, extraction, panel_fallback_used, panel_fields)
    if fields is None or fields == ():
        return fields

    expanded = list(fields)
    if not panel_fields.get("issueDate"):
        expanded.append("issueDate")
    if _has_failed_mrz_validation(extraction) and not panel_fields.get("expiryDate"):
        expanded.append("expiryDate")
    return tuple(dict.fromkeys(expanded))

def _select_speed_visual_field_names(parsed: ParsedPassportData, extraction: ExtractionEvidence) -> tuple[str, ...]:
    if not _should_try_speed_location_ocr(parsed, extraction):
        return ()
    return ("placeOfBirth", "issuingOffice")

def _select_heavy_visual_field_names(
    parsed: ParsedPassportData,
    extraction: ExtractionEvidence,
    panel_fields: dict[str, str],
) -> tuple[str, ...] | None:
    if not _has_reliable_mrz_for_fast_path(parsed, extraction, panel_fallback_used=bool(panel_fields)):
        return None
    return OCR_FULL_VISUAL_FIELD_SCOPE

def _missing_profile_visual_panel_fields(
    ocr_profile: str,
    visual_field_names: tuple[str, ...] | None,
    visual_fields: dict[str, str],
    panel_fields: dict[str, str],
) -> tuple[str, ...]:
    if ocr_profile == OcrProfile.SPEED:
        return ()
    if visual_field_names is None:
        requested_fields = OCR_FULL_VISUAL_FIELD_SCOPE
    else:
        requested_fields = tuple(visual_field_names)
    if not requested_fields:
        return ()
    if ocr_profile == OcrProfile.BALANCED:
        requested_fields = tuple(field_name for field_name in OCR_BALANCED_PANEL_RECOVERY_FIELDS if field_name in requested_fields)
    elif ocr_profile != OcrProfile.HEAVY:
        return ()
    return tuple(
        field_name
        for field_name in requested_fields
        if field_name in OCR_FULL_PANEL_FIELD_SCOPE and not visual_fields.get(field_name) and not panel_fields.get(field_name)
    )

def _missing_speed_location_panel_fields(
    visual_field_names: tuple[str, ...] | None,
    visual_fields: dict[str, str],
) -> tuple[str, ...]:
    if not visual_field_names:
        return ()
    return tuple(
        field_name
        for field_name in ("placeOfBirth", "issuingOffice")
        if field_name in visual_field_names and not visual_fields.get(field_name)
    )

def _should_try_speed_location_ocr(parsed: ParsedPassportData, extraction: ExtractionEvidence) -> bool:
    if _is_indonesian_passport(parsed, extraction, {}) or _has_indonesian_mrz_hint(extraction):
        return True
    if not _location_ocr_ambiguous_enabled():
        return False
    if _has_clear_non_indonesian_mrz_hint(parsed, extraction):
        return False
    passport_number = str(parsed.get("passportNumber", "") or "").upper()
    if re.fullmatch(r"[EX]\d{7}", passport_number):
        return True
    nationality = str(parsed.get("nationality", "") or "")
    return _looks_like_noisy_indonesia_code(nationality)

def _should_try_recovery_location_ocr(parsed: ParsedPassportData, extraction: ExtractionEvidence) -> bool:
    if _is_indonesian_passport(parsed, extraction, {}) or _has_indonesian_mrz_hint(extraction):
        return True
    if _has_clear_non_indonesian_mrz_hint(parsed, extraction):
        return False
    passport_number = str(parsed.get("passportNumber", "") or "").upper()
    if re.fullmatch(r"[EX]\d{7}", passport_number):
        return True
    nationality = str(parsed.get("nationality", "") or "")
    return bool(nationality and _looks_like_noisy_indonesia_code(nationality))

def _location_ocr_ambiguous_enabled() -> bool:
    value = os.environ.get("PASSPORT_LOCATION_OCR_AMBIGUOUS", "").strip().lower()
    return value in {"1", "true", "yes", "on"}

def _has_clear_non_indonesian_mrz_hint(parsed: ParsedPassportData, extraction: ExtractionEvidence) -> bool:
    nationality = str(parsed.get("nationality", "") or "").upper()
    if nationality and nationality != "INDONESIA" and not _looks_like_noisy_indonesia_code(nationality):
        return True
    data = extraction.get("data", {}) if extraction else {}
    if isinstance(data, dict):
        for key in ("country", "nationality"):
            country = _normalize_mrz_country_hint(str(data.get(key, "") or ""))
            if len(country) == 3 and country != "IDN" and not _looks_like_noisy_indonesia_code(country):
                return True
    for value in _mrz_text_values(extraction):
        cleaned = re.sub(r"[^A-Z0-9<]", "", value.upper())
        if cleaned.startswith("P<") and len(cleaned) >= 5:
            country = _normalize_mrz_country_hint(cleaned[2:5])
            if len(country) == 3 and country != "IDN" and not _looks_like_noisy_indonesia_code(country):
                return True
        for match in re.finditer(r"[A-Z0-9<]{10}([A-Z0-9]{3})\d{6}[0-9<]?[MFP<]", cleaned):
            country = _normalize_mrz_country_hint(match.group(1))
            if len(country) == 3 and country != "IDN" and not _looks_like_noisy_indonesia_code(country):
                return True
    return False

def _visual_fields_need_aligned_page(field_names: tuple[str, ...] | None) -> bool:
    if field_names is None:
        return True
    return any(field_name not in {"placeOfBirth", "issuingOffice"} for field_name in field_names)

def _select_panel_fallback_visual_field_names(
    parsed: ParsedPassportData,
    panel_fields: dict[str, str],
) -> tuple[str, ...]:
    fields: list[str] = ["placeOfBirth", "issuingOffice"]
    if not panel_fields.get("fullName") and _needs_name_refinement(parsed):
        fields.append("fullName")
    if parsed.get("nationality", "") not in {"INDONESIA"} and not panel_fields.get("nationality"):
        fields.append("nationality")
    if not _is_iso_date(parsed.get("dob", "")) and not panel_fields.get("dob"):
        fields.append("dob")
    if parsed.get("gender", "") not in {"MALE", "FEMALE"} and not panel_fields.get("gender"):
        fields.append("gender")
    return tuple(dict.fromkeys(fields))

def _select_panel_field_names(parsed: ParsedPassportData, extraction: ExtractionEvidence) -> tuple[str, ...]:
    direct_mrz = _is_direct_mrz_extraction(extraction)
    fields = ["placeOfBirth", "issuingOffice"]
    if _needs_name_refinement(parsed):
        fields.append("fullName")
    if not re.fullmatch(r"[A-Z]\d{7}", parsed.get("passportNumber", "") or ""):
        fields.append("passportNumber")
    if parsed.get("nationality", "") != "INDONESIA":
        fields.append("nationality")
    if not _is_iso_date(parsed.get("dob", "")):
        fields.append("dob")
    if parsed.get("gender", "") not in {"MALE", "FEMALE"}:
        fields.append("gender")
    has_expiry = _is_iso_date(parsed.get("expiryDate", ""))
    has_issue = _is_iso_date(parsed.get("issueDate", ""))
    if not has_issue and not (direct_mrz and has_expiry):
        fields.append("issueDate")
    if not has_expiry or (not direct_mrz and not has_issue and not _has_valid_mrz_validation(extraction)):
        fields.append("expiryDate")
    return tuple(dict.fromkeys(fields))

def _should_skip_panel_for_direct_location_only(
    parsed: ParsedPassportData,
    extraction: ExtractionEvidence,
    panel_field_names: tuple[str, ...],
) -> bool:
    return (
        _is_direct_mrz_extraction(extraction)
        and "IMAGE GLARE DETECTED" in str(extraction.get("notes", "") or "").upper()
        and set(panel_field_names).issubset({"placeOfBirth", "issuingOffice"})
        and _has_reliable_mrz_for_fast_path(parsed, extraction, panel_fallback_used=False)
    )

def _is_direct_mrz_extraction(extraction: ExtractionEvidence) -> bool:
    return "DIRECT LOWER-BAND OCR" in str(extraction.get("notes", "") or "").upper()




def _should_extract_dates(parsed: ParsedPassportData) -> bool:
    issue_date = _parse_iso_date(parsed.get("issueDate", ""))
    expiry_date = _parse_iso_date(parsed.get("expiryDate", ""))
    dob = _parse_iso_date(parsed.get("dob", ""))
    if issue_date is None or expiry_date is None:
        return True
    if issue_date >= expiry_date:
        return True
    if dob and (issue_date <= dob or expiry_date <= dob):
        return True
    return False

def _should_refine_names(
    parsed: ParsedPassportData,
    extraction: ExtractionEvidence,
    panel_fallback_used: bool,
    preferred_full_name: str,
) -> bool:
    if preferred_full_name:
        return True
    if _needs_name_refinement(parsed):
        return True
    return _mrz_confidence(extraction) < 0.85 and not panel_fallback_used

def _needs_name_refinement(parsed: ParsedPassportData) -> bool:
    first_compact = _compact_name_value(parsed.get("firstName", ""))
    family_compact = _compact_name_value(parsed.get("familyName", ""))
    if first_compact and first_compact == family_compact:
        return True
    return score_name_fields(parsed.get("firstName", ""), parsed.get("familyName", "")) < 10 or _has_suspicious_name_noise(parsed)

def _has_suspicious_name_noise(parsed: ParsedPassportData) -> bool:
    for field_name, value in (("firstName", parsed.get("firstName", "")), ("familyName", parsed.get("familyName", ""))):
        tokens = re.sub(r"[^A-Z\s]", " ", str(value or "").upper()).split()
        if field_name == "familyName" and len(tokens) > 1:
            return True
        for token in tokens:
            if field_name == "familyName" and token.endswith("TLE"):
                return True
            if len(token) >= 9 and token.endswith(("K", "S")):
                return True
            if re.search(r"(.)\1{2,}", token):
                return True
    return False

def _can_infer_missing_issue_date(parsed: ParsedPassportData) -> bool:
    if _is_iso_date(parsed.get("issueDate", "")):
        return False
    expiry_date = parsed.get("expiryDate", "")
    if not _is_iso_date(expiry_date):
        return False
    return bool(infer_issue_date(parsed.get("dob", ""), expiry_date))

def _merge_visual_sources(visual_fields: dict[str, str], panel_fields: dict[str, str]) -> ParsedPassportData:
    merged = dict(visual_fields)
    for field_name in ("fullName", "placeOfBirth", "issuingOffice", "issueDate", "expiryDate", "nationality", "dob", "gender"):
        if not merged.get(field_name) and panel_fields.get(field_name):
            merged[field_name] = panel_fields[field_name]
    return merged

def _pick_preferred_full_name(
    parsed: ParsedPassportData,
    visual_fields: dict[str, str],
    panel_fields: dict[str, str],
    file_name: str = "",
) -> str:
    family_hints = salvage_family_hints(parsed.get("familyName", ""))
    for full_name in (panel_fields.get("fullName", ""), visual_fields.get("fullName", "")):
        if not full_name:
            continue
        tokens = [token for token in full_name.upper().split() if token]
        if family_hints and not _full_name_matches_family(tokens, family_hints):
            continue
        if _has_suspicious_name_noise(parsed) and _full_name_matches_current_name(tokens, parsed):
            continue
        return full_name
    return ""

def _full_name_matches_family(tokens: list[str], family_hints: list[str]) -> bool:
    if not tokens:
        return False
    if any(token_matches_simple(tokens[-1], hint) for hint in family_hints):
        return True
    return len(tokens) == 1 and any(token_matches_simple(tokens[0], hint) for hint in family_hints)

def _full_name_matches_current_name(tokens: list[str], parsed: ParsedPassportData) -> bool:
    first_name = parsed.get("firstName", "")
    family_name = parsed.get("familyName", "")
    current_tokens = re.sub(
        r"[^A-Z\s]",
        " ",
        f"{first_name} {family_name}".upper(),
    ).split()
    return bool(tokens and current_tokens) and ("".join(tokens) == "".join(current_tokens))

def _build_given_name_hint(file_name: str, extraction: ExtractionEvidence, family_hint: str = "") -> str:
    return _extract_given_name_hint(extraction, family_hint)

def _extract_given_name_hint(extraction: ExtractionEvidence, family_hint: str = "") -> str:
    data = extraction.get("data", {}) if extraction else {}
    family_hints = salvage_family_hints(family_hint)
    best_token = ""
    best_score = -1
    for key in ("line1", "raw_text", "mrz_text", "text"):
        value = str(data.get(key, "") or "")
        for line in value.splitlines():
            cleaned = re.sub(r"[^A-Z<]", "", line.upper())
            for index, part in enumerate(token for token in cleaned.split("<") if token):
                token = part.removeprefix("P").removeprefix("IDN")
                if not token:
                    continue
                if not is_reasonable_token(token):
                    continue
                if any(token_matches_simple(token, hint) for hint in family_hints):
                    continue
                score = 20 - index
                score += max(0, 8 - abs(len(token) - 6))
                score -= 10 if re.search(r"(.)\1{2,}", token) else 0
                if score > best_score:
                    best_token, best_score = token, score
    return best_token

