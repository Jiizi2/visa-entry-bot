from __future__ import annotations

import argparse
import csv
from datetime import datetime
import json
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_GOLDEN = ROOT / "tests" / "fixtures" / "ocr_training_golden.json"
REVIEW_FIELDS = (
    "status",
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
APPROVED_STATUSES = {"VALID", "ERROR"}
APPROVED_GENDERS = {"MALE", "FEMALE"}
PASSPORT_NUMBER_RE = re.compile(r"^[A-Z][0-9]{7}$")
CORE_APPROVED_FIELDS = ("status", "passportNumber", "nationality", "dob", "issueDate", "expiryDate", "gender")


def main() -> int:
    args = parse_args()
    golden = _load_golden_fixture(args.golden)
    candidate_report = _load_candidate_report(args.candidates)
    if args.review_sheet:
        candidate_report = apply_review_sheet(candidate_report, _load_review_sheet(args.review_sheet))
    merged, summary = merge_approved_candidates(golden, candidate_report, allow_duplicate_file_names=args.allow_duplicate_file_names)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(merged, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return 1 if summary["approvedSkippedCount"] else 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Apply human-approved golden candidates to a golden fixture.")
    parser.add_argument("candidates", type=Path, help="Candidate report from prepare_golden_candidates.py.")
    parser.add_argument("--golden", type=Path, default=DEFAULT_GOLDEN)
    parser.add_argument("--output", type=Path, required=True, help="Write merged golden fixture here.")
    parser.add_argument("--review-sheet", type=Path, help="CSV review sheet exported from export_golden_review_sheet.py.")
    parser.add_argument("--allow-duplicate-file-names", action="store_true")
    return parser.parse_args()


def apply_review_sheet(candidate_report: dict[str, Any], review_rows: list[dict[str, str]]) -> dict[str, Any]:
    rows_by_file_name = {str(row.get("fileName", "") or ""): row for row in review_rows if row.get("fileName")}
    updated_report = dict(candidate_report)
    updated_candidates = []
    for candidate in _candidate_items(candidate_report):
        updated_candidate = dict(candidate)
        file_name = str(updated_candidate.get("fileName", "") or "")
        row = rows_by_file_name.get(file_name)
        if row:
            updated_candidate["reviewApproved"] = _is_truthy(row.get("reviewApproved", ""))
            updated_candidate["reviewNotes"] = str(row.get("reviewNotes", "") or "")
            expected = {
                field_name: str(row.get(field_name, "") or "").strip()
                for field_name in REVIEW_FIELDS
                if str(row.get(field_name, "") or "").strip()
            }
            updated_candidate["candidateExpected"] = dict(expected)
            updated_candidate["goldenDraft"] = {"fileName": file_name, "expected": dict(expected)}
            updated_candidate["reviewChecklist"] = _review_checklist(expected)
        updated_candidates.append(updated_candidate)
    updated_report["candidates"] = updated_candidates
    return updated_report


def merge_approved_candidates(
    golden: list[dict[str, Any]],
    candidate_report: dict[str, Any],
    *,
    allow_duplicate_file_names: bool = False,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    existing_names = {str(item.get("fileName", "")) for item in golden if isinstance(item, dict)}
    duplicate_names = {
        str(item.get("fileName", ""))
        for item in candidate_report.get("duplicateFileNames", [])
        if isinstance(item, dict) and item.get("fileName")
    }
    merged = list(golden)
    approved_count = 0
    skipped: list[dict[str, str]] = []
    appended: list[str] = []
    for candidate in _candidate_items(candidate_report):
        file_name = str(candidate.get("fileName", "") or "")
        if not candidate.get("reviewApproved", False):
            skipped.append({"fileName": file_name, "reason": "NOT_REVIEW_APPROVED"})
            continue
        approved_count += 1
        draft = candidate.get("goldenDraft", {})
        expected = draft.get("expected", {}) if isinstance(draft, dict) else {}
        if not file_name:
            skipped.append({"fileName": file_name, "reason": "MISSING_FILE_NAME"})
            continue
        if file_name in existing_names:
            skipped.append({"fileName": file_name, "reason": "ALREADY_IN_GOLDEN"})
            continue
        if file_name in duplicate_names and not allow_duplicate_file_names:
            skipped.append({"fileName": file_name, "reason": "DUPLICATE_FILE_NAME"})
            continue
        if not isinstance(expected, dict) or not expected:
            skipped.append({"fileName": file_name, "reason": "MISSING_EXPECTED_FIELDS"})
            continue
        validation_errors = validate_expected_fields(expected)
        if validation_errors:
            skipped.append({"fileName": file_name, "reason": "INVALID_EXPECTED_FIELDS", "details": "|".join(validation_errors)})
            continue
        merged.append({"fileName": file_name, "expected": {str(key): str(value) for key, value in expected.items()}})
        existing_names.add(file_name)
        appended.append(file_name)
    approved_skipped = [item for item in skipped if item["reason"] != "NOT_REVIEW_APPROVED"]
    return merged, {
        "existingCount": len(golden),
        "candidateCount": len(_candidate_items(candidate_report)),
        "approvedCount": approved_count,
        "appendedCount": len(appended),
        "approvedSkippedCount": len(approved_skipped),
        "appendedFileNames": appended,
        "skipped": skipped,
    }


def validate_expected_fields(expected: dict[str, Any]) -> list[str]:
    values = {str(key): str(value or "").strip() for key, value in expected.items()}
    errors: list[str] = []
    status = values.get("status", "").upper()
    if not status:
        errors.append("status:missing")
    if status and status not in APPROVED_STATUSES:
        errors.append("status:invalid")
    if status == "VALID":
        for field_name in CORE_APPROVED_FIELDS:
            if not values.get(field_name):
                errors.append(f"{field_name}:missing")
    passport_number = values.get("passportNumber", "").upper()
    if passport_number and not PASSPORT_NUMBER_RE.match(passport_number):
        errors.append("passportNumber:invalid")
    nationality = values.get("nationality", "").upper()
    if nationality and nationality != "INDONESIA":
        errors.append("nationality:unexpected")
    gender = values.get("gender", "").upper()
    if gender and gender not in APPROVED_GENDERS:
        errors.append("gender:invalid")

    parsed_dates = {
        field_name: _parse_iso_date(values.get(field_name, ""))
        for field_name in ("dob", "issueDate", "expiryDate")
        if values.get(field_name, "")
    }
    for field_name in ("dob", "issueDate", "expiryDate"):
        if values.get(field_name, "") and field_name not in parsed_dates:
            errors.append(f"{field_name}:invalid")
    dob = parsed_dates.get("dob")
    issue = parsed_dates.get("issueDate")
    expiry = parsed_dates.get("expiryDate")
    if dob and issue and issue <= dob:
        errors.append("issueDate:not_after_dob")
    if issue and expiry and expiry <= issue:
        errors.append("expiryDate:not_after_issueDate")
    return errors


def _load_golden_fixture(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("Golden fixture must be a list.")
    return [item for item in payload if isinstance(item, dict)]


def _load_candidate_report(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Candidate report must be an object.")
    return payload


def _load_review_sheet(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return [{str(key): str(value or "") for key, value in row.items()} for row in csv.DictReader(handle)]


def _candidate_items(candidate_report: dict[str, Any]) -> list[dict[str, Any]]:
    candidates = candidate_report.get("candidates", [])
    return [item for item in candidates if isinstance(item, dict)] if isinstance(candidates, list) else []


def _is_truthy(value: str) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "y", "approved"}


def _parse_iso_date(value: str) -> datetime | None:
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        return None


def _review_checklist(expected: dict[str, str]) -> list[dict[str, str]]:
    return [
        {
            "field": field_name,
            "candidate": expected.get(field_name, ""),
            "status": "approved",
        }
        for field_name in REVIEW_FIELDS
        if expected.get(field_name, "")
    ]


if __name__ == "__main__":
    raise SystemExit(main())
