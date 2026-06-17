from __future__ import annotations

from typing import Any


PASSPORT_FIELDS = (
    "firstName",
    "familyName",
    "passportNumber",
    "nationality",
    "dob",
    "issueDate",
    "expiryDate",
    "gender",
    "countryOfIssued",
    "cityOfIssued",
    "birthCity",
)


def build_field_evidence(
    passport_extracted: dict[str, str],
    resolved_profile: dict[str, object],
    source_by_field: dict[str, str],
    field_confidence: dict[str, object],
    extraction: ExtractionEvidence,
    visual_fields: dict[str, str],
    review_flags: dict[str, object],
) -> dict[str, object]:
    passport_confidence = field_confidence.get("passportExtracted", {})
    passport_confidence = passport_confidence if isinstance(passport_confidence, dict) else {}
    resolved_confidence = field_confidence.get("resolvedProfile", {})
    resolved_confidence = resolved_confidence if isinstance(resolved_confidence, dict) else {}
    passport_flags = review_flags.get("passportExtracted", {})
    passport_flags = passport_flags if isinstance(passport_flags, dict) else {}
    resolved_flags = review_flags.get("resolvedProfile", {})
    resolved_flags = resolved_flags if isinstance(resolved_flags, dict) else {}

    return {
        "passportExtracted": {
            field_name: _evidence(
                field_name,
                passport_extracted.get(field_name, ""),
                _passport_source(field_name, passport_extracted, visual_fields),
                _raw_text_for_field(field_name, extraction, visual_fields),
                passport_confidence.get(field_name, 0.0),
                passport_flags.get(field_name, []),
            )
            for field_name in PASSPORT_FIELDS
        },
        "resolvedProfile": {
            field_name: _evidence(
                field_name,
                resolved_profile.get(field_name, ""),
                source_by_field.get(field_name, "intentional_empty"),
                "",
                resolved_confidence.get(field_name, 0.0),
                resolved_flags.get(field_name, []),
            )
            for field_name in resolved_profile
            if field_name != "arabic"
        },
    }


def empty_field_evidence() -> dict[str, object]:
    return {
        "passportExtracted": {
            field_name: _evidence(field_name, "", "intentional_empty", "", 0.0, ["MISSING_VALUE"])
            for field_name in PASSPORT_FIELDS
        },
        "resolvedProfile": {},
    }


def _evidence(
    field_name: str,
    value: object,
    source: str,
    raw_text: str,
    confidence: object,
    flags: object,
) -> dict[str, object]:
    notes = _list_values(flags)
    text = str(value or "")
    return {
        "fieldName": field_name,
        "value": text,
        "source": str(source or "intentional_empty"),
        "rawText": str(raw_text or ""),
        "confidence": _as_float(confidence),
        "validationStatus": _validation_status(text, notes),
        "notes": notes,
    }


def _passport_source(field_name: str, values: dict[str, str], visual_fields: dict[str, str]) -> str:
    if not values.get(field_name):
        return "intentional_empty"
    if field_name == "birthCity" and visual_fields.get("placeOfBirth"):
        return "visual_field_ocr.placeOfBirth"
    if field_name == "cityOfIssued" and visual_fields.get("issuingOffice"):
        return "visual_field_ocr.issuingOffice"
    if field_name in {"firstName", "familyName"} and visual_fields.get("fullName"):
        return "visual_field_ocr.fullName"
    if field_name in {"passportNumber", "nationality", "dob", "expiryDate", "gender", "countryOfIssued"}:
        return "mrz"
    if field_name == "issueDate":
        return "date_recovery_or_visual"
    return f"passportExtracted.{field_name}"


def _raw_text_for_field(field_name: str, extraction: ExtractionEvidence, visual_fields: dict[str, str]) -> str:
    if field_name == "birthCity":
        return visual_fields.get("placeOfBirth", "")
    if field_name == "cityOfIssued":
        return visual_fields.get("issuingOffice", "")
    if field_name in {"firstName", "familyName"} and visual_fields.get("fullName"):
        return visual_fields.get("fullName", "")
    data = extraction.get("data", {}) if extraction else {}
    if not isinstance(data, dict):
        return ""
    if field_name in {"firstName", "familyName"}:
        return str(data.get("line1") or _first_line(data))
    if field_name in {"passportNumber", "nationality", "dob", "expiryDate", "gender", "countryOfIssued"}:
        return str(data.get("line2") or _last_line(data))
    return ""


def _first_line(data: dict[str, Any]) -> str:
    lines = _all_text_lines(data)
    return lines[0] if lines else ""


def _last_line(data: dict[str, Any]) -> str:
    lines = _all_text_lines(data)
    return lines[-1] if lines else ""


def _all_text_lines(data: dict[str, Any]) -> list[str]:
    for key in ("raw_text", "mrz_text", "text"):
        value = data.get(key)
        if value:
            return [line.strip() for line in str(value).splitlines() if line.strip()]
    return []


def _validation_status(value: str, notes: list[str]) -> str:
    if not value:
        return "MISSING"
    if any(note in {"MRZ_CHECKSUM_FAILED", "DATE_ORDER_SUSPICIOUS"} for note in notes):
        return "REVIEW"
    if "LOW_CONFIDENCE" in notes:
        return "LOW_CONFIDENCE"
    return "OK"


def _list_values(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item)]


def _as_float(value: object) -> float:
    try:
        return round(float(value or 0.0), 2)
    except (TypeError, ValueError):
        return 0.0
