from __future__ import annotations

import argparse
import contextlib
import io
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from main import process_passport  # noqa: E402
from scan_session import resolve_scan_target  # noqa: E402

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
GOLDEN_FIELDS = (
    "firstName",
    "familyName",
    "passportNumber",
    "nationality",
    "dob",
    "issueDate",
    "expiryDate",
    "gender",
    "birthCity",
    "cityOfIssued",
)


def main() -> int:
    args = parse_args()
    target = resolve_scan_target(str(args.path))
    passport_files = _discover_passport_files(Path(target.passports_dir), recursive=args.recursive)
    golden_names = _load_golden_names(args.golden)
    duplicate_names = _duplicate_file_names(passport_files)
    files_to_scan = _select_candidate_files(passport_files, golden_names, include_existing=args.include_existing)
    if args.limit:
        files_to_scan = files_to_scan[: args.limit]

    candidates = []
    for file_path in files_to_scan:
        with contextlib.redirect_stdout(io.StringIO()):
            record = process_passport(str(file_path))
        candidates.append(_build_candidate(file_path, record, duplicate_names))

    report = {
        "groupId": target.group_id,
        "passportsDir": target.passports_dir,
        "goldenPath": str(args.golden),
        "recursive": bool(args.recursive),
        "totalFiles": len(passport_files),
        "goldenCount": len(golden_names),
        "missingCount": len(_select_candidate_files(passport_files, golden_names, include_existing=False)),
        "scannedCount": len(candidates),
        "duplicateFileNames": _duplicate_report(duplicate_names),
        "candidates": candidates,
    }
    payload = json.dumps(report, indent=2, ensure_ascii=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload + "\n", encoding="utf-8")
    else:
        print(payload)
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare review-only golden fixture candidates from current OCR output.")
    parser.add_argument("path", type=Path, help="Group folder or passport image folder to inspect.")
    parser.add_argument("--golden", type=Path, default=ROOT / "tests" / "fixtures" / "ocr_training_golden.json")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--recursive", action="store_true", help="Inspect nested image folders under the resolved passport directory.")
    parser.add_argument("--include-existing", action="store_true", help="Also generate candidates for files already present in the golden fixture.")
    return parser.parse_args()


def _discover_passport_files(passports_dir: Path, *, recursive: bool) -> list[Path]:
    pattern = "**/*" if recursive else "*"
    files = [
        path
        for path in passports_dir.glob(pattern)
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    ]
    return sorted(files, key=lambda path: str(path).lower())


def _load_golden_names(path: Path) -> set[str]:
    if not path.exists():
        return set()
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        return set()
    return {str(item.get("fileName", "")) for item in payload if isinstance(item, dict) and item.get("fileName")}


def _select_candidate_files(files: list[Path], golden_names: set[str], *, include_existing: bool) -> list[Path]:
    if include_existing:
        return list(files)
    return [path for path in files if path.name not in golden_names]


def _duplicate_file_names(files: list[Path]) -> dict[str, list[str]]:
    grouped: dict[str, list[str]] = {}
    for path in files:
        grouped.setdefault(path.name, []).append(str(path))
    return {file_name: paths for file_name, paths in grouped.items() if len(paths) > 1}


def _duplicate_report(duplicates: dict[str, list[str]]) -> list[dict[str, Any]]:
    return [
        {
            "fileName": file_name,
            "paths": paths,
        }
        for file_name, paths in sorted(duplicates.items())
    ]


def _build_candidate(file_path: Path, record: dict[str, Any], duplicate_names: dict[str, list[str]]) -> dict[str, Any]:
    review_reasons = ["GENERATED_FROM_CURRENT_OCR"]
    if record.get("requiresReview"):
        review_reasons.append("OCR_NEEDS_REVIEW")
    if file_path.name in duplicate_names:
        review_reasons.append("DUPLICATE_FILE_NAME")
    return {
        "fileName": file_path.name,
        "sourcePath": str(file_path),
        "reviewRequired": True,
        "reviewApproved": False,
        "reviewNotes": "",
        "reviewReasons": review_reasons,
        "reviewChecklist": _review_checklist(_candidate_expected(record)),
        "recordStatus": record.get("status", ""),
        "recordReviewStatus": record.get("reviewStatus", record.get("status", "")),
        "recordReviewReasons": record.get("reviewReasons", []),
        "confidence": record.get("confidence", 0.0),
        "mrzValidation": record.get("mrzValidation", {}),
        "candidateExpected": _candidate_expected(record),
        "goldenDraft": {
            "fileName": file_path.name,
            "expected": _candidate_expected(record),
        },
        "processingMetrics": record.get("processingMetrics", {}),
    }


def _candidate_expected(record: dict[str, Any]) -> dict[str, str]:
    extracted = record.get("passportExtracted", {})
    extracted = extracted if isinstance(extracted, dict) else {}
    expected = {"status": str(record.get("status", ""))}
    for field_name in GOLDEN_FIELDS:
        value = str(extracted.get(field_name, "") or "")
        if value:
            expected[field_name] = value
    return expected


def _review_checklist(expected: dict[str, str]) -> list[dict[str, str]]:
    return [
        {
            "field": field_name,
            "candidate": expected.get(field_name, ""),
            "status": "needs_review",
        }
        for field_name in ("status", *GOLDEN_FIELDS)
        if expected.get(field_name, "")
    ]


if __name__ == "__main__":
    raise SystemExit(main())
