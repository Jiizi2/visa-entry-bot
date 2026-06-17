from __future__ import annotations

import os
import uuid

from services.confidence_levels import build_confidence_levels, empty_confidence_levels
from services.field_confidence import build_field_confidence, empty_field_confidence
from services.field_evidence import build_field_evidence, empty_field_evidence
from services.parser import clean_country
from services.resolved_name_rules import build_resolved_name_fields
from services.review_flags import build_review_flags, empty_review_flags
from services.transliterator import transliterate_name

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EMAIL_TEMPLATE = "huseinghanim@gmail.com"
MOBILE_TEMPLATE = "+6282137434147"
DEFAULT_PROFESSION = "OTHER"
DEFAULT_MARITAL_STATUS = "OTHER"
DEFAULT_PASSPORT_TYPE = "NORMAL"


def build_error_record(file_name: str, file_path: str, message: str) -> dict[str, object]:
    record = _base_record(file_name, file_path)
    passport_extracted = _empty_passport_extracted()
    resolved_profile = _empty_resolved_profile()
    source_by_field = _empty_source_by_field()
    field_confidence = empty_field_confidence()
    record.update(
        {
            "passportExtracted": passport_extracted,
            "resolvedProfile": resolved_profile,
            "sourceByField": source_by_field,
            "fieldConfidence": field_confidence,
            "fieldEvidence": empty_field_evidence(),
            "mrzValidation": _empty_mrz_validation(),
            "confidenceLevel": build_confidence_levels(0.0, field_confidence),
            "reviewFlags": build_review_flags(
                passport_extracted,
                resolved_profile,
                source_by_field,
                field_confidence,
                "ERROR",
                message.strip(),
            ),
            "requiresReview": True,
            "reviewReasons": ["RECORD_ERROR"],
            "reviewStatus": "ERROR",
            "status": "ERROR",
            "confidence": 0.0,
            "notes": message.strip(),
        }
    )
    return record


def build_member_record(
    file_name: str,
    file_path: str,
    parsed: ParsedPassportData,
    visual_fields: dict[str, str],
    extraction: ExtractionEvidence,
    status: str,
    confidence: float,
    notes: str,
) -> dict[str, object]:
    record = _base_record(file_name, file_path)
    passport_extracted = _build_passport_extracted(parsed, visual_fields, extraction)
    resolved_profile = _build_resolved_profile(passport_extracted)
    source_by_field = _build_source_by_field(passport_extracted, resolved_profile)
    field_confidence = build_field_confidence(passport_extracted, resolved_profile, source_by_field, extraction, visual_fields)
    confidence_levels = build_confidence_levels(confidence, field_confidence)
    mrz_validation = _build_mrz_validation(extraction)
    review_flags = build_review_flags(
        passport_extracted,
        resolved_profile,
        source_by_field,
        field_confidence,
        status,
        notes,
        mrz_validation,
    )
    review_reasons = _record_review_reasons(review_flags)
    field_evidence = build_field_evidence(
        passport_extracted,
        resolved_profile,
        source_by_field,
        field_confidence,
        extraction,
        visual_fields,
        review_flags,
    )
    record.update(
        {
            "passportExtracted": passport_extracted,
            "resolvedProfile": resolved_profile,
            "sourceByField": source_by_field,
            "fieldConfidence": field_confidence,
            "fieldEvidence": field_evidence,
            "mrzValidation": mrz_validation,
            "confidenceLevel": confidence_levels,
            "reviewFlags": review_flags,
            "requiresReview": bool(review_reasons),
            "reviewReasons": review_reasons,
            "reviewStatus": _review_status(status, review_reasons),
            "status": status,
            "confidence": confidence,
            "notes": notes,
        }
    )
    return record


