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
        self.assertIn("RECORD_ERROR", record["reviewFlags"]["record"])
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


if __name__ == "__main__":
    unittest.main()
