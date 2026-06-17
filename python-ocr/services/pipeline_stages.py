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
from services.data_repairs import join_notes
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

from services.ocr_constants import (OCR_PROFILE_BUDGET_MS, OCR_BALANCED_PANEL_RECOVERY_FIELDS, OCR_FULL_PANEL_FIELD_SCOPE, OCR_FULL_VISUAL_FIELD_SCOPE, OCR_STAGE_MIN_REMAINING_MS, StepCallback)

from services.scan_budget import (_ocr_profile, _is_speed_first_scan, _is_balanced_scan, _is_heavy_scan, _ocr_budget_ms, _elapsed_ms, _time_left_ms, _has_ocr_budget_for_elapsed, _can_spend_ocr_time, _budget_exceeded, _skip_ocr_stage, _build_budget_notes, _classify_ocr_mode, _ocr_mode_reasons)
from services.data_repairs import (_has_indonesian_mrz_hint, _looks_like_noisy_indonesia_code, _has_valid_mrz_validation, _has_failed_mrz_validation, _has_reliable_mrz_for_fast_path, _apply_indonesian_visual_repairs, _apply_fast_mrz_repairs, _recover_passport_number_from_mrz, _recover_dob_from_unverified_mrz, _recover_gender_from_unverified_mrz, _mrz_text_values, _normalize_mrz_country_hint, _apply_verified_single_word_name, _apply_verified_mrz_name_repairs, _apply_final_name_repairs, _compact_name_value, _apply_fast_date_repairs, _repair_impossible_expiry_date, _mrz_confidence, _is_iso_date, _parse_iso_date)
from services.passport_logic import (_should_run_initial_panel_scan, _select_profile_panel_field_names, _is_indonesian_passport, _ocr_rotation_degrees, _normalize_ocr_rotation_degrees, _select_visual_field_names, _select_balanced_visual_field_names, _select_speed_visual_field_names, _select_heavy_visual_field_names, _missing_profile_visual_panel_fields, _missing_speed_location_panel_fields, _should_try_speed_location_ocr, _should_try_recovery_location_ocr, _location_ocr_ambiguous_enabled, _has_clear_non_indonesian_mrz_hint, _visual_fields_need_aligned_page, _select_panel_fallback_visual_field_names, _select_panel_field_names, _should_skip_panel_for_direct_location_only, _is_direct_mrz_extraction, _should_extract_dates, _should_refine_names, _needs_name_refinement, _has_suspicious_name_noise, _can_infer_missing_issue_date, _merge_visual_sources, _pick_preferred_full_name, _full_name_matches_family, _full_name_matches_current_name, _build_given_name_hint, _extract_given_name_hint)

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
                family_hint=getattr(ctx.parsed, 'familyName', ''),
                given_hint=_build_given_name_hint(ctx.file_name, ctx.extraction, getattr(ctx.parsed, 'familyName', '')),
                field_names=panel_field_names,
                current_dob=getattr(ctx.parsed, 'dob', ''),
                current_issue_date=getattr(ctx.parsed, 'issueDate', ''),
                current_expiry_date=getattr(ctx.parsed, 'expiryDate', ''),
            )
            ctx.parsed, ctx.panel_notes = fuse_panel_fields(ctx.parsed, ctx.extraction, ctx.panel_fields)
            ctx.record_stage_duration('panel', stage_started)
        else:
            ctx.skip_stage('panel')
            ctx.panel_field_names = ()
    else:
        ctx.panel_field_names = ()

def _stage_visual_fields(ctx: ScanContext) -> None:
    speed_first_scan = ctx.ocr_profile == OcrProfile.SPEED
    heavy_scan = ctx.ocr_profile == OcrProfile.HEAVY
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
        
        from services.field_gate import fields_needing_recovery
        mrz_conf = _mrz_confidence(ctx.extraction)
        mrz_valid = _has_valid_mrz_validation(ctx.extraction)
        ctx.visual_field_names = fields_needing_recovery(
            ctx.parsed if hasattr(ctx.parsed, 'as_dict') else vars(ctx.parsed),
            mrz_conf,
            mrz_valid,
            ctx.visual_field_names
        )

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
    speed_first_scan = ctx.ocr_profile == OcrProfile.SPEED
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
    speed_first_scan = ctx.ocr_profile == OcrProfile.SPEED
    if not speed_first_scan:
        missing_profile_panel_fields = _missing_profile_visual_panel_fields(
            ctx.ocr_profile,
            ctx.visual_field_names,
            ctx.visual_fields,
            ctx.panel_fields,
        )
        from services.field_gate import fields_needing_recovery
        mrz_conf = _mrz_confidence(ctx.extraction)
        mrz_valid = _has_valid_mrz_validation(ctx.extraction)
        missing_profile_panel_fields = fields_needing_recovery(
            ctx.parsed if hasattr(ctx.parsed, 'as_dict') else vars(ctx.parsed),
            mrz_conf,
            mrz_valid,
            missing_profile_panel_fields
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
    speed_first_scan = ctx.ocr_profile == OcrProfile.SPEED
    if ctx.skipped_panel_field_names and not speed_first_scan:
        missing_panel_fields = tuple(
            field_name
            for field_name in ctx.skipped_panel_field_names
            if not ctx.visual_fields.get(field_name) and not ctx.panel_fields.get(field_name)
        )
        from services.field_gate import fields_needing_recovery
        mrz_conf = _mrz_confidence(ctx.extraction)
        mrz_valid = _has_valid_mrz_validation(ctx.extraction)
        missing_panel_fields = fields_needing_recovery(
            ctx.parsed if hasattr(ctx.parsed, 'as_dict') else vars(ctx.parsed),
            mrz_conf,
            mrz_valid,
            missing_panel_fields
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
    speed_first_scan = ctx.ocr_profile == OcrProfile.SPEED
    if ctx.skipped_panel_field_names and not speed_first_scan:
        missing_panel_fields = tuple(
            field_name
            for field_name in ctx.skipped_panel_field_names
            if not ctx.visual_fields.get(field_name) and not ctx.panel_fields.get(field_name)
        )
        from services.field_gate import fields_needing_recovery
        mrz_conf = _mrz_confidence(ctx.extraction)
        mrz_valid = _has_valid_mrz_validation(ctx.extraction)
        missing_panel_fields = fields_needing_recovery(
            ctx.parsed if hasattr(ctx.parsed, 'as_dict') else vars(ctx.parsed),
            mrz_conf,
            mrz_valid,
            missing_panel_fields
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
    speed_first_scan = ctx.ocr_profile == OcrProfile.SPEED
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
                    setattr(ctx.parsed, field_name, date_fields[field_name])
        else:
            ctx.skip_stage("dates")
            
    ctx.parsed, ctx.date_repair_notes = _repair_impossible_expiry_date(ctx.parsed)
    ctx.record_stage_duration("dates", stage_started)

def _stage_names_recovery(ctx: ScanContext) -> None:
    speed_first_scan = ctx.ocr_profile == OcrProfile.SPEED
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
    
    speed_first_scan = ctx.ocr_profile == OcrProfile.SPEED
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

