from __future__ import annotations

import re
from datetime import date, timedelta

try:
    import cv2
except ImportError:  # pragma: no cover - depends on local environment
    cv2 = None

try:
    import pytesseract
except ImportError:  # pragma: no cover - depends on local environment
    pytesseract = None

from services.passport_page import build_mrz_relative_crops, collect_ocr_lines, crop_relative, extract_aligned_passport_page

MONTHS = {
    "JAN": 1,
    "FEB": 2,
    "MAR": 3,
    "APR": 4,
    "MAY": 5,
    "JUN": 6,
    "JUL": 7,
    "AUG": 8,
    "SEP": 9,
    "OCT": 10,
    "NOV": 11,
    "DEC": 12,
}
RAW_WINDOWS = ((4.8, 0.8, 0.0, 0.75), (5.8, 1.0, 0.0, 0.82))
PAGE_WINDOWS = (
    (0.54, 0.82, 0.58, 0.99),
    (0.58, 0.78, 0.66, 0.99),
    (0.58, 0.76, 0.72, 0.99),
    (0.56, 0.72, 0.76, 0.99),
)
FOCUSED_WINDOWS = (
    (0.61, 0.71, 0.80, 0.99),
    (0.60, 0.70, 0.79, 0.99),
    (0.58, 0.72, 0.74, 0.99),
    (0.58, 0.74, 0.68, 0.97),
)


def extract_expiry_date(
    file_path: str,
    dob: str = "",
    issue_date: str = "",
    page: object | None = None,
    current_value: str = "",
) -> str:
    current = _parse_iso_date(current_value)
    if current and not _parse_iso_date(issue_date) and pick_expiry_date([current.isoformat()], dob=dob):
        return current.isoformat()
    page = page if page is not None else extract_aligned_passport_page(file_path)
    page_candidates = _collect_page_candidates(page)
    candidates = _unique(([current.isoformat()] if current else []) + page_candidates)
    if not candidates:
        candidates = _collect_raw_candidates(file_path)
    if not candidates:
        candidates = _collect_legacy_candidates(file_path)
    if current and current.isoformat() not in candidates:
        candidates.append(current.isoformat())
    if not candidates:
        return current.isoformat() if current else ""
    expiry_date = pick_expiry_date(candidates, dob=dob, issue_date=issue_date)
    if expiry_date:
        return expiry_date
    raw_candidates = _collect_raw_candidates(file_path)
    if raw_candidates:
        expiry_date = pick_expiry_date(_unique(candidates + raw_candidates), dob=dob, issue_date=issue_date)
        if expiry_date:
            return expiry_date
    legacy_candidates = _collect_legacy_candidates(file_path)
    if legacy_candidates:
        expiry_date = pick_expiry_date(_unique(candidates + legacy_candidates), dob=dob, issue_date=issue_date)
        if expiry_date:
            return expiry_date
    return current.isoformat() if current else ""


def pick_expiry_date(candidates: list[str], dob: str = "", issue_date: str = "") -> str:
    if not candidates:
        return ""

    dob_date = _parse_iso_date(dob)
    issue = _parse_iso_date(issue_date)
    today = date.today()
    best_score = -1
    best_candidate = ""
    best_snap_penalty = 10**9

    for candidate_text in candidates:
        raw_candidate = _parse_iso_date(candidate_text)
        if raw_candidate is None:
            continue
        candidate = raw_candidate
        snap_penalty = 0
        if issue:
            candidate, snap_penalty = _snap_to_expected_expiry(candidate, issue)
        normalized_text = candidate.isoformat()

        if dob_date and candidate <= dob_date:
            continue
        if issue and candidate <= issue:
            continue
        if candidate > _years_after(today, 20):
            continue
        if candidate < today - timedelta(days=730) and not issue:
            continue

        score = 10
        if issue:
            score += 26 + _expected_expiry_score(candidate, issue)
            score -= _snap_penalty_score(snap_penalty)
        else:
            if today - timedelta(days=365) <= candidate <= _years_after(today, 15):
                score += 18
            elif candidate >= today:
                score += 10
        if dob_date:
            score += 8
        if candidate >= today:
            score += 6

        if (
            score > best_score
            or (
                score == best_score
                and (
                    snap_penalty < best_snap_penalty
                    or (snap_penalty == best_snap_penalty and normalized_text > best_candidate)
                )
            )
        ):
            best_score = score
            best_candidate = normalized_text
            best_snap_penalty = snap_penalty

    return best_candidate