def _base_record(file_name: str, file_path: str) -> dict[str, object]:
    return {
        "id": str(uuid.uuid4()),
        "fileName": file_name,
        "passportImagePath": _relative_path(file_path),
        "passportExtracted": _empty_passport_extracted(),
        "resolvedProfile": _empty_resolved_profile(),
        "sourceByField": _empty_source_by_field(),
        "fieldConfidence": empty_field_confidence(),
        "fieldEvidence": empty_field_evidence(),
        "mrzValidation": _empty_mrz_validation(),
        "confidenceLevel": empty_confidence_levels(),
        "reviewFlags": empty_review_flags(),
        "requiresReview": False,
        "reviewReasons": [],
        "reviewStatus": "ERROR",
        "status": "ERROR",
        "confidence": 0.0,
        "notes": "",
        "submitted": False,
    }


def _build_passport_extracted(
    parsed: ParsedPassportData,
    visual_fields: dict[str, str],
    extraction: ExtractionEvidence,
) -> ParsedPassportData:
    nationality = parsed.nationality
    return {
        "firstName": parsed.firstName,
        "familyName": parsed.familyName,
        "passportNumber": parsed.passportNumber,
        "nationality": nationality,
        "dob": parsed.dob,
        "issueDate": parsed.issueDate,
        "expiryDate": parsed.expiryDate,
        "gender": parsed.gender,
        "countryOfIssued": _country_of_issued(nationality, extraction),
        "cityOfIssued": visual_fields.get("issuingOffice", ""),
        "birthCity": visual_fields.get("placeOfBirth", ""),
    }


def _build_resolved_profile(passport_extracted: dict[str, str]) -> dict[str, object]:
    resolved_names = build_resolved_name_fields(passport_extracted)
    nationality = passport_extracted.get("nationality", "")
    country_of_issued = passport_extracted.get("countryOfIssued", "") or nationality
    issue_date = passport_extracted.get("issueDate", "")
    return {
        "firstName": resolved_names["firstName"],
        "fatherName": resolved_names["fatherName"],
        "grandfatherName": resolved_names["grandfatherName"],
        "familyName": resolved_names["familyName"],
        "passportNumber": passport_extracted.get("passportNumber", ""),
        "nationality": nationality,
        "previousNationality": "",
        "dob": passport_extracted.get("dob", ""),
        "issueDate": issue_date,
        "releaseDate": issue_date,
        "expiryDate": passport_extracted.get("expiryDate", ""),
        "gender": passport_extracted.get("gender", ""),
        "passportType": DEFAULT_PASSPORT_TYPE,
        "countryOfIssued": country_of_issued,
        "cityOfIssued": passport_extracted.get("cityOfIssued", ""),
        "birthCountry": nationality or country_of_issued,
        "birthCity": passport_extracted.get("birthCity", ""),
        "profession": DEFAULT_PROFESSION,
        "maritalStatus": DEFAULT_MARITAL_STATUS,
        "iqamaNumber": "",
        "iqamaExpiryDate": "",
        "vaccinationCertificate": "",
        "vaccinationCertificatePath": "",
        "email": EMAIL_TEMPLATE,
        "mobileNumber": MOBILE_TEMPLATE,
        "arabic": {
            "firstName": transliterate_name(str(resolved_names["firstName"])),
            "fatherName": transliterate_name(str(resolved_names["fatherName"])),
            "grandfatherName": transliterate_name(str(resolved_names["grandfatherName"])),
            "familyName": transliterate_name(str(resolved_names["familyName"])),
        },
    }


