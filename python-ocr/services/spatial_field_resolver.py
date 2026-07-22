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
    "placeOfBirth": ("TEMPATLAHIR", "TEMPATLAHIRPLACEOFBIRTH"),
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
        return SpatialFieldResolution(field_name, "", 0.0, "SPATIAL_FULL_PAGE", "LABEL_NOT_FOUND", False)

    scored: list[tuple[float, str, float]] = []
    for anchor in anchors:
        inline_value = _inline_label_value(field_name, anchor.normalized_text)
        if inline_value:
            value = _normalize_candidate(field_name, inline_value)
            if value:
                scored.append((150.0 + anchor.confidence * 10.0, value, anchor.confidence))

        for position, item in enumerate(index.below(anchor)):
            if _looks_like_any_label(item.normalized_text):
                continue
            value = _normalize_candidate(field_name, item.normalized_text)
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


def _normalize_candidate(field_name: str, text: str) -> str:
    cleaned = normalize_ocr_text(text).upper()
    cleaned = re.sub(r"[^A-Z0-9\s-]", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if not cleaned or _looks_like_any_label(cleaned):
        return ""
    return pick_best_location_value(field_name, [cleaned])


def _is_field_label(field_name: str, text: str) -> bool:
    normalized = _label_text(text)
    if any(pattern.search(normalized) for pattern in _LABEL_PATTERNS.get(field_name, ())):
        return True

    compact = re.sub(r"[^A-Z]", "", normalized)
    if field_name == "placeOfBirth":
        # DATE OF BIRTH is adjacent to PLACE OF BIRTH and differs by only
        # two letters, so fuzzy matching must retain a place-specific token.
        if "DATEOF" in compact and "PLACE" not in compact and "TEMPAT" not in compact:
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
        return ""
    return normalized[marker_end:].strip(" /:-")


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
