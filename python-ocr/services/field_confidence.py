from __future__ import annotations

import re
from datetime import date

from services.location_normalizer import is_known_location_value
from services.name_support import is_reasonable_name_value


def build_field_confidence(
    passport_extracted: dict[str, str],
    resolved_profile: dict[str, object],
    source_by_field: dict[str, str],
    extraction: ExtractionEvidence,
    visual_fields: dict[str, str],
) -> dict[str, object]:
    base = _clamp(float(extraction.get("confidence", 0.0) or 0.0))
    passport_confidence = _build_passport_confidence(passport_extracted, visual_fields, base, extraction)
    resolved_confidence = _build_resolved_confidence(resolved_profile, source_by_field, passport_confidence)
    return {"passportExtracted": passport_confidence, "resolvedProfile": resolved_confidence}


def empty_field_confidence() -> dict[str, object]:
    return {"passportExtracted": _empty_passport_confidence(), "resolvedProfile": _empty_resolved_confidence()}


def _build_passport_confidence(
    passport_extracted: dict[str, str],
    visual_fields: dict[str, str],
    base: float,
    extraction: ExtractionEvidence,
) -> dict[str, float]:
    visual_name = visual_fields.get("fullName", "")
    nationality_confidence = _mrz_confidence(passport_extracted.get("nationality", ""), base)
    confidence = {
        "firstName": _name_confidence(passport_extracted.get("firstName", ""), visual_name, base),
        "familyName": _name_confidence(passport_extracted.get("familyName", ""), visual_name, base),
        "passportNumber": _mrz_confidence(passport_extracted.get("passportNumber", ""), base, bonus=0.08),
        "nationality": nationality_confidence,
        "dob": _mrz_confidence(passport_extracted.get("dob", ""), base, bonus=0.06),
        "issueDate": _visual_confidence(passport_extracted.get("issueDate", ""), base),
        "expiryDate": _mrz_confidence(passport_extracted.get("expiryDate", ""), base, bonus=0.06),
        "gender": _mrz_confidence(passport_extracted.get("gender", ""), base, bonus=0.05),
        "countryOfIssued": _country_confidence(passport_extracted, nationality_confidence, base),
        "cityOfIssued": _visual_confidence(passport_extracted.get("cityOfIssued", ""), base),
        "birthCity": _visual_confidence(passport_extracted.get("birthCity", ""), base),
    }
    confidence = _apply_valid_mrz_boosts(confidence, passport_extracted, extraction)
    return _apply_mrz_checksum_caps(confidence, extraction)


def _build_resolved_confidence(
    resolved_profile: dict[str, object],
    source_by_field: dict[str, str],
    passport_confidence: dict[str, float],
) -> dict[str, object]:
    resolved: dict[str, object] = {}
    ordered_fields = (
        "firstName",
        "fatherName",
        "grandfatherName",
        "familyName",
        "passportNumber",
        "nationality",
        "previousNationality",
        "dob",
        "issueDate",
        "releaseDate",
        "expiryDate",
        "gender",
        "passportType",
        "countryOfIssued",
        "cityOfIssued",
        "birthCountry",
        "birthCity",
        "profession",
        "maritalStatus",
        "iqamaNumber",
        "iqamaExpiryDate",
        "vaccinationCertificate",
        "vaccinationCertificatePath",
        "email",
        "mobileNumber",
    )
    for field_name in ordered_fields:
        resolved[field_name] = _resolve_value_confidence(
            resolved_profile.get(field_name, ""),
            source_by_field.get(field_name, ""),
            passport_confidence,
            resolved,
        )
    if resolved_profile.get("maritalStatus"):
        resolved["maritalStatus"] = min(float(resolved.get("maritalStatus", 0.0) or 0.0), 0.45)

    arabic_profile = resolved_profile.get("arabic", {}) if isinstance(resolved_profile.get("arabic"), dict) else {}
    resolved["arabic"] = {
        "firstName": _resolve_value_confidence(
            arabic_profile.get("firstName", ""),
            source_by_field.get("arabic.firstName", ""),
            passport_confidence,
            resolved,
        ),
        "fatherName": _resolve_value_confidence(
            arabic_profile.get("fatherName", ""),
            source_by_field.get("arabic.fatherName", ""),
            passport_confidence,
            resolved,
        ),
        "grandfatherName": _resolve_value_confidence(
            arabic_profile.get("grandfatherName", ""),
            source_by_field.get("arabic.grandfatherName", ""),
            passport_confidence,
            resolved,
        ),
        "familyName": _resolve_value_confidence(
            arabic_profile.get("familyName", ""),
            source_by_field.get("arabic.familyName", ""),
            passport_confidence,
            resolved,
        ),
    }
    return resolved


def _resolve_value_confidence(
    value: object,
    source: str,
    passport_confidence: dict[str, float],
    resolved_confidence: dict[str, object],
) -> float:
    text = str(value or "")
    if source == "derived_from_passportExtracted.fullName":
        return round(max(passport_confidence.get("firstName", 0.0), passport_confidence.get("familyName", 0.0)), 2)
    if source.startswith("passportExtracted."):
        return passport_confidence.get(source.split(".", 1)[1], 0.0)
    if source.startswith("derived_from_passportExtracted."):
        return passport_confidence.get(source.rsplit(".", 1)[1], 0.0)
    if source.startswith("derived_from_resolvedProfile."):
        field_name = source.split(".", 1)[1]
        base_value = resolved_confidence.get(field_name, 0.0)
        return round(float(base_value), 2) if isinstance(base_value, (float, int)) else 0.0
    if source.startswith("default:") or source.startswith("template:"):
        return 0.0
    if source == "intentional_empty":
        return 0.0
    return 0.0 if not text else 0.6


