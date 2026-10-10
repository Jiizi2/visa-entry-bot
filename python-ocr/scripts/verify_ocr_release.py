"""Release gate using current code plus an aggregate benchmark of local images.

Refresh runs every reviewed fixture locally. CI validates the matching snapshot
without receiving passport images or per-person OCR results.
"""
from __future__ import annotations

import argparse
from collections import Counter
import contextlib
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import io
import json
import math
from pathlib import Path
import platform
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

SUITES = (
    ("FirstTest", "ocr_firsttest_golden.json", "FirstTest", 20),
    ("SecondTest", "ocr_secondtest_golden.json", "SecondTest/45 PAX", 45),
    ("thirdTest", "ocr_thirdtest_golden.json", "thirdTest", 2),
    ("trainingData", "ocr_training_golden.json", "trainingData", 17),
)
EVIDENCE_PATH = ROOT / "benchmark" / "ocr_release_validation.json"
TARGETS_PATH = ROOT / "tests" / "fixtures" / "ocr_benchmark_targets.json"
PACKAGES = ("rapidocr-onnxruntime", "onnxruntime", "opencv-python", "opencv-python-headless", "numpy")


def text_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def source_sha256() -> str:
    paths = [ROOT / name for name in (
        "main.py", "scan_worker.py", "scan_session.py", "requirements.txt", "requirements-dev.txt",
        "scripts/verify_ocr_release.py", "scripts/benchmark_ocr.py",
        "scripts/validate_golden_fixture.py", "scripts/apply_golden_candidates.py",
    )]
    paths.extend((ROOT / "services").rglob("*.py"))
    paths.extend(path for path in (ROOT / "services" / "data").rglob("*") if path.is_file())
    digest = hashlib.sha256()
    for path in sorted(paths):
        digest.update(path.relative_to(ROOT).as_posix().encode() + b"\0")
        digest.update(text_sha256(path).encode() + b"\n")
    return digest.hexdigest()


def current_identity() -> dict:
    distribution = importlib.metadata.distribution("rapidocr-onnxruntime")
    models = {
        str(path).replace("\\", "/"): hashlib.sha256(distribution.locate_file(path).read_bytes()).hexdigest()
        for path in distribution.files or []
        if str(path).endswith((".onnx", "config.yaml"))
    }
    if sum(name.endswith(".onnx") for name in models) < 3:
        raise ValueError("RapidOCR model files are incomplete.")
    return {
        "sourceSha256": source_sha256(),
        "fixtureSha256": {name: text_sha256(ROOT / "tests" / "fixtures" / fixture) for name, fixture, _, _ in SUITES},
        "targetsSha256": text_sha256(TARGETS_PATH),
        "engine": {
            "pythonMajorMinor": ".".join(platform.python_version_tuple()[:2]),
            "packages": {name: importlib.metadata.version(name) for name in PACKAGES},
            "modelSha256": models,
        },
    }


def load_fixtures(images_root: Path | None = None):
    from validate_golden_fixture import load_golden_fixture, validate_golden_fixture

    fixtures = []
    for name, filename, directory, count in SUITES:
        fixture = load_golden_fixture(ROOT / "tests" / "fixtures" / filename)
        validation = validate_golden_fixture(fixture, images_dir=images_root / directory if images_root else None)
        if validation["errorCount"] or len(fixture) != count:
            raise ValueError(f"Invalid or incomplete golden fixture: {name}")
        fixtures.append((name, directory, fixture))
    return fixtures


def fixture_field_counts(fixtures) -> dict:
    return dict(Counter(field for _, _, fixture in fixtures for item in fixture for field in item["expected"]))


def validate_evidence(evidence: dict, identity: dict, field_counts: dict, targets: dict) -> list[str]:
    from benchmark_ocr import _evaluate_targets

    failures = []
    if evidence.get("schemaVersion") != 1:
        failures.append("Unsupported or missing evidence schema.")
    for key, value in identity.items():
        if evidence.get(key) != value:
            failures.append(f"Stale benchmark identity: {key}. Refresh with the current code and engine.")
    dataset = evidence.get("dataset", {})
    suite_counts = {name: count for name, _, _, count in SUITES}
    total = sum(suite_counts.values())
    if dataset.get("suiteCounts") != suite_counts or dataset.get("totalFiles") != total:
        failures.append("Benchmark must include all 84 reviewed fixture images.")
    if not isinstance(dataset.get("uniqueImages"), int) or not 82 <= dataset["uniqueImages"] <= total:
        failures.append("Benchmark dataset has missing or unexpected duplicate images.")
    if not isinstance(dataset.get("contentSha256"), str) or len(dataset["contentSha256"]) != 64:
        failures.append("Missing dataset content fingerprint.")
    summary = evidence.get("summary", {})
    if summary.get("totalFiles") != total or summary.get("validCount") != total:
        failures.append("Benchmark result counts do not match the fixture dataset.")
    for metric in ("errorCount", "mismatchCount", "stageCrashCount", "skippedStageCount", "budgetExceededCount",
                   "ocrErrorCount", "ocrTimeoutCount", "ocrBudgetSkipCount", "imagePathMismatchCount"):
        if summary.get(metric) != 0:
            failures.append(f"Missing or failed safety metric: {metric}.")
    for metric in ("avgTotalMs", "p95TotalMs", "maxTotalMs"):
        value = summary.get(metric)
        if not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
            failures.append(f"Missing or invalid latency: {metric}.")
    accuracy = summary.get("fieldAccuracy", {})
    if set(accuracy) != set(field_counts):
        failures.append("Benchmark field coverage does not match the fixtures.")
    for field, count in field_counts.items():
        result = accuracy.get(field, {})
        matches, misses, rate = result.get("matchCount"), result.get("mismatchCount"), result.get("accuracy")
        if (result.get("expectedCount") != count or not isinstance(matches, int) or not isinstance(misses, int)
                or matches < 0 or misses < 0 or matches + misses != count
                or not isinstance(rate, (int, float)) or not math.isfinite(rate)
                or rate != round(matches / count, 4)):
            failures.append(f"Invalid or incomplete field coverage: {field}.")
    if failures:
        return failures
    failures.extend(f"Quality target failed: {failure['metric']} ({failure.get('actual')})."
                    for failure in _evaluate_targets(summary, targets))
    return failures


