from __future__ import annotations

import time

from services.ocr_constants import (
    OCR_BUDGET_MS,
    OCR_STAGE_MIN_REMAINING_MS,
)

def _ocr_budget_ms() -> int:
    return OCR_BUDGET_MS

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

def _classify_pipeline_path(
    *,
    mrz_error: str,
    panel_fallback_used: bool,
    visual_ocr_used: bool,
    needs_date_scan: bool,
    needs_name_scan: bool,
    review_status: str,
) -> str:
    reasons = _pipeline_path_reasons(
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

def _pipeline_path_reasons(
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

