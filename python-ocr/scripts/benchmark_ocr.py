from __future__ import annotations

import argparse
import contextlib
import io
import json
import statistics
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT.parent
sys.path.insert(0, str(ROOT))

from main import list_passport_files, process_passport  # noqa: E402
from scan_session import resolve_scan_target  # noqa: E402
from validate_golden_fixture import load_golden_fixture, validate_golden_fixture  # noqa: E402


def main() -> int:
    args = parse_args()
    target = resolve_scan_target(str(args.path))
    passport_files = list_passport_files(target.passports_dir)
    golden: dict[str, dict[str, str]] = {}
    golden_validation: dict[str, Any] | None = None
    if args.golden:
        golden, golden_validation = _load_validated_golden(args.golden, Path(target.passports_dir))
        if int(golden_validation.get("errorCount", 0) or 0) > 0:
            return _write_invalid_golden_report(args, target, golden_validation)
        passport_files = _select_golden_files(passport_files, golden)
    if args.limit:
        passport_files = passport_files[: args.limit]

    records = []
    for file_path in passport_files:
        with contextlib.redirect_stdout(io.StringIO()):
            record = process_passport(file_path)
        records.append(_summarize_record(record, golden.get(Path(file_path).name, {})))

    targets = _load_targets(args.targets) if args.targets else {}
    summary = _summarize_records(records)
    latency_assumption = _resolve_latency_assumption(args, targets)
    if latency_assumption:
        summary["assumedHardware"] = _project_latency(summary, latency_assumption)

    report = {
        "groupId": target.group_id,
        "passportsDir": target.passports_dir,
        "totalFiles": len(records),
        "summary": summary,
        "records": records,
    }
    if golden_validation is not None:
        report["goldenValidation"] = golden_validation
    if args.targets:
        report["targetFailures"] = _evaluate_targets(report["summary"], targets)

    payload = json.dumps(report, indent=2, ensure_ascii=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload + "\n", encoding="utf-8")
    else:
        print(payload)

    return 1 if report["summary"]["mismatchCount"] or report.get("targetFailures") else 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark OCR scan performance and optional golden-field accuracy.")
    parser.add_argument("path", type=Path, help="Group folder or passport image folder to scan.")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of files after sorting.")
    parser.add_argument("--golden", type=Path, help="JSON fixture with expected fields keyed by fileName.")
    parser.add_argument("--output", type=Path, help="Write benchmark report JSON to this path.")
    parser.add_argument("--targets", type=Path, help="JSON target thresholds for production readiness checks.")
    parser.add_argument("--assumed-hardware-name", default="", help="Name for an optional latency projection.")
    parser.add_argument("--assumed-latency-multiplier", type=float, default=0.0, help="Project latency for a slower target laptop.")
    return parser.parse_args()


def _write_invalid_golden_report(args: argparse.Namespace, target: Any, golden_validation: dict[str, Any]) -> int:
    report = {
        "groupId": target.group_id,
        "passportsDir": target.passports_dir,
        "totalFiles": 0,
        "summary": {
            "validCount": 0,
            "errorCount": 0,
            "reviewStatusCounts": {"VALID": 0, "NEEDS_REVIEW": 0, "ERROR": 0},
            "reviewCount": 0,
            "mismatchCount": 0,
            "avgTotalMs": 0,
            "p95TotalMs": 0,
            "maxTotalMs": 0,
            "stageTotalsMs": {},
            "ocrCacheTotals": {"hitCount": 0, "missCount": 0, "storeCount": 0},
            "tesseractTotals": {"callCount": 0, "errorCount": 0, "totalMs": 0, "maxMs": 0},
            "fieldAccuracy": {},
            "ocrModeCounts": {},
            "panelFallbackUsed": 0,
            "visualOcrUsed": 0,
            "mrzFallbackUsed": 0,
        },
        "records": [],
        "goldenValidation": golden_validation,
        "targetFailures": [
            {
                "metric": "goldenValidation.errorCount",
                "target": 0,
                "actual": int(golden_validation.get("errorCount", 0) or 0),
            }
        ],
    }
    payload = json.dumps(report, indent=2, ensure_ascii=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload + "\n", encoding="utf-8")
    else:
        print(payload)
    return 1