def _collect_page_candidates(page: object | None) -> list[str]:
    if page is None:
        return []
    candidates: list[str] = []
    for window in FOCUSED_WINDOWS:
        region = crop_relative(page, *window)
        if region is None:
            continue
        for text in collect_ocr_lines(
            region,
            whitelist="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ ",
            variant_mode="numeric",
            max_lines=20,
        ):
            candidates.extend(_extract_dates(text))
    for window in PAGE_WINDOWS:
        region = crop_relative(page, *window)
        if region is None:
            continue
        for text in collect_ocr_lines(
            region,
            whitelist="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ ",
            variant_mode="numeric",
            max_lines=30,
        ):
            candidates.extend(_extract_dates(text))
    return _unique(candidates)


def _collect_raw_candidates(file_path: str) -> list[str]:
    candidates: list[str] = []
    for crop in build_mrz_relative_crops(file_path, RAW_WINDOWS):
        for text in collect_ocr_lines(
            crop,
            whitelist="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ ",
            variant_mode="fast",
            max_lines=20,
        ):
            candidates.extend(_extract_dates(text))
    return _unique(candidates)


def _collect_legacy_candidates(file_path: str) -> list[str]:
    if cv2 is None or pytesseract is None:
        return []
    image = cv2.imread(file_path)
    if image is None:
        return []
    height, width = image.shape[:2]
    region = image[int(height * 0.52) : int(height * 0.84), int(width * 0.56) : width]
    candidates: list[str] = []
    for text in collect_ocr_lines(
        region,
        whitelist="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ ",
        variant_mode="numeric",
        max_lines=20,
    ):
        candidates.extend(_extract_dates(text))
    return _unique(candidates)


def _extract_dates(text: str) -> list[str]:
    normalized = re.sub(r"[^A-Z0-9]", " ", text.upper())
    matches = re.findall(r"\b(\d{1,2})\s*([A-Z]{3})\s*(\d{4})\b", normalized)
    dates: list[str] = []
    for day, month_text, year in matches:
        month = MONTHS.get(month_text)
        if month is None:
            continue
        try:
            dates.append(date(int(year), month, int(day)).isoformat())
        except ValueError:
            continue
    return dates


def _snap_to_expected_expiry(candidate: date, issue: date) -> tuple[date, int]:
    for expected in _expected_expiry_dates(issue):
        if candidate.month == expected.month and candidate.day == expected.day and abs(candidate.year - expected.year) <= 2:
            return expected, abs((expected - candidate).days)
    return candidate, 0


def _expected_expiry_dates(issue: date) -> list[date]:
    return [_years_after(issue, years) for years in (5, 10)]


def _expected_expiry_score(candidate: date, issue: date) -> int:
    if candidate in _expected_expiry_dates(issue):
        return 110
    month_day_matches = [
        abs(candidate.year - expected.year)
        for expected in _expected_expiry_dates(issue)
        if candidate.month == expected.month and candidate.day == expected.day
    ]
    if month_day_matches:
        return max(40, 80 - min(month_day_matches) * 10)
    closest_gap = min(abs((expected - candidate).days) for expected in _expected_expiry_dates(issue))
    return max(-20, 30 - closest_gap // 15)


def _snap_penalty_score(days_shifted: int) -> int:
    if days_shifted <= 0:
        return 0
    return min(30, max(8, days_shifted // 90 * 2))


def _years_after(value: date, years: int) -> date:
    try:
        return value.replace(year=value.year + years)
    except ValueError:
        return value.replace(year=value.year + years, day=28)


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
        if value not in seen:
            unique_values.append(value)
            seen.add(value)
    return unique_values
