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


def main() -> int:
    args = parse_args()
    target = resolve_scan_target(str(args.path))
    passport_files = list_passport_files(target.passports_dir)
    if args.golden:
        passport_files = _select_golden_files(passport_files, args.golden)
    if args.limit:
        passport_files = passport_files[: args.limit]

    golden = _load_golden(args.golden) if args.golden else {}
    records = []
    for file_path in passport_files:
        with contextlib.redirect_stdout(io.StringIO()):
            record = process_passport(file_path)
        records.append(_summarize_record(record, golden.get(Path(file_path).name, {})))

    report = {
        "groupId": target.group_id,
        "passportsDir": target.passports_dir,
        "totalFiles": len(records),
        "summary": _summarize_records(records),
        "records": records,
    }

    payload = json.dumps(report, indent=2, ensure_ascii=False)
    if args.output:
        args.output.write_text(payload + "\n", encoding="utf-8")
    else:
        print(payload)

    return 1 if report["summary"]["mismatchCount"] else 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark OCR scan performance and optional golden-field accuracy.")
    parser.add_argument("path", type=Path, help="Group folder or passport image folder to scan.")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of files after sorting.")
    parser.add_argument("--golden", type=Path, help="JSON fixture with expected fields keyed by fileName.")
    parser.add_argument("--output", type=Path, help="Write benchmark report JSON to this path.")
    return parser.parse_args()


def _select_golden_files(passport_files: list[str], golden_path: Path) -> list[str]:
    expected_names = set(_load_golden(golden_path))
    return [file_path for file_path in passport_files if Path(file_path).name in expected_names]


def _load_golden(path: Path) -> dict[str, dict[str, str]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    golden: dict[str, dict[str, str]] = {}
    for item in payload:
        file_name = str(item.get("fileName", ""))
        expected = item.get("expected", {})
        if file_name and isinstance(expected, dict):
            golden[file_name] = {str(key): str(value) for key, value in expected.items()}
    return golden


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
        "confidence": record.get("confidence", 0.0),
        "totalMs": metrics.get("totalMs", 0),
        "stagesMs": metrics.get("stagesMs", {}),
        "panelFallbackUsed": bool(metrics.get("panelFallbackUsed")),
        "visualOcrUsed": bool(metrics.get("visualOcrUsed")),
        "mrzFallbackUsed": bool(metrics.get("mrzFallbackUsed")),
        "mismatches": mismatches,
    }


def _summarize_records(records: list[dict[str, Any]]) -> dict[str, Any]:
    total_ms = [int(record.get("totalMs", 0) or 0) for record in records]
    stage_totals: dict[str, int] = {}
    for record in records:
        stages = record.get("stagesMs", {})
        if not isinstance(stages, dict):
            continue
        for stage_name, value in stages.items():
            stage_totals[stage_name] = stage_totals.get(stage_name, 0) + int(value or 0)
    return {
        "validCount": sum(1 for record in records if record.get("status") == "VALID"),
        "errorCount": sum(1 for record in records if record.get("status") != "VALID"),
        "mismatchCount": sum(len(record.get("mismatches", [])) for record in records),
        "avgTotalMs": int(statistics.fmean(total_ms)) if total_ms else 0,
        "maxTotalMs": max(total_ms, default=0),
        "stageTotalsMs": dict(sorted(stage_totals.items())),
        "panelFallbackUsed": sum(1 for record in records if record.get("panelFallbackUsed")),
        "visualOcrUsed": sum(1 for record in records if record.get("visualOcrUsed")),
        "mrzFallbackUsed": sum(1 for record in records if record.get("mrzFallbackUsed")),
    }


if __name__ == "__main__":
    raise SystemExit(main())