def _build_source_by_field(
    passport_extracted: dict[str, str],
    resolved_profile: dict[str, object],
) -> ParsedPassportData:
    resolved_name_sources = build_resolved_name_fields(passport_extracted).get("sources", {})
    return {
        "firstName": str(resolved_name_sources.get("firstName", "intentional_empty")),
        "fatherName": str(resolved_name_sources.get("fatherName", "intentional_empty")),
        "grandfatherName": str(resolved_name_sources.get("grandfatherName", "intentional_empty")),
        "familyName": str(resolved_name_sources.get("familyName", "intentional_empty")),
        "passportNumber": _passport_source(passport_extracted, "passportNumber"),
        "nationality": _passport_source(passport_extracted, "nationality"),
        "previousNationality": "intentional_empty",
        "dob": _passport_source(passport_extracted, "dob"),
        "issueDate": _passport_source(passport_extracted, "issueDate"),
        "releaseDate": _linked_source(passport_extracted, "issueDate"),
        "expiryDate": _passport_source(passport_extracted, "expiryDate"),
        "gender": _passport_source(passport_extracted, "gender"),
        "passportType": f"default:{DEFAULT_PASSPORT_TYPE}",
        "countryOfIssued": _country_source(passport_extracted),
        "cityOfIssued": _passport_source(passport_extracted, "cityOfIssued"),
        "birthCountry": _birth_country_source(resolved_profile),
        "birthCity": _passport_source(passport_extracted, "birthCity"),
        "profession": f"default:{DEFAULT_PROFESSION}",
        "maritalStatus": f"default:{DEFAULT_MARITAL_STATUS}",
        "iqamaNumber": "intentional_empty",
        "iqamaExpiryDate": "intentional_empty",
        "vaccinationCertificate": "intentional_empty",
        "vaccinationCertificatePath": "intentional_empty",
        "email": f"template:{EMAIL_TEMPLATE}",
        "mobileNumber": f"template:{MOBILE_TEMPLATE}",
        "arabic.firstName": _derived_source(resolved_profile.get("arabic", {}), "firstName", "resolvedProfile.firstName"),
        "arabic.fatherName": _derived_source(resolved_profile.get("arabic", {}), "fatherName", "resolvedProfile.fatherName"),
        "arabic.grandfatherName": _derived_source(resolved_profile.get("arabic", {}), "grandfatherName", "resolvedProfile.grandfatherName"),
        "arabic.familyName": _derived_source(resolved_profile.get("arabic", {}), "familyName", "resolvedProfile.familyName"),
    }


def _empty_passport_extracted() -> ParsedPassportData:
    return {
        "firstName": "",
        "familyName": "",
        "passportNumber": "",
        "nationality": "",
        "dob": "",
        "issueDate": "",
        "expiryDate": "",
        "gender": "",
        "countryOfIssued": "",
        "cityOfIssued": "",
        "birthCity": "",
    }


def _empty_resolved_profile() -> dict[str, object]:
    return {
        "firstName": "",
        "fatherName": "",
        "grandfatherName": "",
        "familyName": "",
        "passportNumber": "",
        "nationality": "",
        "previousNationality": "",
        "dob": "",
        "issueDate": "",
        "releaseDate": "",
        "expiryDate": "",
        "gender": "",
        "passportType": DEFAULT_PASSPORT_TYPE,
        "countryOfIssued": "",
        "cityOfIssued": "",
        "birthCountry": "",
        "birthCity": "",
        "profession": DEFAULT_PROFESSION,
        "maritalStatus": DEFAULT_MARITAL_STATUS,
        "iqamaNumber": "",
        "iqamaExpiryDate": "",
        "vaccinationCertificate": "",
        "vaccinationCertificatePath": "",
        "email": EMAIL_TEMPLATE,
        "mobileNumber": MOBILE_TEMPLATE,
        "arabic": {"firstName": "", "fatherName": "", "grandfatherName": "", "familyName": ""},
    }


