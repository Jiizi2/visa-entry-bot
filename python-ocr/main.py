from __future__ import annotations

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
from services.tesseract_runner import get_tesseract_ocr_stats, reset_tesseract_ocr_stats
from services.validator import calculate_confidence, validate_member
from services.visual_name_extractor import refine_names_from_scan
from services.scan_context import ScanContext

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT_DIR, "data")
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png"}
OCR_PROFILE_SPEED = "speed"
OCR_PROFILE_BALANCED = "balanced"
OCR_PROFILE_HEAVY = "heavy"
OCR_PROFILE_ACCURACY = "accuracy"
OCR_PROFILE_ALIASES = {OCR_PROFILE_ACCURACY: OCR_PROFILE_HEAVY}
OCR_PROFILES = {OCR_PROFILE_SPEED, OCR_PROFILE_BALANCED, OCR_PROFILE_HEAVY}
OCR_PROFILE_BUDGET_MS = {
    OCR_PROFILE_SPEED: 15_000,
    OCR_PROFILE_BALANCED: 30_000,
    OCR_PROFILE_HEAVY: 90_000,
}
OCR_BALANCED_PANEL_RECOVERY_FIELDS = ("placeOfBirth", "issuingOffice", "issueDate")
OCR_FULL_PANEL_FIELD_SCOPE = (
    "fullName",
    "passportNumber",
    "nationality",
    "dob",
    "gender",
    "placeOfBirth",
    "issueDate",
    "expiryDate",
    "issuingOffice",
)
OCR_FULL_VISUAL_FIELD_SCOPE = (
    "placeOfBirth",
    "issuingOffice",
    "issueDate",
    "expiryDate",
    "dob",
    "gender",
    "nationality",
    "fullName",
)
OCR_STAGE_MIN_REMAINING_MS = {
    "visual": 1_000,
    "panel": 3_000,
    "speed_panel": 2_500,
    "visual_recovery": 5_000,
    "page_align": 4_000,
    "dates": 3_000,
    "names": 4_000,
}
StepCallback = Callable[[str, str, float], None]


def _ocr_profile() -> str:
    value = os.environ.get("PASSPORT_OCR_PROFILE", OCR_PROFILE_SPEED).strip().lower()
    value = OCR_PROFILE_ALIASES.get(value, value)
    return value if value in OCR_PROFILES else OCR_PROFILE_SPEED


def _is_speed_first_scan() -> bool:
    return _ocr_profile() == OCR_PROFILE_SPEED


def _is_balanced_scan() -> bool:
    return _ocr_profile() == OCR_PROFILE_BALANCED


def _is_heavy_scan() -> bool:
    return _ocr_profile() == OCR_PROFILE_HEAVY


def _ocr_budget_ms(profile: str | None = None) -> int:
    return OCR_PROFILE_BUDGET_MS.get(profile or _ocr_profile(), OCR_PROFILE_BUDGET_MS[OCR_PROFILE_SPEED])


def resolve_group_context() -> tuple[str, str]:
    if len(sys.argv) > 1 and sys.argv[1].strip():
        group_dir = resolve_group_dir(sys.argv[1].strip())
        if group_dir:
            return os.path.basename(group_dir), group_dir
        raise SystemExit(
            f"Group folder not found: {sys.argv[1].strip()}. "
            "Use a group ID or a folder path such as example/group."
        )

    groups = discover_group_dirs()
    if len(groups) == 1:
        group_dir = groups[0]
        return os.path.basename(group_dir), group_dir
    if not groups:
        raise SystemExit(
            "No group folders found. Create <GROUP_ID>/passport/, <GROUP_ID>/passports/, "
            "or data/<GROUP_ID>/passports/."
        )
    raise SystemExit("Multiple groups found. Run: python main.py <GROUP_ID or group path>")


def resolve_group_dir(group_ref: str) -> str | None:
    candidates = []
    if os.path.isdir(group_ref):
        candidates.append(os.path.abspath(group_ref))
    candidates.append(os.path.join(ROOT_DIR, group_ref))
    candidates.append(os.path.join(DATA_DIR, group_ref))

    for candidate in candidates:
        normalized = os.path.abspath(candidate)
        if os.path.isdir(normalized):
            return normalized
    return None


def discover_group_dirs() -> list[str]:
    groups: list[str] = []
    for search_root in (ROOT_DIR, DATA_DIR):
        if not os.path.isdir(search_root):
            continue
        for entry in sorted(os.listdir(search_root)):
            group_dir = os.path.join(search_root, entry)
            if not os.path.isdir(group_dir):
                continue
            if group_dir == os.path.abspath(os.path.dirname(__file__)):
                continue
            if has_passport_folder(group_dir):
                groups.append(os.path.abspath(group_dir))
    return unique_paths(groups)


def has_passport_folder(group_dir: str) -> bool:
    return any(os.path.isdir(os.path.join(group_dir, folder_name)) for folder_name in ("passport", "passports"))


def resolve_passports_dir(group_dir: str) -> str:
    for folder_name in ("passport", "passports"):
        candidate = os.path.join(group_dir, folder_name)
        if os.path.isdir(candidate):
            return candidate
    raise FileNotFoundError(f"Passport folder not found: {group_dir}")


def unique_paths(paths: list[str]) -> list[str]:
    seen = set()
    unique = []
    for path in paths:
        normalized = os.path.abspath(path)
        if normalized not in seen:
            seen.add(normalized)
            unique.append(normalized)
    return unique


def list_passport_files(passports_dir: str) -> list[str]:
    if not os.path.isdir(passports_dir):
        raise FileNotFoundError(f"Passport folder not found: {passports_dir}")

    files = []
    for entry in sorted(os.listdir(passports_dir)):
        file_path = os.path.join(passports_dir, entry)
        extension = os.path.splitext(entry)[1].lower()
        if os.path.isfile(file_path) and extension in SUPPORTED_EXTENSIONS:
            files.append(file_path)
    return files


