from __future__ import annotations

import sys
import unittest
from argparse import Namespace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from benchmark_ocr import (  # type: ignore # noqa: E402
    _build_benchmark_metadata,
    _evaluate_targets,
    _golden_from_fixture,
    _load_validated_golden,
    _project_latency,
    _resolve_latency_assumption,
    _select_golden_files,
    _summarize_record,
    _summarize_records,
)


class BenchmarkOcrTests(unittest.TestCase):
    def test_benchmark_metadata_fingerprints_inputs_and_runtime(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            image = root / "sample.png"
            golden = root / "golden.json"
            image.write_bytes(b"image")
            golden.write_text("[]", encoding="utf-8")
            args = Namespace(golden=golden, targets=None)

            result = _build_benchmark_metadata(args, [str(image)])

        self.assertEqual(result["dataset"]["fileCount"], 1)
        self.assertEqual(len(result["dataset"]["nameSizeSha256"]), 64)
        self.assertEqual(len(result["goldenSha256"]), 64)
        self.assertIn("rapidocr-onnxruntime", result["packageVersions"])
        self.assertIn(result["locationStrategy"], {"legacy", "spatial", "spatial_shadow"})

    def test_golden_from_fixture_loads_expected_fields(self) -> None:
        result = _golden_from_fixture(
            [
                {"fileName": "A.png", "expected": {"status": "VALID", "passportNumber": "E1234567"}},
                {"fileName": "", "expected": {"status": "VALID"}},
                {"fileName": "B.png", "expected": "skip"},
            ]
        )

        self.assertEqual(result, {"A.png": {"status": "VALID", "passportNumber": "E1234567"}})

    def test_select_golden_files_uses_loaded_golden_names(self) -> None:
        result = _select_golden_files(["C:/passports/A.png", "C:/passports/B.png"], {"B.png": {"status": "VALID"}})

        self.assertEqual(result, ["C:/passports/B.png"])

    def test_load_validated_golden_reports_missing_image_before_benchmark(self) -> None:
        import json
        import tempfile

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            fixture_path = root / "golden.json"
            images_dir = root / "images"
            images_dir.mkdir()
            fixture_path.write_text(
                json.dumps(
                    [
                        {
                            "fileName": "missing.png",
                            "expected": {
                                "status": "VALID",
                                "passportNumber": "E1234567",
                                "nationality": "INDONESIA",
                                "dob": "1990-01-01",
                                "issueDate": "2025-01-01",
                                "expiryDate": "2030-01-01",
                                "gender": "MALE",
                            },
                        }
                    ]
                ),
                encoding="utf-8",
            )

            golden, validation = _load_validated_golden(fixture_path, images_dir)

        self.assertEqual(golden, {})
        self.assertEqual(validation["errorCount"], 1)
        self.assertIn("fileName:image_missing", validation["records"][0]["errors"])

    def test_summarize_record_tracks_expected_fields_and_mismatches(self) -> None:
        record = {
            "fileName": "sample.jpeg",
            "status": "VALID",
            "reviewStatus": "NEEDS_REVIEW",
            "requiresReview": True,
            "reviewReasons": ["MRZ_CHECKSUM_PARTIAL"],
            "confidence": 0.91,
            "passportExtracted": {
                "passportNumber": "E1234567",
                "nationality": "INDONESIA",
                "gender": "MALE",
            },
            "processingMetrics": {
                "totalMs": 1200,
                "stagesMs": {"mrz": 800},
                "panelFallbackUsed": False,
                "visualOcrUsed": True,
                "mrzFallbackUsed": False,
                "ocrCache": {"hitCount": 2, "missCount": 3, "storeCount": 3, "entryCount": 3},
                "rapidocr": {"callCount": 4, "errorCount": 1, "totalMs": 300, "maxMs": 120},
            },
        }

        result = _summarize_record(
            record,
            {
                "status": "VALID",
                "passportNumber": "E1234567",
                "nationality": "INDONESIA",
                "gender": "FEMALE",
            },
        )

        self.assertEqual(result["expectedFields"], ["gender", "nationality", "passportNumber", "status"])
        self.assertEqual(result["reviewStatus"], "NEEDS_REVIEW")
        self.assertTrue(result["requiresReview"])
        self.assertEqual(result["reviewReasons"], ["MRZ_CHECKSUM_PARTIAL"])
        self.assertEqual(result["ocrCache"], {"hitCount": 2, "missCount": 3, "storeCount": 3, "entryCount": 3})
        self.assertEqual(result["rapidocr"], {"callCount": 4, "errorCount": 1, "totalMs": 300, "maxMs": 120})
        self.assertEqual(
            result["mismatches"],
            [{"field": "gender", "expected": "FEMALE", "actual": "MALE"}],
        )

    def test_summarize_records_reports_field_accuracy_and_p95_latency(self) -> None:
        records = [
            {
                "status": "VALID",
                "reviewStatus": "VALID",
                "requiresReview": False,
                "ocrMode": "FAST",
                "totalMs": 100,
                "stagesMs": {"mrz": 60},
                "panelFallbackUsed": False,
                "visualOcrUsed": False,
                "mrzFallbackUsed": False,
                "ocrCache": {"hitCount": 1, "missCount": 2, "storeCount": 2},
                "rapidocr": {"callCount": 2, "errorCount": 0, "totalMs": 50, "maxMs": 30},
                "imagePreprocessor": {"requestCount": 1, "callCount": 1, "totalMs": 12, "maxMs": 12, "inputMegaPixels": 1.2, "outputMegaPixels": 0.8, "estimatedPeakMb": 9.0},
                "expectedFields": ["status", "passportNumber"],
                "mismatches": [],
            },
            {
                "status": "ERROR",
                "reviewStatus": "ERROR",
                "requiresReview": True,
                "ocrMode": "DEEP",
                "totalMs": 300,
                "stagesMs": {"mrz": 120, "panel": 80},
                "panelFallbackUsed": True,
                "visualOcrUsed": True,
                "mrzFallbackUsed": True,
                "ocrCache": {"hitCount": 3, "missCount": 4, "storeCount": 4},
                "rapidocr": {"callCount": 5, "errorCount": 1, "totalMs": 120, "maxMs": 90},
                "imagePreprocessor": {
                    "requestCount": 2,
                    "cacheHitCount": 1,
                    "callCount": 1,
                    "errorCount": 0,
                    "totalMs": 18,
                    "maxMs": 18,
                    "inputMegaPixels": 1.0,
                    "outputMegaPixels": 0.7,
                    "estimatedPeakMb": 11.5,
                },
                "expectedFields": ["status", "passportNumber"],
                "mismatches": [{"field": "passportNumber", "expected": "E1234567", "actual": ""}],
            },
        ]

        result = _summarize_records(records)

        self.assertEqual(result["validCount"], 1)
        self.assertEqual(result["errorCount"], 1)
        self.assertEqual(result["reviewStatusCounts"], {"VALID": 1, "NEEDS_REVIEW": 0, "ERROR": 1})
        self.assertEqual(result["reviewCount"], 1)
        self.assertEqual(result["ocrModeCounts"], {"DEEP": 1, "FAST": 1})
        self.assertEqual(result["mismatchCount"], 1)
        self.assertEqual(result["avgTotalMs"], 200)
        self.assertEqual(result["p95TotalMs"], 100)
        self.assertEqual(result["maxTotalMs"], 300)
        self.assertEqual(result["stageTotalsMs"], {"mrz": 180, "panel": 80})
        self.assertEqual(result["ocrCacheTotals"], {"hitCount": 4, "missCount": 6, "storeCount": 6})
        self.assertEqual(result["rapidocrTotals"], {"callCount": 7, "errorCount": 1, "totalMs": 170, "avgMs": 85, "p95Ms": 50, "maxMs": 90})
        self.assertEqual(
            result["imagePreprocessorTotals"],
            {
                "requestCount": 3,
                "cacheHitCount": 1,
                "callCount": 2,
                "errorCount": 0,
                "totalMs": 30,
                "avgMs": 15,
                "p95Ms": 12,
                "maxMs": 18,
                "inputMegaPixels": 2.2,
                "outputMegaPixels": 1.5,
                "estimatedPeakMb": 11.5,
            },
        )
        self.assertEqual(
            result["fieldAccuracy"]["passportNumber"],
            {"expectedCount": 2, "matchCount": 1, "mismatchCount": 1, "accuracy": 0.5},
        )
        self.assertEqual(
            result["fieldAccuracy"]["status"],
            {"expectedCount": 2, "matchCount": 2, "mismatchCount": 0, "accuracy": 1.0},
        )
        self.assertEqual(result["panelFallbackUsed"], 1)
        self.assertEqual(result["visualOcrUsed"], 1)
        self.assertEqual(result["mrzFallbackUsed"], 1)

    def test_evaluate_targets_reports_latency_and_accuracy_failures(self) -> None:
        summary = {
            "mismatchCount": 1,
            "avgTotalMs": 1000,
            "p95TotalMs": 5000,
            "maxTotalMs": 7000,
            "fieldAccuracy": {
                "passportNumber": {"expectedCount": 2, "accuracy": 0.5},
                "status": {"expectedCount": 2, "accuracy": 1.0},
            },
        }

        failures = _evaluate_targets(
            summary,
            {
                "mismatchCount": 0,
                "p95TotalMs": 4000,
                "fieldAccuracy": {
                    "passportNumber": 1.0,
                    "status": 1.0,
                    "dob": 1.0,
                },
            },
        )

        self.assertEqual(
            failures,
            [
                {"metric": "mismatchCount", "target": 0, "actual": 1},
                {"metric": "p95TotalMs", "target": 4000, "actual": 5000},
                {"metric": "fieldAccuracy.passportNumber", "target": 1.0, "actual": 0.5},
                {
                    "metric": "fieldAccuracy.dob",
                    "target": 1.0,
                    "actual": None,
                    "reason": "No benchmark samples for field.",
                },
            ],
        )

    def test_project_latency_scales_assumed_hardware_metrics(self) -> None:
        result = _project_latency(
            {
                "avgTotalMs": 100,
                "p95TotalMs": 200,
                "maxTotalMs": 300,
                "rapidocrTotals": {"totalMs": 80, "avgMs": 40, "p95Ms": 30, "maxMs": 30, "callCount": 7},
                "imagePreprocessorTotals": {
                    "totalMs": 10,
                    "avgMs": 5,
                    "p95Ms": 8,
                    "maxMs": 9,
                    "callCount": 2,
                    "estimatedPeakMb": 12.5,
                },
            },
            {"name": "low_power", "latencyMultiplier": 3.0},
        )

        self.assertEqual(
            result,
            {
                "name": "low_power",
                "latencyMultiplier": 3.0,
                "avgTotalMs": 300,
                "p95TotalMs": 600,
                "maxTotalMs": 900,
                "rapidocrTotalMs": 240,
                "rapidocrAvgMs": 120,
                "rapidocrP95Ms": 90,
                "rapidocrMaxMs": 90,
                "rapidocrCallCount": 7,
                "imagePreprocessorTotalMs": 30,
                "imagePreprocessorAvgMs": 15,
                "imagePreprocessorP95Ms": 24,
                "imagePreprocessorMaxMs": 27,
                "imagePreprocessorCallCount": 2,
                "imagePreprocessorEstimatedPeakMb": 12.5,
            },
        )

    def test_resolve_latency_assumption_uses_target_multiplier_when_cli_unset(self) -> None:
        result = _resolve_latency_assumption(
            Namespace(assumed_latency_multiplier=0.0, assumed_hardware_name=""),
            {"assumedHardware": {"name": "low_power", "latencyMultiplier": 3.0}},
        )

        self.assertEqual(result, {"name": "low_power", "latencyMultiplier": 3.0})

    def test_evaluate_targets_reports_assumed_hardware_failures(self) -> None:
        summary = {
            "mismatchCount": 0,
            "reviewCount": 0,
            "avgTotalMs": 100,
            "p95TotalMs": 200,
            "maxTotalMs": 300,
            "fieldAccuracy": {},
            "assumedHardware": {
                "avgTotalMs": 9000,
                "p95TotalMs": 12000,
                "maxTotalMs": 20000,
                "rapidocrTotalMs": 10000,
                "rapidocrMaxMs": 4000,
            },
        }

        failures = _evaluate_targets(
            summary,
            {
                "assumedHardware": {
                    "avgTotalMs": 8000,
                    "rapidocrMaxMs": 3000,
                },
            },
        )

        self.assertEqual(
            failures,
            [
                {"metric": "assumedHardware.avgTotalMs", "target": 8000, "actual": 9000},
                {"metric": "assumedHardware.rapidocrMaxMs", "target": 3000, "actual": 4000},
            ],
        )


if __name__ == "__main__":
    unittest.main()
