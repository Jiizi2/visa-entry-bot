from unittest.mock import patch
import time

from main import execute_safe_stage
from services.models import ParsedPassportData
from services.name_verification import observed_name_pair, verify_name_evidence
from services.pipeline_stages import _stage_names_recovery, _stage_validation_and_metrics, _stage_visual_fields
from services.scan_context import ScanContext
from services.visual_identity import VisualIdentityEvidence
from services.nusuk_manifest import build_member_record


def verify(parsed, mrz, observed, **kwargs):
    return verify_name_evidence(parsed, mrz, observed, words_verified=kwargs.get("words_verified", True), confidence=0.99)


def test_checksum_valid_names_still_need_independent_agreement():
    wrong = {"firstName": "SAKDLLAH", "familyName": "SAKDLLAH"}
    corrected = {"firstName": "SAKDILLAH", "familyName": "SAKDILLAH"}
    assert verify(wrong, wrong, "SAKDILLAH")["status"] == "CONFLICT"
    assert verify(corrected, wrong, "SAKDILLAH")["status"] == "CONFLICT"
    assert verify(corrected, corrected, "SAKDILLAH")["status"] == "VERIFIED"
    assert verify(corrected, corrected, "")["status"] == "UNVERIFIED"


def test_matching_letters_do_not_hide_missing_word_boundaries():
    names = {"firstName": "ADIBAH", "familyName": "ABQORIAH"}
    assert verify(names, names, "ADIBAH ABQORIAH", words_verified=False)["status"] == "UNVERIFIED"
    assert verify(names, names, "ADIBAH ABQO RIAH")["status"] == "CONFLICT"


def test_low_visual_confidence_is_preserved_despite_valid_mrz_and_known_city():
    names = {"firstName": "ALI", "familyName": "BUDI"}
    record = build_member_record(
        "passport.png", "passport.png", ParsedPassportData(**names), {"issuingOffice": "TANJUNG REDEB"},
        {"confidence": 1.0, "mrzValidation": {"valid": True}}, "VALID", 1.0, "",
        name_verification=verify(names, names, "ALI BUDI"), visual_field_confidence={"cityOfIssued": 0.51},
    )
    assert record["fieldConfidence"]["passportExtracted"]["cityOfIssued"] == 0.51
    assert "LOW_CONFIDENCE" in record["reviewFlags"]["passportExtracted"]["cityOfIssued"]
    assert record["reviewStatus"] == "NEEDS_REVIEW"


def test_observed_name_pair_preserves_initials_and_exact_spelling():
    assert observed_name_pair("M HAMDI", {"nationality": "INDONESIA", "familyName": "HAMDI"}) == {
        "firstName": "M HAMDI", "familyName": "M HAMDI",
    }
    assert observed_name_pair("M ABDUL HAMID", {"familyName": "HAMID"}) == {
        "firstName": "M ABDUL", "familyName": "HAMID",
    }
    assert observed_name_pair("MEYSI SALSAHBILLA", {"familyName": "SALSAHBILLAK"}) == {
        "firstName": "MEYSI", "familyName": "SALSAHBILLA",
    }


def test_visual_word_segmentation_does_not_reallocate_an_existing_matching_name():
    for first, family, observation in (("NORDAM", "VALENTINO", "NORDAM VAL ENTINO"), ("RATNA", "JELITA", "RATNA JEL ITA")):
        names = {"firstName": first, "familyName": family}
        assert observed_name_pair(observation, names) == names
        assert verify(names, names, observation)["status"] == "CONFLICT"


def test_observed_word_boundaries_replace_spacing_from_corrupted_mrz():
    ctx = ScanContext("missing.png", "missing.png", 30_000)
    ctx.parsed = ParsedPassportData(firstName="ROBIY ANTO", familyName="KASIM")
    ctx.mrz_name_fields = {"firstName": "ROBIYA IO", "familyName": "KASIMK"}
    ctx.visual_identity_evidence = VisualIdentityEvidence(
        fields={"fullName": "ROBIYANTO KASIM"}, confidence={"fullName": 0.99}, name_words_verified=True,
    )
    _stage_names_recovery(ctx)
    assert ctx.parsed["firstName"] == "ROBIYANTO"
    assert ctx.parsed["familyName"] == "KASIM"
    assert "PASSPORT NAME DISAGREEMENT REQUIRES REVIEW" in ctx.name_notes