def process_passport(file_path: str, step_callback: StepCallback | None = None) -> dict[str, object]:
    file_name = os.path.basename(file_path)
    started_at = time.perf_counter()
    stage_durations_ms: dict[str, int] = {}
    skipped_ocr_stages: list[str] = []
    panel_fallback_used = False
    visual_ocr_used = False

    def report_step(code: str, label: str, progress: float, console_message: str) -> None:
        print(console_message)
        if step_callback is not None:
            step_callback(code, label, progress)

    report_step("start", "Menyiapkan file", 0.04, f"Processing: {file_name}")
    clear_passport_page_cache()
    clear_image_preprocess_cache()
    start_ocr_result_cache_session(file_path)
    reset_tesseract_ocr_stats()
    reset_image_preprocessor_stats()
    reset_fast_location_ocr_stats()

    try:
        ocr_profile = _ocr_profile()
        ctx = ScanContext(
            file_path=file_path,
            file_name=file_name,
            ocr_profile=ocr_profile,
            ocr_budget_ms=_ocr_budget_ms(ocr_profile),
            step_callback=step_callback
        )
        ctx.started_at = started_at
        
        _stage_mrz(ctx)
        _stage_initial_panel(ctx)
        _stage_visual_fields(ctx)
        _stage_speed_panel(ctx)
        _stage_recovery_panel(ctx)
        _stage_visual_recovery(ctx)
        _stage_fallback_panel(ctx)
        _stage_dates_recovery(ctx)
        _stage_names_recovery(ctx)
        
        return _stage_validation_and_metrics(ctx)
    except Exception as exc:  # noqa: BLE001    except Exception as exc:  # noqa: BLE001
        if step_callback is not None:
            step_callback("error", "Gagal memproses file", 0.0)
        record = build_error_record(file_name, file_path, str(exc))
        record["errorCode"] = "OCR_PASSPORT_PROCESSING_FAILED"
        record["processingMetrics"] = {
            "totalMs": _elapsed_ms(started_at),
            "stagesMs": stage_durations_ms,
            "panelFallbackUsed": panel_fallback_used,
            "visualOcrUsed": visual_ocr_used,
            "mrzFallbackUsed": bool(locals().get("mrz_error", "")),
            "ocrProfile": _ocr_profile(),
            "budgetMs": _ocr_budget_ms(),
            "elapsedMs": _elapsed_ms(started_at),
            "budgetExceeded": _budget_exceeded(started_at, _ocr_budget_ms()),
            "skippedStages": list(skipped_ocr_stages),
            "ocrCache": get_ocr_result_cache_stats(),
            "tesseract": get_tesseract_ocr_stats(),
            "imagePreprocessor": get_image_preprocessor_stats(),
            "ocrMode": "DEEP",
            "ocrModeReasons": ["PROCESSING_EXCEPTION"],
        }
        return record
    finally:
        clear_passport_page_cache()
        clear_image_preprocess_cache()
        end_ocr_result_cache_session()
        reset_tesseract_ocr_stats()
        reset_image_preprocessor_stats()


def _elapsed_ms(started_at: float) -> int:
    return max(0, int((time.perf_counter() - started_at) * 1000))


def _time_left_ms(started_at: float, budget_ms: int) -> int:
    return max(0, int(budget_ms) - _elapsed_ms(started_at))


def _has_ocr_budget_for_elapsed(elapsed_ms: int, budget_ms: int, stage_name: str) -> bool:
    return int(budget_ms) - max(0, int(elapsed_ms)) >= OCR_STAGE_MIN_REMAINING_MS.get(stage_name, 0)


def _can_spend_ocr_time(started_at: float, budget_ms: int, stage_name: str) -> bool:
    return _has_ocr_budget_for_elapsed(_elapsed_ms(started_at), budget_ms, stage_name)


def _should_run_initial_panel_scan(ocr_profile: str, extraction: dict[str, object]) -> bool:
    if ocr_profile == OCR_PROFILE_SPEED:
        return False
    if ocr_profile == OCR_PROFILE_HEAVY:
        return True
    return ocr_profile == OCR_PROFILE_BALANCED and should_use_panel_fallback(extraction)


def _select_profile_panel_field_names(
    ocr_profile: str,
    parsed: dict[str, str],
    extraction: dict[str, object],
) -> tuple[str, ...]:
    if ocr_profile == OCR_PROFILE_HEAVY:
        return OCR_FULL_PANEL_FIELD_SCOPE
    return _select_panel_field_names(parsed, extraction)


def _budget_exceeded(started_at: float, budget_ms: int) -> bool:
    return _elapsed_ms(started_at) > int(budget_ms)


def _skip_ocr_stage(skipped_stages: list[str], stage_name: str) -> None:
    if stage_name not in skipped_stages:
        skipped_stages.append(stage_name)


def _build_budget_notes(skipped_stages: list[str]) -> str:
    if not skipped_stages:
        return ""
    return "OCR TIME BUDGET SKIPPED: " + ", ".join(skipped_stages)


def _classify_ocr_mode(
    *,
    mrz_error: str,
    panel_fallback_used: bool,
    visual_ocr_used: bool,
    needs_date_scan: bool,
    needs_name_scan: bool,
    review_status: str,
) -> str:
    reasons = _ocr_mode_reasons(
        mrz_error=mrz_error,
        panel_fallback_used=panel_fallback_used,
        visual_ocr_used=visual_ocr_used,
        needs_date_scan=needs_date_scan,
        needs_name_scan=needs_name_scan,
        review_status=review_status,
    )
    if mrz_error or str(review_status).upper() == "ERROR":
        return "DEEP"
    return "FAST" if not reasons else "RECOVERY"


def _ocr_mode_reasons(
    *,
    mrz_error: str,
    panel_fallback_used: bool,
    visual_ocr_used: bool,
    needs_date_scan: bool,
    needs_name_scan: bool,
    review_status: str,
) -> list[str]:
    reasons: list[str] = []
    if mrz_error:
        reasons.append("MRZ_ERROR")
    if panel_fallback_used:
        reasons.append("PANEL_FALLBACK")
    if visual_ocr_used:
        reasons.append("VISUAL_OCR")
    if needs_date_scan:
        reasons.append("DATE_RECOVERY")
    if needs_name_scan:
        reasons.append("NAME_RECOVERY")
    if str(review_status).upper() == "NEEDS_REVIEW":
        reasons.append("REVIEW_STATUS")
    if str(review_status).upper() == "ERROR":
        reasons.append("ERROR_STATUS")
    return reasons


