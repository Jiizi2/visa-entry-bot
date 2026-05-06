from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scan_worker import summarize_scan_metrics  # noqa: E402


class ScanWorkerMetricsTests(unittest.TestCase):
    def test_summarize_scan_metrics_counts_ocr_modes(self) -> None:
        summary = summarize_scan_metrics(
            [
                {"processingMetrics": {"totalMs": 100, "ocrMode": "FAST"}},
                {"processingMetrics": {"totalMs": 200, "ocrMode": "RECOVERY", "panelFallbackUsed": True}},
                {"processingMetrics": {"totalMs": 300, "ocrMode": "RECOVERY", "visualOcrUsed": True}},
                {"processingMetrics": {"totalMs": 400, "ocrMode": "DEEP", "mrzFallbackUsed": True}},
            ]
        )

        self.assertEqual(summary["filesWithMetrics"], 4)
        self.assertEqual(summary["ocrModeCounts"], {"DEEP": 1, "FAST": 1, "RECOVERY": 2})
        self.assertEqual(summary["panelFallbackUsed"], 1)
        self.assertEqual(summary["visualOcrUsed"], 1)
        self.assertEqual(summary["mrzFallbackUsed"], 1)


if __name__ == "__main__":
    unittest.main()