def test_matching_mrz_preserves_existing_spacing_when_visual_gap_is_misread():
    ctx = ScanContext("missing.png", "missing.png", 30_000)
    ctx.parsed = ParsedPassportData(firstName="NORDAM", familyName="VALENTINO")
    ctx.mrz_name_fields = dict(ctx.parsed)
    ctx.visual_identity_evidence = VisualIdentityEvidence(
        fields={"fullName": "NORDAM VAL ENTINO"}, confidence={"fullName": 0.99}, name_words_verified=True,
    )
    _stage_names_recovery(ctx)
    assert ctx.parsed["firstName"] == "NORDAM"
    assert ctx.parsed["familyName"] == "VALENTINO"


def test_machine_agreement_does_not_skip_required_human_review():
    names = {"firstName": "ALI", "familyName": "BUDI"}
    record = build_member_record(
        "passport.png", "passport.png", ParsedPassportData(**names), {"fullName": "ALI BUDI"},
        {"confidence": 1.0, "mrzValidation": {"valid": True}}, "VALID", 1.0,
        "SINGLE PIPELINE REVIEW REQUIRED; FAST PATH COMPLETED", name_verification=verify(names, names, "ALI BUDI"),
    )
    assert record["nameVerification"]["status"] == "VERIFIED"
    assert "OCR_REVIEW_REQUIRED" in record["reviewReasons"]
    assert record["reviewStatus"] == "NEEDS_REVIEW"


def test_mutated_final_names_cannot_pass_an_earlier_match():
    names = {"firstName": "ALI", "familyName": "BUDI"}
    assert verify({"firstName": "ALI", "familyName": "SANTOSO"}, names, "ALI BUDI")["status"] == "UNVERIFIED"


def test_name_refiner_cannot_hide_changes_by_mutating_its_input():
    ctx = ScanContext("missing.png", "missing.png", 30_000)
    ctx.parsed = ParsedPassportData(firstName="ZFA", familyName="ARDIAN")
    ctx.merged_visual_fields = {"fullName": "FATIH RAFAIZAN ARDIAN"}
    def mutate_input(_file, parsed, **_kwargs):
        parsed["firstName"] = "FATIH RAFAIZAN"
        return parsed, "NAME NORMALIZED FROM FULL NAME FIELD"
    with patch("services.pipeline_stages.refine_names_from_scan", side_effect=mutate_input):
        _stage_names_recovery(ctx)
    assert ctx.parsed["firstName"] == "FATIH RAFAIZAN"
    assert "PASSPORT NAME DISAGREEMENT REQUIRES REVIEW" in ctx.name_notes


def test_refinement_cannot_add_letters_that_are_absent_from_the_labelled_name():
    ctx = ScanContext("missing.png", "missing.png", 30_000)
    ctx.parsed = ParsedPassportData(firstName="SITI", familyName="YULIANI")
    ctx.visual_identity_evidence = VisualIdentityEvidence(
        fields={"fullName": "SITIYULIANI"}, confidence={"fullName": 0.99}, name_words_verified=False,
    )
    with (
        patch("services.pipeline_stages._pick_preferred_full_name", return_value="SITIY YULIANI"),
        patch("services.pipeline_stages.refine_names_from_scan", return_value=(ParsedPassportData(firstName="SITIY", familyName="YULIANI"), "")),
    ):
        _stage_names_recovery(ctx)
    assert ctx.parsed["firstName"] == "SITI"
    assert ctx.parsed["familyName"] == "YULIANI"
    assert ctx.field_metadata["rejections"]["firstName"]["value"] == "SITIY"
    assert "PASSPORT NAME DISAGREEMENT REQUIRES REVIEW" in ctx.name_notes


