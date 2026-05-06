from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from main import list_passport_files  # noqa: E402
from scan_session import resolve_scan_target  # noqa: E402
from services.modern_ocr_evaluation import (  # noqa: E402
    evaluate_expected_field_hits,
    evaluate_modern_ocr_engine,
    probe_modern_ocr_engine,
    summarize_field_hits,
)


def main() -> int:
    args = parse_args()
    target = resolve_scan_target(str(args.path))
    passport_files = list_passport_files(target.passports_dir)
    golden = _load_golden(args.golden) if args.golden else {}
    if args.golden:
        passport_files = [file_path for file_path in passport_files if Path(file_path).name in golden]
    if args.limit:
        passport_files = passport_files[: args.limit]

    records = []
    for file_path in passport_files:
        result = evaluate_modern_ocr_engine(file_path, args.engine)
        expected = golden.get(Path(file_path).name, {})
        record = {
            "fileName": Path(file_path).name,
            **result.to_dict(),
            "expectedFields": sorted(expected),
            "fieldHits": evaluate_expected_field_hits(result.text, expected),
        }
        if not args.include_text:
            record.pop("text", None)
        records.append(record)

    report = {
        "groupId": target.group_id,
        "engine": args.engine,
        "engineProbe": probe_modern_ocr_engine(args.engine),
        "totalFiles": len(records),
        "summary": _summarize_records(records),
        "records": records,
        "recommendation": _recommendation(records),
    }
    if args.targets:
        report["targetFailures"] = _evaluate_targets(report["summary"], _load_targets(args.targets))
    payload = json.dumps(report, indent=2, ensure_ascii=False)
    if args.output:
        args.output.write_text(payload + "\n", encoding="utf-8")
    else:
        print(payload)
    return 1 if report.get("targetFailures") else 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate optional OCR engines without changing the production pipeline.")
    parser.add_argument("path", type=Path, help="Group folder or passport image folder to scan.")
    parser.add_argument("--engine", choices=("tesseract", "paddle"), default="paddle")
    parser.add_argument("--golden", type=Path, help="JSON fixture with expected fields keyed by fileName.")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--targets", type=Path, help="JSON thresholds for engine adoption checks.")
    parser.add_argument("--include-text", action="store_true", help="Include raw OCR text in the report.")
    return parser.parse_args()


def _load_golden(path: Path) -> dict[str, dict[str, str]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
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


def _summarize_records(records: list[dict[str, Any]]) -> dict[str, Any]:
    elapsed = [int(record.get("elapsedMs", 0) or 0) for record in records]
    status_counts: dict[str, int] = {}
    for record in records:
        status = str(record.get("status", "") or "")
        status_counts[status] = status_counts.get(status, 0) + 1
    return {
        "statusCounts": dict(sorted(status_counts.items())),
        "avgElapsedMs": int(statistics.fmean(elapsed)) if elapsed else 0,
        "maxElapsedMs": max(elapsed, default=0),
        "maxPeakMemoryKb": max((int(record.get("peakMemoryKb", 0) or 0) for record in records), default=0),
        "fieldHitRates": summarize_field_hits(records),
    }


def _recommendation(records: list[dict[str, Any]]) -> str:
    if not records:
        return "NO_DATA"
    if any(record.get("status") == "UNAVAILABLE" for record in records):
        return "DO_NOT_ADOPT_ENGINE_NOT_INSTALLED"
    if any(record.get("status") != "OK" for record in records):
        return "DO_NOT_ADOPT_ENGINE_UNSTABLE"
    return "COMPARE_WITH_PRODUCTION_BENCHMARK_BEFORE_ADOPTION"


def _evaluate_targets(summary: dict[str, Any], targets: dict[str, Any]) -> list[dict[str, Any]]:
    failures: list[dict[str, Any]] = []
    if targets.get("requireAllOk", False):
        status_counts = summary.get("statusCounts", {})
        if not isinstance(status_counts, dict) or set(status_counts) != {"OK"}:
            failures.append(
                {
                    "metric": "statusCounts",
                    "target": {"OK": "all"},
                    "actual": status_counts if isinstance(status_counts, dict) else {},
                }
            )
    _check_max(summary, targets, failures, "avgElapsedMs")
    _check_max(summary, targets, failures, "maxElapsedMs")
    _check_max(summary, targets, failures, "maxPeakMemoryKb")
    field_targets = targets.get("fieldHitRates", {})
    field_summary = summary.get("fieldHitRates", {})
    if isinstance(field_targets, dict) and isinstance(field_summary, dict):
        for field_name, minimum in field_targets.items():
            actual = _field_hit_rate(field_summary, str(field_name))
            if actual is None:
                failures.append(
                    {
                        "metric": f"fieldHitRates.{field_name}",
                        "target": float(minimum),
                        "actual": None,
                        "reason": "No evaluation samples for field.",
                    }
                )
            elif actual < float(minimum):
                failures.append(
                    {
                        "metric": f"fieldHitRates.{field_name}",
                        "target": float(minimum),
                        "actual": actual,
                    }
                )
    return failures


def _check_max(summary: dict[str, Any], targets: dict[str, Any], failures: list[dict[str, Any]], metric: str) -> None:
    if metric not in targets:
        return
    actual = int(summary.get(metric, 0) or 0)
    target = int(targets[metric])
    if actual > target:
        failures.append({"metric": metric, "target": target, "actual": actual})


def _field_hit_rate(field_summary: dict[str, Any], field_name: str) -> float | None:
    value = field_summary.get(field_name)
    if not isinstance(value, dict):
        return None
    if int(value.get("expectedCount", 0) or 0) <= 0:
        return None
    return float(value.get("hitRate", 0.0) or 0.0)


if __name__ == "__main__":
    raise SystemExit(main())
