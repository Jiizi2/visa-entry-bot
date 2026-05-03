from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from crosscheck import build_report


def make_member(file_name: str, status: str = "VALID", **resolved_fields: str) -> dict[str, object]:
    passport = {
        "firstName": "",
        "familyName": "",
        "passportNumber": "",
        "nationality": "",
        "dob": "",
        "issueDate": "",
        "expiryDate": "",
        "gender": "",
        "countryOfIssued": "",
        "cityOfIssued": "",
        "birthCity": "",
    }
    passport.update({key: value for key, value in resolved_fields.items() if key in passport})
    return {
        "fileName": file_name,
        "status": status,
        "notes": "",
        "passportExtracted": passport,
        "resolvedProfile": dict(passport),
    }


class CrosscheckTests(unittest.TestCase):
    def test_error_record_with_filename_only_is_skipped(self) -> None:
        manifest = {"members": [make_member("HALIMAH 2.png", status="ERROR")]}
        references = [{"fullName": "HALIMAH ABDUL RAFIK HASIAN", "passportNumber": "X7028437"}]

        report = build_report(manifest, references, "manifest.json", "reference.xlsx")

        self.assertEqual(report["summary"]["comparableMembers"], 0)
        self.assertEqual(report["summary"]["skippedMembers"], 1)

    def test_duplicate_reference_passport_is_not_auto_matched(self) -> None:
        manifest = {"members": [make_member("sample.png", passportNumber="X1234567")]}
        references = [
            {"fullName": "ALICE ONE", "passportNumber": "X1234567"},
            {"fullName": "ALICE TWO", "passportNumber": "X1234567"},
        ]

        report = build_report(manifest, references, "manifest.json", "reference.xlsx")

        self.assertEqual(report["summary"]["comparableMembers"], 0)
        self.assertEqual(report["summary"]["skippedMembers"], 1)


if __name__ == "__main__":
    unittest.main()
