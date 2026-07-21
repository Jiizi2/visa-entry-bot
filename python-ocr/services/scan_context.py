"""Mutable state container for a single passport OCR scan."""

from typing import Any, Callable, Dict, List, Tuple, Optional
import time
from dataclasses import dataclass, field

from services.log import logger
from services.models import ParsedPassportData


class ScanContext:
    """Holds all mutable state for one passport OCR scan.
    
    Attributes are grouped into sections:
    - Input: file_path, file_name, ocr_profile, ocr_budget_ms
    - Timing: started_at, stage_durations_ms, skipped_ocr_stages
    - Pipeline flags: panel_fallback_used, visual_ocr_used, etc.
    - MRZ results: extraction, parsed, mrz_error
    - Page & Rotation: page, ocr_rotation_degrees
    - Visual results: visual_fields, visual_notes, merged_visual_fields, etc.
    - Panel results: panel_fields, panel_notes, etc.
    - Recovery notes: early_name_notes, fast_mrz_notes, etc.
    """

    def __init__(
        self,
        file_path: str,
        file_name: str,
        ocr_profile: str,
        ocr_budget_ms: int,
        step_callback: Optional[Callable[[str, str, float], None]] = None
    ):
        # --- Input ---
        self.file_path: str = file_path
        self.file_name: str = file_name
        self.ocr_profile: str = ocr_profile
        self.ocr_budget_ms: int = ocr_budget_ms
        self.step_callback: Optional[Callable[[str, str, float], None]] = step_callback

        # --- Timing ---
        self.started_at: float = time.perf_counter()
        self.stage_durations_ms: Dict[str, int] = {}
        self.skipped_ocr_stages: List[str] = []

        # --- Pipeline Flags ---
        self.panel_fallback_used: bool = False
        self.visual_ocr_used: bool = False
        self.needs_date_scan: bool = False
        self.needs_name_scan: bool = False
        self.speed_recovery_required: bool = False
        self.speed_fast_path: bool = False
        self.speed_recovery_budget_ms: int = ocr_budget_ms
        self.speed_first_pass_merged: bool = False

        # --- MRZ Results ---
        self.extraction: Dict[str, Any] = {"data": {}, "confidence": 0.0, "notes": ""}
        self.parsed: ParsedPassportData = ParsedPassportData()
        self.mrz_error: str = ""

        # --- Page & Rotation ---
        self.page: Any = None
        self.ocr_rotation_degrees: int = 0

        # --- Visual OCR Results ---
        self.visual_fields: Dict[str, str] = {}
        self.visual_notes: str = ""
        self.merged_visual_fields: Dict[str, str] = {}
        self.visual_field_names: Tuple[str, ...] = ()

        # --- Panel OCR Results ---
        self.panel_fields: Dict[str, str] = {}
        self.panel_notes: str = ""
        self.panel_field_names: Tuple[str, ...] = ()
        self.skipped_panel_field_names: Tuple[str, ...] = ()
        self.panel_recovery_field_names: Tuple[str, ...] = ()

        # --- Recovery Notes ---
        self.early_name_notes: str = ""
        self.fast_mrz_notes: str = ""
        self.fast_date_notes: str = ""
        self.date_repair_notes: str = ""
        self.name_notes: str = ""
        self.validation_notes: str = ""
        self.speed_scan_notes: str = ""

        # --- Metadata & Auditing ---
        self.field_metadata: Dict[str, Any] = {}
        self.stage_reports: List[Any] = []

        # --- Stage Timing Config ---
        self.stage_min_remaining_ms: Dict[str, int] = {
            "visual": 1_000,
            "speed_visual": 3_000,
            "panel": 3_000,
            "speed_panel": 2_500,
            "visual_recovery": 5_000,
            "page_align": 4_000,
            "dates": 3_000,
            "names": 4_000,
        }

    # --- Profile Helpers ---

    @property
    def is_speed_scan(self) -> bool:
        """Return True if this is a speed-first OCR profile."""
        return self.ocr_profile == "speed"

    @property
    def is_heavy_scan(self) -> bool:
        """Return True if this is a heavy/accuracy OCR profile."""
        return self.ocr_profile in {"heavy", "accuracy"}

    @property
    def is_balanced_scan(self) -> bool:
        """Return True if this is a balanced OCR profile."""
        return self.ocr_profile == "balanced"

    # --- Timing Helpers ---

    def elapsed_ms(self) -> int:
        """Return milliseconds elapsed since scan started."""
        return max(0, int((time.perf_counter() - self.started_at) * 1000))

    def budget_exceeded(self) -> bool:
        """Return True if the OCR time budget has been exceeded."""
        return self.elapsed_ms() > self.ocr_budget_ms

    def can_spend_ocr_time(self, stage_name: str) -> bool:
        """Return True if enough budget remains for the given stage."""
        remaining = self.ocr_budget_ms - self.elapsed_ms()
        return remaining >= self.stage_min_remaining_ms.get(stage_name, 0)

    def skip_stage(self, stage_name: str) -> None:
        """Record that a stage was skipped due to budget constraints."""
        if stage_name not in self.skipped_ocr_stages:
            self.skipped_ocr_stages.append(stage_name)

    def record_stage_duration(self, stage_name: str, stage_started_at: float) -> None:
        """Accumulate timing for a named stage."""
        elapsed = max(0, int((time.perf_counter() - stage_started_at) * 1000))
        self.stage_durations_ms[stage_name] = self.stage_durations_ms.get(stage_name, 0) + elapsed

    def report_step(self, code: str, label: str, progress: float, console_message: str) -> None:
        """Print progress and notify the step callback if present."""
        logger.info(console_message)
        if self.step_callback is not None:
            self.step_callback(code, label, progress)


@dataclass
class StageResult:
    """Represents the execution result of a single pipeline stage."""
    stage_name: str
    duration_ms: float = 0.0
    fields_changed: List[str] = field(default_factory=list)
    fields_rejected: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    exception: str = ""

