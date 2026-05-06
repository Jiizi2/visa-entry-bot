from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.field_evidence import build_field_evidence, empty_field_evidence  # noqa: E402


class FieldEvidenceTests(unittest.TestCase):
    def test_builds_passport_field_evidence_from_mrz_and_visual_sources(self) -> None:
        evidence = build_field_evidence(
            {
                "firstName": "KARIM ALFARIZI",
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
            {"passportNumber": "E8710852", "arabic": {}},
            {"passportNumber": "passportExtracted.passportNumber"},
            {
                "passportExtracted": {
                    "passportNumber": 0.98,
                    "cityOfIssued": 0.88,
                    "birthCity": 0.87,
                },
                "resolvedProfile": {"passportNumber": 0.98},
            },
            {
                "data": {
                    "line1": "P<IDNRAMADAN<<KARIM<ALFARIZI<<<<<<<<<<<<<<<<",
                    "line2": "E8710852<5IDN1906017M30010866403050106000214",
                }
            },
            {"issuingOffice": "TANJUNG REDEB", "placeOfBirth": "BERAU"},
            {
                "passportExtracted": {
                    "passportNumber": [],
                    "cityOfIssued": [],
                    "birthCity": ["LOW_CONFIDENCE"],
                },
                "resolvedProfile": {"passportNumber": []},
            },
        )

        passport = evidence["passportExtracted"]
        self.assertEqual(passport["passportNumber"]["source"], "mrz")
        self.assertEqual(passport["passportNumber"]["rawText"], "E8710852<5IDN1906017M30010866403050106000214")
        self.assertEqual(passport["passportNumber"]["validationStatus"], "OK")
        self.assertEqual(passport["cityOfIssued"]["source"], "visual_field_ocr.issuingOffice")
        self.assertEqual(passport["cityOfIssued"]["rawText"], "TANJUNG REDEB")
        self.assertEqual(passport["birthCity"]["validationStatus"], "LOW_CONFIDENCE")

    def test_checksum_failure_marks_field_evidence_for_review(self) -> None:
        evidence = build_field_evidence(
            {
                "firstName": "",
                "familyName": "",
                "passportNumber": "E8710852",
                "nationality": "INDONESIA",
                "dob": "2019-06-01",
                "issueDate": "",
                "expiryDate": "2030-01-08",
                "gender": "MALE",
                "countryOfIssued": "INDONESIA",
                "cityOfIssued": "",
                "birthCity": "",
            },
            {"passportNumber": "E8710852", "arabic": {}},
            {"passportNumber": "passportExtracted.passportNumber"},
            {"passportExtracted": {"passportNumber": 0.6}, "resolvedProfile": {"passportNumber": 0.6}},
            {"data": {"line2": "E8710852<0IDN1906017M30010866403050106000214"}},
            {},
            {
                "passportExtracted": {
                    "passportNumber": ["MRZ_CHECKSUM_FAILED"],
                    "issueDate": ["MISSING_VALUE"],
                },
                "resolvedProfile": {"passportNumber": []},
            },
        )

        passport = evidence["passportExtracted"]
        self.assertEqual(passport["passportNumber"]["confidence"], 0.6)
        self.assertEqual(passport["passportNumber"]["validationStatus"], "REVIEW")
        self.assertEqual(passport["issueDate"]["validationStatus"], "MISSING")

    def test_empty_field_evidence_has_passport_fields(self) -> None:
        evidence = empty_field_evidence()

        self.assertIn("passportNumber", evidence["passportExtracted"])
        self.assertEqual(evidence["passportExtracted"]["passportNumber"]["validationStatus"], "MISSING")


if __name__ == "__main__":
    unittest.main()
