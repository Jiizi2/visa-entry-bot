from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.scan_context import ScanContext
from services.pipeline_stages import _stage_adaptive_recovery, _stage_dates_recovery, _stage_initial_panel, _stage_names_recovery, _stage_validation_and_metrics
from services.mrz_extractor import _direct_mrz_orientation_candidates
from services.models import ParsedPassportData


class SinglePipelineRegressionTests(unittest.TestCase):
    def test_pipeline_latches_fast_path_for_healthy_mrz(self) -> None:
        ctx = ScanContext("dummy.jpg", "dummy.jpg", 20_000)
        ctx.parsed = ParsedPassportData(
            firstName="KARIM ALFARIZI",
            familyName="RAMADAN",
            passportNumber="E8710852",
            nationality="INDONESIA",
            dob="2019-06-01",
            expiryDate="2030-01-08",
            gender="MALE",
        )
        ctx.extraction = {"confidence": 0.95, "mrzValidation": {"valid": True}}

        with patch("services.pipeline_stages.extract_document_panel_fields") as panel_scan:
            _stage_initial_panel(ctx)
            _stage_adaptive_recovery(ctx)

        panel_scan.assert_not_called()
        self.assertTrue(ctx.fast_path)
        self.assertFalse(ctx.adaptive_recovery_required)
        self.assertEqual(ctx.ocr_budget_ms, 15_000)

        with patch("services.pipeline_stages.validate_member", return_value=("VALID", "")):
            metrics = _stage_validation_and_metrics(ctx)["processingMetrics"]
        self.assertTrue(metrics["fastPath"])
        self.assertFalse(metrics["adaptiveRecoveryUsed"])

    def test_pipeline_rescues_empty_mrz_with_targeted_panel(self) -> None:
        ctx = ScanContext("dummy.jpg", "dummy.jpg", 0)
        ctx.parsed = ParsedPassportData()
        ctx.extraction = {"data": {}, "confidence": 0.0, "notes": ""}
        panel_fields = {
            "fullName": "BUDI SANTOSO",
            "passportNumber": "E1234567",
            "nationality": "INDONESIA",
            "dob": "1990-01-02",
            "gender": "MALE",
            "placeOfBirth": "JAKARTA",
            "issueDate": "2025-01-01",
            "expiryDate": "2035-01-01",
            "issuingOffice": "JAKARTA",
        }

        with patch("services.pipeline_stages.extract_document_panel_fields", return_value=panel_fields) as panel_scan:
            _stage_initial_panel(ctx)
            panel_scan.assert_not_called()
            self.assertTrue(ctx.fast_path)
            _stage_adaptive_recovery(ctx)

        panel_scan.assert_called_once()
        self.assertNotIn("placeOfBirth", panel_scan.call_args.kwargs["field_names"])
        self.assertNotIn("issuingOffice", panel_scan.call_args.kwargs["field_names"])
        self.assertTrue(ctx.adaptive_recovery_required)
        self.assertFalse(ctx.fast_path)
        self.assertEqual(ctx.ocr_budget_ms, 0)
        self.assertEqual(ctx.parsed.get("passportNumber"), "E1234567")
        self.assertEqual(ctx.parsed.get("firstName"), "BUDI")
        self.assertEqual(ctx.parsed.get("familyName"), "SANTOSO")
        self.assertEqual(ctx.parsed.get("dob"), "1990-01-02")

    def test_complete_identity_does_not_run_panel_for_low_confidence_mrz(self) -> None:
        ctx = ScanContext("dummy.jpg", "dummy.jpg", 20_000)
        ctx.parsed = ParsedPassportData(
            firstName="BUDI",
            familyName="SANTOSO",
            passportNumber="E1234567",
            nationality="INDONESIA",
            dob="1990-01-02",
            expiryDate="2035-01-01",
            gender="MALE",
        )
        ctx.extraction = {"data": {}, "confidence": 0.2, "mrzValidation": {"valid": False}}
        _stage_initial_panel(ctx)

        with patch("services.pipeline_stages.extract_document_panel_fields") as panel_scan:
            _stage_adaptive_recovery(ctx)

        panel_scan.assert_not_called()
        self.assertTrue(ctx.fast_path)
        self.assertFalse(ctx.adaptive_recovery_required)

    def test_pipeline_uses_visual_recovery_when_mrz_and_panel_are_empty(self) -> None:
        ctx = ScanContext("dummy.jpg", "dummy.jpg", 20_000)
        ctx.parsed = ParsedPassportData()
        ctx.extraction = {"data": {}, "confidence": 0.0, "notes": ""}
        _stage_initial_panel(ctx)

        with (
            patch("services.pipeline_stages.extract_document_panel_fields", return_value={}),
            patch("services.pipeline_stages.extract_aligned_passport_page", return_value=MagicMock()),
            patch(
                "services.pipeline_stages.extract_visual_fields",
                return_value={"fullName": "BUDI SANTOSO", "nationality": "INDONESIA"},
            ) as visual_scan,
        ):
            _stage_adaptive_recovery(ctx)

        visual_scan.assert_called_once()
        self.assertTrue(ctx.visual_ocr_used)
        self.assertEqual(ctx.visual_fields.get("fullName"), "BUDI SANTOSO")

    def test_telemetry_recovery_state_shadowing(self) -> None:
        """Verify that ctx.needs_date_scan and ctx.needs_name_scan are updated
        when dates/names recovery is triggered, and telemetry captures them.
        """
        ctx = ScanContext("dummy.jpg", "dummy.jpg", 20_000)
        ctx.adaptive_recovery_required = True
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
            self.assertIn("DATE_RECOVERY", metrics.get("pipelineReasons", []))
            self.assertIn("NAME_RECOVERY", metrics.get("pipelineReasons", []))

    def test_mrz_rotation_recovery_is_content_driven(self) -> None:
        dummy_doc = MagicMock()
        with (
            patch("services.mrz_extractor._should_try_direct_mrz_rotations", return_value=True),
            patch("services.mrz_extractor._rotate_image_180", return_value=dummy_doc),
            patch("services.mrz_extractor._rotate_image_90", return_value=dummy_doc),
            patch("services.mrz_extractor._rotate_image_270", return_value=dummy_doc),
        ):
            candidates = list(_direct_mrz_orientation_candidates(dummy_doc))
            self.assertEqual([c[1] for c in candidates], [0, 180, 90, 270])

        with patch("services.mrz_extractor._should_try_direct_mrz_rotations", return_value=False):
            candidates = list(_direct_mrz_orientation_candidates(dummy_doc))
            self.assertEqual(len(candidates), 1)

    def test_dates_recovery_type_safety_with_empty_context(self) -> None:
        """Verify that date recovery handles an empty context without crashing."""
        ctx = ScanContext("dummy.jpg", "dummy.jpg", 20_000)
        ctx.adaptive_recovery_required = True
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
            _stage_dates_recovery(ctx)
            self.assertTrue(ctx.needs_date_scan)

    def test_visual_fields_vars_type_safety_with_empty_context(self) -> None:
        """Verify that fields_needing_recovery does not crash when ctx.parsed is empty."""
        from services.field_gate import fields_needing_recovery
        ctx = ScanContext("dummy.jpg", "dummy.jpg", 20_000)
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