def _select_golden_files(passport_files: list[str], golden: dict[str, dict[str, str]]) -> list[str]:
    expected_names = set(golden)
    return [file_path for file_path in passport_files if Path(file_path).name in expected_names]


def _load_validated_golden(path: Path, images_dir: Path) -> tuple[dict[str, dict[str, str]], dict[str, Any]]:
    fixture = load_golden_fixture(path)
    validation = validate_golden_fixture(fixture, images_dir=images_dir)
    if int(validation.get("errorCount", 0) or 0) > 0:
        return {}, validation
    return _golden_from_fixture(fixture), validation


def _golden_from_fixture(payload: list[dict[str, Any]]) -> dict[str, dict[str, str]]:
    golden: dict[str, dict[str, str]] = {}
    for item in payload:
        file_name = str(item.get("fileName", ""))
        expected = item.get("expected", {})
        if file_name and isinstance(expected, dict):
            golden[file_name] = {str(key): str(value) for key, value in expected.items()}
    return golden


def _load_targets(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return payload if isinstance(payload, dict) else {}


def _summarize_record(record: dict[str, Any], expected: dict[str, str]) -> dict[str, Any]:
    extracted = record.get("passportExtracted", {})
    extracted = extracted if isinstance(extracted, dict) else {}
    actual = {"status": str(record.get("status", ""))}
    actual.update({key: str(value or "") for key, value in extracted.items()})
    mismatches = [
        {"field": key, "expected": value, "actual": actual.get(key, "")}
        for key, value in expected.items()
        if actual.get(key, "") != value
    ]
    metrics = record.get("processingMetrics", {})
    metrics = metrics if isinstance(metrics, dict) else {}
    return {
        "fileName": record.get("fileName", ""),
        "status": record.get("status", ""),
        "reviewStatus": record.get("reviewStatus", record.get("status", "")),
        "requiresReview": bool(record.get("requiresReview")),
        "reviewReasons": _list_values(record.get("reviewReasons", [])),
        "confidence": record.get("confidence", 0.0),
        "totalMs": metrics.get("totalMs", 0),
        "stagesMs": metrics.get("stagesMs", {}),
        "panelFallbackUsed": bool(metrics.get("panelFallbackUsed")),
        "visualOcrUsed": bool(metrics.get("visualOcrUsed")),
        "mrzFallbackUsed": bool(metrics.get("mrzFallbackUsed")),
        "ocrCache": _dict_value(metrics.get("ocrCache", {})),
        "tesseract": _dict_value(metrics.get("tesseract", {})),
        "ocrMode": str(metrics.get("ocrMode", "")),
        "ocrModeReasons": _list_values(metrics.get("ocrModeReasons", [])),
        "expectedFields": sorted(expected),
        "mismatches": mismatches,
    }


def _summarize_records(records: list[dict[str, Any]]) -> dict[str, Any]:
    total_ms = [int(record.get("totalMs", 0) or 0) for record in records]
    stage_totals: dict[str, int] = {}
    field_totals: dict[str, int] = {}
    field_mismatches: dict[str, int] = {}
    ocr_mode_counts: dict[str, int] = {}
    tesseract_totals = {"callCount": 0, "errorCount": 0, "totalMs": 0, "maxMs": 0}
    ocr_cache_totals = {"hitCount": 0, "missCount": 0, "storeCount": 0}
    for record in records:
        stages = record.get("stagesMs", {})
        if not isinstance(stages, dict):
            stages = {}
        for stage_name, value in stages.items():
            stage_totals[stage_name] = stage_totals.get(stage_name, 0) + int(value or 0)
        expected_fields = record.get("expectedFields", [])
        if not isinstance(expected_fields, list):
            expected_fields = []
        mismatch_fields = {
            str(mismatch.get("field", ""))
            for mismatch in record.get("mismatches", [])
            if isinstance(mismatch, dict)
        }
        for field_name in expected_fields:
            field_name = str(field_name)
            field_totals[field_name] = field_totals.get(field_name, 0) + 1
            if field_name in mismatch_fields:
                field_mismatches[field_name] = field_mismatches.get(field_name, 0) + 1
        ocr_mode = str(record.get("ocrMode", "") or "")
        if ocr_mode:
            ocr_mode_counts[ocr_mode] = ocr_mode_counts.get(ocr_mode, 0) + 1
        tesseract = record.get("tesseract", {})
        if isinstance(tesseract, dict):
            tesseract_totals["callCount"] += int(tesseract.get("callCount", 0) or 0)
            tesseract_totals["errorCount"] += int(tesseract.get("errorCount", 0) or 0)
            tesseract_totals["totalMs"] += int(tesseract.get("totalMs", 0) or 0)
            tesseract_totals["maxMs"] = max(tesseract_totals["maxMs"], int(tesseract.get("maxMs", 0) or 0))
        ocr_cache = record.get("ocrCache", {})
        if isinstance(ocr_cache, dict):
            ocr_cache_totals["hitCount"] += int(ocr_cache.get("hitCount", 0) or 0)
            ocr_cache_totals["missCount"] += int(ocr_cache.get("missCount", 0) or 0)
            ocr_cache_totals["storeCount"] += int(ocr_cache.get("storeCount", 0) or 0)
    return {
        "validCount": sum(1 for record in records if record.get("status") == "VALID"),
        "errorCount": sum(1 for record in records if record.get("status") != "VALID"),
        "reviewStatusCounts": _count_review_statuses(records),
        "reviewCount": sum(1 for record in records if record.get("requiresReview")),
        "mismatchCount": sum(len(record.get("mismatches", [])) for record in records),
        "avgTotalMs": int(statistics.fmean(total_ms)) if total_ms else 0,
        "p95TotalMs": _percentile(total_ms, 0.95),
        "maxTotalMs": max(total_ms, default=0),
        "stageTotalsMs": dict(sorted(stage_totals.items())),
        "ocrCacheTotals": ocr_cache_totals,
        "tesseractTotals": tesseract_totals,
        "fieldAccuracy": _summarize_field_accuracy(field_totals, field_mismatches),
        "ocrModeCounts": dict(sorted(ocr_mode_counts.items())),
        "panelFallbackUsed": sum(1 for record in records if record.get("panelFallbackUsed")),
        "visualOcrUsed": sum(1 for record in records if record.get("visualOcrUsed")),
        "mrzFallbackUsed": sum(1 for record in records if record.get("mrzFallbackUsed")),
    }


def _summarize_field_accuracy(field_totals: dict[str, int], field_mismatches: dict[str, int]) -> dict[str, dict[str, Any]]:
    summary: dict[str, dict[str, Any]] = {}
    for field_name in sorted(field_totals):
        total = field_totals[field_name]
        mismatches = field_mismatches.get(field_name, 0)
        matches = total - mismatches
        summary[field_name] = {
            "expectedCount": total,
            "matchCount": matches,
            "mismatchCount": mismatches,
            "accuracy": round(matches / total, 4) if total else 0.0,
        }
    return summary


def _list_values(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item)]


