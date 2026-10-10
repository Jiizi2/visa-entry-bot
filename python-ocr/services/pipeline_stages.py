from __future__ import annotations

import re
import time

from services.log import logger
from services.date_field_extractor import extract_document_dates
from services.image_preprocessor import get_image_preprocessor_stats
from services.indonesia_field_ocr import (
    build_visual_notes,
    extract_fast_location_fields,
    extract_visual_fields,
    get_fast_location_ocr_stats,
    merge_visual_fields,
)
from services.mrz_extractor import extract_mrz_data, infer_passport_rotation
from services.mrz_validation import mrz_field_is_verified
from services.data_repairs import (
    join_notes,
    _has_valid_mrz_validation,
    _mrz_confidence,
    _apply_indonesian_visual_repairs,
    _apply_fast_mrz_repairs,
    _apply_fast_date_repairs,
    _apply_verified_mrz_name_repairs,
    _apply_final_name_repairs,
    _repair_impossible_expiry_date,
)
from services.nusuk_manifest import build_member_record
from services.ocr_result_cache import get_ocr_result_cache_stats
from services.panel_fallback import extract_document_panel_fields, fuse_panel_fields
from services.parser import parse_mrz_data
from services.passport_page import extract_aligned_passport_page
from services.ocr_runner import get_ocr_stats, ocr_stage_budget
from services.validator import calculate_confidence, validate_member
from services.visual_name_extractor import refine_names_from_scan
from services.visual_identity import extract_visual_identity_evidence
from services.name_verification import observed_name_pair, passport_full_name, verify_name_evidence
from services.models import ParsedPassportData
from services.scan_context import ScanContext
from services.ocr_constants import OCR_FAST_PATH_BUDGET_MS, OCR_MRZ_BUDGET_MS
from services.decision_rules import DecisionRules
from services.scan_budget import _build_budget_notes, _classify_pipeline_path, _pipeline_path_reasons
from services.passport_logic import (
    _is_indonesian_passport,
    _ocr_rotation_degrees,
    _select_visual_field_names,
    _select_location_field_names,
    _should_try_location_ocr,
    _visual_fields_need_aligned_page,
    _select_panel_field_names,
    _should_extract_dates,
    _can_infer_missing_issue_date,
    _merge_visual_sources,
    _pick_preferred_full_name,
    _build_given_name_hint,
    _identity_field_count,
    _needs_name_refinement,
)

def _stage_mrz(ctx: ScanContext) -> None:
    logger.debug("[%s] Stage: mrz", ctx.file_name)
    ctx.report_step('mrz', 'Mengekstrak MRZ', 0.16, '  - extracting MRZ')
    stage_started = time.perf_counter()
    try:
        # Leave time for visible labels when MRZ is missing, clipped, or shaded.
        with ocr_stage_budget(min(OCR_MRZ_BUDGET_MS / 1000.0, ctx.ocr_budget_ms / 1000.0 * 0.60)):
            ctx.extraction = extract_mrz_data(ctx.file_path)
        ctx.ocr_rotation_degrees = _ocr_rotation_degrees(ctx.extraction)
        ctx.parsed = parse_mrz_data(ctx.extraction.get('data', {}))
        ctx.mrz_name_fields = {field: ctx.parsed.get(field, "") for field in ("firstName", "familyName")}
        ctx.parsed, ctx.early_name_notes = _apply_verified_mrz_name_repairs(ctx.parsed, ctx.extraction, file_name=ctx.file_name)
        
        # P5: Parallel Provenance Metadata Registration for baseline MRZ fields
        mrz_conf = ctx.extraction.get("confidence", 0.0)
        for field_name in ("passportNumber", "dob", "expiryDate", "firstName", "familyName", "nationality", "gender"):
            val = getattr(ctx.parsed, field_name, "")
            if val:
                checksum_validated = mrz_field_is_verified(ctx.extraction.get("mrzValidation"), field_name)
                DecisionRules.update_field(ctx, field_name, val, "MRZ", mrz_conf, tentative=False, validated=checksum_validated, reason="Initial MRZ extraction and verification repairs")
    except Exception as exc:  # noqa: BLE001
        ctx.mrz_error = str(exc)
        ctx.ocr_rotation_degrees = infer_passport_rotation(ctx.file_path)
    ctx.record_stage_duration('mrz', stage_started)
    logger.debug("[%s] Stage mrz done in %dms", ctx.file_name, ctx.stage_durations_ms.get("mrz", 0))

