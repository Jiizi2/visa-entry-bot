from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.field_confidence import build_field_confidence  # noqa: E402


class FieldConfidenceTests(unittest.TestCase):
    def test_failed_mrz_checksum_caps_affected_field_confidence(self) -> None:
        confidence = build_field_confidence(
            {
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
            },
            {"passportNumber": "E8710852", "dob": "2019-06-01", "expiryDate": "2030-01-08"},
            {"passportNumber": "passportExtracted.passportNumber"},
            {
                "confidence": 1.0,
                "mrzValidation": {
                    "status": "MRZ_PARTIAL",
                    "valid": False,
                    "validCheckCount": 3,
                    "checks": [
                        {"fieldName": "passportNumber", "valid": False},
                        {"fieldName": "dob", "valid": True},
                        {"fieldName": "expiryDate", "valid": True},
                        {"fieldName": "composite", "valid": False},
                    ],
                },
            },
            {},
        )

        passport_confidence = confidence["passportExtracted"]
        self.assertEqual(passport_confidence["passportNumber"], 0.6)
        self.assertGreater(passport_confidence["dob"], 0.75)
        self.assertGreater(passport_confidence["expiryDate"], 0.75)

    def test_valid_mrz_checksum_does_not_cap_field_confidence(self) -> None:
        confidence = build_field_confidence(
            {
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
            },
            {"passportNumber": "E8710852", "dob": "2019-06-01", "expiryDate": "2030-01-08"},
            {"passportNumber": "passportExtracted.passportNumber"},
            {
                "confidence": 1.0,
                "mrzValidation": {
                    "status": "MRZ_VALID",
                    "valid": True,
                    "validCheckCount": 5,
                    "checks": [
                        {"fieldName": "passportNumber", "valid": True},
                        {"fieldName": "dob", "valid": True},
                        {"fieldName": "expiryDate", "valid": True},
                    ],
                },
            },
            {},
        )

        self.assertGreater(confidence["passportExtracted"]["passportNumber"], 0.75)

    def test_valid_mrz_checksum_boosts_names_above_review_threshold(self) -> None:
        confidence = build_field_confidence(
            {
                "firstName": "YUNITA",
                "familyName": "ARIYANTI",
                "passportNumber": "E2657615",
                "nationality": "INDONESIA",
                "dob": "1985-06-13",
                "issueDate": "2023-03-24",
                "expiryDate": "2033-03-24",
                "gender": "FEMALE",
                "countryOfIssued": "INDONESIA",
                "cityOfIssued": "TANJUNG REDEB",
                "birthCity": "KENDAL",
            },
            {"passportNumber": "E2657615", "dob": "1985-06-13", "expiryDate": "2033-03-24"},
            {"firstName": "passportExtracted.firstName", "familyName": "passportExtracted.familyName"},
            {
                "confidence": 0.65,
                "mrzValidation": {
                    "status": "MRZ_VALID",
                    "valid": True,
                    "validCheckCount": 5,
                    "checks": [
                        {"fieldName": "passportNumber", "valid": True},
                        {"fieldName": "dob", "valid": True},
                        {"fieldName": "expiryDate", "valid": True},
                    ],
                },
            },
            {},
        )

        self.assertGreaterEqual(confidence["passportExtracted"]["firstName"], 0.82)
        self.assertGreaterEqual(confidence["passportExtracted"]["familyName"], 0.82)

    def test_valid_mrz_checksum_boosts_known_visual_fields_above_review_threshold(self) -> None:
        confidence = build_field_confidence(
            {
                "firstName": "MUHAMMAD FADIL",
                "familyName": "HAZIQ",
                "passportNumber": "E9229500",
                "nationality": "INDONESIA",
                "dob": "2007-08-27",
                "issueDate": "2025-07-10",
                "expiryDate": "2035-07-10",
                "gender": "MALE",
                "countryOfIssued": "INDONESIA",
                "cityOfIssued": "TANJUNG REDEB",
                "birthCity": "KENDAL",
            },
            {"issueDate": "2025-07-10", "cityOfIssued": "TANJUNG REDEB", "birthCity": "KENDAL"},
            {
                "issueDate": "passportExtracted.issueDate",
                "cityOfIssued": "passportExtracted.cityOfIssued",
                "birthCity": "passportExtracted.birthCity",
            },
            {
                "confidence": 0.05,
                "mrzValidation": {
                    "status": "MRZ_VALID",
                    "valid": True,
                    "validCheckCount": 5,
                    "checks": [{"fieldName": "passportNumber", "valid": True}],
                },
            },
            {},
        )

        self.assertGreaterEqual(confidence["passportExtracted"]["issueDate"], 0.78)
        self.assertGreaterEqual(confidence["passportExtracted"]["cityOfIssued"], 0.78)
        self.assertGreaterEqual(confidence["passportExtracted"]["birthCity"], 0.78)


if __name__ == "__main__":
    unittest.main()
