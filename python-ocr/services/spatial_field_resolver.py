from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher

from services.location_normalizer import is_known_location_value, pick_best_location_value
from services.ocr_observation import OcrObservation, normalize_ocr_text
from services.passport_ocr_index import PassportOcrIndex


LOCATION_FIELDS = ("placeOfBirth", "issuingOffice")
_LABEL_PATTERNS = {
    "placeOfBirth": (
        re.compile(r"TEMPAT\s*LAHIR"),
        re.compile(r"PLACE\s*OF\s*BIRTH"),
    ),
    "issuingOffice": (
        re.compile(r"ISSUING\s*OFFICE"),
        re.compile(r"[KR]ANTOR\s*YANG\s*MENGELUARKAN[GT]?"),
        re.compile(r"MENGELUARKAN"),
    ),
}
_ANY_LABEL_FRAGMENTS = (
    "DATEOFBIRTH",
    "DATEOFEXPIRY",
    "DATEOFISSUE",
    "ISSUINGOFFICE",
    "KANTORYANGMENGELUARKAN",
    "PLACEOFBIRTH",
    "TEMPATLAHIR",
    "TGLLAHIR",
    "TGLHABISBERLAKU",
    "TGLPENGELUARAN",
)
_COMPACT_LABELS = {
    "placeOfBirth": ("TEMPATLAHIR", "TEMPATLAHIRPLACEOFBIRTH", "PLACEOFBIRTH"),
    "issuingOffice": ("ISSUINGOFFICE", "KANTORYANGMENGELUARKAN"),
}


@dataclass(frozen=True)
class SpatialFieldResolution:
    field_name: str
    value: str
    confidence: float
    source: str
    reason: str
    label_found: bool


def resolve_location_fields(
    index: PassportOcrIndex,
    field_names: tuple[str, ...] = LOCATION_FIELDS,
) -> dict[str, SpatialFieldResolution]:
    results: dict[str, SpatialFieldResolution] = {}
    for field_name in field_names:
        if field_name not in LOCATION_FIELDS:
            continue
        results[field_name] = _resolve_location_field(index, field_name)
    return results


def resolved_location_values(
    index: PassportOcrIndex,
    field_names: tuple[str, ...] = LOCATION_FIELDS,
) -> dict[str, str]:
    return {
        field_name: result.value
        for field_name, result in resolve_location_fields(index, field_names).items()
        if result.value
    }


def location_recovery_windows(index: PassportOcrIndex, field_name: str) -> tuple[tuple[float, float, float, float], ...]:
    anchors = [item for item in index.observations if _is_field_label(field_name, item.normalized_text)]
    if not anchors:
        return ()
    anchor = max(anchors, key=lambda item: item.center_y)
    # The English label is often narrower and right-aligned while its value
    # spans the full column (for example ISSUING OFFICE -> TANJUNG REDEB).
    left = max(0.0, _left(anchor) - max(0.08, anchor.width * 1.35))
    right = min(1.0, _right(anchor) + 0.08)
    top = min(1.0, _bottom(anchor) + 0.002)
    bottom = min(1.0, top + max(0.032, anchor.height * 2.4))
    if bottom <= top or right <= left:
        return ()
    return ((top, bottom, left, right),)