def _stage_initial_panel(ctx: ScanContext) -> None:
    logger.debug("[%s] Stage: initial_panel", ctx.file_name)
    # Always complete the lightweight first pass before deciding whether
    # targeted recovery is necessary.
    ctx.adaptive_recovery_required = False
    ctx.fast_path = True
    ctx.recovery_budget_ms = ctx.ocr_budget_ms
    ctx.ocr_budget_ms = min(ctx.ocr_budget_ms, OCR_FAST_PATH_BUDGET_MS)
    ctx.panel_field_names = ()

def _stage_visual_fields(ctx: ScanContext) -> None:
    logger.debug("[%s] Stage: visual_fields", ctx.file_name)
    if not ctx.can_spend_ocr_time("location"):
        ctx.ocr_budget_ms = max(ctx.ocr_budget_ms, ctx.recovery_budget_ms)
    is_indonesian_passport = _is_indonesian_passport(ctx.parsed, ctx.extraction, ctx.panel_fields) or _should_try_location_ocr(ctx.parsed, ctx.extraction)
    if is_indonesian_passport:
        ctx.visual_field_names = _select_location_field_names(ctx.parsed, ctx.extraction)
        
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
            # A slow MRZ must not consume the time reserved for visual identity.
            if not ctx.can_spend_ocr_time("location"):
                ctx.ocr_budget_ms = max(ctx.ocr_budget_ms, ctx.recovery_budget_ms)
            if ctx.can_spend_ocr_time("location"):
                ctx.visual_ocr_used = True
                ctx.visual_fields = extract_fast_location_fields(
                    ctx.file_path,
                    field_names=ctx.visual_field_names,
                    rotation_degrees=ctx.ocr_rotation_degrees,
                )
                ctx.visual_identity_evidence = extract_visual_identity_evidence(
                    ctx.file_path, ctx.ocr_rotation_degrees, allow_scan=True,
                )
                ctx.visual_fields.update(ctx.visual_identity_evidence.fields)
                ctx.visual_fields.update(ctx.visual_identity_evidence.location_values)
            else:
                ctx.skip_stage("visual")
        ctx.record_stage_duration("visual", stage_started)
        logger.debug("[%s] Stage visual done in %dms", ctx.file_name, ctx.stage_durations_ms.get("visual", 0))
    else:
        ctx.visual_field_names = ()
        if ctx.can_spend_ocr_time("location"):
            ctx.visual_identity_evidence = extract_visual_identity_evidence(
                ctx.file_path, ctx.ocr_rotation_degrees, allow_scan=True,
            )
            ctx.visual_fields.update(ctx.visual_identity_evidence.fields)
            ctx.visual_fields.update(ctx.visual_identity_evidence.location_values)

def _merge_first_pass_results(ctx: ScanContext) -> None:
    """Merge lightweight sources before deciding whether recovery is needed."""
    ctx.merged_visual_fields = _merge_visual_sources(ctx.visual_fields, ctx.panel_fields)
    pre_parsed = dict(ctx.parsed)
    merge_visual_fields(ctx, ctx.visual_fields)
    ctx.parsed = _apply_indonesian_visual_repairs(ctx.parsed, ctx.extraction, ctx.merged_visual_fields)
    ctx.parsed, ctx.fast_mrz_notes = _apply_fast_mrz_repairs(ctx.parsed, ctx.extraction)
    ctx.visual_notes = build_visual_notes(ctx.merged_visual_fields)
    ctx.parsed, ctx.fast_date_notes = _apply_fast_date_repairs(ctx.parsed)
    for field_name in ("passportNumber", "dob", "expiryDate", "firstName", "familyName", "nationality", "gender", "issueDate"):
        curr_val = ctx.parsed.get(field_name, "")
        if (curr_val != pre_parsed.get(field_name, "")
                and ctx.field_metadata.get(field_name, {}).get("value") != curr_val):
            DecisionRules.evaluate_and_update(
                ctx,
                field_name,
                curr_val,
                source="INFERENCE",
                confidence=0.90,
                tentative=False,
                validated=True,
            )
    ctx.first_pass_merged = True


