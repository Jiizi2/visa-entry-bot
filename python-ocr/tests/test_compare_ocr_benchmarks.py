from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from compare_ocr_benchmarks import aggregate_reports  # type: ignore # noqa: E402


class CompareOcrBenchmarksTests(unittest.TestCase):
    def test_aggregate_reports_uses_median_for_measured_runs(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            paths = []
            for index, latency in enumerate((100, 500, 200)):
                path = Path(temp_dir) / f"run-{index}.json"
                path.write_text(
                    json.dumps(
                        {
                            "summary": {
                                "mismatchCount": index,
                                "avgTotalMs": latency,
                                "p95TotalMs": latency + 10,
                                "maxTotalMs": latency + 20,
                                "reviewCount": 0,
                                "panelFallbackUsed": 0,
                                "rapidocrTotals": {"callCount": index + 2, "totalMs": latency // 2},
                                "fieldAccuracy": {"birthCity": {"accuracy": 1.0 - index * 0.1}},
                            }
                        }
                    ),
                    encoding="utf-8",
                )
                paths.append(path)

            result = aggregate_reports(paths)

        self.assertEqual(result["runCount"], 3)
        self.assertEqual(result["avgTotalMs"], 200)
        self.assertEqual(result["mismatchCount"], 1)
        self.assertEqual(result["rapidocrCallCount"], 3)
        self.assertEqual(result["fieldAccuracy"]["birthCity"], 0.9)


if __name__ == "__main__":
    unittest.main()
