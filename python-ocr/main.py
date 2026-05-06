from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import date
from typing import Callable

from services.date_field_extractor import extract_document_dates
from services.image_preprocessor import cleanup_temp_root
from services.indonesia_field_ocr import build_visual_notes, extract_visual_fields, merge_visual_fields
from services.issue_date_extractor import infer_issue_date
from services.mrz_extractor import extract_mrz_data
from services.name_support import is_reasonable_token, repair_common_given_name_spacing, repair_single_word_name, salvage_family_hints, score_name_fields, token_matches_simple
from services.nusuk_manifest import build_error_record, build_member_record
from services.ocr_result_cache import end_ocr_result_cache_session, get_ocr_result_cache_stats, start_ocr_result_cache_session
from services.panel_fallback import extract_document_panel_fields, fuse_panel_fields, should_use_panel_fallback
from services.panel_name_support import score_full_name
from services.passport_page import clear_passport_page_cache, extract_aligned_passport_page
from services.parser import parse_mrz_data
from services.tesseract_runner import get_tesseract_ocr_stats, reset_tesseract_ocr_stats
from services.validator import calculate_confidence, validate_member
from services.visual_name_extractor import refine_names_from_scan

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT_DIR, "data")
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png"}
StepCallback = Callable[[str, str, float], None]
FILENAME_NAME_NOISE = {"COPY", "IMG", "IMAGE", "JPEG", "JPG", "OF", "PASSPORT", "PHOTO", "PNG", "SCAN"}


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
    panel_fallback_used = False
    visual_ocr_used = False

    def report_step(code: str, label: str, progress: float, console_message: str) -> None:
        print(console_message)
        if step_callback is not None:
            step_callback(code, label, progress)

    report_step("start", "Menyiapkan file", 0.04, f"Processing: {file_name}")
    clear_passport_page_cache()
    start_ocr_result_cache_session(file_path)
    reset_tesseract_ocr_stats()

    try:
        extraction: dict[str, object] = {"data": {}, "confidence": 0.0, "notes": ""}
        parsed = parse_mrz_data({})
        mrz_error = ""
        early_name_notes = ""

        report_step("mrz", "Mengekstrak MRZ", 0.16, "  - extracting MRZ")
        stage_started = time.perf_counter()
        try:
            extraction = extract_mrz_data(file_path)
            parsed = parse_mrz_data(extraction["data"])
            parsed, early_name_notes = _apply_verified_mrz_name_repairs(parsed, extraction, file_name=file_name)
        except Exception as exc:  # noqa: BLE001
            mrz_error = str(exc)
        stage_durations_ms["mrz"] = _elapsed_ms(stage_started)

        page = None
        visual_fields: dict[str, str] = {}
        visual_notes = ""
        panel_fields: dict[str, str] = {}
        panel_notes = ""
        if should_use_panel_fallback(extraction):
            panel_fallback_used = True
            panel_field_names = _select_panel_field_names(parsed, extraction)
            report_step("panel", "Membaca panel dokumen", 0.30, "  - reading document panel")
            stage_started = time.perf_counter()
            panel_fields = extract_document_panel_fields(
                file_path,
                family_hint=parsed.get("familyName", ""),
                given_hint=_build_given_name_hint(file_name, extraction, parsed.get("familyName", "")),
                field_names=panel_field_names,
                current_dob=parsed.get("dob", ""),
                current_issue_date=parsed.get("issueDate", ""),
                current_expiry_date=parsed.get("expiryDate", ""),
            )
            parsed, panel_notes = fuse_panel_fields(parsed, extraction, panel_fields)
            stage_durations_ms["panel"] = _elapsed_ms(stage_started)
        else:
            panel_field_names = ()

        if _is_indonesian_passport(parsed, extraction, panel_fields):
            visual_field_names = _select_visual_field_names(parsed, extraction, panel_fallback_used, panel_fields)
            report_step("visual", "Membaca field visual", 0.46, "  - reading visual fields")
            stage_started = time.perf_counter()
            if visual_field_names != ():
                visual_ocr_used = True
                page = extract_aligned_passport_page(file_path)
                visual_fields = extract_visual_fields(file_path, page=page, field_names=visual_field_names)
            stage_durations_ms["visual"] = _elapsed_ms(stage_started)
        else:
            visual_field_names = ()
        merged_visual_fields = _merge_visual_sources(visual_fields, panel_fields)
        parsed = merge_visual_fields(parsed, merged_visual_fields)
        visual_notes = build_visual_notes(merged_visual_fields)
        preferred_full_name = _pick_preferred_full_name(parsed, merged_visual_fields, panel_fields, file_name)
        needs_date_scan = _should_extract_dates(parsed)
        needs_name_scan = _should_refine_names(parsed, extraction, panel_fallback_used, preferred_full_name)
        needs_page_for_dates = needs_date_scan and not _can_infer_missing_issue_date(parsed)

        if page is None and (needs_page_for_dates or (needs_name_scan and not preferred_full_name)):
            stage_started = time.perf_counter()
            page = extract_aligned_passport_page(file_path)
            stage_durations_ms["page_align"] = _elapsed_ms(stage_started)
        report_step("dates", "Mencari tanggal passport", 0.68, "  - extracting passport dates")
        stage_started = time.perf_counter()
        if needs_date_scan:
            date_fields = extract_document_dates(
                file_path,
                dob=parsed["dob"],
                current_issue_date=parsed.get("issueDate", ""),
                current_expiry_date=parsed.get("expiryDate", ""),
                page=page if needs_page_for_dates else None,
            )
            for field_name in ("issueDate", "expiryDate"):
                if date_fields.get(field_name):
                    parsed[field_name] = date_fields[field_name]
        stage_durations_ms["dates"] = _elapsed_ms(stage_started)
        report_step("names", "Merapikan nama", 0.88, "  - refining names")
        stage_started = time.perf_counter()
        if needs_name_scan:
            parsed, name_notes = refine_names_from_scan(
                file_path,
                parsed,
                page=page,
                preferred_full_name=preferred_full_name,
            )
        else:
            name_notes = ""
        stage_durations_ms["names"] = _elapsed_ms(stage_started)
        report_step("validate", "Validasi akhir", 0.96, "  - validating")
        stage_started = time.perf_counter()
        status, validation_notes = validate_member(parsed)
        stage_durations_ms["validate"] = _elapsed_ms(stage_started)
        notes = join_notes(mrz_error, extraction.get("notes", ""), panel_notes, visual_notes, early_name_notes, name_notes, validation_notes)
        record = build_member_record(
            file_name,
            file_path,
            parsed,
            merged_visual_fields,
            extraction,
            status,
            calculate_confidence(extraction.get("confidence", 0.0), parsed, status),
            notes,
        )
        record["processingMetrics"] = {
            "totalMs": _elapsed_ms(started_at),
            "stagesMs": stage_durations_ms,
            "panelFallbackUsed": panel_fallback_used,
            "panelFieldScope": list(panel_field_names),
            "visualOcrUsed": visual_ocr_used,
            "visualFieldScope": list(visual_field_names) if visual_field_names is not None else "all",
            "mrzFallbackUsed": bool(mrz_error),
            "ocrCache": get_ocr_result_cache_stats(),
            "tesseract": get_tesseract_ocr_stats(),
            "ocrMode": _classify_ocr_mode(
                mrz_error=mrz_error,
                panel_fallback_used=panel_fallback_used,
                visual_ocr_used=visual_ocr_used,
                needs_date_scan=needs_date_scan,
                needs_name_scan=needs_name_scan,
                review_status=str(record.get("reviewStatus", "")),
            ),
            "ocrModeReasons": _ocr_mode_reasons(
                mrz_error=mrz_error,
                panel_fallback_used=panel_fallback_used,
                visual_ocr_used=visual_ocr_used,
                needs_date_scan=needs_date_scan,
                needs_name_scan=needs_name_scan,
                review_status=str(record.get("reviewStatus", "")),
            ),
        }
        return record
    except Exception as exc:  # noqa: BLE001
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
            "ocrCache": get_ocr_result_cache_stats(),
            "tesseract": get_tesseract_ocr_stats(),
            "ocrMode": "DEEP",
            "ocrModeReasons": ["PROCESSING_EXCEPTION"],
        }
        return record
    finally:
        clear_passport_page_cache()
        end_ocr_result_cache_session()
        reset_tesseract_ocr_stats()


