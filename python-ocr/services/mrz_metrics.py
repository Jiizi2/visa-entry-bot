from __future__ import annotations
import threading
import time
from contextlib import contextmanager
from typing import Generator

class MrzMetricsCollector:
    def __init__(self):
        self.rapidocr_runs = 0
        self.variant_attempts = 0
        self.orientation_attempts = {0: 0, 90: 0, 180: 0, 270: 0}
        self.successful_variant = None
        self.successful_orientation = None
        self.fallback_used = False
        self.direct_success = False
        self.fallback_success = False
        self.early_exit_triggered = False
        self.t_start = 0.0
        self.t_ocr = 0.0
        self.t_repair = 0.0
        self.t_total = 0.0
        
        # Internal state to track current orientation/variant
        self.current_orientation = 0
        self.current_variant = None

_current_collector = threading.local()

def get_mrz_collector() -> MrzMetricsCollector | None:
    return getattr(_current_collector, 'value', None)

@contextmanager
def mrz_metrics_context() -> Generator[MrzMetricsCollector, None, None]:
    collector = MrzMetricsCollector()
    collector.t_start = time.perf_counter()
    _current_collector.value = collector
    try:
        yield collector
    finally:
        collector.t_total = time.perf_counter() - collector.t_start
        _current_collector.value = None
