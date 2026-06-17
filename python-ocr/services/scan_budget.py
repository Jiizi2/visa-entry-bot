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
from services.tesseract_runner import get_tesseract_ocr_stats, reset_tesseract_ocr_stats
from services.validator import calculate_confidence, validate_member
from services.visual_name_extractor import refine_names_from_scan
from services.scan_context import ScanContext

from services.ocr_constants import (OCR_PROFILE_BUDGET_MS, OCR_BALANCED_PANEL_RECOVERY_FIELDS, OCR_FULL_PANEL_FIELD_SCOPE, OCR_FULL_VISUAL_FIELD_SCOPE, OCR_STAGE_MIN_REMAINING_MS, StepCallback)


def _ocr_profile() -> str:
    value = os.environ.get("PASSPORT_OCR_PROFILE", OcrProfile.SPEED).strip().lower()
    value = OCR_PROFILE_ALIASES.get(value, value)
    return value if value in OCR_PROFILES else OcrProfile.SPEED

def _is_speed_first_scan() -> bool:
    return _ocr_profile() == OcrProfile.SPEED

def _is_balanced_scan() -> bool:
    return _ocr_profile() == OcrProfile.BALANCED

def _is_heavy_scan() -> bool:
    return _ocr_profile() == OcrProfile.HEAVY

def _ocr_budget_ms(profile: str | None = None) -> int:
    return OCR_PROFILE_BUDGET_MS.get(profile or _ocr_profile(), OCR_PROFILE_BUDGET_MS[OcrProfile.SPEED])

def _elapsed_ms(started_at: float) -> int:
    return max(0, int((time.perf_counter() - started_at) * 1000))

def _time_left_ms(started_at: float, budget_ms: int) -> int:
    return max(0, int(budget_ms) - _elapsed_ms(started_at))

def _has_ocr_budget_for_elapsed(elapsed_ms: int, budget_ms: int, stage_name: str) -> bool:
    return int(budget_ms) - max(0, int(elapsed_ms)) >= OCR_STAGE_MIN_REMAINING_MS.get(stage_name, 0)

def _can_spend_ocr_time(started_at: float, budget_ms: int, stage_name: str) -> bool:
    return _has_ocr_budget_for_elapsed(_elapsed_ms(started_at), budget_ms, stage_name)

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