def _resolve_location_field(index: PassportOcrIndex, field_name: str) -> SpatialFieldResolution:
    anchors = [item for item in index.observations if _is_field_label(field_name, item.normalized_text)]
    if not anchors:
        if field_name == "issuingOffice":
            recovered = _office_below_expiry_pair(index)
            if recovered:
                return recovered
        return SpatialFieldResolution(field_name, "", 0.0, "SPATIAL_FULL_PAGE", "LABEL_NOT_FOUND", False)

    scored: list[tuple[float, str, float]] = []
    for anchor in anchors:
        inline_value = _inline_label_value(field_name, anchor.normalized_text)
        if inline_value and anchor.confidence >= 0.85:
            value = _normalize_candidate(field_name, inline_value, anchor.confidence)
            if value:
                scored.append((150.0 + anchor.confidence * 10.0, value, anchor.confidence))

        for position, item in enumerate(index.below(anchor)):
            if _looks_like_any_label(item.normalized_text):
                continue
            value = _normalize_candidate(field_name, item.normalized_text, item.confidence)
            if not value:
                continue
            vertical_distance = max(0.0, item.center_y - anchor.center_y)
            horizontal_distance = abs(item.center_x - anchor.center_x)
            score = 120.0
            score += item.confidence * 20.0
            score -= vertical_distance * 500.0
            score -= horizontal_distance * 80.0
            score -= position * 3.0
            if is_known_location_value(field_name, value):
                score += 35.0
            scored.append((score, value, item.confidence))

    if not scored:
        return SpatialFieldResolution(
            field_name,
            "",
            0.0,
            "SPATIAL_FULL_PAGE",
            "VALUE_NOT_FOUND_NEAR_LABEL",
            True,
        )
    _, value, confidence = max(scored, key=lambda item: (item[0], item[2], item[1]))
    return SpatialFieldResolution(field_name, value, confidence, "SPATIAL_FULL_PAGE", "VALID_NEAR_LABEL", True)


def _office_below_expiry_pair(index: PassportOcrIndex) -> SpatialFieldResolution | None:
    """Recover a faint office label from a corroborated Indonesian date row."""
    from datetime import date
    months = {name: number for number, name in enumerate(
        ("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"), 1)}
    mrz_rows = [item.center_y for item in index.observations
        if item.text.upper().startswith("P<IDN") and item.text.count("<") >= 5]
    if not mrz_rows or not any(item.text.upper() == "INDONESIA" for item in index.observations):
        return None
    dates = []
    for item in index.observations:
        match = re.fullmatch(r"(\d{1,2})\s*([A-Z]{3})\s*(\d{4})", item.text.upper().strip())
        if not match or match[2] not in months or item.confidence < 0.90:
            continue
        try:
            dates.append((item, date(int(match[3]), months[match[2]], int(match[1]))))
        except ValueError:
            continue
    candidates = []
    for issue, issue_date in dates:
        for expiry, expiry_date in dates:
            if (expiry.center_x - issue.center_x < 0.20
                    or abs(expiry.center_y - issue.center_y) > 0.03
                    or expiry_date.year - issue_date.year not in {5, 10}
                    or (expiry_date.month, expiry_date.day) != (issue_date.month, issue_date.day)):
                continue
            for item in index.observations:
                if (not 0.035 <= item.center_y - expiry.center_y <= 0.18
                        or item.center_y >= min(mrz_rows) - 0.02
                        or abs(item.center_x - expiry.center_x) > 0.14
                        or item.confidence < 0.90):
                    continue
                value = _normalize_candidate("issuingOffice", item.text, item.confidence)
                if value:
                    candidates.append((value, item.confidence))
    values = {value for value, _ in candidates}
    if len(values) != 1:
        return None
    value = next(iter(values))
    return SpatialFieldResolution("issuingOffice", value, min(conf for _, conf in candidates),
        "SPATIAL_DATE_ROW", "VALUE_BELOW_EXPIRY_PAIR", False)


