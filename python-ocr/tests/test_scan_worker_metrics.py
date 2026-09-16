from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scan_worker import resolve_prepared_manifest_argument, summarize_scan_metrics  # noqa: E402


class ScanWorkerMetricsTests(unittest.TestCase):
    def test_summarize_scan_metrics_counts_pipeline_paths(self) -> None:
        summary = summarize_scan_metrics(
            [
                {"processingMetrics": {"totalMs": 100, "pipelinePath": "FAST"}},
                {"processingMetrics": {"totalMs": 200, "pipelinePath": "RECOVERY", "panelFallbackUsed": True}},
                {
                    "processingMetrics": {
                        "totalMs": 300,
                        "pipelinePath": "RECOVERY",
                        "visualOcrUsed": True,
                    }
                },
                {
                    "processingMetrics": {
                        "totalMs": 400,
                        "pipelinePath": "DEEP",
                        "mrzFallbackUsed": True,
                        "budgetExceeded": True,
                        "skippedStages": ["dates", "names"],
                    }
                },
            ]
        )

        self.assertEqual(summary["filesWithMetrics"], 4)
        self.assertEqual(summary["pipelinePathCounts"], {"DEEP": 1, "FAST": 1, "RECOVERY": 2})
        self.assertEqual(summary["budgetExceededCount"], 1)
        self.assertEqual(summary["skippedStageCounts"], {"dates": 1, "names": 1})
        self.assertEqual(summary["panelFallbackUsed"], 1)
        self.assertEqual(summary["visualOcrUsed"], 1)
        self.assertEqual(summary["mrzFallbackUsed"], 1)

    def test_worker_accepts_new_and_legacy_argument_shapes(self) -> None:
        self.assertEqual(resolve_prepared_manifest_argument(["worker", "folder"]), "")
        self.assertEqual(resolve_prepared_manifest_argument(["worker", "folder", "prepared.json"]), "prepared.json")
        self.assertEqual(resolve_prepared_manifest_argument(["worker", "folder", "balanced", "prepared.json"]), "prepared.json")
        self.assertEqual(resolve_prepared_manifest_argument(["worker", "folder", "heavy"]), "")


if __name__ == "__main__":
    unittest.main()
