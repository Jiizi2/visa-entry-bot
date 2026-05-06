from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from evaluate_modern_ocr import _evaluate_targets, _recommendation, _summarize_records  # noqa: E402


class EvaluateModernOcrScriptTests(unittest.TestCase):
    def test_recommendation_rejects_unavailable_engine(self) -> None:
        self.assertEqual(
            _recommendation([{"status": "UNAVAILABLE"}]),
            "DO_NOT_ADOPT_ENGINE_NOT_INSTALLED",
        )

    def test_summarize_records_reports_status_latency_and_hits(self) -> None:
        summary = _summarize_records(
            [
                {"status": "OK", "elapsedMs": 100, "fieldHits": {"passportNumber": True}},
                {"status": "ERROR", "elapsedMs": 300, "fieldHits": {"passportNumber": False}},
            ]
        )

        self.assertEqual(summary["statusCounts"], {"ERROR": 1, "OK": 1})
        self.assertEqual(summary["avgElapsedMs"], 200)
        self.assertEqual(summary["maxElapsedMs"], 300)
        self.assertEqual(summary["maxPeakMemoryKb"], 0)
        self.assertEqual(summary["fieldHitRates"]["passportNumber"], {"expectedCount": 2, "hitCount": 1, "hitRate": 0.5})

    def test_evaluate_targets_reports_status_latency_memory_and_hit_failures(self) -> None:
        summary = {
            "statusCounts": {"OK": 1, "UNAVAILABLE": 1},
            "avgElapsedMs": 9000,
            "maxElapsedMs": 12000,
            "maxPeakMemoryKb": 600000,
            "fieldHitRates": {
                "passportNumber": {"expectedCount": 2, "hitRate": 0.5},
            },
        }

        failures = _evaluate_targets(
            summary,
            {
                "requireAllOk": True,
                "avgElapsedMs": 8000,
                "maxPeakMemoryKb": 500000,
                "fieldHitRates": {
                    "passportNumber": 1.0,
                    "dob": 1.0,
                },
            },
        )

        self.assertEqual(
            failures,
            [
                {"metric": "statusCounts", "target": {"OK": "all"}, "actual": {"OK": 1, "UNAVAILABLE": 1}},
                {"metric": "avgElapsedMs", "target": 8000, "actual": 9000},
                {"metric": "maxPeakMemoryKb", "target": 500000, "actual": 600000},
                {"metric": "fieldHitRates.passportNumber", "target": 1.0, "actual": 0.5},
                {
                    "metric": "fieldHitRates.dob",
                    "target": 1.0,
                    "actual": None,
                    "reason": "No evaluation samples for field.",
                },
            ],
        )


if __name__ == "__main__":
    unittest.main()
