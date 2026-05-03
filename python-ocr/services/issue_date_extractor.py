from __future__ import annotations

import re
from datetime import date

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
RAW_WINDOWS = ((8.0, 1.2, 0.35, 0.35), (7.0, 1.0, 0.35, 0.45))
PAGE_WINDOWS = (
    (0.46, 0.76, 0.06, 0.94),
    (0.54, 0.72, 0.06, 0.94),
    (0.54, 0.76, 0.18, 0.58),
    (0.50, 0.80, 0.10, 0.70),
)
FOCUSED_WINDOWS = (
    (0.64, 0.72, 0.34, 0.56),
    (0.62, 0.71, 0.32, 0.57),
    (0.60, 0.76, 0.28, 0.56),
    (0.58, 0.72, 0.22, 0.50),
)


def extract_issue_date(
    file_path: str,
    dob: str = "",
    expiry_date: str = "",
    page: object | None = None,
    current_value: str = "",
) -> str:
    current = _parse_iso_date(current_value)
    if not dob and not expiry_date:
        return current.isoformat() if current else ""
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
        return infer_issue_date(dob, expiry_date)
    issue_date = pick_issue_date(candidates, dob, expiry_date)
    if issue_date:
        return issue_date
    raw_candidates = _collect_raw_candidates(file_path)
    if raw_candidates:
        issue_date = pick_issue_date(_unique(candidates + raw_candidates), dob, expiry_date)
        if issue_date:
            return issue_date
    legacy_candidates = _collect_legacy_candidates(file_path)
    if legacy_candidates:
        issue_date = pick_issue_date(_unique(candidates + legacy_candidates), dob, expiry_date)
        if issue_date:
            return issue_date
    return current.isoformat() if current else infer_issue_date(dob, expiry_date)


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
            psm_values=(7,),
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
            psm_values=(6, 7),
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
            psm_values=(6,),
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

    height = image.shape[0]
    regions = (
        image[int(height * 0.56) : int(height * 0.84), :],
    )
    candidates: list[str] = []
    for region in regions:
        for text in collect_ocr_lines(
            region,
            psm_values=(6,),
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


def pick_issue_date(candidates: list[str], dob: str, expiry_date: str) -> str:
    if not candidates:
        return ""

    dob_date = _parse_iso_date(dob)
    expiry = _parse_iso_date(expiry_date)
    best_score = -1
    best_candidate = ""

    for candidate_text in candidates:
        candidate = _parse_iso_date(candidate_text)
        if candidate is None:
            continue
        if expiry:
            candidate = _snap_to_expected_issue(candidate, expiry)
        normalized_text = candidate.isoformat()
        if dob_date and candidate <= dob_date:
            continue
        if expiry and candidate >= expiry:
            continue
        if candidate > date.today():
            continue

        score = 10
        if dob_date:
            score += 16
        if expiry:
            score += 20 + _expected_issue_score(candidate, expiry)
        if candidate.year >= date.today().year - 20:
            score += 6

        if score > best_score or (score == best_score and normalized_text > best_candidate):
            best_score = score
            best_candidate = normalized_text

    return best_candidate


def pick_expiry_date(candidates: list[str]) -> str:
    today = date.today()
    parsed = [candidate for candidate in (_parse_iso_date(value) for value in candidates) if candidate]
    future = [candidate for candidate in parsed if candidate >= today.replace(year=today.year - 1)]
    best = max(future or parsed, default=None)
    return best.isoformat() if best else ""


def infer_issue_date(dob: str, expiry_date: str) -> str:
    dob_date = _parse_iso_date(dob)
    expiry = _parse_iso_date(expiry_date)
    if expiry is None:
        return ""
    expected = [expected.isoformat() for expected in _expected_issue_dates(expiry)]
    issue = pick_issue_date(expected, dob, expiry_date)
    if issue:
        return issue
    fallback = max((candidate for candidate in _expected_issue_dates(expiry) if candidate <= date.today()), default=None)
    if fallback is None or (dob_date and fallback <= dob_date):
        return ""
    return fallback.isoformat()


def _snap_to_expected_issue(candidate: date, expiry: date) -> date:
    for expected in _expected_issue_dates(expiry):
        if candidate.month == expected.month and candidate.day == expected.day and abs(candidate.year - expected.year) <= 2:
            return expected
    return candidate


def _expected_issue_dates(expiry: date) -> list[date]:
    return [_years_before(expiry, years) for years in (5, 10)]


def _expected_issue_score(candidate: date, expiry: date) -> int:
    exact = {expected: 110 if index == 0 else 100 for index, expected in enumerate(_expected_issue_dates(expiry))}
    if candidate in exact:
        return exact[candidate]
    month_day_matches = [
        abs(candidate.year - expected.year)
        for expected in _expected_issue_dates(expiry)
        if candidate.month == expected.month and candidate.day == expected.day
    ]
    if month_day_matches:
        return max(40, 80 - min(month_day_matches) * 10)
    closest_gap = min(abs((expected - candidate).days) for expected in _expected_issue_dates(expiry))
    return max(-20, 30 - closest_gap // 15)


def _years_before(value: date, years: int) -> date:
    try:
        return value.replace(year=value.year - years)
    except ValueError:
        return value.replace(year=value.year - years, day=28)


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