def _stage_adaptive_recovery(ctx: ScanContext) -> None:
    """Run targeted recovery only when the lightweight pass is insufficient."""
    _merge_first_pass_results(ctx)
    visual_name_verified = bool(
        ctx.visual_identity_evidence.fields.get("fullName")
        and ctx.visual_identity_evidence.name_words_verified
    )
    missing_visual_fields = _should_try_location_ocr(ctx.parsed, ctx.extraction) and any(
        not ctx.merged_visual_fields.get(field) for field in ("placeOfBirth", "issuingOffice")
    )
    ctx.adaptive_recovery_required = (
        _identity_field_count(ctx.parsed) < 7
        or not _has_valid_mrz_validation(ctx.extraction)
        or not visual_name_verified
        or bool(missing_visual_fields)
        or (_should_extract_dates(ctx.parsed) and not _can_infer_missing_issue_date(ctx.parsed))
    )
    ctx.fast_path = not ctx.adaptive_recovery_required
    if not ctx.adaptive_recovery_required:
        return

    ctx.ocr_budget_ms = max(ctx.ocr_budget_ms, ctx.recovery_budget_ms)
    panel_field_names = tuple(
        field_name
        for field_name in _select_panel_field_names(ctx.parsed, ctx.extraction)
        if field_name not in {"placeOfBirth", "issuingOffice"}
        and not (field_name == "fullName" and visual_name_verified)
    )
    if not visual_name_verified:
        panel_field_names = tuple(dict.fromkeys((*panel_field_names, "fullName")))
    ctx.panel_field_names = panel_field_names
    if panel_field_names and ctx.can_spend_ocr_time("panel"):
        ctx.panel_fallback_used = True
        ctx.report_step("panel", "Memulihkan field wajib", 0.56, "  - recovering required document fields")
        stage_started = time.perf_counter()
        recovery_panel_fields = extract_document_panel_fields(
            ctx.file_path,
            family_hint=ctx.parsed.get("familyName", ""),
            given_hint=_build_given_name_hint(ctx.file_name, ctx.extraction, ctx.parsed.get("familyName", "")),
            field_names=panel_field_names,
            current_dob=ctx.parsed.get("dob", ""),
            current_issue_date=ctx.parsed.get("issueDate", ""),
            current_expiry_date=ctx.parsed.get("expiryDate", ""),
        )
        ctx.panel_fields.update({key: value for key, value in recovery_panel_fields.items() if value})
        recovery_notes = fuse_panel_fields(ctx, recovery_panel_fields)
        ctx.panel_notes = join_notes(ctx.panel_notes, recovery_notes)
        ctx.record_stage_duration("panel", stage_started)
    elif panel_field_names:
        ctx.skip_stage("panel")

    if _identity_field_count(ctx.parsed) < 7:
        recovery_fields = _select_visual_field_names(
            ctx.parsed,
            ctx.extraction,
            ctx.panel_fallback_used,
            ctx.panel_fields,
        )
        if recovery_fields and ctx.can_spend_ocr_time("visual_recovery"):
            ctx.visual_field_names = recovery_fields
            ctx.report_step("visual", "Memperkuat field wajib", 0.62, "  - reinforcing required visual fields")
            stage_started = time.perf_counter()
            if _visual_fields_need_aligned_page(recovery_fields) and ctx.page is None:
                ctx.page = extract_aligned_passport_page(ctx.file_path)
            if ctx.can_spend_ocr_time("visual_recovery"):
                recovered_visual_fields = extract_visual_fields(
                    ctx.file_path,
                    page=ctx.page,
                    field_names=recovery_fields,
                    allow_aligned_fallback=ctx.page is not None,
                    rotation_degrees=ctx.ocr_rotation_degrees,
                )
                ctx.visual_fields.update({key: value for key, value in recovered_visual_fields.items() if value})
                ctx.visual_ocr_used = True
            else:
                ctx.skip_stage("visual_recovery")
            ctx.record_stage_duration("visual_recovery", stage_started)
        elif recovery_fields:
            ctx.skip_stage("visual_recovery")

    if _identity_field_count(ctx.parsed) >= 7 and _should_try_location_ocr(ctx.parsed, ctx.extraction):
        missing_location_fields = tuple(
            field_name
            for field_name in ("placeOfBirth", "issuingOffice")
            if not ctx.visual_fields.get(field_name) and not ctx.panel_fields.get(field_name)
        )
        if missing_location_fields and ctx.can_spend_ocr_time("location"):
            stage_started = time.perf_counter()
            recovered_locations = extract_fast_location_fields(
                ctx.file_path,
                field_names=missing_location_fields,
                rotation_degrees=ctx.ocr_rotation_degrees,
            )
            ctx.visual_fields.update({key: value for key, value in recovered_locations.items() if value})
            ctx.visual_ocr_used = True
            ctx.record_stage_duration("visual_recovery", stage_started)
        elif missing_location_fields:
            ctx.skip_stage("location")

    if not ctx.visual_identity_evidence.fields.get("fullName"):
        ctx.visual_identity_evidence = extract_visual_identity_evidence(
            ctx.file_path, ctx.ocr_rotation_degrees, allow_scan=ctx.can_spend_ocr_time("location"),
        )
        ctx.visual_fields.update(ctx.visual_identity_evidence.fields)
    _merge_first_pass_results(ctx)