def _dict_value(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _count_review_statuses(records: list[dict[str, Any]]) -> dict[str, int]:
    counts = {"VALID": 0, "NEEDS_REVIEW": 0, "ERROR": 0}
    for record in records:
        status = str(record.get("reviewStatus", record.get("status", "")) or "").upper()
        if status in counts:
            counts[status] += 1
        elif status:
            counts[status] = counts.get(status, 0) + 1
    return counts


def _percentile(values: list[int], percentile: float) -> int:
    if not values:
        return 0
    sorted_values = sorted(values)
    index = min(len(sorted_values) - 1, max(0, int(len(sorted_values) * percentile) - 1))
    return sorted_values[index]


def _evaluate_targets(summary: dict[str, Any], targets: dict[str, Any]) -> list[dict[str, Any]]:
    failures: list[dict[str, Any]] = []
    _check_max(summary, targets, failures, "mismatchCount")
    _check_max(summary, targets, failures, "reviewCount")
    _check_max(summary, targets, failures, "avgTotalMs")
    _check_max(summary, targets, failures, "p95TotalMs")
    _check_max(summary, targets, failures, "maxTotalMs")
    _evaluate_assumed_hardware_targets(summary, targets, failures)

    field_targets = targets.get("fieldAccuracy", {})
    field_summary = summary.get("fieldAccuracy", {})
    if isinstance(field_targets, dict) and isinstance(field_summary, dict):
        for field_name, minimum in field_targets.items():
            actual = _field_accuracy(field_summary, str(field_name))
            if actual is None:
                failures.append(
                    {
                        "metric": f"fieldAccuracy.{field_name}",
                        "target": float(minimum),
                        "actual": None,
                        "reason": "No benchmark samples for field.",
                    }
                )
                continue
            if actual < float(minimum):
                failures.append(
                    {
                        "metric": f"fieldAccuracy.{field_name}",
                        "target": float(minimum),
                        "actual": actual,
                    }
                )
    return failures


def _resolve_latency_assumption(args: argparse.Namespace, targets: dict[str, Any]) -> dict[str, Any] | None:
    target_assumption = targets.get("assumedHardware", {})
    if not isinstance(target_assumption, dict):
        target_assumption = {}
    cli_multiplier = float(args.assumed_latency_multiplier or 0.0)
    target_multiplier = float(target_assumption.get("latencyMultiplier", 1.0) or 1.0)
    multiplier = cli_multiplier if cli_multiplier > 0.0 else target_multiplier
    name = str(args.assumed_hardware_name or target_assumption.get("name", "") or "")
    if multiplier <= 1.0 and not name:
        return None
    return {
        "name": name or "assumed_hardware",
        "latencyMultiplier": max(multiplier, 1.0),
    }


def _project_latency(summary: dict[str, Any], assumption: dict[str, Any]) -> dict[str, Any]:
    multiplier = float(assumption.get("latencyMultiplier", 1.0) or 1.0)
    tesseract_totals = summary.get("tesseractTotals", {})
    tesseract_totals = tesseract_totals if isinstance(tesseract_totals, dict) else {}
    return {
        "name": str(assumption.get("name", "") or "assumed_hardware"),
        "latencyMultiplier": multiplier,
        "avgTotalMs": _scale_ms(summary.get("avgTotalMs", 0), multiplier),
        "p95TotalMs": _scale_ms(summary.get("p95TotalMs", 0), multiplier),
        "maxTotalMs": _scale_ms(summary.get("maxTotalMs", 0), multiplier),
        "tesseractTotalMs": _scale_ms(tesseract_totals.get("totalMs", 0), multiplier),
        "tesseractMaxMs": _scale_ms(tesseract_totals.get("maxMs", 0), multiplier),
        "tesseractCallCount": int(tesseract_totals.get("callCount", 0) or 0),
    }


def _scale_ms(value: object, multiplier: float) -> int:
    return int(round(int(value or 0) * multiplier))


def _evaluate_assumed_hardware_targets(
    summary: dict[str, Any],
    targets: dict[str, Any],
    failures: list[dict[str, Any]],
) -> None:
    assumed_targets = targets.get("assumedHardware", {})
    if not isinstance(assumed_targets, dict):
        return
    assumed_summary = summary.get("assumedHardware", {})
    if not isinstance(assumed_summary, dict):
        failures.append(
            {
                "metric": "assumedHardware",
                "target": "configured",
                "actual": None,
                "reason": "No assumed hardware projection was generated.",
            }
        )
        return
    for metric in ("avgTotalMs", "p95TotalMs", "maxTotalMs", "tesseractTotalMs", "tesseractMaxMs"):
        if metric in assumed_targets:
            actual = int(assumed_summary.get(metric, 0) or 0)
            target = int(assumed_targets[metric])
            if actual > target:
                failures.append({"metric": f"assumedHardware.{metric}", "target": target, "actual": actual})


def _check_max(summary: dict[str, Any], targets: dict[str, Any], failures: list[dict[str, Any]], metric: str) -> None:
    if metric not in targets:
        return
    actual = int(summary.get(metric, 0) or 0)
    target = int(targets[metric])
    if actual > target:
        failures.append({"metric": metric, "target": target, "actual": actual})


def _field_accuracy(field_summary: dict[str, Any], field_name: str) -> float | None:
    value = field_summary.get(field_name)
    if not isinstance(value, dict):
        return None
    if int(value.get("expectedCount", 0) or 0) <= 0:
        return None
    return float(value.get("accuracy", 0.0) or 0.0)


if __name__ == "__main__":
    raise SystemExit(main())
