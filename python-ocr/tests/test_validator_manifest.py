from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.nusuk_manifest import build_error_record, build_member_record
from services.validator import validate_member


class ValidatorManifestTests(unittest.TestCase):
    def test_validate_member_requires_nusuk_core_fields(self) -> None:
        status, notes = validate_member(
            {
                "firstName": "JOHN",
                "familyName": "DOE",
                "passportNumber": "A1234567",
                "nationality": "INDONESIA",
                "dob": "1990-01-01",
                "issueDate": "",
                "expiryDate": "2030-01-01",
                "gender": "MALE",
            }
        )

        self.assertEqual(status, "ERROR")
        self.assertIn("issueDate", notes)

    def test_build_error_record_keeps_nested_flags(self) -> None:
        record = build_error_record("bad.png", "C:/visa-entry-bot/data/bad.png", "MRZ not detected.")

        self.assertEqual(record["status"], "ERROR")
        self.assertEqual(record["reviewStatus"], "ERROR")
        self.assertTrue(record["requiresReview"])
        self.assertEqual(record["reviewReasons"], ["RECORD_ERROR"])
        self.assertEqual(
            record["mrzValidation"],
            {"line2": "", "status": "MRZ_FAILED", "valid": False, "validCheckCount": 0, "checks": [], "notes": ""},
        )
        self.assertIn("RECORD_ERROR", record["reviewFlags"]["record"])
        self.assertIn("passportNumber", record["fieldEvidence"]["passportExtracted"])
        self.assertIn("passportExtracted", record["confidenceLevel"])
        self.assertIn("resolvedProfile", record["confidenceLevel"])

    def test_country_of_issued_prefers_mrz_issuing_country(self) -> None:
        record = build_member_record(
            "passport.png",
            "C:/visa-entry-bot/data/passport.png",
            {
                "firstName": "JOHN",
                "familyName": "DOE",
                "passportNumber": "A1234567",
                "nationality": "INDIA",
                "dob": "1990-01-01",
                "issueDate": "2025-01-01",
                "expiryDate": "2030-01-01",
                "gender": "MALE",
            },
            {},
            {"confidence": 0.9, "data": {"country": "USA"}},
            "VALID",
            0.95,
            "",
        )

        self.assertEqual(record["passportExtracted"]["countryOfIssued"], "UNITED STATES")
        self.assertEqual(record["resolvedProfile"]["birthCountry"], "INDIA")
        self.assertFalse(record["requiresReview"])
        self.assertEqual(record["reviewReasons"], [])
        self.assertEqual(record["reviewStatus"], "VALID")

    def test_build_member_record_preserves_mrz_validation_evidence(self) -> None:
        mrz_validation = {
            "line2": "E8710852<5IDN1906017M30010866403050106000214",
            "status": "MRZ_VALID",
            "valid": True,
            "validCheckCount": 5,
            "checks": [{"fieldName": "passportNumber", "expected": "5", "actual": "5", "valid": True}],
            "notes": "",
        }

        record = build_member_record(
            "passport.png",
            "C:/visa-entry-bot/data/passport.png",
            {
                "firstName": "KARIM",
                "familyName": "RAMADAN",
                "passportNumber": "E8710852",
                "nationality": "INDONESIA",
                "dob": "2019-06-01",
                "issueDate": "2025-01-08",
                "expiryDate": "2030-01-08",
                "gender": "MALE",
            },
            {},
            {"confidence": 1.0, "data": {"country": "IDN"}, "mrzValidation": mrz_validation},
            "VALID",
            1.0,
            "",
        )

        self.assertEqual(record["mrzValidation"], mrz_validation)
        self.assertEqual(
            record["fieldEvidence"]["passportExtracted"]["passportNumber"]["source"],
            "mrz",
        )
        self.assertEqual(
            record["fieldEvidence"]["passportExtracted"]["passportNumber"]["validationStatus"],
            "OK",
        )

    def test_build_member_record_marks_checksum_flags_as_review_reasons(self) -> None:
        mrz_validation = {
            "line2": "E8710852<0IDN1906017M30010866403050106000214",
            "status": "MRZ_PARTIAL",
            "valid": False,
            "validCheckCount": 3,
            "checks": [
                {"fieldName": "passportNumber", "expected": "5", "actual": "0", "valid": False},
                {"fieldName": "dob", "expected": "7", "actual": "7", "valid": True},
                {"fieldName": "expiryDate", "expected": "6", "actual": "6", "valid": True},
                {"fieldName": "personalNumber", "expected": "1", "actual": "1", "valid": True},
                {"fieldName": "composite", "expected": "9", "actual": "4", "valid": False},
            ],
            "notes": "",
        }

        record = build_member_record(
            "passport.png",
            "C:/visa-entry-bot/data/passport.png",
            {
                "firstName": "KARIM",
                "familyName": "RAMADAN",
                "passportNumber": "E8710852",
                "nationality": "INDONESIA",
                "dob": "2019-06-01",
                "issueDate": "2025-01-08",
                "expiryDate": "2030-01-08",
                "gender": "MALE",
            },
            {},
            {"confidence": 1.0, "data": {"country": "IDN"}, "mrzValidation": mrz_validation},
            "VALID",
            1.0,
            "",
        )

        self.assertEqual(record["status"], "VALID")
        self.assertEqual(record["reviewStatus"], "NEEDS_REVIEW")
        self.assertTrue(record["requiresReview"])
        self.assertIn("MRZ_CHECKSUM_PARTIAL", record["reviewReasons"])
        self.assertEqual(
            record["fieldEvidence"]["passportExtracted"]["passportNumber"]["validationStatus"],
            "REVIEW",
        )

    def test_build_member_record_accepts_verified_single_word_name(self) -> None:
        mrz_validation = {
            "line2": "X6725059<5IDN6312159M30112696404110120000214",
            "status": "MRZ_VALID",
            "valid": True,
            "validCheckCount": 5,
            "checks": [{"fieldName": "passportNumber", "valid": True}],
            "notes": "",
        }

        record = build_member_record(
            "passport.png",
            "C:/visa-entry-bot/data/passport.png",
            {
                "firstName": "MARGONO",
                "familyName": "MARGONO",
                "passportNumber": "X6725059",
                "nationality": "INDONESIA",
                "dob": "1963-12-15",
                "issueDate": "2020-11-26",
                "expiryDate": "2030-11-26",
                "gender": "MALE",
            },
            {},
            {"confidence": 1.0, "data": {"country": "IDN"}, "mrzValidation": mrz_validation},
            "VALID",
            1.0,
            "SINGLE-WORD NAME DUPLICATED TO SATISFY REQUIRED FIELDS",
        )

        self.assertEqual(record["reviewStatus"], "VALID")
        self.assertFalse(record["requiresReview"])
        self.assertEqual(record["reviewReasons"], [])


if __name__ == "__main__":
    unittest.main()