def _normalize_candidate(field_name: str, text: str, confidence: float = 0.0) -> str:
    cleaned = normalize_ocr_text(text).upper()
    cleaned = re.sub(r"[^A-Z0-9\s-]", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if (not cleaned or _looks_like_any_label(cleaned)
            or re.fullmatch(r"\d{1,2}\s*[A-Z]{3}\s*\d{2,4}", cleaned)):
        return ""
    preserve_unlisted = confidence >= 0.90 and bool(re.fullmatch(r"[A-Z]+(?: [A-Z]+)*", cleaned))
    return pick_best_location_value(field_name, [cleaned], preserve_unlisted=preserve_unlisted)


def _is_field_label(field_name: str, text: str) -> bool:
    normalized = _label_text(text)
    if any(pattern.search(normalized) for pattern in _LABEL_PATTERNS.get(field_name, ())):
        return True

    compact = re.sub(r"[^A-Z]", "", normalized)
    if field_name == "placeOfBirth":
        # DATE OF BIRTH is adjacent to PLACE OF BIRTH and differs by only
        # two letters, so fuzzy matching must retain a place-specific token.
        if ("DATEOF" in compact or "TGLLAH" in compact or "OATEOF" in compact) and "PLACE" not in compact and "TEMPAT" not in compact:
            return False
        if "PLACE" in compact and ("BIRTH" in compact or "LAH" in compact):
            return True
    if field_name == "issuingOffice":
        if compact == "KANTOR":
            return True
        if compact.startswith("ISSU") and compact.endswith("OFFICE"):
            return True

    return any(_approximately_contains(compact, marker) for marker in _COMPACT_LABELS.get(field_name, ()))


def _inline_label_value(field_name: str, text: str) -> str:
    normalized = _label_text(text)
    marker_end = -1
    for pattern in _LABEL_PATTERNS.get(field_name, ()):
        for match in pattern.finditer(normalized):
            marker_end = max(marker_end, match.end())
    if marker_end < 0:
        return _compact_inline_label_value(field_name, normalized)
    return normalized[marker_end:].strip(" /:-")


def _compact_inline_label_value(field_name: str, text: str) -> str:
    """Recover a value glued to an OCR-damaged bilingual field label."""
    compact = re.sub(r"[^A-Z]", "", text)
    candidates: list[tuple[float, int, str]] = []
    for marker in sorted(_COMPACT_LABELS.get(field_name, ()), key=len, reverse=True):
        exact_start = compact.find(marker)
        if exact_start >= 0:
            return compact[exact_start + len(marker) :]

        for prefix_length in range(max(7, len(marker) - 4), min(len(compact), len(marker) + 4) + 1):
            prefix = compact[:prefix_length]
            similarity = SequenceMatcher(None, prefix, marker).ratio()
            if similarity >= 0.78:
                candidates.append((similarity, prefix_length, compact[prefix_length:]))
    # Consume the complete label when that is the strongest match. Taking the
    # first plausible prefix turns damaged label endings into invented cities.
    return max(candidates)[2] if candidates else ""


def _looks_like_any_label(text: str) -> bool:
    compact = re.sub(r"[^A-Z]", "", normalize_ocr_text(text).upper())
    return any(fragment in compact for fragment in _ANY_LABEL_FRAGMENTS) or any(
        _is_field_label(field_name, text) for field_name in LOCATION_FIELDS
    )


def _label_text(text: str) -> str:
    normalized = normalize_ocr_text(text).upper().replace("/", " ").replace("-", " ")
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z\s]", "", normalized)).strip()


def _approximately_contains(value: str, marker: str, minimum_ratio: float = 0.72) -> bool:
    """Match OCR-damaged labels while rejecting short, unrelated field values."""
    if len(value) < max(7, int(len(marker) * 0.55)):
        return False
    if marker in value:
        return True
    lengths = range(max(7, len(marker) - 4), min(len(value), len(marker) + 4) + 1)
    return any(
        SequenceMatcher(None, value[start : start + length], marker).ratio() >= minimum_ratio
        for length in lengths
        for start in range(0, len(value) - length + 1)
    )


def _left(item: OcrObservation) -> float:
    return min((point[0] for point in item.normalized_box), default=0.0)


def _right(item: OcrObservation) -> float:
    return max((point[0] for point in item.normalized_box), default=0.0)


def _bottom(item: OcrObservation) -> float:
    return max((point[1] for point in item.normalized_box), default=0.0)
