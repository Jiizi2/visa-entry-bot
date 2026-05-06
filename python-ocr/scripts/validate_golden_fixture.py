from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
from typing import Any

from apply_golden_candidates import validate_expected_fields


def main() -> int:
    args = parse_args()
    fixture = load_golden_fixture(args.fixture)
    report = validate_golden_fixture(fixture, images_dir=args.images_dir)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 1 if report["errorCount"] else 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate OCR golden fixture structure and core field formats.")
    parser.add_argument("fixture", type=Path, help="Golden fixture JSON file.")
    parser.add_argument("--images-dir", type=Path, help="Optional directory used to verify fileName image references.")
    parser.add_argument("--output", type=Path, help="Optional JSON validation report output.")
    return parser.parse_args()


def load_golden_fixture(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("Golden fixture must be a list.")
    return [item if isinstance(item, dict) else {"_invalidItem": item} for item in payload]


def validate_golden_fixture(fixture: list[dict[str, Any]], *, images_dir: Path | None = None) -> dict[str, Any]:
    file_names = [str(item.get("fileName", "") or "") for item in fixture if isinstance(item, dict)]
    duplicate_names = sorted(name for name, count in Counter(file_names).items() if name and count > 1)
    records = []
    for index, item in enumerate(fixture):
        records.append(validate_golden_record(index, item, duplicate_names=duplicate_names, images_dir=images_dir))
    error_records = [record for record in records if record["errors"]]
    return {
        "recordCount": len(records),
        "validCount": len(records) - len(error_records),
        "errorCount": len(error_records),
        "duplicateFileNames": duplicate_names,
        "records": records,
    }


def validate_golden_record(
    index: int,
    item: dict[str, Any],
    *,
    duplicate_names: list[str],
    images_dir: Path | None = None,
) -> dict[str, Any]:
    file_name = str(item.get("fileName", "") or "")
    errors: list[str] = []
    if "_invalidItem" in item:
        errors.append("record:must_be_object")
    if not file_name:
        errors.append("fileName:missing")
    if file_name in duplicate_names:
        errors.append("fileName:duplicate")
    if images_dir and file_name and not (images_dir / file_name).exists():
        errors.append("fileName:image_missing")
    expected = item.get("expected", {})
    if not isinstance(expected, dict):
        errors.append("expected:must_be_object")
        expected = {}
    elif not expected:
        errors.append("expected:missing")
    errors.extend(validate_expected_fields(expected))
    return {
        "index": index,
        "fileName": file_name,
        "status": str(expected.get("status", "") or "") if isinstance(expected, dict) else "",
        "errors": errors,
    }


if __name__ == "__main__":
    raise SystemExit(main())
