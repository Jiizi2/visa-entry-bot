from __future__ import annotations

import re

MAX_NAME_COLUMN_CHARS = 15
GIVEN_NAME_COLUMNS = ("firstName", "fatherName", "grandfatherName")


def build_resolved_name_fields(passport_extracted: dict[str, str]) -> dict[str, object]:
    first_name = _normalize_name(passport_extracted.get("firstName", ""))
    family_name = _normalize_name(passport_extracted.get("familyName", ""))
    full_name = _combine_name(first_name, family_name)
    tokens = full_name.split()

    if len(tokens) < 2:
        duplicate_name = full_name or first_name or family_name
        return {
            "firstName": duplicate_name,
            "fatherName": "",
            "grandfatherName": "",
            "familyName": duplicate_name,
            "sources": {
                "firstName": _full_name_source(duplicate_name),
                "fatherName": "intentional_empty",
                "grandfatherName": "intentional_empty",
                "familyName": _full_name_source(duplicate_name),
            },
        }

    family_value = tokens[-1]
    distributed = _distribute_given_name_columns(tokens[:-1])
    return {
        "firstName": distributed["firstName"],
        "fatherName": distributed["fatherName"],
        "grandfatherName": distributed["grandfatherName"],
        "familyName": family_value,
        "sources": {
            "firstName": _passport_or_derived_source(distributed["firstName"], first_name, "firstName"),
            "fatherName": _derived_name_source(distributed["fatherName"]),
            "grandfatherName": _derived_name_source(distributed["grandfatherName"]),
            "familyName": _passport_or_derived_source(family_value, family_name, "familyName"),
        },
    }


def _normalize_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Z\s]", " ", str(value or "").upper())
    return re.sub(r"\s+", " ", cleaned).strip()


def _combine_name(first_name: str, family_name: str) -> str:
    parts = [part for part in (first_name, family_name) if part]
    if len(parts) == 2 and parts[0] == parts[1]:
        return parts[0]
    return " ".join(parts)


def _distribute_given_name_columns(tokens: list[str]) -> ParsedPassportData:
    remaining_tokens = list(tokens)
    columns = ["", "", ""]
    for index in range(len(columns)):
        column_value, remaining_tokens = _fill_column(remaining_tokens)
        columns[index] = column_value
        if not remaining_tokens:
            break
    if remaining_tokens:
        columns[-1] = _append_overflow(columns[-1], remaining_tokens)
    return dict(zip(GIVEN_NAME_COLUMNS, columns, strict=True))


def _fill_column(tokens: list[str]) -> tuple[str, list[str]]:
    if not tokens:
        return "", []
    first_token = tokens[0]
    if len(first_token) > MAX_NAME_COLUMN_CHARS:
        head = first_token[:MAX_NAME_COLUMN_CHARS]
        tail = first_token[MAX_NAME_COLUMN_CHARS :]
        remaining = ([tail] if tail else []) + tokens[1:]
        return head, remaining

    selected: list[str] = []
    current_length = 0
    remaining_index = 0
    for token in tokens:
        projected = len(token) if not selected else current_length + 1 + len(token)
        if projected > MAX_NAME_COLUMN_CHARS:
            break
        selected.append(token)
        current_length = projected
        remaining_index += 1
    return " ".join(selected), tokens[remaining_index:]


def _append_overflow(current: str, overflow_tokens: list[str]) -> str:
    overflow_text = " ".join(token for token in overflow_tokens if token)
    if not current:
        return overflow_text[:MAX_NAME_COLUMN_CHARS]
    room = MAX_NAME_COLUMN_CHARS - len(current) - 1
    if room <= 0:
        return current[:MAX_NAME_COLUMN_CHARS]
    return f"{current} {overflow_text[:room]}".strip()


def _full_name_source(value: str) -> str:
    return "derived_from_passportExtracted.fullName" if value else "intentional_empty"


def _derived_name_source(value: str) -> str:
    return "derived_from_passportExtracted.firstName" if value else "intentional_empty"


def _passport_or_derived_source(value: str, original: str, field_name: str) -> str:
    if not value:
        return "intentional_empty"
    if value == original:
        return f"passportExtracted.{field_name}"
    return f"derived_from_passportExtracted.{field_name}"