def _elapsed_ms(started_at: float) -> int:
    return max(0, int((time.perf_counter() - started_at) * 1000))


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
    return nationality == "INDONESIA" or country == "IDN" or panel_fields.get("nationality") == "INDONESIA"


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
    if not _is_iso_date(parsed.get("issueDate", "")):
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


def _select_panel_fallback_visual_field_names(
    parsed: dict[str, str],
    panel_fields: dict[str, str],
) -> tuple[str, ...]:
    fields: list[str] = []
    if not panel_fields.get("placeOfBirth"):
        fields.append("placeOfBirth")
    if not panel_fields.get("issuingOffice"):
        fields.append("issuingOffice")
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


def _is_direct_mrz_extraction(extraction: dict[str, object]) -> bool:
    return "DIRECT LOWER-BAND OCR" in str(extraction.get("notes", "") or "").upper()


def _has_valid_mrz_validation(extraction: dict[str, object]) -> bool:
    validation = extraction.get("mrzValidation", {})
    return isinstance(validation, dict) and bool(validation.get("valid"))


def _apply_verified_single_word_name(
    parsed: dict[str, str],
    extraction: dict[str, object],
    file_name: str = "",
) -> tuple[dict[str, str], str]:
    if not _has_valid_mrz_validation(extraction):
        return parsed, ""
    if _has_distinct_filename_name_hint(file_name, parsed.get("familyName", "")):
        return parsed, ""
    return repair_single_word_name(parsed)


