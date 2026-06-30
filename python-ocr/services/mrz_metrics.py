from __future__ import annotations
import threading
import time
from contextlib import contextmanager
from typing import Generator

class MrzMetricsCollector:
    def __init__(self, passport_id: str = "unknown"):
        self.passport_id = passport_id
        
        # Stages tracker
        stages_list = [
            "load_image", "document_detection", "resize", "rotation",
            "crop", "variant_generation", "ocr", "candidate_selection",
            "repair", "validation", "serialization"
        ]
        self.stages = {
            name: {
                "total_ms": 0.0,
                "count": 0,
                "min_ms": float('inf'),
                "max_ms": 0.0
            }
            for name in stages_list
        }
        
        # Attempts tracker
        self.ocr_attempts = []
        
        # General indicators
        self.fallback_used = False
        self.direct_success = False
        self.fallback_success = False
        self.early_exit_triggered = False
        self.t_start = 0.0
        self.t_total = 0.0
        
        # Missing attributes needed by extractor & runner
        self.rapidocr_runs = 0
        self.variant_attempts = 0
        self.orientation_attempts = {0: 0, 90: 0, 180: 0, 270: 0}
        self.successful_orientation = None
        self.successful_variant = None
        self.successful_width = None
        
        # State tracking during execution
        self.current_orientation = 0
        self.current_variant = None
        self.current_width = 0
        self.current_attempt_index = -1

    def record_stage_time(self, stage_name: str, duration_ms: float):
        if stage_name in self.stages:
            s = self.stages[stage_name]
            s["total_ms"] += duration_ms
            s["count"] += 1
            if duration_ms < s["min_ms"]:
                s["min_ms"] = duration_ms
            if duration_ms > s["max_ms"]:
                s["max_ms"] = duration_ms

    def serialize_stages(self) -> dict[str, dict[str, float | int]]:
        result = {}
        for name, s in self.stages.items():
            tot = s["total_ms"]
            cnt = s["count"]
            avg = tot / cnt if cnt > 0 else 0.0
            min_v = s["min_ms"] if s["min_ms"] != float('inf') else 0.0
            max_v = s["max_ms"]
            result[name] = {
                "total_ms": round(tot, 1),
                "count": cnt,
                "average_ms": round(avg, 1),
                "min_ms": round(min_v, 1),
                "max_ms": round(max_v, 1)
            }
        return result


_current_collector = threading.local()

def get_mrz_collector() -> MrzMetricsCollector | None:
    return getattr(_current_collector, 'value', None)

@contextmanager
def mrz_metrics_context(passport_id: str = "unknown") -> Generator[MrzMetricsCollector, None, None]:
    collector = MrzMetricsCollector(passport_id)
    collector.t_start = time.perf_counter()
    _current_collector.value = collector
    try:
        yield collector
    finally:
        collector.t_total = time.perf_counter() - collector.t_start
        _current_collector.value = None

@contextmanager
def time_stage(stage_name: str) -> Generator[None, None, None]:
    collector = get_mrz_collector()
    t0 = time.perf_counter()
    try:
        yield
    finally:
        if collector is not None:
            duration_ms = (time.perf_counter() - t0) * 1000.0
            collector.record_stage_time(stage_name, duration_ms)
