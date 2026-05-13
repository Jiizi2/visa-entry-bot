from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scan_worker import normalize_worker_ocr_profile, summarize_scan_metrics  # noqa: E402


class ScanWorkerMetricsTests(unittest.TestCase):
    def test_summarize_scan_metrics_counts_ocr_modes(self) -> None:
        summary = summarize_scan_metrics(
            [
                {"processingMetrics": {"totalMs": 100, "ocrMode": "FAST"}},
                {"processingMetrics": {"totalMs": 200, "ocrMode": "RECOVERY", "panelFallbackUsed": True}},
                {
                    "processingMetrics": {
                        "totalMs": 300,
                        "ocrMode": "RECOVERY",
                        "ocrProfile": "balanced",
                        "visualOcrUsed": True,
                    }
                },
                {
                    "processingMetrics": {
                        "totalMs": 400,
                        "ocrMode": "DEEP",
                        "ocrProfile": "heavy",
                        "mrzFallbackUsed": True,
                        "budgetExceeded": True,
                        "skippedStages": ["dates", "names"],
                    }
                },
            ]
        )

        self.assertEqual(summary["filesWithMetrics"], 4)
        self.assertEqual(summary["ocrModeCounts"], {"DEEP": 1, "FAST": 1, "RECOVERY": 2})
        self.assertEqual(summary["ocrProfileCounts"], {"balanced": 1, "heavy": 1})
        self.assertEqual(summary["budgetExceededCount"], 1)
        self.assertEqual(summary["skippedStageCounts"], {"dates": 1, "names": 1})
        self.assertEqual(summary["panelFallbackUsed"], 1)
        self.assertEqual(summary["visualOcrUsed"], 1)
        self.assertEqual(summary["mrzFallbackUsed"], 1)

    def test_normalize_worker_ocr_profile_accepts_three_desktop_modes(self) -> None:
        self.assertEqual(normalize_worker_ocr_profile("speed"), "speed")
        self.assertEqual(normalize_worker_ocr_profile("balanced"), "balanced")
        self.assertEqual(normalize_worker_ocr_profile("heavy"), "heavy")
        self.assertEqual(normalize_worker_ocr_profile("accuracy"), "heavy")
        self.assertEqual(normalize_worker_ocr_profile("unknown"), "speed")


if __name__ == "__main__":
    unittest.main()
