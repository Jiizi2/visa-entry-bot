from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.review_flags import build_review_flags  # noqa: E402


class ReviewFlagsTests(unittest.TestCase):
    def test_mrz_validation_partial_flags_record_and_affected_fields(self) -> None:
        flags = build_review_flags(
            _passport_values(),
            _resolved_values(),
            _source_by_field(),
            _field_confidence(),
            "VALID",
            "",
            {
                "line2": "E8710852<0IDN1906017M30010866403050106000214",
                "status": "MRZ_PARTIAL",
                "valid": False,
                "validCheckCount": 3,
                "checks": [
                    {"fieldName": "passportNumber", "valid": False},
                    {"fieldName": "dob", "valid": True},
                    {"fieldName": "expiryDate", "valid": True},
                    {"fieldName": "personalNumber", "valid": True},
                    {"fieldName": "composite", "valid": False},
                ],
                "notes": "",
            },
        )

        self.assertIn("MRZ_CHECKSUM_PARTIAL", flags["record"])
        self.assertIn("MRZ_CHECKSUM_FAILED", flags["passportExtracted"]["passportNumber"])
        self.assertNotIn("MRZ_CHECKSUM_FAILED", flags["passportExtracted"]["dob"])
        self.assertNotIn("MRZ_CHECKSUM_FAILED", flags["passportExtracted"]["expiryDate"])

    def test_mrz_validation_failed_flags_record(self) -> None:
        flags = build_review_flags(
            _passport_values(),
            _resolved_values(),
            _source_by_field(),
            _field_confidence(),
            "VALID",
            "",
            {
                "line2": "E8710852<0IDN1906010M30010806403050106000210",
                "status": "MRZ_FAILED",
                "valid": False,
                "validCheckCount": 0,
                "checks": [
                    {"fieldName": "passportNumber", "valid": False},
                    {"fieldName": "dob", "valid": False},
                    {"fieldName": "expiryDate", "valid": False},
                    {"fieldName": "personalNumber", "valid": False},
                    {"fieldName": "composite", "valid": False},
                ],
                "notes": "",
            },
        )

        self.assertIn("MRZ_CHECKSUM_FAILED", flags["record"])
        self.assertIn("MRZ_CHECKSUM_FAILED", flags["passportExtracted"]["passportNumber"])
        self.assertIn("MRZ_CHECKSUM_FAILED", flags["passportExtracted"]["dob"])
        self.assertIn("MRZ_CHECKSUM_FAILED", flags["passportExtracted"]["expiryDate"])

    def test_mrz_validation_valid_adds_no_review_flag(self) -> None:
        flags = build_review_flags(
            _passport_values(),
            _resolved_values(),
            _source_by_field(),
            _field_confidence(),
            "VALID",
            "",
            {
                "line2": "E8710852<5IDN1906017M30010866403050106000214",
                "status": "MRZ_VALID",
                "valid": True,
                "validCheckCount": 5,
                "checks": [{"fieldName": "passportNumber", "valid": True}],
                "notes": "",
            },
        )

        self.assertNotIn("MRZ_CHECKSUM_PARTIAL", flags["record"])
        self.assertNotIn("MRZ_CHECKSUM_FAILED", flags["record"])
        self.assertNotIn("MRZ_CHECKSUM_FAILED", flags["passportExtracted"]["passportNumber"])

    def test_verified_single_word_name_adds_no_review_flag(self) -> None:
        passport = _passport_values(firstName="MARGONO", familyName="MARGONO")
        resolved = _resolved_values(firstName="MARGONO", familyName="MARGONO")

        flags = build_review_flags(
            passport,
            resolved,
            _source_by_field(passport),
            _field_confidence(passport, resolved),
            "VALID",
            "SINGLE-WORD NAME DUPLICATED TO SATISFY REQUIRED FIELDS",
            {
                "line2": "X6725059<5IDN6312159M30112696404110120000214",
                "status": "MRZ_VALID",
                "valid": True,
                "validCheckCount": 5,
                "checks": [{"fieldName": "passportNumber", "valid": True}],
                "notes": "",
            },
        )

        self.assertNotIn("SINGLE_WORD_NAME", flags["record"])
        self.assertNotIn("SINGLE_WORD_OR_DUPLICATED_NAME", flags["passportExtracted"]["firstName"])
        self.assertNotIn("SINGLE_WORD_OR_DUPLICATED_NAME", flags["passportExtracted"]["familyName"])

    def test_unverified_duplicated_name_still_requires_review(self) -> None:
        passport = _passport_values(firstName="MARGONO", familyName="MARGONO")

        flags = build_review_flags(
            passport,
            _resolved_values(firstName="MARGONO", familyName="MARGONO"),
            _source_by_field(passport),
            _field_confidence(passport),
            "VALID",
            "",
            {
                "line2": "",
                "status": "MRZ_FAILED",
                "valid": False,
                "validCheckCount": 0,
                "checks": [],
                "notes": "",
            },
        )

        self.assertIn("SINGLE_WORD_NAME", flags["record"])


def _passport_values(**overrides: str) -> dict[str, str]:
    values = {
        "firstName": "KARIM",
        "familyName": "RAMADAN",
        "passportNumber": "E8710852",
        "nationality": "INDONESIA",
        "dob": "2019-06-01",
        "issueDate": "2025-01-08",
        "expiryDate": "2030-01-08",
        "gender": "MALE",
        "countryOfIssued": "INDONESIA",
        "cityOfIssued": "TANJUNG REDEB",
        "birthCity": "BERAU",
    }
    values.update(overrides)
    return values


def _resolved_values(**overrides: object) -> dict[str, object]:
    values: dict[str, object] = {
        "firstName": "KARIM",
        "fatherName": "",
        "grandfatherName": "",
        "familyName": "RAMADAN",
        "passportNumber": "E8710852",
        "nationality": "INDONESIA",
        "previousNationality": "",
        "dob": "2019-06-01",
        "issueDate": "2025-01-08",
        "releaseDate": "2025-01-08",
        "expiryDate": "2030-01-08",
        "gender": "MALE",
        "passportType": "NORMAL",
        "countryOfIssued": "INDONESIA",
        "cityOfIssued": "TANJUNG REDEB",
        "birthCountry": "INDONESIA",
        "birthCity": "BERAU",
        "profession": "BUSINESS",
        "maritalStatus": "SINGLE",
        "iqamaNumber": "",
        "iqamaExpiryDate": "",
        "vaccinationCertificate": "",
        "vaccinationCertificatePath": "",
        "email": "example@gmail.com",
        "mobileNumber": "+6289421314123",
        "arabic": {"firstName": "", "fatherName": "", "grandfatherName": "", "familyName": ""},
    }
    values.update(overrides)
    return values


def _source_by_field(passport_values: dict[str, str] | None = None) -> dict[str, str]:
    return {field_name: f"passportExtracted.{field_name}" for field_name in (passport_values or _passport_values())}


def _field_confidence(
    passport_values: dict[str, str] | None = None,
    resolved_values: dict[str, object] | None = None,
) -> dict[str, object]:
    passport = {field_name: 1.0 for field_name in (passport_values or _passport_values())}
    resolved = {field_name: 1.0 for field_name in (resolved_values or _resolved_values()) if field_name != "arabic"}
    resolved["arabic"] = {"firstName": 1.0, "fatherName": 1.0, "grandfatherName": 1.0, "familyName": 1.0}
    return {"passportExtracted": passport, "resolvedProfile": resolved}


if __name__ == "__main__":
    unittest.main()
