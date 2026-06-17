from __future__ import annotations

from datetime import date

from services.models import ParsedPassportData

LOW_CONFIDENCE_THRESHOLD = 0.75
ENTRY_REQUIRED_PASSPORT_FIELDS = (
    "passportNumber",
    "firstName",
    "familyName",
    "nationality",
    "dob",
    "issueDate",
    "expiryDate",
    "gender",
    "birthCity",
    "cityOfIssued",
)


def build_review_flags(
    passport_extracted: dict[str, str],
    resolved_profile: dict[str, object],
    source_by_field: dict[str, str],
    field_confidence: dict[str, object],
    status: str,
    notes: str,
    mrz_validation: dict[str, object] | None = None,
) -> dict[str, object]:
    passport_flags = {field: [] for field in passport_extracted}
    resolved_flags = {field: [] for field in resolved_profile if field != "arabic"}
    resolved_flags["arabic"] = {field: [] for field in _arabic_values(resolved_profile)}
    record_flags: list[str] = []

    passport_confidence = field_confidence.get("passportExtracted", {})
    passport_confidence = passport_confidence if isinstance(passport_confidence, dict) else {}
    _apply_status_flags(record_flags, status, notes, mrz_validation, passport_confidence)
    _apply_passport_flags(passport_flags, passport_extracted, field_confidence.get("passportExtracted", {}))
    _apply_resolved_flags(
        record_flags,
        resolved_flags,
        resolved_profile,
        source_by_field,
        field_confidence.get("resolvedProfile", {}),
    )
    _apply_name_flags(passport_flags, resolved_flags, passport_extracted, resolved_profile, notes, mrz_validation)
    _apply_date_flags(passport_flags, resolved_flags, passport_extracted, resolved_profile)
    _apply_mrz_validation_flags(record_flags, passport_flags, mrz_validation)
    _apply_record_summary(record_flags, passport_flags, resolved_flags)
    return {"record": _dedupe(record_flags), "passportExtracted": passport_flags, "resolvedProfile": resolved_flags}


def empty_review_flags() -> dict[str, object]:
    return {
        "record": [],
        "passportExtracted": {
            "firstName": [],
            "familyName": [],
            "passportNumber": [],
            "nationality": [],
            "dob": [],
            "issueDate": [],
            "expiryDate": [],
            "gender": [],
            "countryOfIssued": [],
            "cityOfIssued": [],
            "birthCity": [],
        },
        "resolvedProfile": {
            "firstName": [],
            "fatherName": [],
            "grandfatherName": [],
            "familyName": [],
            "passportNumber": [],
            "nationality": [],
            "previousNationality": [],
            "dob": [],
            "issueDate": [],
            "releaseDate": [],
            "expiryDate": [],
            "gender": [],
            "passportType": [],
            "countryOfIssued": [],
            "cityOfIssued": [],
            "birthCountry": [],
            "birthCity": [],
            "profession": [],
            "maritalStatus": [],
            "iqamaNumber": [],
            "iqamaExpiryDate": [],
            "vaccinationCertificate": [],
            "vaccinationCertificatePath": [],
            "email": [],
            "mobileNumber": [],
            "arabic": {"firstName": [], "fatherName": [], "grandfatherName": [], "familyName": []},
        },
    }


def _apply_status_flags(
    record_flags: list[str],
    status: str,
    notes: str,
    mrz_validation: dict[str, object] | None = None,
    passport_confidence: dict[str, object] | None = None,
) -> None:
    upper_notes = str(notes or "").upper()
    if status == "ERROR":
        record_flags.append("RECORD_ERROR")
    if "FAST SCAN REVIEW REQUIRED" in upper_notes:
        record_flags.append("FAST_SCAN_REVIEW")
    if "LOW PASSPORTEYE CONFIDENCE" in upper_notes and not _has_valid_mrz(mrz_validation):
        record_flags.append("LOW_MRZ_CONFIDENCE")
    if (
        "NAME NORMALIZED FROM FULL NAME FIELD" in upper_notes
        and not _is_verified_deterministic_name_repair(upper_notes, mrz_validation)
        and not _is_high_confidence_verified_visual_name_repair(mrz_validation, passport_confidence)
    ):
        record_flags.append("NAME_NORMALIZED_FROM_VISUAL")


def _is_verified_deterministic_name_repair(upper_notes: str, mrz_validation: dict[str, object] | None) -> bool:
    if not _has_valid_mrz(mrz_validation):
        return False
    trusted_markers = (
        "SINGLE-WORD NAME DUPLICATED TO SATISFY REQUIRED FIELDS",
        "GIVEN NAME ABBREVIATION REPAIRED FROM MRZ",
        "GIVEN NAME SPACING REPAIRED FROM MRZ",
        "GIVEN NAME NOISE REPAIRED FROM MRZ",
    )
    return any(marker in upper_notes for marker in trusted_markers)