def test_final_repair_cannot_change_letters_after_visual_name_was_selected():
    ctx = ScanContext("missing.png", "missing.png", 30_000)
    ctx.parsed = ParsedPassportData(firstName="SITI", familyName="YULIANI")
    ctx.visual_identity_evidence = VisualIdentityEvidence(
        fields={"fullName": "SITI YULIANI"}, confidence={"fullName": 0.99}, name_words_verified=True,
    )
    def repair(_parsed, **_kwargs):
        _parsed["firstName"] = "SITIY"
        return _parsed, "NAME REPAIRED"
    with patch("services.pipeline_stages._apply_final_name_repairs", side_effect=repair):
        _stage_names_recovery(ctx)
    assert ctx.parsed["firstName"] == "SITI"
    assert ctx.parsed["familyName"] == "YULIANI"
    assert ctx.field_metadata["rejections"]["firstName"]["source"] == "INFERENCE"
    assert "PASSPORT NAME DISAGREEMENT REQUIRES REVIEW" in ctx.name_notes


def test_labelled_mononym_corrects_mrz_letters_without_claiming_verified_boundaries():
    ctx = ScanContext("missing.png", "missing.png", 30_000)
    ctx.parsed = ParsedPassportData(firstName="SAKDLLAH", familyName="SAKDLLAH")
    ctx.mrz_name_fields = {"firstName": "", "familyName": "SAKDLLAH"}
    ctx.visual_identity_evidence = VisualIdentityEvidence(
        fields={"fullName": "SAKDILLAH"}, confidence={"fullName": 0.99}, name_words_verified=False,
    )
    _stage_names_recovery(ctx)
    assert ctx.parsed["firstName"] == ctx.parsed["familyName"] == "SAKDILLAH"
    record = _stage_validation_and_metrics(ctx)
    assert record["nameVerification"]["status"] == "CONFLICT"
    assert record["requiresReview"]


def test_failed_stage_rolls_back_partial_identity_and_forces_review():
    ctx = ScanContext("passport.png", "passport.png", 30_000)
    ctx.parsed = ParsedPassportData(firstName="ALI", familyName="BUDI", passportNumber="E1234567")
    ctx.field_metadata = {"passportNumber": {"value": "E1234567", "source": "MRZ", "validated": True}}
    def broken_stage(current):
        current.parsed["passportNumber"] = "E7654321"
        current.field_metadata["passportNumber"]["value"] = "E7654321"
        current.visual_fields["fullName"] = "OTHER PERSON"
        raise RuntimeError("failed after changing identity")
    execute_safe_stage(broken_stage, ctx)
    assert ctx.parsed["passportNumber"] == "E1234567"
    assert ctx.field_metadata["passportNumber"]["value"] == "E1234567"
    assert not ctx.visual_fields
    with patch("services.pipeline_stages.validate_member", return_value=("VALID", "")):
        record = _stage_validation_and_metrics(ctx)
    assert "OCR_STAGE_FAILED" in record["reviewReasons"]
    assert record["requiresReview"]
    assert record["reviewStatus"] == "NEEDS_REVIEW"


def test_slow_mrz_does_not_skip_visual_identity_with_recovery_time_left():
    ctx = ScanContext("passport.png", "passport.png", 15_000)
    ctx.recovery_budget_ms = 30_000
    ctx.started_at = time.perf_counter() - 13
    ctx.parsed = ParsedPassportData(nationality="INDONESIA")
    evidence = VisualIdentityEvidence(fields={"fullName": "ALI BUDI"}, confidence={"fullName": 0.99}, name_words_verified=True)
    with (
        patch("services.pipeline_stages.extract_fast_location_fields", return_value={}) as location,
        patch("services.pipeline_stages.extract_visual_identity_evidence", return_value=evidence),
    ):
        _stage_visual_fields(ctx)
    location.assert_called_once()
    assert ctx.visual_fields["fullName"] == "ALI BUDI"
    assert "visual" not in ctx.skipped_ocr_stages
    assert ctx.ocr_budget_ms == 30_000