def _stage_dates_recovery(ctx: ScanContext) -> None:
    logger.debug("[%s] Stage: dates_recovery", ctx.file_name)
    if ctx.first_pass_merged:
        pre_parsed = dict(ctx.parsed)
    else:
        ctx.merged_visual_fields = _merge_visual_sources(ctx.visual_fields, ctx.panel_fields)
        pre_parsed = dict(ctx.parsed)
        merge_visual_fields(ctx, ctx.visual_fields)
        ctx.parsed = _apply_indonesian_visual_repairs(ctx.parsed, ctx.extraction, ctx.merged_visual_fields)
        ctx.parsed, ctx.fast_mrz_notes = _apply_fast_mrz_repairs(ctx.parsed, ctx.extraction)
        ctx.visual_notes = build_visual_notes(ctx.merged_visual_fields)
        ctx.parsed, ctx.fast_date_notes = _apply_fast_date_repairs(ctx.parsed)
    preferred_full_name = _pick_preferred_full_name(ctx.parsed, ctx.merged_visual_fields, ctx.panel_fields, ctx.file_name)
    
    # Register repair modifications as INFERENCE
    for field_name in ("passportNumber", "dob", "expiryDate", "firstName", "familyName", "nationality", "gender", "issueDate"):
        curr_val = ctx.parsed.get(field_name, "")
        if curr_val != pre_parsed.get(field_name, ""):
            DecisionRules.evaluate_and_update(ctx, field_name, curr_val, source="INFERENCE", confidence=0.90, tentative=False, validated=True)
    
    ctx.needs_date_scan = ctx.adaptive_recovery_required and _should_extract_dates(ctx.parsed)
    ctx.needs_name_scan = bool(preferred_full_name) or _needs_name_refinement(ctx.parsed)
    needs_page_for_dates = ctx.needs_date_scan and not _can_infer_missing_issue_date(ctx.parsed)

    if ctx.page is None and (needs_page_for_dates or (ctx.needs_name_scan and not preferred_full_name)):
        stage_started = time.perf_counter()
        if ctx.can_spend_ocr_time("page_align"):
            ctx.page = extract_aligned_passport_page(ctx.file_path)
        else:
            ctx.skip_stage("page_align")
        ctx.record_stage_duration("page_align", stage_started)
        
    ctx.report_step("dates", "Mencari tanggal passport", 0.68, "  - extracting passport dates")
    stage_started = time.perf_counter()
    if ctx.needs_date_scan:
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
            from services.indonesia_field_ocr import _is_iso_date
            for field_name in ("issueDate", "expiryDate"):
                val = date_fields.get(field_name, "")
                if val:
                    is_valid = _is_iso_date(val)
                    DecisionRules.evaluate_and_update(ctx, field_name, val, source="VISUAL", confidence=0.75, tentative=False, validated=is_valid)
        else:
            ctx.skip_stage("dates")
            
    # Track pre-repair state for century repairs
    pre_parsed_century = dict(ctx.parsed)
    ctx.parsed, ctx.date_repair_notes = _repair_impossible_expiry_date(ctx.parsed)
    if ctx.date_repair_notes:
        DecisionRules.evaluate_and_update(ctx, "expiryDate", ctx.parsed.get("expiryDate", ""), source="INFERENCE", confidence=0.95, tentative=False, validated=True)
        
    ctx.record_stage_duration("dates", stage_started)
    logger.debug("[%s] Stage dates_recovery done in %dms", ctx.file_name, ctx.stage_durations_ms.get("dates", 0))