def _name_confidence(value: str, visual_name: str, base: float) -> float:
    if not value:
        return 0.0
    score = 0.34 + (base * 0.34)
    if is_reasonable_name_value(value):
        score += 0.14
    if _supports_name(value, visual_name):
        score += 0.16
    if len(value.split()) == 1:
        score -= 0.04
    if re.search(r"(.)\1{2,}", value):
        score -= 0.18
    return _clamp(score)


def _mrz_confidence(value: str, base: float, bonus: float = 0.0) -> float:
    if not value:
        return 0.0
    score = 0.52 + (base * 0.34) + bonus
    return _clamp(score)


def _visual_confidence(value: str, base: float) -> float:
    if not value:
        return 0.0
    score = 0.48 + (base * 0.22)
    if len(re.sub(r"[^A-Z0-9]", "", value.upper())) >= 4:
        score += 0.08
    return _clamp(score)


def _country_confidence(passport_extracted: dict[str, str], nationality_confidence: float, base: float) -> float:
    country = passport_extracted.get("countryOfIssued", "")
    nationality = passport_extracted.get("nationality", "")
    if not country:
        return 0.0
    if country == nationality and nationality:
        return nationality_confidence
    return _mrz_confidence(country, base)


def _apply_mrz_checksum_caps(confidence: dict[str, float], extraction: ExtractionEvidence) -> dict[str, float]:
    failed_fields = _failed_mrz_checksum_fields(extraction)
    for field_name in failed_fields:
        if field_name in confidence:
            confidence[field_name] = min(confidence[field_name], 0.6)
    return confidence


def _apply_valid_mrz_boosts(
    confidence: dict[str, float],
    passport_extracted: dict[str, str],
    extraction: ExtractionEvidence,
) -> dict[str, float]:
    validation = extraction.get("mrzValidation", {}) if extraction else {}
    if not isinstance(validation, dict) or validation.get("valid") is not True:
        return confidence
    boosted = dict(confidence)
    for field_name in ("firstName", "familyName", "passportNumber", "nationality", "dob", "expiryDate", "gender", "countryOfIssued"):
        if passport_extracted.get(field_name):
            boosted[field_name] = max(boosted.get(field_name, 0.0), 0.82)
    if _is_iso_date(passport_extracted.get("issueDate", "")):
        boosted["issueDate"] = max(boosted.get("issueDate", 0.0), 0.78)
    if is_known_location_value("issuingOffice", passport_extracted.get("cityOfIssued", "")):
        boosted["cityOfIssued"] = max(boosted.get("cityOfIssued", 0.0), 0.78)
    if is_known_location_value("placeOfBirth", passport_extracted.get("birthCity", "")):
        boosted["birthCity"] = max(boosted.get("birthCity", 0.0), 0.78)
    return boosted


def _failed_mrz_checksum_fields(extraction: ExtractionEvidence) -> set[str]:
    validation = extraction.get("mrzValidation", {}) if extraction else {}
    checks = validation.get("checks", []) if isinstance(validation, dict) else []
    if not isinstance(checks, list):
        return set()
    mapping = {
        "passportNumber": "passportNumber",
        "dob": "dob",
        "expiryDate": "expiryDate",
    }
    failed: set[str] = set()
    for check in checks:
        if not isinstance(check, dict) or check.get("valid") is True:
            continue
        field_name = mapping.get(str(check.get("fieldName", "") or ""))
        if field_name:
            failed.add(field_name)
    return failed


def _supports_name(value: str, visual_name: str) -> bool:
    if not visual_name or not is_reasonable_name_value(visual_name):
        return False
    return re.sub(r"[^A-Z]", "", value.upper()) in re.sub(r"[^A-Z]", "", visual_name.upper())


def _is_iso_date(value: str) -> bool:
    try:
        date.fromisoformat(str(value or ""))
        return True
    except ValueError:
        return False


def _empty_passport_confidence() -> dict[str, float]:
    return {
        "firstName": 0.0,
        "familyName": 0.0,
        "passportNumber": 0.0,
        "nationality": 0.0,
        "dob": 0.0,
        "issueDate": 0.0,
        "expiryDate": 0.0,
        "gender": 0.0,
        "countryOfIssued": 0.0,
        "cityOfIssued": 0.0,
        "birthCity": 0.0,
    }


def _empty_resolved_confidence() -> dict[str, object]:
    return {
        "firstName": 0.0,
        "fatherName": 1.0,
        "grandfatherName": 1.0,
        "familyName": 0.0,
        "passportNumber": 0.0,
        "nationality": 0.0,
        "previousNationality": 1.0,
        "dob": 0.0,
        "issueDate": 0.0,
        "releaseDate": 0.0,
        "expiryDate": 0.0,
        "gender": 0.0,
        "passportType": 1.0,
        "countryOfIssued": 0.0,
        "cityOfIssued": 0.0,
        "birthCountry": 0.0,
        "birthCity": 0.0,
        "profession": 1.0,
        "maritalStatus": 0.0,
        "iqamaNumber": 1.0,
        "iqamaExpiryDate": 1.0,
        "vaccinationCertificate": 1.0,
        "vaccinationCertificatePath": 1.0,
        "email": 1.0,
        "mobileNumber": 1.0,
        "arabic": {"firstName": 0.0, "fatherName": 1.0, "grandfatherName": 1.0, "familyName": 0.0},
    }


def _clamp(value: float) -> float:
    return round(min(max(value, 0.0), 1.0), 2)
