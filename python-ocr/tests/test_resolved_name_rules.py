from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.nusuk_manifest import build_member_record
from services.resolved_name_rules import build_resolved_name_fields


class ResolvedNameRulesTests(unittest.TestCase):
    def test_two_token_name_assigns_first_and_family(self) -> None:
        resolved = build_resolved_name_fields({"firstName": "M", "familyName": "HAMDI"})

        self.assertEqual(resolved["firstName"], "M")
        self.assertEqual(resolved["familyName"], "HAMDI")
        self.assertEqual(resolved["fatherName"], "")
        self.assertEqual(resolved["sources"]["firstName"], "passportExtracted.firstName")

    def test_single_token_without_endorsement_uses_duplicate_fallback(self) -> None:
        resolved = build_resolved_name_fields({"firstName": "", "familyName": "HALIMAH"})

        self.assertEqual(resolved["firstName"], "HALIMAH")
        self.assertEqual(resolved["familyName"], "HALIMAH")
        self.assertEqual(resolved["sources"]["firstName"], "derived_from_passportExtracted.fullName")

    def test_three_token_name_merges_first_two_when_it_fits(self) -> None:
        resolved = build_resolved_name_fields({"firstName": "MUHAMMAD FADIL", "familyName": "HAZIQ"})

        self.assertEqual(resolved["firstName"], "MUHAMMAD FADIL")
        self.assertEqual(resolved["fatherName"], "")
        self.assertEqual(resolved["familyName"], "HAZIQ")

    def test_three_token_name_spills_second_token_to_father_name(self) -> None:
        resolved = build_resolved_name_fields({"firstName": "FADHLIVALDA GAMUAT", "familyName": "ATTALLAH"})

        self.assertEqual(resolved["firstName"], "FADHLIVALDA")
        self.assertEqual(resolved["fatherName"], "GAMUAT")
        self.assertEqual(resolved["familyName"], "ATTALLAH")

    def test_build_member_record_uses_resolved_name_rules(self) -> None:
        record = build_member_record(
            "sample.png",
            "C:/visa-entry-bot/data/sample.png",
            {
                "firstName": "M",
                "familyName": "HAMDI",
                "passportNumber": "X8489774",
                "nationality": "INDONESIA",
                "dob": "1952-10-12",
                "issueDate": "2026-01-18",
                "expiryDate": "2031-01-18",
                "gender": "MALE",
            },
            {"placeOfBirth": "BERAU", "issuingOffice": "TANJUNG REDEB"},
            {"confidence": 0.9, "data": {}},
            "VALID",
            0.9,
            "",
        )

        self.assertEqual(record["resolvedProfile"]["firstName"], "M")
        self.assertEqual(record["resolvedProfile"]["familyName"], "HAMDI")
        self.assertEqual(record["sourceByField"]["fatherName"], "intentional_empty")
        self.assertTrue(record["resolvedProfile"]["arabic"]["firstName"])


if __name__ == "__main__":
    unittest.main()
