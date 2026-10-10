from services.decision_rules import DecisionRules, evaluate_overwrite
from services.scan_context import ScanContext


def test_validated_visual_date_can_replace_unverified_mrz_even_when_mrz_confidence_is_high():
    accepted, _ = evaluate_overwrite(
        "1990-01-01", {"source": "MRZ", "confidence": 1.0, "validated": False},
        "1990-01-02", "VISUAL", 0.99, True,
    )
    assert accepted


def test_verified_mrz_is_protected_from_visual_overwrites_with_plain_dict_data():
    ctx = ScanContext("test.png", "test.png", 30_000)
    ctx.parsed = {"dob": "1990-01-01"}
    ctx.field_metadata["dob"] = {"source": "MRZ", "confidence": 0.5, "validated": True}
    assert not DecisionRules.evaluate_and_update(ctx, "dob", "1990-01-02", "VISUAL", 0.99, validated=True)
    assert ctx.parsed["dob"] == "1990-01-01"


def test_weak_or_unvalidated_correction_cannot_replace_nonempty_mrz():
    current = {"source": "MRZ", "confidence": 0.2, "validated": False}
    assert not evaluate_overwrite("1990-01-01", current, "1990-01-02", "PANEL", 0.69, True)[0]
    assert not evaluate_overwrite("1990-01-01", current, "1990-01-02", "PANEL", 0.99, False)[0]
