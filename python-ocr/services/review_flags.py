from __future__ import annotations

from datetime import date

LOW_CONFIDENCE_THRESHOLD = 0.75


def build_review_flags(
    passport_extracted: dict[str, str],
    resolved_profile: dict[str, object],
    source_by_field: dict[str, str],
    field_confidence: dict[str, object],
    status: str,
    notes: str,
) -> dict[str, object]:
    passport_flags = {field: [] for field in passport_extracted}
    resolved_flags = {field: [] for field in resolved_profile if field != "arabic"}
    resolved_flags["arabic"] = {field: [] for field in _arabic_values(resolved_profile)}
    record_flags: list[str] = []

    _apply_status_flags(record_flags, status, notes)
    _apply_passport_flags(passport_flags, passport_extracted, field_confidence.get("passportExtracted", {}))
    _apply_resolved_flags(
        record_flags,
        resolved_flags,
        resolved_profile,
        source_by_field,
        field_confidence.get("resolvedProfile", {}),
    )
    _apply_name_flags(passport_flags, resolved_flags, passport_extracted, resolved_profile)
    _apply_date_flags(passport_flags, resolved_flags, passport_extracted, resolved_profile)
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


def _apply_status_flags(record_flags: list[str], status: str, notes: str) -> None:
    upper_notes = str(notes or "").upper()
    if status == "ERROR":
        record_flags.append("RECORD_ERROR")
    if "LOW PASSPORTEYE CONFIDENCE" in upper_notes:
        record_flags.append("LOW_MRZ_CONFIDENCE")
    if "NAME NORMALIZED FROM FULL NAME FIELD" in upper_notes:
        record_flags.append("NAME_NORMALIZED_FROM_VISUAL")


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
) -> None:
    _mark_name_pair(passport_flags, passport_values.get("firstName", ""), passport_values.get("familyName", ""))
    _mark_name_pair(resolved_flags, str(resolved_values.get("firstName", "") or ""), str(resolved_values.get("familyName", "") or ""))


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


def _apply_record_summary(
    record_flags: list[str],
    passport_flags: dict[str, list[str]],
    resolved_flags: dict[str, object],
) -> None:
    name_fields = ("firstName", "familyName")
    if any("LOW_CONFIDENCE" in passport_flags[field] for field in name_fields):
        record_flags.append("LOW_NAME_CONFIDENCE")
    if any("MISSING_VALUE" in passport_flags[field] for field in ("passportNumber", "firstName", "familyName")):
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


def _mark_name_pair(flags: dict[str, object], first_name: str, family_name: str) -> None:
    if first_name and first_name == family_name:
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


def _arabic_values(values: dict[str, object]) -> dict[str, str]:
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