def _empty_source_by_field() -> ParsedPassportData:
    return {
        "firstName": "intentional_empty",
        "fatherName": "intentional_empty",
        "grandfatherName": "intentional_empty",
        "familyName": "intentional_empty",
        "passportNumber": "intentional_empty",
        "nationality": "intentional_empty",
        "previousNationality": "intentional_empty",
        "dob": "intentional_empty",
        "issueDate": "intentional_empty",
        "releaseDate": "intentional_empty",
        "expiryDate": "intentional_empty",
        "gender": "intentional_empty",
        "passportType": f"default:{DEFAULT_PASSPORT_TYPE}",
        "countryOfIssued": "intentional_empty",
        "cityOfIssued": "intentional_empty",
        "birthCountry": "intentional_empty",
        "birthCity": "intentional_empty",
        "profession": f"default:{DEFAULT_PROFESSION}",
        "maritalStatus": f"default:{DEFAULT_MARITAL_STATUS}",
        "iqamaNumber": "intentional_empty",
        "iqamaExpiryDate": "intentional_empty",
        "vaccinationCertificate": "intentional_empty",
        "vaccinationCertificatePath": "intentional_empty",
        "email": f"template:{EMAIL_TEMPLATE}",
        "mobileNumber": f"template:{MOBILE_TEMPLATE}",
        "arabic.firstName": "intentional_empty",
        "arabic.fatherName": "intentional_empty",
        "arabic.grandfatherName": "intentional_empty",
        "arabic.familyName": "intentional_empty",
    }


def _build_mrz_validation(extraction: ExtractionEvidence) -> dict[str, object]:
    validation = extraction.get("mrzValidation", {}) if extraction else {}
    return validation if isinstance(validation, dict) else _empty_mrz_validation()


def _empty_mrz_validation() -> dict[str, object]:
    return {
        "line2": "",
        "status": "MRZ_FAILED",
        "valid": False,
        "validCheckCount": 0,
        "checks": [],
        "notes": "",
    }


def _record_review_reasons(review_flags: dict[str, object]) -> list[str]:
    record_flags = review_flags.get("record", [])
    if not isinstance(record_flags, list):
        return []
    return [str(value) for value in record_flags if str(value)]


def _review_status(status: str, review_reasons: list[str]) -> str:
    if status == "ERROR":
        return "ERROR"
    return "NEEDS_REVIEW" if review_reasons else "VALID"


def _passport_source(passport_extracted: dict[str, str], field_name: str) -> str:
    return f"passportExtracted.{field_name}" if passport_extracted.get(field_name) else "intentional_empty"


def _linked_source(passport_extracted: dict[str, str], field_name: str) -> str:
    return f"derived_from_passportExtracted.{field_name}" if passport_extracted.get(field_name) else "intentional_empty"


def _country_source(passport_extracted: dict[str, str]) -> str:
    country = passport_extracted.get("countryOfIssued", "")
    nationality = passport_extracted.get("nationality", "")
    if not country:
        return "intentional_empty"
    if country == nationality and nationality:
        return "derived_from_passportExtracted.nationality"
    return "passportExtracted.countryOfIssued"


def _birth_country_source(resolved_profile: dict[str, object]) -> str:
    birth_country = str(resolved_profile.get("birthCountry", "") or "")
    nationality = str(resolved_profile.get("nationality", "") or "")
    country = str(resolved_profile.get("countryOfIssued", "") or "")
    if not birth_country:
        return "intentional_empty"
    if birth_country == nationality and nationality:
        return "derived_from_resolvedProfile.nationality"
    if birth_country == country and country:
        return "derived_from_resolvedProfile.countryOfIssued"
    return "resolvedProfile.birthCountry"


def _derived_source(values: dict[str, object], field_name: str, origin: str) -> str:
    return f"derived_from_{origin}" if values.get(field_name) else "intentional_empty"


def _country_of_issued(nationality: str, extraction: ExtractionEvidence) -> str:
    data = extraction.get("data", {}) if extraction else {}
    country = clean_country(data.get("country", ""))
    if nationality == "INDONESIA" and country != "INDONESIA":
        return nationality
    return country or nationality


def _relative_path(path: str) -> str:
    normalized_path = _normalize_filesystem_path(path)
    normalized_root = _normalize_filesystem_path(ROOT_DIR)
    try:
        return os.path.relpath(normalized_path, normalized_root).replace(os.sep, "/")
    except ValueError:
        return normalized_path.replace(os.sep, "/")


def _normalize_filesystem_path(path: str) -> str:
    text = str(path or "").strip()
    if text.startswith("\\\\?\\UNC\\"):
        return "\\\\" + text[8:]
    if text.startswith("\\\\?\\"):
        return text[4:]
    return text
