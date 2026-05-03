from __future__ import annotations

import json
import os
import re
import sys
import time
from typing import Callable

from services.expiry_date_extractor import extract_expiry_date
from services.image_preprocessor import cleanup_temp_root
from services.indonesia_field_ocr import build_visual_notes, extract_visual_fields, merge_visual_fields
from services.issue_date_extractor import extract_issue_date
from services.mrz_extractor import extract_mrz_data
from services.name_support import is_reasonable_token, salvage_family_hints, token_matches_simple
from services.nusuk_manifest import build_error_record, build_member_record
from services.ocr_result_cache import clear_ocr_result_cache
from services.panel_fallback import extract_document_panel_fields, fuse_panel_fields, should_use_panel_fallback
from services.passport_page import extract_aligned_passport_page
from services.parser import parse_mrz_data
from services.validator import calculate_confidence, validate_member
from services.visual_name_extractor import refine_names_from_scan

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT_DIR, "data")
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png"}
StepCallback = Callable[[str, str, float], None]


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
    clear_ocr_result_cache()

    try:
        extraction: dict[str, object] = {"data": {}, "confidence": 0.0, "notes": ""}
        parsed = parse_mrz_data({})
        mrz_error = ""

        report_step("mrz", "Mengekstrak MRZ", 0.16, "  - extracting MRZ")
        stage_started = time.perf_counter()
        try:
            extraction = extract_mrz_data(file_path)
            parsed = parse_mrz_data(extraction["data"])
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
            report_step("panel", "Membaca panel dokumen", 0.30, "  - reading document panel")
            stage_started = time.perf_counter()
            panel_fields = extract_document_panel_fields(
                file_path,
                family_hint=parsed.get("familyName", ""),
                given_hint=_extract_given_name_hint(extraction, parsed.get("familyName", "")),
            )
            parsed, panel_notes = fuse_panel_fields(parsed, extraction, panel_fields)
            stage_durations_ms["panel"] = _elapsed_ms(stage_started)

        if _is_indonesian_passport(parsed, extraction, panel_fields):
            visual_ocr_used = True
            report_step("visual", "Membaca field visual", 0.46, "  - reading visual fields")
            stage_started = time.perf_counter()
            page = extract_aligned_passport_page(file_path)
            visual_fields = extract_visual_fields(file_path, page=page)
            stage_durations_ms["visual"] = _elapsed_ms(stage_started)
        merged_visual_fields = _merge_visual_sources(visual_fields, panel_fields)
        parsed = merge_visual_fields(parsed, merged_visual_fields)
        visual_notes = build_visual_notes(merged_visual_fields)

        if page is None:
            stage_started = time.perf_counter()
            page = extract_aligned_passport_page(file_path)
            stage_durations_ms["page_align"] = _elapsed_ms(stage_started)
        report_step("expiry", "Mencari tanggal expired", 0.62, "  - extracting expiry date")
        stage_started = time.perf_counter()
        parsed["expiryDate"] = extract_expiry_date(
            file_path,
            dob=parsed["dob"],
            issue_date=parsed.get("issueDate", ""),
            page=page,
            current_value=parsed.get("expiryDate", ""),
        )
        stage_durations_ms["expiry_first"] = _elapsed_ms(stage_started)
        report_step("issue", "Mencari tanggal terbit", 0.74, "  - extracting issue date")
        stage_started = time.perf_counter()
        parsed["issueDate"] = extract_issue_date(
            file_path,
            dob=parsed["dob"],
            expiry_date=parsed["expiryDate"],
            page=page,
            current_value=parsed.get("issueDate", ""),
        )
        stage_durations_ms["issue"] = _elapsed_ms(stage_started)
        stage_started = time.perf_counter()
        parsed["expiryDate"] = extract_expiry_date(
            file_path,
            dob=parsed["dob"],
            issue_date=parsed["issueDate"],
            page=page,
            current_value=parsed.get("expiryDate", ""),
        )
        stage_durations_ms["expiry_second"] = _elapsed_ms(stage_started)
        report_step("names", "Merapikan nama", 0.88, "  - refining names")
        stage_started = time.perf_counter()
        parsed, name_notes = refine_names_from_scan(
            file_path,
            parsed,
            page=page,
            preferred_full_name=_pick_preferred_full_name(parsed, merged_visual_fields, panel_fields),
        )
        stage_durations_ms["names"] = _elapsed_ms(stage_started)
        report_step("validate", "Validasi akhir", 0.96, "  - validating")
        stage_started = time.perf_counter()
        status, validation_notes = validate_member(parsed)
        stage_durations_ms["validate"] = _elapsed_ms(stage_started)
        notes = join_notes(mrz_error, extraction.get("notes", ""), panel_notes, visual_notes, name_notes, validation_notes)
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
            "visualOcrUsed": visual_ocr_used,
            "mrzFallbackUsed": bool(mrz_error),
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
            "mrzFallbackUsed": False,
        }
        return record
    finally:
        clear_ocr_result_cache()


def _elapsed_ms(started_at: float) -> int:
    return max(0, int((time.perf_counter() - started_at) * 1000))


def _is_indonesian_passport(
    parsed: dict[str, str],
    extraction: dict[str, object],
    panel_fields: dict[str, str],
) -> bool:
    country = str(extraction.get("data", {}).get("country", "")).upper()
    nationality = parsed.get("nationality", "")
    return nationality == "INDONESIA" or country == "IDN" or panel_fields.get("nationality") == "INDONESIA"


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
) -> str:
    if panel_fields.get("fullName"):
        return panel_fields["fullName"]
    full_name = visual_fields.get("fullName", "")
    family_hints = salvage_family_hints(parsed.get("familyName", ""))
    tokens = [token for token in full_name.upper().split() if token]
    if family_hints and not any(token_matches_simple(token, hint) for token in tokens for hint in family_hints):
        return ""
    return full_name


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
    print(f"Processed {len(members)} files: {valid_count} VALID, {error_count} ERROR")


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