def _has_valid_mrz(mrz_validation: dict[str, object] | None) -> bool:
    return isinstance(mrz_validation, dict) and mrz_validation.get("valid") is True


def _is_high_confidence_verified_visual_name_repair(
    mrz_validation: dict[str, object] | None,
    passport_confidence: dict[str, object] | None,
) -> bool:
    if not _has_valid_mrz(mrz_validation) or not isinstance(passport_confidence, dict):
        return False
    return _as_float(passport_confidence.get("firstName", 0.0)) >= 0.9 and _as_float(passport_confidence.get("familyName", 0.0)) >= 0.9


def _apply_passport_flags(flags: dict[str, list[str]], values: dict[str, str], confidence: dict[str, object]) -> None:
    for field_name, value in values.items():
        field_flags = flags[field_name]
        if not value:
            field_flags.append("MISSING_VALUE")
            continue
        if _as_float(confidence.get(field_name, 0.0)) < LOW_CONFIDENCE_THRESHOLD:
            field_flags.append("LOW_CONFIDENCE")


def _apply_resolved_flags(
    record_flags: list[str],
    flags: dict[str, object],
    values: dict[str, object],
    sources: dict[str, str],
    confidence: dict[str, object],
) -> None:
    for field_name, value in values.items():
        if field_name == "arabic":
            continue
        field_flags = flags[field_name]
        source = str(sources.get(field_name, "") or "")
        _apply_source_flag(field_flags, source, value)
        if value and _as_float(confidence.get(field_name, 0.0)) < LOW_CONFIDENCE_THRESHOLD:
            field_flags.append("LOW_CONFIDENCE")
    arabic_values = _arabic_values(values)
    arabic_confidence = confidence.get("arabic", {}) if isinstance(confidence.get("arabic"), dict) else {}
    for field_name, value in arabic_values.items():
        field_flags = flags["arabic"][field_name]
        source = str(sources.get(f"arabic.{field_name}", "") or "")
        _apply_source_flag(field_flags, source, value)
        if value and _as_float(arabic_confidence.get(field_name, 0.0)) < LOW_CONFIDENCE_THRESHOLD:
            field_flags.append("LOW_CONFIDENCE")
    if any("LOW_CONFIDENCE" in values for values in flags["arabic"].values()):
        record_flags.append("LOW_ARABIC_CONFIDENCE")


def _apply_name_flags(
    passport_flags: dict[str, list[str]],
    resolved_flags: dict[str, object],
    passport_values: dict[str, str],
    resolved_values: dict[str, object],
    notes: str,
    mrz_validation: dict[str, object] | None,
) -> None:
    allow_single_word_name = _is_verified_single_word_name(passport_values, notes, mrz_validation)
    _mark_name_pair(
        passport_flags,
        passport_values.get("firstName", ""),
        passport_values.get("familyName", ""),
        allow_single_word_name=allow_single_word_name,
    )
    _mark_name_pair(
        resolved_flags,
        str(resolved_values.get("firstName", "") or ""),
        str(resolved_values.get("familyName", "") or ""),
        allow_single_word_name=allow_single_word_name,
    )


def _apply_date_flags(
    passport_flags: dict[str, list[str]],
    resolved_flags: dict[str, object],
    passport_values: dict[str, str],
    resolved_values: dict[str, object],
) -> None:
    _mark_date_consistency(passport_flags, passport_values.get("dob", ""), passport_values.get("issueDate", ""), passport_values.get("expiryDate", ""))
    _mark_date_consistency(
        resolved_flags,
        str(resolved_values.get("dob", "") or ""),
        str(resolved_values.get("issueDate", "") or ""),
        str(resolved_values.get("expiryDate", "") or ""),
    )


def _apply_mrz_validation_flags(
    record_flags: list[str],
    passport_flags: dict[str, list[str]],
    mrz_validation: dict[str, object] | None,
) -> None:
    if not isinstance(mrz_validation, dict) or not mrz_validation:
        return
    checks = mrz_validation.get("checks", [])
    if not isinstance(checks, list) or not checks:
        return
    if mrz_validation.get("valid") is True:
        return

    valid_count = int(mrz_validation.get("validCheckCount", 0) or 0)
    record_flags.append("MRZ_CHECKSUM_PARTIAL" if valid_count > 0 else "MRZ_CHECKSUM_FAILED")
    for check in checks:
        if not isinstance(check, dict) or check.get("valid") is True:
            continue
        field_name = _checksum_field_to_passport_field(str(check.get("fieldName", "") or ""))
        if field_name and field_name in passport_flags:
            passport_flags[field_name].append("MRZ_CHECKSUM_FAILED")


def _checksum_field_to_passport_field(field_name: str) -> str:
    return {
        "passportNumber": "passportNumber",
        "dob": "dob",
        "expiryDate": "expiryDate",
    }.get(field_name, "")


