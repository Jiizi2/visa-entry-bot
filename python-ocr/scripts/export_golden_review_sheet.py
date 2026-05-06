from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any

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

REVIEW_COLUMNS = (
    "fileName",
    "sourcePath",
    "reviewApproved",
    "reviewNotes",
    "recordReviewStatus",
    "recordStatus",
    "confidence",
    "reviewReasons",
    "recordReviewReasons",
    *REVIEW_FIELDS,
)


def main() -> int:
    args = parse_args()
    candidate_report = load_candidate_report(args.candidates)
    rows = build_review_rows(candidate_report)
    write_review_sheet(rows, args.output)
    print(json.dumps({"rowCount": len(rows), "output": str(args.output)}, indent=2))
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export golden candidates to a CSV review sheet.")
    parser.add_argument("candidates", type=Path, help="Candidate report from prepare_golden_candidates.py.")
    parser.add_argument("--output", type=Path, required=True, help="CSV file to write.")
    return parser.parse_args()


def load_candidate_report(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Candidate report must be an object.")
    return payload


def build_review_rows(candidate_report: dict[str, Any]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for candidate in _candidate_items(candidate_report):
        draft = candidate.get("goldenDraft", {})
        expected = draft.get("expected", {}) if isinstance(draft, dict) else {}
        expected = expected if isinstance(expected, dict) else {}
        row = {
            "fileName": str(candidate.get("fileName", "") or ""),
            "sourcePath": str(candidate.get("sourcePath", "") or ""),
            "reviewApproved": "TRUE" if candidate.get("reviewApproved", False) else "FALSE",
            "reviewNotes": str(candidate.get("reviewNotes", "") or ""),
            "recordReviewStatus": str(candidate.get("recordReviewStatus", "") or ""),
            "recordStatus": str(candidate.get("recordStatus", "") or ""),
            "confidence": str(candidate.get("confidence", "") or ""),
            "reviewReasons": _join_reason_list(candidate.get("reviewReasons", [])),
            "recordReviewReasons": _join_reason_list(candidate.get("recordReviewReasons", [])),
        }
        for field_name in REVIEW_FIELDS:
            row[field_name] = str(expected.get(field_name, "") or "")
        rows.append(row)
    return rows


def write_review_sheet(rows: list[dict[str, str]], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(REVIEW_COLUMNS), extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def _candidate_items(candidate_report: dict[str, Any]) -> list[dict[str, Any]]:
    candidates = candidate_report.get("candidates", [])
    return [item for item in candidates if isinstance(item, dict)] if isinstance(candidates, list) else []


def _join_reason_list(value: Any) -> str:
    if isinstance(value, list):
        return "|".join(str(item) for item in value if item)
    return str(value or "")


if __name__ == "__main__":
    raise SystemExit(main())
