from unittest.mock import patch
import io
import json

import numpy as np
import pytest

from services.decision_rules import DecisionRules
from services.indonesia_field_ocr import extract_fast_location_fields
from services.models import ParsedPassportData
from services.location_normalizer import _best_vocabulary_match
from services.mrz_validation import mrz_field_is_verified, mrz_fields_needing_recovery
from services.pipeline_stages import _stage_adaptive_recovery, _stage_initial_panel
from services.review_flags import ENTRY_REQUIRED_PASSPORT_FIELDS, build_review_flags
from services.scan_context import ScanContext
from services.visual_identity import VisualIdentityEvidence
from scan_worker import configure_worker_streams, emit


def _partial_context(budget_ms=30_000):
    ctx = ScanContext("dummy.png", "dummy.png", budget_ms)
    ctx.parsed = ParsedPassportData(
        firstName="BUDI", familyName="SANTOSO", passportNumber="E1234567",
        nationality="INDONESIA", dob="1990-01-03", expiryDate="2035-01-01",
        issueDate="2025-01-01", gender="MALE",
    )
    validation = {
        "valid": False,
        "checks": [{"fieldName": field, "valid": valid} for field, valid in (
            ("passportNumber", True), ("dob", False), ("expiryDate", True), ("composite", False)
        )],
    }
    ctx.extraction = {"confidence": 0.99, "mrzValidation": validation}
    ctx.visual_fields = {"fullName": "BUDI SANTOSO", "placeOfBirth": "JAKARTA", "issuingOffice": "JAKARTA"}
    ctx.visual_identity_evidence = VisualIdentityEvidence(
        fields={"fullName": "BUDI SANTOSO"}, confidence={"fullName": 0.99},
        name_candidates=("BUDI SANTOSO",), name_words_verified=True,
    )
    for field in ("passportNumber", "dob", "expiryDate"):
        DecisionRules.update_field(ctx, field, ctx.parsed[field], "MRZ", 0.99, False,
                                   mrz_field_is_verified(validation, field), "MRZ test evidence")
    return ctx


def test_complete_identity_recovers_failed_dob_and_protects_passing_checks():
    ctx = _partial_context()
    assert mrz_fields_needing_recovery(ctx.extraction["mrzValidation"]) == ("dob",)
    with patch("services.pipeline_stages.extract_document_panel_fields", return_value={
        "dob": "1990-01-02", "passportNumber": "E7654321", "expiryDate": "2034-01-01"
    }) as panel:
        _stage_initial_panel(ctx)
        _stage_adaptive_recovery(ctx)
    assert panel.call_args.kwargs["field_names"] == ("dob",)
    assert ctx.parsed["dob"] == "1990-01-02"
    assert ctx.field_metadata["dob"]["source"] == "PANEL"
    assert ctx.parsed["passportNumber"] == "E1234567"
    assert ctx.parsed["expiryDate"] == "2035-01-01"


def test_exhausted_budget_skips_recovery_instead_of_starting_more_ocr():
    ctx = _partial_context(budget_ms=0)
    with patch("services.pipeline_stages.extract_document_panel_fields") as panel:
        _stage_initial_panel(ctx)
        _stage_adaptive_recovery(ctx)
    panel.assert_not_called()
    assert "panel" in ctx.skipped_ocr_stages
    assert ctx.parsed["dob"] == "1990-01-03"


def test_format_repair_does_not_block_recovery_of_failed_mrz_checksum():
    ctx = _partial_context()
    DecisionRules.update_field(ctx, "dob", "1990-01-03", "INFERENCE", 0.90, False, True, "Formatting repair")
    assert DecisionRules.evaluate_and_update(ctx, "dob", "1990-01-02", "PANEL", 0.70, validated=True)
    assert ctx.parsed["dob"] == "1990-01-02"


def test_spatial_preprocessing_recovers_same_shape_changed_pixels():
    original = np.zeros((100, 160, 3), dtype=np.uint8)
    processed = np.full_like(original, 255)
    with (
        patch.dict("os.environ", {"PASSPORT_OCR_LOCATION_STRATEGY": "spatial", "PASSPORT_FAST_LOCATION_PREPROCESS": "1"}),
        patch("services.indonesia_field_ocr._load_image", return_value=original),
        patch("services.indonesia_field_ocr.detect_passport_data_page_crop", return_value=original),
        patch("services.indonesia_field_ocr._extract_spatial_location_from_image", return_value=({"issuingOffice": "JAKARTA"}, None)),
        patch("services.indonesia_field_ocr.build_processed_document_image", return_value=processed) as preprocess,
        patch("services.indonesia_field_ocr._extract_fast_location_from_image", side_effect=["", "JAKARTA"]) as extractor,
    ):
        values = extract_fast_location_fields("dummy.png")
    assert values == {"issuingOffice": "JAKARTA", "placeOfBirth": "JAKARTA"}
    preprocess.assert_called_once()
    assert extractor.call_count == 2
    assert extractor.call_args.args[0] is processed


def test_engine_failure_and_deadline_are_visible_in_review_flags():
    values = {field: "" for field in ENTRY_REQUIRED_PASSPORT_FIELDS}
    flags = build_review_flags(values, dict(values), {}, {}, "VALID",
                               "OCR ENGINE ERROR REQUIRES REVIEW; OCR INFERENCE DEADLINE SKIPPED")
    assert "OCR_ENGINE_ERROR" in flags["record"]
    assert "OCR_TIME_BUDGET_EXCEEDED" in flags["record"]


def test_worker_json_uses_utf8_when_windows_pipe_defaults_to_ansi():
    buffer = io.BytesIO()
    stream = io.TextIOWrapper(buffer, encoding="cp1252")
    with patch("sys.stdout", stream), patch("sys.__stdout__", stream), patch("sys.stderr", io.StringIO()), patch("sys.__stderr__", io.StringIO()):
        configure_worker_streams()
        emit("scan_progress", fileName="paspor-\u65e5\u672c-\u03a9.png")
    assert json.loads(buffer.getvalue().decode("utf-8"))["fileName"] == "paspor-\u65e5\u672c-\u03a9.png"


@pytest.mark.parametrize("candidate", ["KOTABARU", "KOTA BARU"])
def test_location_dictionary_ties_preserve_exact_spelling_for_any_iteration_order(candidate):
    for vocabulary in (["KOTA BARU", "KOTABARU"], ["KOTABARU", "KOTA BARU"]):
        value, _ = _best_vocabulary_match(candidate, vocabulary)
        assert value == candidate