def _stage_names_recovery(ctx: ScanContext) -> None:
    logger.debug("[%s] Stage: names_recovery", ctx.file_name)
    preferred_full_name = _pick_preferred_full_name(ctx.parsed, ctx.merged_visual_fields, ctx.panel_fields, ctx.file_name)
    observed_full_name = ctx.visual_identity_evidence.fields.get("fullName", "")
    ctx.needs_name_scan = bool(preferred_full_name or observed_full_name) or _needs_name_refinement(ctx.parsed)
    
    ctx.report_step("names", "Merapikan nama", 0.88, "  - refining names")
    stage_started = time.perf_counter()
    mrz_mononym = bool(
        ctx.mrz_name_fields.get("familyName")
        and (not ctx.mrz_name_fields.get("firstName")
             or ctx.mrz_name_fields.get("firstName") == ctx.mrz_name_fields.get("familyName"))
    )
    observed_mononym_candidate = mrz_mononym and " " not in observed_full_name
    if observed_full_name and (ctx.visual_identity_evidence.name_words_verified or observed_mononym_candidate):
        mrz_full_name = passport_full_name(ctx.mrz_name_fields)
        candidate = observed_name_pair(
            observed_full_name, ctx.parsed,
            preserve_existing_word_boundaries=(
                not mrz_full_name
                or re.sub(r"[^A-Z]", "", mrz_full_name) == re.sub(r"[^A-Z]", "", observed_full_name)
            ),
        )
        previous_full_name = passport_full_name(ctx.parsed)
        for field_name, value in candidate.items():
            DecisionRules.update_field(
                ctx, field_name, value, "VISUAL", ctx.visual_identity_evidence.confidence["fullName"],
                tentative=True, validated=False, reason="Exact observed full-name field; no spelling guesses",
            )
        if passport_full_name(ctx.parsed) != previous_full_name:
            ctx.name_notes = "NAME NORMALIZED FROM FULL NAME FIELD; PASSPORT NAME DISAGREEMENT REQUIRES REVIEW"
        else:
            ctx.name_notes = ""
    elif ctx.needs_name_scan:
        if not preferred_full_name and ctx.page is None:
            ctx.skip_stage("names")
            ctx.name_notes = ""
        elif preferred_full_name or ctx.can_spend_ocr_time("names"):
            candidate, name_notes = refine_names_from_scan(
                ctx.file_path,
                ParsedPassportData(**ctx.parsed),
                page=ctx.page,
                preferred_full_name=preferred_full_name,
            )
            observed_letters = re.sub(r"[^A-Z]", "", observed_full_name.upper())
            candidate_letters = re.sub(r"[^A-Z]", "", passport_full_name(candidate))
            conflicts_with_observation = bool(observed_letters and observed_letters != candidate_letters)
            first_changed = candidate.get("firstName", "") != ctx.parsed.get("firstName", "")
            family_changed = candidate.get("familyName", "") != ctx.parsed.get("familyName", "")
            if conflicts_with_observation:
                for field_name in ("firstName", "familyName"):
                    DecisionRules.record_rejection(
                        ctx, field_name, candidate.get(field_name, ""), "VISUAL", 0.80, False,
                        "Name candidate adds or removes letters from the observed full-name field",
                    )
                ctx.name_notes = join_notes(name_notes, "PASSPORT NAME DISAGREEMENT REQUIRES REVIEW")
            elif preferred_full_name and (first_changed or family_changed):
                # MRZ check digits cover line 2, never the name on line 1.
                # Accept the observed full name as a pair and require review.
                for field_name in ("firstName", "familyName"):
                    DecisionRules.update_field(ctx, field_name, candidate.get(field_name, ""), "VISUAL", 0.80, tentative=True, validated=False, reason="Name recovered from observed passport full-name field")
                name_notes = join_notes(name_notes, "PASSPORT NAME DISAGREEMENT REQUIRES REVIEW")
                ctx.name_notes = name_notes
            else:
                first_changed = DecisionRules.evaluate_and_update(ctx, "firstName", candidate.get("firstName", ""), source="VISUAL", confidence=0.80, tentative=False)
                family_changed = DecisionRules.evaluate_and_update(ctx, "familyName", candidate.get("familyName", ""), source="VISUAL", confidence=0.80, tentative=False)
                ctx.name_notes = name_notes if first_changed or family_changed else ""
        else:
            ctx.skip_stage("names")
            ctx.name_notes = ""
    else:
        ctx.name_notes = ""
        
    # Track pre-repair for final repairs
    pre_parsed_final = dict(ctx.parsed)
    final_candidate, final_name_notes = _apply_final_name_repairs(ParsedPassportData(**ctx.parsed), file_name=ctx.file_name)
    final_changed = any(final_candidate.get(field, "") != pre_parsed_final.get(field, "") for field in ("firstName", "familyName"))
    if (final_changed and observed_full_name
            and re.sub(r"[^A-Z]", "", passport_full_name(final_candidate)) != re.sub(r"[^A-Z]", "", observed_full_name.upper())):
        for field_name in ("firstName", "familyName"):
            DecisionRules.record_rejection(
                ctx, field_name, final_candidate.get(field_name, ""), "INFERENCE", 0.65, False,
                "Final name repair adds or removes letters from the observed full-name field",
            )
        ctx.name_notes = join_notes(ctx.name_notes, "PASSPORT NAME DISAGREEMENT REQUIRES REVIEW")
        final_name_notes = ""
    else:
        ctx.parsed = final_candidate
    if final_name_notes:
        ctx.name_notes = join_notes(ctx.name_notes, final_name_notes)
        for field_name in ("firstName", "familyName"):
            curr_val = ctx.parsed.get(field_name, "")
            if curr_val != pre_parsed_final.get(field_name, ""):
                DecisionRules.evaluate_and_update(ctx, field_name, curr_val, source="INFERENCE", confidence=0.90, tentative=False, validated=True)
                
    ctx.record_stage_duration("names", stage_started)
    logger.debug("[%s] Stage names_recovery done in %dms", ctx.file_name, ctx.stage_durations_ms.get("names", 0))

