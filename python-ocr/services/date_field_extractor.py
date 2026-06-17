from __future__ import annotations

from datetime import date

from services.expiry_date_extractor import (
    _collect_legacy_candidates as _collect_expiry_legacy_candidates,
    _collect_page_candidates as _collect_expiry_page_candidates,
    _collect_raw_candidates as _collect_expiry_raw_candidates,
    pick_expiry_date,
)
from services.issue_date_extractor import (
    _collect_legacy_candidates as _collect_issue_legacy_candidates,
    _collect_page_candidates as _collect_issue_page_candidates,
    _collect_raw_candidates as _collect_issue_raw_candidates,
    infer_issue_date,
    pick_issue_date,
)
from services.passport_page import extract_aligned_passport_page


def extract_document_dates(
    file_path: str,
    dob: str = "",
    current_issue_date: str = "",
    current_expiry_date: str = "",
    page: object | None = None,
) -> ParsedPassportData:
    issue_candidates = _candidate_from_current(current_issue_date)
    expiry_candidates = _candidate_from_current(current_expiry_date)
    resolved = _resolve_date_pair(
        issue_candidates,
        expiry_candidates,
        dob,
        allow_infer=page is None and not issue_candidates and bool(expiry_candidates),
    )
    if _has_complete_pair(resolved, dob):
        return resolved

    page = page if page is not None else extract_aligned_passport_page(file_path)
    if page is not None:
        issue_candidates = _unique(issue_candidates + _collect_issue_page_candidates(page))
        expiry_candidates = _unique(expiry_candidates + _collect_expiry_page_candidates(page))
        resolved = _resolve_date_pair(issue_candidates, expiry_candidates, dob)
        if _has_complete_pair(resolved, dob):
            return resolved

    if not _has_complete_pair(resolved, dob):
        issue_candidates = _unique(issue_candidates + _collect_issue_raw_candidates(file_path))
        expiry_candidates = _unique(expiry_candidates + _collect_expiry_raw_candidates(file_path))
        resolved = _resolve_date_pair(issue_candidates, expiry_candidates, dob)

    if not _has_complete_pair(resolved, dob):
        issue_candidates = _unique(issue_candidates + _collect_issue_legacy_candidates(file_path))
        expiry_candidates = _unique(expiry_candidates + _collect_expiry_legacy_candidates(file_path))
        resolved = _resolve_date_pair(issue_candidates, expiry_candidates, dob, allow_infer=True)

    return resolved


def _resolve_date_pair(
    issue_candidates: list[str],
    expiry_candidates: list[str],
    dob: str,
    allow_infer: bool = False,
) -> ParsedPassportData:
    shared_candidates = _unique(issue_candidates + expiry_candidates)
    expiry = pick_expiry_date(expiry_candidates or shared_candidates, dob=dob)
    issue = pick_issue_date(shared_candidates, dob, expiry)
    if not issue and allow_infer:
        issue = infer_issue_date(dob, expiry)
    if not expiry:
        expiry = pick_expiry_date(expiry_candidates or shared_candidates, dob=dob, issue_date=issue)
    elif issue:
        expiry = pick_expiry_date(expiry_candidates or shared_candidates, dob=dob, issue_date=issue) or expiry
    return {"issueDate": issue, "expiryDate": expiry}


def _has_complete_pair(values: dict[str, str], dob: str = "") -> bool:
    issue = _parse_iso_date(values.get("issueDate", ""))
    expiry = _parse_iso_date(values.get("expiryDate", ""))
    dob_date = _parse_iso_date(dob)
    if issue is None or expiry is None:
        return False
    if issue >= expiry:
        return False
    if dob_date and (issue <= dob_date or expiry <= dob_date):
        return False
    return True


def _candidate_from_current(value: str) -> list[str]:
    parsed = _parse_iso_date(value)
    return [parsed.isoformat()] if parsed else []


def _parse_iso_date(value: str) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    unique_values: list[str] = []
    for value in values:
        if value and value not in seen:
            unique_values.append(value)
            seen.add(value)
    return unique_values
