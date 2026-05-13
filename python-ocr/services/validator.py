from __future__ import annotations

from datetime import date

ERROR_REQUIRED_MEMBER_FIELDS = (
    "passportNumber",
    "firstName",
    "familyName",
    "nationality",
    "dob",
    "issueDate",
    "expiryDate",
    "gender",
)

REVIEW_REQUIRED_MEMBER_FIELDS = (
    "birthCity",
    "cityOfIssued",
)

REQUIRED_MEMBER_FIELDS = ERROR_REQUIRED_MEMBER_FIELDS + REVIEW_REQUIRED_MEMBER_FIELDS


def validate_member(member: dict[str, str]) -> tuple[str, str]:
    missing_error_fields = []
    for field_name in ERROR_REQUIRED_MEMBER_FIELDS:
        if not member.get(field_name):
            missing_error_fields.append(field_name)
    missing_review_fields = []
    for field_name in REVIEW_REQUIRED_MEMBER_FIELDS:
        if not member.get(field_name):
            missing_review_fields.append(field_name)
    invalid_fields = [field_name for field_name in ("dob", "issueDate", "expiryDate") if member.get(field_name) and not _is_iso_date(member[field_name])]
    if member.get("gender") and member["gender"] not in {"MALE", "FEMALE"}:
        invalid_fields.append("gender")
    if _has_invalid_date_order(member):
        invalid_fields.append("dateOrder")

    if missing_error_fields:
        return "ERROR", f"Missing required fields: {', '.join(missing_error_fields)}"
    if invalid_fields:
        return "ERROR", f"Invalid fields: {', '.join(invalid_fields)}"
    if missing_review_fields:
        return "VALID", f"Review required fields: {', '.join(missing_review_fields)}"
    return "VALID", ""


def calculate_confidence(base_confidence: float, member: dict[str, str], status: str) -> float:
    populated_fields = sum(
        1
        for key in REQUIRED_MEMBER_FIELDS
        if member.get(key)
    )
    score = float(base_confidence) + (populated_fields / len(REQUIRED_MEMBER_FIELDS)) * 0.15
    if status == "ERROR":
        score -= 0.2
    return round(min(max(score, 0.0), 1.0), 2)


def _is_iso_date(value: str) -> bool:
    try:
        date.fromisoformat(value)
        return True
    except ValueError:
        return False


def _has_invalid_date_order(member: dict[str, str]) -> bool:
    dob = _parse_date(member.get("dob", ""))
    issue_date = _parse_date(member.get("issueDate", ""))
    expiry_date = _parse_date(member.get("expiryDate", ""))
    if issue_date and expiry_date and issue_date > expiry_date:
        return True
    if dob and issue_date and issue_date <= dob:
        return True
    if dob and expiry_date and expiry_date <= dob:
        return True
    return False


def _parse_date(value: str) -> date | None:
    try:
        return date.fromisoformat(value) if value else None
    except ValueError:
        return None