def _apply_verified_mrz_name_repairs(
    parsed: dict[str, str],
    extraction: dict[str, object],
    file_name: str = "",
) -> tuple[dict[str, str], str]:
    if not _has_valid_mrz_validation(extraction):
        return parsed, ""
    notes = []
    updated, note = repair_common_given_name_spacing(parsed)
    if note:
        notes.append(note)
    updated, note = _apply_verified_single_word_name(updated, extraction, file_name=file_name)
    if note:
        notes.append(note)
    return updated, "; ".join(notes)


def _has_distinct_filename_name_hint(file_name: str, family_name: str) -> bool:
    hint = _filename_name_hint(file_name)
    if not hint:
        return False
    family_hints = salvage_family_hints(family_name)
    return not any(token_matches_simple(hint, family_hint) for family_hint in family_hints)


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
    return score_name_fields(parsed.get("firstName", ""), parsed.get("familyName", "")) < 10 or _has_suspicious_name_noise(parsed)


def _has_suspicious_name_noise(parsed: dict[str, str]) -> bool:
    for value in (parsed.get("firstName", ""), parsed.get("familyName", "")):
        for token in re.sub(r"[^A-Z\s]", " ", str(value or "").upper()).split():
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
    full_name = panel_fields.get("fullName") or visual_fields.get("fullName", "")
    family_hints = salvage_family_hints(parsed.get("familyName", ""))
    if not full_name:
        return _filename_full_name_hint(file_name, family_hints)
    tokens = [token for token in full_name.upper().split() if token]
    if family_hints and not _full_name_matches_family_or_file(tokens, family_hints, file_name):
        return ""
    return full_name


def _full_name_matches_family_or_file(tokens: list[str], family_hints: list[str], file_name: str) -> bool:
    if not tokens:
        return False
    if any(token_matches_simple(tokens[-1], hint) for hint in family_hints):
        return True
    filename_hint = _filename_name_hint(file_name)
    if filename_hint and token_matches_simple(tokens[0], filename_hint) and score_full_name(" ".join(tokens), []) >= 80:
        return True
    return len(tokens) == 1 and any(token_matches_simple(tokens[0], hint) for hint in family_hints)


def _build_given_name_hint(file_name: str, extraction: dict[str, object], family_hint: str = "") -> str:
    return " ".join(token for token in (_extract_given_name_hint(extraction, family_hint), _filename_name_hint(file_name)) if token)


def _filename_name_hint(file_name: str) -> str:
    for token in _filename_name_tokens(file_name):
        if len(token) >= 3 and is_reasonable_token(token):
            return token
    return ""


def _filename_full_name_hint(file_name: str, family_hints: list[str]) -> str:
    if not family_hints:
        return ""
    tokens = _filename_name_tokens(file_name)
    if len(tokens) < 2:
        return ""
    for start in range(max(0, len(tokens) - 4), len(tokens) - 1):
        candidate_tokens = tokens[start:]
        if any(token_matches_simple(candidate_tokens[-1], hint) for hint in family_hints):
            candidate = " ".join(candidate_tokens)
            if score_full_name(candidate, family_hints) >= 80:
                return candidate
    return ""


def _filename_name_tokens(file_name: str) -> list[str]:
    stem = os.path.splitext(os.path.basename(file_name))[0]
    return [
        token
        for token in re.sub(r"[^A-Z\s]", " ", stem.upper()).split()
        if token not in FILENAME_NAME_NOISE and is_reasonable_token(token)
    ]


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


def write_manifest(group_id: str, group_dir: str, members: list[dict[str, object]]) -> None:
    output_dir = group_dir

    manifest = {
        "schemaVersion": "passport-manifest-v1",
        "groupId": group_id,
        "contractVersion": "passport-extracted-resolved-profile-v4",
        "members": members,
    }
    manifest_path = os.path.join(output_dir, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as file_handle:
        json.dump(manifest, file_handle, indent=2, ensure_ascii=False)


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
