from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from validate_golden_fixture import load_golden_fixture


def main() -> int:
    args = parse_args()
    old_fixture = load_golden_fixture(args.old_fixture)
    new_fixture = load_golden_fixture(args.new_fixture)
    report = compare_golden_fixtures(old_fixture, new_fixture)
    payload = json.dumps(report, indent=2, ensure_ascii=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload + "\n", encoding="utf-8")
    else:
        print(payload)
    return 1 if args.fail_on_non_additive and _has_non_additive_changes(report) else 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compare active and generated OCR golden fixtures.")
    parser.add_argument("old_fixture", type=Path, help="Current active golden fixture.")
    parser.add_argument("new_fixture", type=Path, help="Generated next golden fixture.")
    parser.add_argument("--output", type=Path, help="Optional JSON diff output.")
    parser.add_argument("--fail-on-non-additive", action="store_true", help="Exit non-zero if records were changed or removed.")
    return parser.parse_args()


def compare_golden_fixtures(old_fixture: list[dict[str, Any]], new_fixture: list[dict[str, Any]]) -> dict[str, Any]:
    old_records = _fixture_by_name(old_fixture)
    new_records = _fixture_by_name(new_fixture)
    old_names = set(old_records)
    new_names = set(new_records)
    added_names = sorted(new_names - old_names)
    removed_names = sorted(old_names - new_names)
    changed = [
        _changed_record(file_name, old_records[file_name], new_records[file_name])
        for file_name in sorted(old_names & new_names)
        if old_records[file_name] != new_records[file_name]
    ]
    unchanged_count = len(old_names & new_names) - len(changed)
    return {
        "oldCount": len(old_records),
        "newCount": len(new_records),
        "addedCount": len(added_names),
        "removedCount": len(removed_names),
        "changedCount": len(changed),
        "unchangedCount": unchanged_count,
        "isAdditiveOnly": not removed_names and not changed,
        "addedFileNames": added_names,
        "removedFileNames": removed_names,
        "changed": changed,
    }


def _fixture_by_name(fixture: list[dict[str, Any]]) -> dict[str, dict[str, str]]:
    records: dict[str, dict[str, str]] = {}
    for item in fixture:
        file_name = str(item.get("fileName", "") or "")
        expected = item.get("expected", {})
        if file_name and isinstance(expected, dict):
            records[file_name] = {str(key): str(value) for key, value in expected.items()}
    return records


def _changed_record(file_name: str, old_expected: dict[str, str], new_expected: dict[str, str]) -> dict[str, Any]:
    field_changes = {}
    for field_name in sorted(set(old_expected) | set(new_expected)):
        old_value = old_expected.get(field_name, "")
        new_value = new_expected.get(field_name, "")
        if old_value != new_value:
            field_changes[field_name] = {"old": old_value, "new": new_value}
    return {"fileName": file_name, "fieldChanges": field_changes}


def _has_non_additive_changes(report: dict[str, Any]) -> bool:
    return int(report.get("removedCount", 0) or 0) > 0 or int(report.get("changedCount", 0) or 0) > 0


if __name__ == "__main__":
    raise SystemExit(main())
