from typing import Any, Callable, Dict, List, Tuple, Optional
import time

class ScanContext:
    def __init__(
        self,
        file_path: str,
        file_name: str,
        ocr_profile: str,
        ocr_budget_ms: int,
        step_callback: Optional[Callable[[str, str, float], None]] = None
    ):
        self.file_path: str = file_path
        self.file_name: str = file_name
        self.ocr_profile: str = ocr_profile
        self.ocr_budget_ms: int = ocr_budget_ms
        self.step_callback: Optional[Callable[[str, str, float], None]] = step_callback
        
        self.started_at: float = time.perf_counter()
        self.stage_durations_ms: Dict[str, int] = {}
        self.skipped_ocr_stages: List[str] = []
        
        self.panel_fallback_used: bool = False
        self.visual_ocr_used: bool = False
        self.needs_date_scan: bool = False
        self.needs_name_scan: bool = False
        self.speed_scan_notes: str = ""
        
        self.extraction: Dict[str, Any] = {"data": {}, "confidence": 0.0, "notes": ""}
        self.parsed: Dict[str, str] = {}
        self.mrz_error: str = ""
        self.early_name_notes: str = ""
        self.fast_mrz_notes: str = ""
        self.fast_date_notes: str = ""
        self.date_repair_notes: str = ""
        self.name_notes: str = ""
        self.validation_notes: str = ""
        
        self.page: Any = None
        self.ocr_rotation_degrees: int = 0
        
        self.visual_fields: Dict[str, str] = {}
        self.visual_notes: str = ""
        self.merged_visual_fields: Dict[str, str] = {}
        
        self.panel_fields: Dict[str, str] = {}
        self.panel_notes: str = ""
        self.panel_field_names: Tuple[str, ...] = ()
        self.visual_field_names: Tuple[str, ...] = ()
        self.skipped_panel_field_names: Tuple[str, ...] = ()
        self.panel_recovery_field_names: Tuple[str, ...] = ()
        
        # Stages timing settings (from main.py)
        self.stage_min_remaining_ms: Dict[str, int] = {
            "visual": 1_000,
            "panel": 3_000,
            "speed_panel": 2_500,
            "visual_recovery": 5_000,
            "page_align": 4_000,
            "dates": 3_000,
            "names": 4_000,
        }

    def elapsed_ms(self) -> int:
        return max(0, int((time.perf_counter() - self.started_at) * 1000))

    def budget_exceeded(self) -> bool:
        return self.elapsed_ms() > self.ocr_budget_ms

    def can_spend_ocr_time(self, stage_name: str) -> bool:
        remaining = self.ocr_budget_ms - self.elapsed_ms()
        return remaining >= self.stage_min_remaining_ms.get(stage_name, 0)

    def skip_stage(self, stage_name: str) -> None:
        if stage_name not in self.skipped_ocr_stages:
            self.skipped_ocr_stages.append(stage_name)

    def record_stage_duration(self, stage_name: str, stage_started_at: float) -> None:
        elapsed = max(0, int((time.perf_counter() - stage_started_at) * 1000))
        self.stage_durations_ms[stage_name] = self.stage_durations_ms.get(stage_name, 0) + elapsed

    def report_step(self, code: str, label: str, progress: float, console_message: str) -> None:
        print(console_message)
        if self.step_callback is not None:
            self.step_callback(code, label, progress)