def refresh_evidence(images_root: Path, output: Path, details_output: Path) -> dict:
    from benchmark_ocr import _summarize_record, _summarize_records
    from main import process_passport
    from services.ocr_runner import initialize_ocr_engine

    fixtures = load_fixtures(images_root)
    identity = current_identity()
    initialize_ocr_engine()
    records, details, content_hashes = [], [], []
    path_mismatches = 0
    details_output.parent.mkdir(parents=True, exist_ok=True)
    for name, directory, fixture in fixtures:
        for index, item in enumerate(sorted(fixture, key=lambda row: row["fileName"]), 1):
            path = (images_root / directory / item["fileName"]).resolve()
            image_hash = hashlib.sha256(path.read_bytes()).hexdigest()
            with contextlib.redirect_stdout(io.StringIO()):
                record = process_passport(str(path))
            summary = _summarize_record(record, item["expected"])
            records.append(summary)
            actual_path = Path(str(record.get("passportImagePath", "")))
            if not actual_path.is_absolute():
                actual_path = ROOT.parent / actual_path
            path_mismatches += actual_path.resolve() != path
            content_hashes.append(image_hash)
            details.append({"suite": name, "imageSha256": image_hash, "benchmark": summary, "record": record})
            details_output.write_text(json.dumps({**identity, "records": details}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            print(f"{name} {index}/{len(fixture)}: {summary['totalMs']}ms, mismatches={len(summary['mismatches'])}", flush=True)
    if current_identity() != identity:
        raise ValueError("OCR code, fixtures, or engine changed during the benchmark.")
    summary = _summarize_records(records)
    summary["imagePathMismatchCount"] = path_mismatches
    evidence = {
        "schemaVersion": 1,
        "createdAtUtc": datetime.now(timezone.utc).isoformat(),
        **identity,
        "dataset": {
            "totalFiles": len(records), "uniqueImages": len(set(content_hashes)),
            "suiteCounts": {name: len(fixture) for name, _, fixture in fixtures},
            "contentSha256": hashlib.sha256("\n".join(content_hashes).encode()).hexdigest(),
        },
        "summary": summary,
    }
    targets = json.loads(TARGETS_PATH.read_text(encoding="utf-8"))
    failures = validate_evidence(evidence, identity, fixture_field_counts(fixtures), targets)
    if failures:
        raise ValueError("; ".join(failures))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    return evidence


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="Run every private fixture locally and refresh the aggregate evidence.")
    parser.add_argument("--images-root", type=Path, default=ROOT.parent / "data" / "example-group" / "passports")
    parser.add_argument("--evidence", type=Path, default=EVIDENCE_PATH)
    parser.add_argument("--details-output", type=Path, default=ROOT / ".review" / "ocr-release-full.json")
    args = parser.parse_args()
    try:
        if args.refresh:
            if not args.details_output.resolve().is_relative_to((ROOT / ".review").resolve()):
                raise ValueError("Detailed passport results must stay in the ignored python-ocr/.review directory.")
            refresh_evidence(args.images_root, args.evidence, args.details_output)
        fixtures = load_fixtures()
        evidence = json.loads(args.evidence.read_text(encoding="utf-8"))
        failures = validate_evidence(evidence, current_identity(), fixture_field_counts(fixtures),
                                     json.loads(TARGETS_PATH.read_text(encoding="utf-8")))
        if failures:
            for failure in failures:
                print(f"FAIL: {failure}", file=sys.stderr)
            return 1
        print("OCR release gate passed: current source, engine/models, all 84 fixtures, and mandatory manual review.")
        return 0
    except (OSError, ValueError, TypeError, KeyError, AttributeError, importlib.metadata.PackageNotFoundError) as exc:
        print(f"OCR release gate failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    from multiprocessing import freeze_support
    freeze_support()
    raise SystemExit(main())