def _is_indonesian_passport(
    parsed: dict[str, str],
    extraction: dict[str, object],
    panel_fields: dict[str, str],
) -> bool:
    country = str(extraction.get("data", {}).get("country", "")).upper()
    nationality = parsed.get("nationality", "")
    return bool(panel_fields) or nationality == "INDONESIA" or country == "IDN" or panel_fields.get("nationality") == "INDONESIA"


def _apply_indonesian_visual_repairs(
    parsed: dict[str, str],
    extraction: dict[str, object],
    visual_fields: dict[str, str],
) -> dict[str, str]:
    updated = dict(parsed)
    if (visual_fields.get("placeOfBirth") or visual_fields.get("issuingOffice")) and _looks_like_noisy_indonesia_code(
        updated.get("nationality", "")
    ):
        updated["nationality"] = "INDONESIA"
    if not _is_iso_date(updated.get("dob", "")):
        dob = _recover_dob_from_unverified_mrz(extraction)
        if dob:
            updated["dob"] = dob
    return updated


def _apply_fast_mrz_repairs(parsed: dict[str, str], extraction: dict[str, object]) -> tuple[dict[str, str], str]:
    updated = dict(parsed)
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
        if updated.get("gender") not in {"MALE", "FEMALE"}:
            gender = _recover_gender_from_unverified_mrz(extraction)
            if gender:
                updated["gender"] = gender
                notes.append("GENDER REPAIRED FROM MRZ HINT IN FAST SCAN")
    return updated, "; ".join(notes)


def _looks_like_noisy_indonesia_code(value: str) -> bool:
    compact = re.sub(r"[^A-Z0-9]", "", str(value or "").upper())
    return compact in {"", "ID", "IDN", "DNI", "DNB", "IO3", "I03", "1O3"}


def _has_indonesian_mrz_hint(extraction: dict[str, object]) -> bool:
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


def _recover_passport_number_from_mrz(extraction: dict[str, object]) -> str:
    for value in _mrz_text_values(extraction):
        cleaned = re.sub(r"[^A-Z0-9<]", "", value.upper())
        match = re.search(r"\b([EX]\d{7})<", cleaned)
        if match:
            return match.group(1)
    return ""


def _recover_dob_from_unverified_mrz(extraction: dict[str, object]) -> str:
    for value in _mrz_text_values(extraction):
        cleaned = re.sub(r"[^A-Z0-9<]", "", value.upper())
        for match in re.finditer(r"(?:IDN|1DN|DN)(\d{6})[0-9<]?[MFP]", cleaned):
            dob = format_date(match.group(1), "birth")
            if _is_iso_date(dob):
                return dob
    return ""


def _recover_gender_from_unverified_mrz(extraction: dict[str, object]) -> str:
    for value in _mrz_text_values(extraction):
        cleaned = re.sub(r"[^A-Z0-9<]", "", value.upper())
        for match in re.finditer(r"(?:IDN|1DN|DN)\d{6}[0-9<]?([MFP])", cleaned):
            gender = match.group(1)
            if gender == "M":
                return "MALE"
            if gender in {"F", "P"}:
                return "FEMALE"
    return ""


def _mrz_text_values(extraction: dict[str, object]) -> list[str]:
    data = extraction.get("data", {}) if extraction else {}
    values: list[str] = []
    for key in ("line1", "line2", "raw_text", "mrz_text", "text"):
        value = data.get(key)
        if value is None:
            continue
        values.extend(str(value).splitlines())
    return values


def _ocr_rotation_degrees(extraction: dict[str, object]) -> int:
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


def _normalize_mrz_country_hint(value: str) -> str:
    compact = re.sub(r"[^A-Z0-9]", "", str(value or "").upper())
    if compact == "INDONESIA":
        return "IDN"
    return compact.translate(str.maketrans({"1": "I", "L": "I", "0": "D", "O": "D", "Q": "D"}))


