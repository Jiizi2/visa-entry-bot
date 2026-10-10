import json
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from benchmark_ocr import _evaluate_targets, _percentile
from verify_ocr_release import TARGETS_PATH, fixture_field_counts, load_fixtures, text_sha256, validate_evidence


@pytest.fixture
def valid_evidence():
    counts = fixture_field_counts(load_fixtures())
    identity = {"sourceSha256": "a" * 64, "fixtureSha256": {"suite": "b" * 64},
                "targetsSha256": "c" * 64, "engine": {"modelSha256": "d" * 64}}
    summary = {
        "totalFiles": 84, "validCount": 84, "reviewCount": 84,
        "reviewStatusCounts": {"VALID": 0, "NEEDS_REVIEW": 84, "ERROR": 0},
        "avgTotalMs": 5000, "p95TotalMs": 9000, "maxTotalMs": 12000,
        "fieldAccuracy": {field: {"expectedCount": count, "matchCount": count, "mismatchCount": 0, "accuracy": 1.0}
                          for field, count in counts.items()},
        **{key: 0 for key in ("errorCount", "mismatchCount", "stageCrashCount", "skippedStageCount", "budgetExceededCount",
                             "ocrErrorCount", "ocrTimeoutCount", "ocrBudgetSkipCount", "imagePathMismatchCount")},
    }
    evidence = {"schemaVersion": 1, **identity,
                "dataset": {"totalFiles": 84, "uniqueImages": 82, "contentSha256": "e" * 64,
                            "suiteCounts": {"FirstTest": 20, "SecondTest": 45, "thirdTest": 2, "trainingData": 17}},
                "summary": summary}
    targets = json.loads(TARGETS_PATH.read_text(encoding="utf-8"))
    return evidence, identity, counts, targets


def test_full_current_evidence_passes_with_required_manual_review(valid_evidence):
    assert validate_evidence(*valid_evidence) == []


@pytest.mark.parametrize("key", ["sourceSha256", "fixtureSha256", "targetsSha256", "engine"])
def test_stale_source_fixture_target_or_engine_is_rejected(valid_evidence, key):
    evidence, identity, counts, targets = valid_evidence
    evidence[key] = "stale"
    assert any(key in failure for failure in validate_evidence(evidence, identity, counts, targets))


@pytest.mark.parametrize("mutation", ["empty", "subset", "duplicates", "field_subset", "field_nan", "no_error_metrics", "timeout", "review_bypass", "slow"])
def test_incomplete_or_failed_benchmark_is_rejected(valid_evidence, mutation):
    evidence, identity, counts, targets = valid_evidence
    if mutation == "empty":
        evidence["summary"] = {}
    elif mutation == "subset":
        evidence["dataset"]["suiteCounts"]["SecondTest"] = 44
    elif mutation == "duplicates":
        evidence["dataset"]["uniqueImages"] = 1
    elif mutation == "field_subset":
        evidence["summary"]["fieldAccuracy"]["dob"]["expectedCount"] = 1
    elif mutation == "field_nan":
        evidence["summary"]["fieldAccuracy"]["dob"]["accuracy"] = float("nan")
    elif mutation == "no_error_metrics":
        del evidence["summary"]["stageCrashCount"]
    elif mutation == "timeout":
        evidence["summary"]["ocrTimeoutCount"] = 1
    elif mutation == "review_bypass":
        evidence["summary"]["reviewCount"] = 0
    elif mutation == "slow":
        evidence["summary"]["p95TotalMs"] = 18001
    assert validate_evidence(evidence, identity, counts, targets)


def test_fingerprint_survives_windows_checkout_line_endings(tmp_path):
    first, second = tmp_path / "lf.py", tmp_path / "crlf.py"
    first.write_bytes(b"first\nsecond\n")
    second.write_bytes(b"first\r\nsecond\r\n")
    assert text_sha256(first) == text_sha256(second)


def test_p95_uses_nearest_rank_including_small_samples():
    assert _percentile([100, 300], 0.95) == 300
    assert _percentile(list(range(1, 85)), 0.95) == 80


def test_benchmark_target_reports_engine_errors_despite_matching_fields():
    failures = _evaluate_targets({"ocrErrorCount": 1, "mismatchCount": 0}, {"ocrErrorCount": 0, "mismatchCount": 0})
    assert failures == [{"metric": "ocrErrorCount", "target": 0, "actual": 1}]