def _stage_validation_and_metrics(ctx: ScanContext) -> dict[str, object]:
    logger.debug("[%s] Stage: validation_and_metrics", ctx.file_name)
    ctx.report_step("validate", "Validasi akhir", 0.96, "  - validating")
    stage_started = time.perf_counter()
    validation_member = {
        **ctx.parsed,
        "birthCity": ctx.merged_visual_fields.get("placeOfBirth", ""),
        "cityOfIssued": ctx.merged_visual_fields.get("issuingOffice", ""),
    }
    status, validation_notes = validate_member(validation_member)
    ctx.record_stage_duration("validate", stage_started)
    logger.debug("[%s] Stage validation_and_metrics done in %dms", ctx.file_name, ctx.stage_durations_ms.get("validate", 0))
    
    pipeline_notes = (
        "SINGLE PIPELINE REVIEW REQUIRED; ADAPTIVE RECOVERY APPLIED"
        if ctx.adaptive_recovery_required
        else "SINGLE PIPELINE REVIEW REQUIRED; FAST PATH COMPLETED"
    )
    
    notes = join_notes(
        ctx.mrz_error,
        ctx.extraction.get("notes", ""),
        ctx.panel_notes,
        ctx.visual_notes,
        pipeline_notes,
        ctx.early_name_notes,
        ctx.fast_mrz_notes,
        ctx.fast_date_notes,
        ctx.date_repair_notes,
        ctx.name_notes,
        _build_budget_notes(ctx.skipped_ocr_stages),
        validation_notes,
        "OCR STAGE FAILED REQUIRES REVIEW" if any(report.exception for report in ctx.stage_reports) else "",
        "OCR ENGINE ERROR REQUIRES REVIEW" if get_ocr_stats().get("errorCount") else "",
        "OCR INFERENCE DEADLINE SKIPPED" if get_ocr_stats().get("budgetSkipCount") else "",
    )

    evidence = ctx.visual_identity_evidence
    name_verification = verify_name_evidence(
        ctx.parsed, ctx.mrz_name_fields, evidence.fields.get("fullName", ""),
        words_verified=evidence.name_words_verified,
        confidence=evidence.confidence.get("fullName", 0.0),
        candidates=evidence.name_candidates,
    )
    visual_field_confidence = {}
    for source_field, passport_field in (("placeOfBirth", "birthCity"), ("issuingOffice", "cityOfIssued"), ("issueDate", "issueDate")):
        observed_value = evidence.location_values.get(source_field) or evidence.fields.get(source_field)
        selected_value = ctx.merged_visual_fields.get(source_field, "")
        visual_field_confidence[passport_field] = (
            evidence.confidence.get(source_field, 0.65)
            if observed_value and observed_value == selected_value else 0.65
        )
    for field in ("firstName", "familyName"):
        visual_field_confidence[field] = (
            evidence.confidence.get("fullName", 0.65)
            if name_verification["status"] == "VERIFIED" else 0.65
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
        name_verification=name_verification,
        visual_field_confidence=visual_field_confidence,
    )
    
    # Needs explicit string cast for reviewStatus
    review_status_str = str(record.get("reviewStatus", ""))
    
    record["fieldMetadata"] = ctx.field_metadata
    record["stageReports"] = [
        {
            "stage_name": r.stage_name,
            "duration_ms": r.duration_ms,
            "fields_changed": r.fields_changed,
            "fields_rejected": r.fields_rejected,
            "warnings": r.warnings,
            "exception": r.exception
        } for r in ctx.stage_reports
    ]
    
    record["processingMetrics"] = {
        "totalMs": ctx.elapsed_ms(),
        "stagesMs": ctx.stage_durations_ms,
        "panelFallbackUsed": ctx.panel_fallback_used,
        "panelFieldScope": list(ctx.panel_field_names),
        "visualOcrUsed": ctx.visual_ocr_used,
        "visualFieldScope": list(ctx.visual_field_names) if ctx.visual_field_names is not None else "all",
        "mrzFallbackUsed": bool(ctx.mrz_error),
        "budgetMs": ctx.ocr_budget_ms,
        "fastPath": ctx.fast_path,
        "adaptiveRecoveryUsed": ctx.adaptive_recovery_required,
        "elapsedMs": ctx.elapsed_ms(),
        "budgetExceeded": ctx.budget_exceeded(),
        "skippedStages": list(ctx.skipped_ocr_stages),
        "ocrCache": get_ocr_result_cache_stats(),
        "rapidocr": get_ocr_stats(),
        "imagePreprocessor": get_image_preprocessor_stats(),
        "fastLocationOcr": get_fast_location_ocr_stats(),
        "pipelinePath": _classify_pipeline_path(
            mrz_error=ctx.mrz_error,
            panel_fallback_used=ctx.panel_fallback_used,
            visual_ocr_used=ctx.visual_ocr_used,
            needs_date_scan=ctx.needs_date_scan,
            needs_name_scan=ctx.needs_name_scan,
            review_status=review_status_str,
        ),
        "pipelineReasons": _pipeline_path_reasons(
            mrz_error=ctx.mrz_error,
            panel_fallback_used=ctx.panel_fallback_used,
            visual_ocr_used=ctx.visual_ocr_used,
            needs_date_scan=ctx.needs_date_scan,
            needs_name_scan=ctx.needs_name_scan,
            review_status=review_status_str,
        ),
    }
    return record