def _select_visual_field_names(
    parsed: dict[str, str],
    extraction: dict[str, object],
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
    if parsed.get("gender") not in {"MALE", "FEMALE"}:
        fields.append("gender")
    if parsed.get("nationality") != "INDONESIA":
        fields.append("nationality")
    if not _is_iso_date(parsed.get("expiryDate", "")):
        fields.append("expiryDate")
    if _needs_name_refinement(parsed):
        fields.append("fullName")
    return tuple(dict.fromkeys(fields))


def _select_balanced_visual_field_names(
    parsed: dict[str, str],
    extraction: dict[str, object],
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


def _select_speed_visual_field_names(parsed: dict[str, str], extraction: dict[str, object]) -> tuple[str, ...]:
    if not _should_try_speed_location_ocr(parsed, extraction):
        return ()
    return ("placeOfBirth", "issuingOffice")


def _select_heavy_visual_field_names(
    parsed: dict[str, str],
    extraction: dict[str, object],
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
    if ocr_profile == OCR_PROFILE_SPEED:
        return ()
    if visual_field_names is None:
        requested_fields = OCR_FULL_VISUAL_FIELD_SCOPE
    else:
        requested_fields = tuple(visual_field_names)
    if not requested_fields:
        return ()
    if ocr_profile == OCR_PROFILE_BALANCED:
        requested_fields = tuple(field_name for field_name in OCR_BALANCED_PANEL_RECOVERY_FIELDS if field_name in requested_fields)
    elif ocr_profile != OCR_PROFILE_HEAVY:
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


def _should_try_speed_location_ocr(parsed: dict[str, str], extraction: dict[str, object]) -> bool:
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


def _should_try_recovery_location_ocr(parsed: dict[str, str], extraction: dict[str, object]) -> bool:
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


def _has_clear_non_indonesian_mrz_hint(parsed: dict[str, str], extraction: dict[str, object]) -> bool:
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
    parsed: dict[str, str],
    panel_fields: dict[str, str],
) -> tuple[str, ...]:
    fields: list[str] = ["placeOfBirth", "issuingOffice"]
    if not panel_fields.get("fullName") and _needs_name_refinement(parsed):
        fields.append("fullName")
    if parsed.get("nationality") not in {"INDONESIA"} and not panel_fields.get("nationality"):
        fields.append("nationality")
    if not _is_iso_date(parsed.get("dob", "")) and not panel_fields.get("dob"):
        fields.append("dob")
    if parsed.get("gender") not in {"MALE", "FEMALE"} and not panel_fields.get("gender"):
        fields.append("gender")
    return tuple(dict.fromkeys(fields))


def _select_panel_field_names(parsed: dict[str, str], extraction: dict[str, object]) -> tuple[str, ...]:
    direct_mrz = _is_direct_mrz_extraction(extraction)
    fields = ["placeOfBirth", "issuingOffice"]
    if _needs_name_refinement(parsed):
        fields.append("fullName")
    if not re.fullmatch(r"[A-Z]\d{7}", parsed.get("passportNumber", "") or ""):
        fields.append("passportNumber")
    if parsed.get("nationality") != "INDONESIA":
        fields.append("nationality")
    if not _is_iso_date(parsed.get("dob", "")):
        fields.append("dob")
    if parsed.get("gender") not in {"MALE", "FEMALE"}:
        fields.append("gender")
    has_expiry = _is_iso_date(parsed.get("expiryDate", ""))
    has_issue = _is_iso_date(parsed.get("issueDate", ""))
    if not has_issue and not (direct_mrz and has_expiry):
        fields.append("issueDate")
    if not has_expiry or (not direct_mrz and not has_issue and not _has_valid_mrz_validation(extraction)):
        fields.append("expiryDate")
    return tuple(dict.fromkeys(fields))


def _should_skip_panel_for_direct_location_only(
    parsed: dict[str, str],
    extraction: dict[str, object],
    panel_field_names: tuple[str, ...],
) -> bool:
    return (
        _is_direct_mrz_extraction(extraction)
        and "IMAGE GLARE DETECTED" in str(extraction.get("notes", "") or "").upper()
        and set(panel_field_names).issubset({"placeOfBirth", "issuingOffice"})
        and _has_reliable_mrz_for_fast_path(parsed, extraction, panel_fallback_used=False)
    )


def _is_direct_mrz_extraction(extraction: dict[str, object]) -> bool:
    return "DIRECT LOWER-BAND OCR" in str(extraction.get("notes", "") or "").upper()


def _has_valid_mrz_validation(extraction: dict[str, object]) -> bool:
    validation = extraction.get("mrzValidation", {})
    return isinstance(validation, dict) and bool(validation.get("valid"))


def _has_failed_mrz_validation(extraction: dict[str, object]) -> bool:
    validation = extraction.get("mrzValidation", {})
    return isinstance(validation, dict) and bool(validation.get("checks")) and validation.get("valid") is not True


def _apply_verified_single_word_name(
    parsed: dict[str, str],
    extraction: dict[str, object],
    file_name: str = "",
) -> tuple[dict[str, str], str]:
    if not _has_valid_mrz_validation(extraction):
        return parsed, ""
    return repair_single_word_name(parsed)


def _apply_verified_mrz_name_repairs(
    parsed: dict[str, str],
    extraction: dict[str, object],
    file_name: str = "",
    ) -> tuple[dict[str, str], str]:
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


def _apply_final_name_repairs(parsed: dict[str, str], file_name: str = "") -> tuple[dict[str, str], str]:
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


def _has_reliable_mrz_for_fast_path(
    parsed: dict[str, str],
    extraction: dict[str, object],
    panel_fallback_used: bool,
) -> bool:
    if panel_fallback_used:
        return False
    if _mrz_confidence(extraction) < 0.85:
        return False
    if "LOW PASSPORTEYE CONFIDENCE" in str(extraction.get("notes", "") or "").upper():
        return False
    return bool(
        parsed.get("passportNumber")
        and parsed.get("nationality")
        and _is_iso_date(parsed.get("dob", ""))
        and _is_iso_date(parsed.get("expiryDate", ""))
        and parsed.get("gender") in {"MALE", "FEMALE"}
    )


def _should_extract_dates(parsed: dict[str, str]) -> bool:
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


def _apply_fast_date_repairs(parsed: dict[str, str]) -> tuple[dict[str, str], str]:
    if _is_iso_date(parsed.get("issueDate", "")):
        return parsed, ""
    expiry_date = parsed.get("expiryDate", "")
    if not _is_iso_date(expiry_date):
        return parsed, ""
    inferred_issue = infer_issue_date(parsed.get("dob", ""), expiry_date)
    if not inferred_issue:
        return parsed, ""
    updated = dict(parsed)
    updated["issueDate"] = inferred_issue
    return updated, "ISSUE DATE INFERRED FROM EXPIRY DATE IN FAST SCAN"


def _should_refine_names(
    parsed: dict[str, str],
    extraction: dict[str, object],
    panel_fallback_used: bool,
    preferred_full_name: str,
) -> bool:
    if preferred_full_name:
        return True
    if _needs_name_refinement(parsed):
        return True
    return _mrz_confidence(extraction) < 0.85 and not panel_fallback_used


def _needs_name_refinement(parsed: dict[str, str]) -> bool:
    first_compact = _compact_name_value(parsed.get("firstName", ""))
    family_compact = _compact_name_value(parsed.get("familyName", ""))
    if first_compact and first_compact == family_compact:
        return True
    return score_name_fields(parsed.get("firstName", ""), parsed.get("familyName", "")) < 10 or _has_suspicious_name_noise(parsed)


def _has_suspicious_name_noise(parsed: dict[str, str]) -> bool:
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


def _can_infer_missing_issue_date(parsed: dict[str, str]) -> bool:
    if _is_iso_date(parsed.get("issueDate", "")):
        return False
    expiry_date = parsed.get("expiryDate", "")
    if not _is_iso_date(expiry_date):
        return False
    return bool(infer_issue_date(parsed.get("dob", ""), expiry_date))


def _repair_impossible_expiry_date(parsed: dict[str, str]) -> tuple[dict[str, str], str]:
    expiry = _parse_iso_date(parsed.get("expiryDate", ""))
    dob = _parse_iso_date(parsed.get("dob", ""))
    if expiry is None or dob is None or expiry > dob or expiry.year >= 2000:
        return parsed, ""
    repaired_expiry = expiry.replace(year=expiry.year + 80)
    today = date.today()
    if repaired_expiry <= today or repaired_expiry.year > today.year + 20:
        return parsed, ""
    updated = dict(parsed)
    updated["expiryDate"] = repaired_expiry.isoformat()
    note = "EXPIRY DATE CENTURY REPAIRED FROM MRZ"
    if not _is_iso_date(updated.get("issueDate", "")):
        inferred_issue = infer_issue_date(updated.get("dob", ""), updated["expiryDate"])
        if inferred_issue:
            updated["issueDate"] = inferred_issue
            note = join_notes(note, "ISSUE DATE INFERRED FROM REPAIRED EXPIRY")
    return updated, note


def _mrz_confidence(extraction: dict[str, object]) -> float:
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


def _merge_visual_sources(visual_fields: dict[str, str], panel_fields: dict[str, str]) -> dict[str, str]:
    merged = dict(visual_fields)
    for field_name in ("fullName", "placeOfBirth", "issuingOffice", "issueDate", "expiryDate", "nationality", "dob", "gender"):
        if not merged.get(field_name) and panel_fields.get(field_name):
            merged[field_name] = panel_fields[field_name]
    return merged


def _pick_preferred_full_name(
    parsed: dict[str, str],
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


def _full_name_matches_current_name(tokens: list[str], parsed: dict[str, str]) -> bool:
    current_tokens = re.sub(
        r"[^A-Z\s]",
        " ",
        f"{parsed.get('firstName', '')} {parsed.get('familyName', '')}".upper(),
    ).split()
    return bool(tokens and current_tokens) and ("".join(tokens) == "".join(current_tokens))


def _build_given_name_hint(file_name: str, extraction: dict[str, object], family_hint: str = "") -> str:
    return _extract_given_name_hint(extraction, family_hint)


def _extract_given_name_hint(extraction: dict[str, object], family_hint: str = "") -> str:
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


def join_notes(*values: str) -> str:
    notes = []
    for value in values:
        cleaned = str(value or "").strip().upper()
        if cleaned and cleaned not in notes:
            notes.append(cleaned)
    return "; ".join(notes)


MANIFEST_IMAGE_PATH_FIELDS = (
    "passportImagePath",
    "originalPassportImagePath",
    "croppedPassportImagePath",
    "nusukUploadImagePath",
)
MANIFEST_PREP_METADATA_PATH_FIELDS = (
    "sourcePath",
    "originalScanPath",
    "scanPath",
    "editedPath",
)


def write_manifest(group_id: str, group_dir: str, members: list[dict[str, object]]) -> None:
    output_dir = group_dir
    _normalize_member_image_paths_for_manifest(members, output_dir)

    manifest = {
        "schemaVersion": "passport-manifest-v1",
        "groupId": group_id,
        "contractVersion": "passport-extracted-resolved-profile-v4",
        "members": members,
    }
    manifest_path = os.path.join(output_dir, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as file_handle:
        json.dump(manifest, file_handle, indent=2, ensure_ascii=False)


def _normalize_member_image_paths_for_manifest(members: list[dict[str, object]], manifest_dir: str) -> None:
    for member in members:
        if not isinstance(member, dict):
            continue
        for field_name in MANIFEST_IMAGE_PATH_FIELDS:
            if field_name in member:
                member[field_name] = _manifest_relative_output_path(str(member.get(field_name) or ""), manifest_dir)

        prep_metadata = member.get("imagePrepMetadata")
        if isinstance(prep_metadata, dict):
            for field_name in MANIFEST_PREP_METADATA_PATH_FIELDS:
                if field_name in prep_metadata:
                    prep_metadata[field_name] = _manifest_relative_output_path(
                        str(prep_metadata.get(field_name) or ""),
                        manifest_dir,
                    )


def _manifest_relative_output_path(path: str, manifest_dir: str) -> str:
    text = str(path or "").strip()
    if not text:
        return ""

    resolved = _resolve_output_path_reference(text, manifest_dir)
    try:
        return os.path.relpath(resolved, manifest_dir).replace(os.sep, "/")
    except ValueError:
        return _normalize_filesystem_path(resolved).replace(os.sep, "/")


def _resolve_output_path_reference(path: str, manifest_dir: str) -> str:
    normalized_path = _normalize_filesystem_path(path)
    if os.path.isabs(normalized_path):
        return os.path.abspath(normalized_path)

    search_roots = [
        manifest_dir,
        ROOT_DIR,
        os.getcwd(),
    ]
    for root in search_roots:
        candidate = os.path.abspath(os.path.join(root, normalized_path))
        if os.path.exists(candidate):
            return candidate
    return os.path.abspath(os.path.join(manifest_dir, normalized_path))


def _normalize_filesystem_path(path: str) -> str:
    text = str(path or "").strip()
    if text.startswith("\\\\?\\UNC\\"):
        return "\\\\" + text[8:]
    if text.startswith("\\\\?\\"):
        return text[4:]
    return text


def print_summary(members: list[dict[str, object]]) -> None:
    valid_count = sum(1 for member in members if member.get("status") == "VALID")
    error_count = len(members) - valid_count
    review_count = sum(1 for member in members if member.get("reviewStatus") == "NEEDS_REVIEW")
    print(f"Processed {len(members)} files: {valid_count} VALID, {error_count} ERROR, {review_count} NEEDS_REVIEW")


def main() -> None:
    cleanup_temp_root()
    try:
        group_id, group_dir = resolve_group_context()
        passports_dir = resolve_passports_dir(group_dir)
        passport_files = list_passport_files(passports_dir)
        if not passport_files:
            raise SystemExit(f"No passport images found in: {passports_dir}")

        members = [process_passport(file_path) for file_path in passport_files]
        write_manifest(group_id, group_dir, members)
        print_summary(members)
    finally:
        cleanup_temp_root()


if __name__ == "__main__":
    main()

def _stage_mrz(ctx: ScanContext) -> None:
    ctx.report_step('mrz', 'Mengekstrak MRZ', 0.16, '  - extracting MRZ')
    stage_started = time.perf_counter()
    try:
        ctx.extraction = extract_mrz_data(ctx.file_path)
        ctx.parsed = parse_mrz_data(ctx.extraction.get('data', {}))
        ctx.parsed, ctx.early_name_notes = _apply_verified_mrz_name_repairs(ctx.parsed, ctx.extraction, file_name=ctx.file_name)
    except Exception as exc:  # noqa: BLE001
        ctx.mrz_error = str(exc)
    ctx.record_stage_duration('mrz', stage_started)


def _stage_initial_panel(ctx: ScanContext) -> None:
    if _should_run_initial_panel_scan(ctx.ocr_profile, ctx.extraction):
        panel_field_names = _select_profile_panel_field_names(ctx.ocr_profile, ctx.parsed, ctx.extraction)
        if _should_skip_panel_for_direct_location_only(ctx.parsed, ctx.extraction, panel_field_names):
            ctx.skipped_panel_field_names = panel_field_names
            ctx.panel_field_names = ()
        elif ctx.can_spend_ocr_time('panel'):
            ctx.panel_fallback_used = True
            ctx.report_step('panel', 'Membaca panel dokumen', 0.30, '  - reading document panel')
            stage_started = time.perf_counter()
            ctx.panel_fields = extract_document_panel_fields(
                ctx.file_path,
                family_hint=ctx.parsed.get('familyName', ''),
                given_hint=_build_given_name_hint(ctx.file_name, ctx.extraction, ctx.parsed.get('familyName', '')),
                field_names=panel_field_names,
                current_dob=ctx.parsed.get('dob', ''),
                current_issue_date=ctx.parsed.get('issueDate', ''),
                current_expiry_date=ctx.parsed.get('expiryDate', ''),
            )
            ctx.parsed, ctx.panel_notes = fuse_panel_fields(ctx.parsed, ctx.extraction, ctx.panel_fields)
            ctx.record_stage_duration('panel', stage_started)
        else:
            ctx.skip_stage('panel')
            ctx.panel_field_names = ()
    else:
        ctx.panel_field_names = ()



def _stage_visual_fields(ctx: ScanContext) -> None:
    speed_first_scan = ctx.ocr_profile == OCR_PROFILE_SPEED
    heavy_scan = ctx.ocr_profile == OCR_PROFILE_HEAVY
    is_indonesian_passport = _is_indonesian_passport(ctx.parsed, ctx.extraction, ctx.panel_fields) or (
        speed_first_scan and _should_try_speed_location_ocr(ctx.parsed, ctx.extraction)
    ) or (
        not speed_first_scan and _should_try_recovery_location_ocr(ctx.parsed, ctx.extraction)
    )
    if is_indonesian_passport:
        if speed_first_scan:
            ctx.visual_field_names = _select_speed_visual_field_names(ctx.parsed, ctx.extraction)
        elif heavy_scan:
            ctx.visual_field_names = _select_heavy_visual_field_names(ctx.parsed, ctx.extraction, ctx.panel_fields)
        else:
            ctx.visual_field_names = _select_balanced_visual_field_names(ctx.parsed, ctx.extraction, ctx.panel_fallback_used, ctx.panel_fields)
        ctx.report_step("visual", "Membaca field visual", 0.46, "  - reading visual fields")
        stage_started = time.perf_counter()
        if ctx.visual_field_names != ():
            if ctx.can_spend_ocr_time("visual"):
                ctx.visual_ocr_used = True
                if speed_first_scan:
                    ctx.visual_fields = extract_fast_location_fields(
                        ctx.file_path,
                        field_names=ctx.visual_field_names,
                        rotation_degrees=ctx.ocr_rotation_degrees,
                    )
                elif _visual_fields_need_aligned_page(ctx.visual_field_names):
                    if ctx.can_spend_ocr_time("page_align"):
                        ctx.page = extract_aligned_passport_page(ctx.file_path)
                    else:
                        ctx.skip_stage("page_align")
                    ctx.visual_fields = extract_visual_fields(
                        ctx.file_path,
                        page=ctx.page,
                        field_names=ctx.visual_field_names,
                        allow_aligned_fallback=not ctx.skipped_panel_field_names and ctx.page is not None,
                        rotation_degrees=ctx.ocr_rotation_degrees,
                    )
                else:
                    ctx.visual_fields = extract_visual_fields(
                        ctx.file_path,
                        page=ctx.page,
                        field_names=ctx.visual_field_names,
                        allow_aligned_fallback=not ctx.skipped_panel_field_names,
                        rotation_degrees=ctx.ocr_rotation_degrees,
                    )
            else:
                ctx.skip_stage("visual")
        ctx.record_stage_duration("visual", stage_started)
    else:
        ctx.visual_field_names = ()

def _stage_speed_panel(ctx: ScanContext) -> None:
    speed_first_scan = ctx.ocr_profile == OCR_PROFILE_SPEED
    if speed_first_scan:
        missing_speed_panel_fields = _missing_speed_location_panel_fields(ctx.visual_field_names, ctx.visual_fields)
        if missing_speed_panel_fields:
            if ctx.can_spend_ocr_time("speed_panel"):
                ctx.panel_fallback_used = True
                ctx.report_step("panel", "Membaca panel lokasi", 0.50, "  - reading document panel")
                stage_started = time.perf_counter()
                speed_panel_fields = extract_document_panel_fields(
                    ctx.file_path,
                    family_hint=ctx.parsed.get("familyName", ""),
                    given_hint=_build_given_name_hint(ctx.file_name, ctx.extraction, ctx.parsed.get("familyName", "")),
                    field_names=missing_speed_panel_fields,
                    current_dob=ctx.parsed.get("dob", ""),
                    current_issue_date=ctx.parsed.get("issueDate", ""),
                    current_expiry_date=ctx.parsed.get("expiryDate", ""),
                )
                ctx.panel_fields.update({key: value for key, value in speed_panel_fields.items() if value and not ctx.panel_fields.get(key)})
                ctx.parsed, speed_panel_notes = fuse_panel_fields(ctx.parsed, ctx.extraction, speed_panel_fields)
                ctx.panel_notes = join_notes(ctx.panel_notes, speed_panel_notes)
                ctx.record_stage_duration("panel", stage_started)
            else:
                ctx.skip_stage("speed_panel")

def _stage_recovery_panel(ctx: ScanContext) -> None:
    speed_first_scan = ctx.ocr_profile == OCR_PROFILE_SPEED
    if not speed_first_scan:
        missing_profile_panel_fields = _missing_profile_visual_panel_fields(
            ctx.ocr_profile,
            ctx.visual_field_names,
            ctx.visual_fields,
            ctx.panel_fields,
        )
        if missing_profile_panel_fields:
            if ctx.can_spend_ocr_time("panel"):
                ctx.panel_recovery_field_names = tuple(dict.fromkeys((*ctx.panel_recovery_field_names, *missing_profile_panel_fields)))
                ctx.panel_fallback_used = True
                ctx.report_step("panel", "Memperkuat field dokumen", 0.52, "  - reinforcing document fields")
                stage_started = time.perf_counter()
                recovery_panel_fields = extract_document_panel_fields(
                    ctx.file_path,
                    family_hint=ctx.parsed.get("familyName", ""),
                    given_hint=_build_given_name_hint(ctx.file_name, ctx.extraction, ctx.parsed.get("familyName", "")),
                    field_names=missing_profile_panel_fields,
                    current_dob=ctx.parsed.get("dob", ""),
                    current_issue_date=ctx.parsed.get("issueDate", ""),
                    current_expiry_date=ctx.parsed.get("expiryDate", ""),
                )
                ctx.panel_fields.update({key: value for key, value in recovery_panel_fields.items() if value and not ctx.panel_fields.get(key)})
                ctx.parsed, recovery_panel_notes = fuse_panel_fields(ctx.parsed, ctx.extraction, recovery_panel_fields)
                ctx.panel_notes = join_notes(ctx.panel_notes, recovery_panel_notes)
                ctx.record_stage_duration("panel", stage_started)
            else:
                ctx.skip_stage("panel")

def _stage_visual_recovery(ctx: ScanContext) -> None:
    speed_first_scan = ctx.ocr_profile == OCR_PROFILE_SPEED
    if ctx.skipped_panel_field_names and not speed_first_scan:
        missing_panel_fields = tuple(
            field_name
            for field_name in ctx.skipped_panel_field_names
            if not ctx.visual_fields.get(field_name) and not ctx.panel_fields.get(field_name)
        )
        if missing_panel_fields and ctx.visual_fields:
            if ctx.can_spend_ocr_time("visual_recovery"):
                stage_started = time.perf_counter()
                if ctx.page is None:
                    if ctx.can_spend_ocr_time("page_align"):
                        ctx.page = extract_aligned_passport_page(ctx.file_path)
                    else:
                        ctx.skip_stage("page_align")
                recovered_visual_fields = extract_visual_fields(
                    ctx.file_path,
                    page=ctx.page,
                    field_names=missing_panel_fields,
                    allow_aligned_fallback=ctx.page is not None,
                    rotation_degrees=ctx.ocr_rotation_degrees,
                )
                ctx.visual_fields.update(recovered_visual_fields)
                ctx.record_stage_duration("visual", stage_started)
            else:
                ctx.skip_stage("visual_recovery")

def _stage_fallback_panel(ctx: ScanContext) -> None:
    speed_first_scan = ctx.ocr_profile == OCR_PROFILE_SPEED
    if ctx.skipped_panel_field_names and not speed_first_scan:
        missing_panel_fields = tuple(
            field_name
            for field_name in ctx.skipped_panel_field_names
            if not ctx.visual_fields.get(field_name) and not ctx.panel_fields.get(field_name)
        )
        if missing_panel_fields:
            if ctx.can_spend_ocr_time("panel"):
                ctx.panel_fallback_used = True
                ctx.report_step("panel", "Membaca panel dokumen", 0.50, "  - reading document panel")
                stage_started = time.perf_counter()
                panel_fields = extract_document_panel_fields(
                    ctx.file_path,
                    family_hint=ctx.parsed.get("familyName", ""),
                    given_hint=_build_given_name_hint(ctx.file_name, ctx.extraction, ctx.parsed.get("familyName", "")),
                    field_names=missing_panel_fields,
                    current_dob=ctx.parsed.get("dob", ""),
                    current_issue_date=ctx.parsed.get("issueDate", ""),
                    current_expiry_date=ctx.parsed.get("expiryDate", ""),
                )
                ctx.parsed, panel_notes = fuse_panel_fields(ctx.parsed, ctx.extraction, panel_fields)
                ctx.panel_notes = join_notes(ctx.panel_notes, panel_notes)
                ctx.panel_fields.update(panel_fields)
                ctx.record_stage_duration("panel", stage_started)
            else:
                ctx.skip_stage("panel")

def _stage_dates_recovery(ctx: ScanContext) -> None:
    speed_first_scan = ctx.ocr_profile == OCR_PROFILE_SPEED
    ctx.merged_visual_fields = _merge_visual_sources(ctx.visual_fields, ctx.panel_fields)
    ctx.parsed = merge_visual_fields(ctx.parsed, ctx.merged_visual_fields)
    ctx.parsed = _apply_indonesian_visual_repairs(ctx.parsed, ctx.extraction, ctx.merged_visual_fields)
    ctx.parsed, ctx.fast_mrz_notes = _apply_fast_mrz_repairs(ctx.parsed, ctx.extraction) if speed_first_scan else (ctx.parsed, "")
    ctx.visual_notes = build_visual_notes(ctx.merged_visual_fields)
    preferred_full_name = _pick_preferred_full_name(ctx.parsed, ctx.merged_visual_fields, ctx.panel_fields, ctx.file_name)
    ctx.parsed, ctx.fast_date_notes = _apply_fast_date_repairs(ctx.parsed) if speed_first_scan else (ctx.parsed, "")
    
    needs_date_scan = False if speed_first_scan else _should_extract_dates(ctx.parsed)
    needs_name_scan = False if speed_first_scan else _should_refine_names(ctx.parsed, ctx.extraction, ctx.panel_fallback_used, preferred_full_name)
    needs_page_for_dates = needs_date_scan and not _can_infer_missing_issue_date(ctx.parsed)

    if ctx.page is None and (needs_page_for_dates or (needs_name_scan and not preferred_full_name)):
        stage_started = time.perf_counter()
        if ctx.can_spend_ocr_time("page_align"):
            ctx.page = extract_aligned_passport_page(ctx.file_path)
        else:
            ctx.skip_stage("page_align")
        ctx.record_stage_duration("page_align", stage_started)
        
    ctx.report_step("dates", "Mencari tanggal passport", 0.68, "  - extracting passport dates")
    stage_started = time.perf_counter()
    if needs_date_scan:
        if needs_page_for_dates and ctx.page is None:
            ctx.skip_stage("dates")
        elif ctx.can_spend_ocr_time("dates"):
            date_fields = extract_document_dates(
                ctx.file_path,
                dob=ctx.parsed.get("dob", ""),
                current_issue_date=ctx.parsed.get("issueDate", ""),
                current_expiry_date=ctx.parsed.get("expiryDate", ""),
                page=ctx.page if needs_page_for_dates else None,
            )
            for field_name in ("issueDate", "expiryDate"):
                if date_fields.get(field_name):
                    ctx.parsed[field_name] = date_fields[field_name]
        else:
            ctx.skip_stage("dates")
            
    ctx.parsed, ctx.date_repair_notes = _repair_impossible_expiry_date(ctx.parsed)
    ctx.record_stage_duration("dates", stage_started)

def _stage_names_recovery(ctx: ScanContext) -> None:
    speed_first_scan = ctx.ocr_profile == OCR_PROFILE_SPEED
    preferred_full_name = _pick_preferred_full_name(ctx.parsed, ctx.merged_visual_fields, ctx.panel_fields, ctx.file_name)
    needs_name_scan = False if speed_first_scan else _should_refine_names(ctx.parsed, ctx.extraction, ctx.panel_fallback_used, preferred_full_name)
    
    ctx.report_step("names", "Merapikan nama", 0.88, "  - refining names")
    stage_started = time.perf_counter()
    if needs_name_scan:
        if not preferred_full_name and ctx.page is None:
            ctx.skip_stage("names")
            ctx.name_notes = ""
        elif ctx.can_spend_ocr_time("names"):
            ctx.parsed, ctx.name_notes = refine_names_from_scan(
                ctx.file_path,
                ctx.parsed,
                page=ctx.page,
                preferred_full_name=preferred_full_name,
            )
        else:
            ctx.skip_stage("names")
            ctx.name_notes = ""
    else:
        ctx.name_notes = ""
        
    ctx.parsed, final_name_notes = _apply_final_name_repairs(ctx.parsed, file_name=ctx.file_name)
    if final_name_notes:
        ctx.name_notes = join_notes(ctx.name_notes, final_name_notes)
    ctx.record_stage_duration("names", stage_started)

def _stage_validation_and_metrics(ctx: ScanContext) -> dict[str, object]:
    ctx.report_step("validate", "Validasi akhir", 0.96, "  - validating")
    stage_started = time.perf_counter()
    validation_member = {
        **ctx.parsed,
        "birthCity": ctx.merged_visual_fields.get("placeOfBirth", ""),
        "cityOfIssued": ctx.merged_visual_fields.get("issuingOffice", ""),
    }
    status, validation_notes = validate_member(validation_member)
    ctx.record_stage_duration("validate", stage_started)
    
    speed_first_scan = ctx.ocr_profile == OCR_PROFILE_SPEED
    speed_scan_notes = "FAST SCAN REVIEW REQUIRED; DEEP VISUAL OCR SKIPPED" if speed_first_scan else ""
    
    notes = join_notes(
        ctx.mrz_error,
        ctx.extraction.get("notes", ""),
        ctx.panel_notes,
        ctx.visual_notes,
        speed_scan_notes,
        ctx.early_name_notes,
        ctx.fast_mrz_notes,
        ctx.fast_date_notes,
        ctx.date_repair_notes,
        ctx.name_notes,
        _build_budget_notes(ctx.skipped_ocr_stages),
        validation_notes,
    )
    
    record = build_member_record(
        ctx.file_name,
        ctx.file_path,
        ctx.parsed,
        ctx.merged_visual_fields,
        ctx.extraction,
        status,
        calculate_confidence(ctx.extraction.get("confidence", 0.0), validation_member, status),
        notes,
    )
    
    # Needs explicit string cast for reviewStatus
    review_status_str = str(record.get("reviewStatus", ""))
    
    record["processingMetrics"] = {
        "totalMs": ctx.elapsed_ms(),
        "stagesMs": ctx.stage_durations_ms,
        "panelFallbackUsed": ctx.panel_fallback_used,
        "panelFieldScope": list(dict.fromkeys((*ctx.panel_field_names, *ctx.panel_recovery_field_names))),
        "visualOcrUsed": ctx.visual_ocr_used,
        "visualFieldScope": list(ctx.visual_field_names) if ctx.visual_field_names is not None else "all",
        "mrzFallbackUsed": bool(ctx.mrz_error),
        "ocrProfile": ctx.ocr_profile,
        "budgetMs": ctx.ocr_budget_ms,
        "elapsedMs": ctx.elapsed_ms(),
        "budgetExceeded": ctx.budget_exceeded(),
        "skippedStages": list(ctx.skipped_ocr_stages),
        "ocrCache": get_ocr_result_cache_stats(),
        "tesseract": get_tesseract_ocr_stats(),
        "imagePreprocessor": get_image_preprocessor_stats(),
        "fastLocationOcr": get_fast_location_ocr_stats(),
        "ocrMode": _classify_ocr_mode(
            mrz_error=ctx.mrz_error,
            panel_fallback_used=ctx.panel_fallback_used,
            visual_ocr_used=ctx.visual_ocr_used,
            needs_date_scan=ctx.needs_date_scan,
            needs_name_scan=ctx.needs_name_scan,
            review_status=review_status_str,
        ),
        "ocrModeReasons": _ocr_mode_reasons(
            mrz_error=ctx.mrz_error,
            panel_fallback_used=ctx.panel_fallback_used,
            visual_ocr_used=ctx.visual_ocr_used,
            needs_date_scan=ctx.needs_date_scan,
            needs_name_scan=ctx.needs_name_scan,
            review_status=review_status_str,
        ),
    }
    return record
