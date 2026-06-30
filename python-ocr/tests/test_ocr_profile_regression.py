from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.scan_context import ScanContext
from services.pipeline_stages import _stage_dates_recovery, _stage_names_recovery, _stage_validation_and_metrics
from services.mrz_extractor import _is_optimized_pipeline, _direct_mrz_orientation_candidates
from services.models import OcrProfile, ParsedPassportData


class OcrProfileRegressionTests(unittest.TestCase):
    def test_telemetry_recovery_state_shadowing(self) -> None:
        """Verify that ctx.needs_date_scan and ctx.needs_name_scan are updated
        when dates/names recovery is triggered, and telemetry captures them.
        """
        # Create a ScanContext with "balanced" profile
        ctx = ScanContext("dummy.jpg", "dummy.jpg", "balanced", 30000)
        ctx.parsed = {"dob": "900101", "issueDate": "", "expiryDate": ""}
        ctx.visual_fields = {}
        ctx.panel_fields = {}
        ctx.extraction = {"data": {}, "confidence": 0.9, "notes": ""}
        
        # Mock functions called during _stage_dates_recovery and _stage_names_recovery
        with (
            patch("services.pipeline_stages._merge_visual_sources", return_value={}),
            patch("services.pipeline_stages.merge_visual_fields", return_value=ctx.parsed),
            patch("services.pipeline_stages._apply_indonesian_visual_repairs", return_value=ctx.parsed),
            patch("services.pipeline_stages.build_visual_notes", return_value=""),
            patch("services.pipeline_stages._pick_preferred_full_name", return_value=""),
            patch("services.pipeline_stages._apply_fast_date_repairs", return_value=(ctx.parsed, "")),
            patch("services.pipeline_stages._should_extract_dates", return_value=True),
            patch("services.pipeline_stages._should_refine_names", return_value=True),
            patch("services.pipeline_stages._can_infer_missing_issue_date", return_value=False),
            patch("services.pipeline_stages.extract_aligned_passport_page", return_value=MagicMock()),
            patch("services.pipeline_stages.extract_document_dates", return_value={}),
            patch("services.pipeline_stages._repair_impossible_expiry_date", return_value=(ctx.parsed, "")),
            patch("services.pipeline_stages.refine_names_from_scan", return_value=(ctx.parsed, "")),
            patch("services.pipeline_stages._apply_final_name_repairs", return_value=(ctx.parsed, "")),
        ):
            # Run the recovery stages
            _stage_dates_recovery(ctx)
            _stage_names_recovery(ctx)
            
            # Assert they updated context state and avoided shadowing
            self.assertTrue(ctx.needs_date_scan)
            self.assertTrue(ctx.needs_name_scan)

            # Generate telemetry record and verify that recovery status is captured
            record = _stage_validation_and_metrics(ctx)
            metrics = record.get("processingMetrics", {})
            self.assertIn("DATE_RECOVERY", metrics.get("ocrModeReasons", []))
            self.assertIn("NAME_RECOVERY", metrics.get("ocrModeReasons", []))

    def test_heavy_profile_mrz_robustness(self) -> None:
        """Verify that heavy profile uses a more complete search space for MRZ extraction (with rotations),
        whereas speed/balanced profiles skip rotations.
        """
        dummy_doc = MagicMock()
        
        # Test speed profile (optimized, skips rotations, returns only 1 candidate)
        with patch.dict("os.environ", {"PASSPORT_OCR_PROFILE": "speed"}):
            self.assertTrue(_is_optimized_pipeline())
            candidates = list(_direct_mrz_orientation_candidates(dummy_doc))
            self.assertEqual(len(candidates), 1)
            
        # Test balanced profile (optimized, skips rotations, returns only 1 candidate)
        with patch.dict("os.environ", {"PASSPORT_OCR_PROFILE": "balanced"}):
            self.assertTrue(_is_optimized_pipeline())
            candidates = list(_direct_mrz_orientation_candidates(dummy_doc))
            self.assertEqual(len(candidates), 1)

        # Test heavy profile (unoptimized/accuracy, evaluates all rotations/candidates)
        with (
            patch.dict("os.environ", {"PASSPORT_OCR_PROFILE": "heavy"}),
            patch("services.mrz_extractor._should_try_direct_mrz_rotations", return_value=True),
            patch("services.mrz_extractor._rotate_image_180", return_value=dummy_doc),
            patch("services.mrz_extractor._rotate_image_90", return_value=dummy_doc),
            patch("services.mrz_extractor._rotate_image_270", return_value=dummy_doc),
        ):
            self.assertFalse(_is_optimized_pipeline())
            candidates = list(_direct_mrz_orientation_candidates(dummy_doc))
            # Yields document + 3 rotations = 4 candidates
            self.assertGreater(len(candidates), 1)

    def test_benchmark_argument_parsing(self) -> None:
        """Verify that the benchmark scripts accept the speed, balanced, and heavy profiles as CLI choices."""
        from scripts.benchmark_dataset import main as benchmark_main
        
        # Test benchmark_dataset parser accepts "speed", "balanced", "heavy"
        for profile in ("speed", "balanced", "heavy"):
            with patch("sys.argv", ["benchmark_dataset.py", "--profile", profile, "--no-resume"]), \
                 patch("scripts.benchmark_dataset.resolve_profile_paths") as mock_resolve, \
                 patch("scripts.benchmark_dataset.load_json", return_value={"items": []}):
                mock_resolve.return_value = {
                    "profile_dir": Path("dummy"),
                    "per_image_results": Path("dummy"),
                    "ocr_attempts": Path("dummy"),
                    "summary": Path("dummy"),
                    "report": Path("dummy"),
                    "checkpoint": Path("dummy"),
                    "metadata": Path("dummy"),
                    "stage_breakdown": Path("dummy"),
                }
                res = benchmark_main()
                self.assertEqual(res, 1) # returns 1 because dataset manifest has no items, proving parser succeeded!

    def test_dates_recovery_type_safety_with_empty_context(self) -> None:
        """Verify that _stage_dates_recovery does not crash when ctx.parsed is initialized empty."""
        ctx = ScanContext("dummy.jpg", "dummy.jpg", "balanced", 30000)
        # Mock functions called during _stage_dates_recovery to simulate date scan triggering
        with (
            patch("services.pipeline_stages._merge_visual_sources", return_value={}),
            patch("services.pipeline_stages.merge_visual_fields", return_value=ctx.parsed),
            patch("services.pipeline_stages._apply_indonesian_visual_repairs", return_value=ctx.parsed),
            patch("services.pipeline_stages.build_visual_notes", return_value=""),
            patch("services.pipeline_stages._pick_preferred_full_name", return_value=""),
            patch("services.pipeline_stages._should_extract_dates", return_value=True),
            patch("services.pipeline_stages._can_infer_missing_issue_date", return_value=False),
            patch("services.pipeline_stages.extract_aligned_passport_page", return_value=MagicMock()),
            # extract_document_dates returns actual date values, which will trigger the setattr path!
            patch("services.pipeline_stages.extract_document_dates", return_value={"issueDate": "2020-01-01", "expiryDate": "2030-01-01"}),
            patch("services.pipeline_stages._repair_impossible_expiry_date", return_value=(ctx.parsed, "")),
        ):
            # This should execute setattr(ctx.parsed, ...) without throwing AttributeError!
            _stage_dates_recovery(ctx)
            self.assertEqual(ctx.parsed.get("issueDate"), "2020-01-01")
            self.assertEqual(ctx.parsed.get("expiryDate"), "2030-01-01")

    def test_visual_fields_vars_type_safety_with_empty_context(self) -> None:
        """Verify that fields_needing_recovery does not crash when ctx.parsed is empty."""
        from services.field_gate import fields_needing_recovery
        ctx = ScanContext("dummy.jpg", "dummy.jpg", "balanced", 30000)
        # hasattr(ctx.parsed, 'as_dict') should be True, and ctx.parsed.as_dict() should return a standard dict.
        self.assertTrue(hasattr(ctx.parsed, 'as_dict'))
        dct = ctx.parsed.as_dict()
        self.assertIsInstance(dct, dict)
        self.assertNotIsInstance(dct, ParsedPassportData)
        
        # Test calling fields_needing_recovery through the path used in _stage_visual_fields
        # It should resolve to as_dict() and run successfully
        res = fields_needing_recovery(
            ctx.parsed if hasattr(ctx.parsed, 'as_dict') else vars(ctx.parsed),
            0.9,
            True,
            ("issueDate", "expiryDate")
        )
        self.assertIn("issueDate", res)