def _apply_record_summary(
    record_flags: list[str],
    passport_flags: dict[str, list[str]],
    resolved_flags: dict[str, object],
) -> None:
    name_fields = ("firstName", "familyName")
    if any("LOW_CONFIDENCE" in passport_flags[field] for field in name_fields):
        record_flags.append("LOW_NAME_CONFIDENCE")
    if any("MISSING_VALUE" in passport_flags[field] for field in ENTRY_REQUIRED_PASSPORT_FIELDS):
        record_flags.append("CRITICAL_FIELD_MISSING")
    if any("SINGLE_WORD_OR_DUPLICATED_NAME" in passport_flags[field] for field in name_fields):
        record_flags.append("SINGLE_WORD_NAME")
    if any("DATE_ORDER_SUSPICIOUS" in passport_flags[field] for field in ("issueDate", "expiryDate")):
        record_flags.append("DATE_REVIEW_RECOMMENDED")
    if any("LOW_CONFIDENCE" in resolved_flags[field] for field in ("issueDate", "cityOfIssued", "birthCity")):
        record_flags.append("LOW_VISUAL_FIELD_CONFIDENCE")


def _apply_source_flag(field_flags: list[str], source: str, value: object) -> None:
    text = str(value or "")
    if source.startswith("default:"):
        field_flags.append("DEFAULT_VALUE")
    elif source.startswith("template:"):
        field_flags.append("TEMPLATE_VALUE")
    elif source.startswith("derived_from_"):
        field_flags.append("DERIVED_VALUE")
    elif source == "intentional_empty":
        field_flags.append("INTENTIONAL_EMPTY")
    if not text and "INTENTIONAL_EMPTY" not in field_flags:
        field_flags.append("MISSING_VALUE")


def _is_verified_single_word_name(
    passport_values: dict[str, str],
    notes: str,
    mrz_validation: dict[str, object] | None,
) -> bool:
    first_name = str(passport_values.get("firstName", "") or "").strip()
    family_name = str(passport_values.get("familyName", "") or "").strip()
    if not first_name or first_name != family_name:
        return False
    upper_notes = str(notes or "").upper()
    trusted_markers = (
        "SINGLE-WORD NAME DUPLICATED TO SATISFY REQUIRED FIELDS",
    )
    if not any(marker in upper_notes for marker in trusted_markers):
        return False
    return isinstance(mrz_validation, dict) and mrz_validation.get("valid") is True


def _mark_name_pair(flags: dict[str, object], first_name: str, family_name: str, allow_single_word_name: bool = False) -> None:
    if first_name and first_name == family_name and not allow_single_word_name:
        flags["firstName"].append("SINGLE_WORD_OR_DUPLICATED_NAME")
        flags["familyName"].append("SINGLE_WORD_OR_DUPLICATED_NAME")
    if len(first_name) == 1:
        flags["firstName"].append("INITIAL_GIVEN_NAME")


def _mark_date_consistency(flags: dict[str, object], dob: str, issue_date: str, expiry_date: str) -> None:
    dob_date = _parse_date(dob)
    issue = _parse_date(issue_date)
    expiry = _parse_date(expiry_date)
    if issue and expiry and issue > expiry:
        flags["issueDate"].append("DATE_ORDER_SUSPICIOUS")
        flags["expiryDate"].append("DATE_ORDER_SUSPICIOUS")
    if dob_date and issue and issue <= dob_date:
        flags["dob"].append("DATE_ORDER_SUSPICIOUS")
        flags["issueDate"].append("DATE_ORDER_SUSPICIOUS")
    if issue and expiry and _has_unusual_validity_term(issue, expiry):
        flags["issueDate"].append("UNUSUAL_VALIDITY_TERM")
        flags["expiryDate"].append("UNUSUAL_VALIDITY_TERM")


def _arabic_values(values: dict[str, object]) -> ParsedPassportData:
    arabic = values.get("arabic", {}) if isinstance(values.get("arabic"), dict) else {}
    return {
        "firstName": str(arabic.get("firstName", "") or ""),
        "fatherName": str(arabic.get("fatherName", "") or ""),
        "grandfatherName": str(arabic.get("grandfatherName", "") or ""),
        "familyName": str(arabic.get("familyName", "") or ""),
    }


def _parse_date(value: str) -> date | None:
    try:
        return date.fromisoformat(value) if value else None
    except ValueError:
        return None


def _has_unusual_validity_term(issue: date, expiry: date) -> bool:
    if (issue.month, issue.day) != (expiry.month, expiry.day):
        return True
    return expiry.year - issue.year not in {5, 10}


def _as_float(value: object) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _dedupe(values: list[str]) -> list[str]:
    return list(dict.fromkeys(values))
