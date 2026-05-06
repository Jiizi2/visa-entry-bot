from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class MrzCheckResult:
    field_name: str
    expected: str
    actual: str
    valid: bool


@dataclass(frozen=True)
class MrzValidationResult:
    line2: str
    valid: bool
    valid_check_count: int
    check_results: tuple[MrzCheckResult, ...]
    notes: str = ""

    def to_dict(self) -> dict[str, object]:
        return {
            "line2": self.line2,
            "status": self.status,
            "valid": self.valid,
            "validCheckCount": self.valid_check_count,
            "checks": [
                {
                    "fieldName": check.field_name,
                    "expected": check.expected,
                    "actual": check.actual,
                    "valid": check.valid,
                }
                for check in self.check_results
            ],
            "notes": self.notes,
        }

    @property
    def status(self) -> str:
        if self.valid:
            return "MRZ_VALID"
        if self.valid_check_count > 0:
            return "MRZ_PARTIAL"
        return "MRZ_FAILED"


def validate_td3_line2(value: str) -> MrzValidationResult:
    line2 = _normalize_line2(value)
    if len(line2) != 44:
        return MrzValidationResult(
            line2=line2,
            valid=False,
            valid_check_count=0,
            check_results=(),
            notes="MRZ line 2 must be 44 characters.",
        )

    checks = (
        _check("passportNumber", line2[0:9], line2[9]),
        _check("dob", line2[13:19], line2[19]),
        _check("expiryDate", line2[21:27], line2[27]),
        _check("personalNumber", line2[28:42], line2[42]),
        _check("composite", line2[0:10] + line2[13:20] + line2[21:43], line2[43]),
    )
    valid_check_count = sum(1 for result in checks if result.valid)
    return MrzValidationResult(
        line2=line2,
        valid=valid_check_count == len(checks),
        valid_check_count=valid_check_count,
        check_results=checks,
    )


def _normalize_line2(value: str) -> str:
    cleaned = re.sub(r"[^A-Z0-9<]", "", str(value or "").upper())
    return cleaned[:44].ljust(44, "<") if cleaned else ""


def _check(field_name: str, payload: str, actual: str) -> MrzCheckResult:
    expected = calculate_mrz_check_digit(payload)
    return MrzCheckResult(
        field_name=field_name,
        expected=expected,
        actual=actual,
        valid=actual.isdigit() and actual == expected,
    )


def calculate_mrz_check_digit(value: str) -> str:
    weights = (7, 3, 1)
    total = sum(_mrz_char_value(char) * weights[index % 3] for index, char in enumerate(value))
    return str(total % 10)


def _mrz_char_value(char: str) -> int:
    if char == "<":
        return 0
    if char.isdigit():
        return int(char)
    if "A" <= char <= "Z":
        return ord(char) - 55
    return 0
