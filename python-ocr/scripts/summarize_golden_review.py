from __future__ import annotations

import argparse
from collections import Counter
import csv
import json
from pathlib import Path
from typing import Any

from apply_golden_candidates import (
    DEFAULT_GOLDEN,
    apply_review_sheet,
    merge_approved_candidates,
)


def main() -> int:
    args = parse_args()
    golden = load_golden_fixture(args.golden)
    candidate_report = load_candidate_report(args.candidates)
    review_rows = load_review_sheet(args.review_sheet) if args.review_sheet else []
    if review_rows:
        candidate_report = apply_review_sheet(candidate_report, review_rows)
    summary = summarize_review_progress(
        golden,
        candidate_report,
        review_rows=review_rows,
        allow_duplicate_file_names=args.allow_duplicate_file_names,
    )
    payload = json.dumps(summary, indent=2, ensure_ascii=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload + "\n", encoding="utf-8")
    else:
        print(payload)
    return 1 if summary["blockedApprovedCount"] or summary["unmatchedReviewRowCount"] else 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Summarize golden candidate review progress before applying fixture changes.")
    parser.add_argument("candidates", type=Path, help="Candidate report from prepare_golden_candidates.py.")
    parser.add_argument("--review-sheet", type=Path, help="CSV review sheet exported from export_golden_review_sheet.py.")
    parser.add_argument("--golden", type=Path, default=DEFAULT_GOLDEN)
    parser.add_argument("--output", type=Path, help="Optional JSON summary output.")
    parser.add_argument("--allow-duplicate-file-names", action="store_true")
    return parser.parse_args()


def summarize_review_progress(
    golden: list[dict[str, Any]],
    candidate_report: dict[str, Any],
    *,
    review_rows: list[dict[str, str]] | None = None,
    allow_duplicate_file_names: bool = False,
) -> dict[str, Any]:
    candidates = _candidate_items(candidate_report)
    _, apply_summary = merge_approved_candidates(
        golden,
        candidate_report,
        allow_duplicate_file_names=allow_duplicate_file_names,
    )
    skipped = [item for item in apply_summary.get("skipped", []) if isinstance(item, dict)]
    pending = [item for item in skipped if item.get("reason") == "NOT_REVIEW_APPROVED"]
    blocked = [item for item in skipped if item.get("reason") != "NOT_REVIEW_APPROVED"]
    review_rows = review_rows or []
    candidate_names = {str(candidate.get("fileName", "") or "") for candidate in candidates}
    unmatched_rows = [
        str(row.get("fileName", "") or "")
        for row in review_rows
        if str(row.get("fileName", "") or "") and str(row.get("fileName", "") or "") not in candidate_names
    ]
    return {
        "existingGoldenCount": len(golden),
        "candidateCount": len(candidates),
        "reviewRowCount": len(review_rows),
        "unmatchedReviewRowCount": len(unmatched_rows),
        "unmatchedReviewRows": unmatched_rows,
        "approvedCount": int(apply_summary.get("approvedCount", 0) or 0),
        "pendingCount": len(pending),
        "readyToAppendCount": int(apply_summary.get("appendedCount", 0) or 0),
        "blockedApprovedCount": len(blocked),
        "nextGoldenCount": len(golden) + int(apply_summary.get("appendedCount", 0) or 0),
        "readyFileNames": list(apply_summary.get("appendedFileNames", [])),
        "pendingFileNames": [str(item.get("fileName", "") or "") for item in pending],
        "blockedApproved": blocked,
        "blockReasonCounts": _reason_counts(blocked),
        "recordStatusCounts": _candidate_status_counts(candidates, "recordStatus"),
        "recordReviewStatusCounts": _candidate_status_counts(candidates, "recordReviewStatus"),
        "reviewReasonCounts": _review_reason_counts(candidates),
    }


def load_golden_fixture(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("Golden fixture must be a list.")
    return [item for item in payload if isinstance(item, dict)]


def load_candidate_report(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Candidate report must be an object.")
    return payload


def load_review_sheet(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return [{str(key): str(value or "") for key, value in row.items()} for row in csv.DictReader(handle)]


def _candidate_items(candidate_report: dict[str, Any]) -> list[dict[str, Any]]:
    candidates = candidate_report.get("candidates", [])
    return [item for item in candidates if isinstance(item, dict)] if isinstance(candidates, list) else []


def _reason_counts(items: list[dict[str, Any]]) -> dict[str, int]:
    counter = Counter(str(item.get("reason", "") or "") for item in items if item.get("reason"))
    return dict(sorted(counter.items()))


def _candidate_status_counts(candidates: list[dict[str, Any]], key: str) -> dict[str, int]:
    counter = Counter(str(candidate.get(key, "") or "UNKNOWN") for candidate in candidates)
    return dict(sorted(counter.items()))


def _review_reason_counts(candidates: list[dict[str, Any]]) -> dict[str, int]:
    counter: Counter[str] = Counter()
    for candidate in candidates:
        reasons = candidate.get("reviewReasons", [])
        if isinstance(reasons, list):
            counter.update(str(reason) for reason in reasons if reason)
    return dict(sorted(counter.items()))


if __name__ == "__main__":
    raise SystemExit(main())
