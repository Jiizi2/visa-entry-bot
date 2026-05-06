from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.mrz_validation import calculate_mrz_check_digit, validate_td3_line2  # noqa: E402


class MrzValidationTests(unittest.TestCase):
    def test_calculates_mrz_check_digit(self) -> None:
        self.assertEqual(calculate_mrz_check_digit("E8710852<"), "5")
        self.assertEqual(calculate_mrz_check_digit("190601"), "7")
        self.assertEqual(calculate_mrz_check_digit("300108"), "6")

    def test_validates_complete_td3_line2(self) -> None:
        result = validate_td3_line2("E8710852<5IDN1906017M30010866403050106000214")

        self.assertTrue(result.valid)
        self.assertEqual(result.status, "MRZ_VALID")
        self.assertEqual(result.valid_check_count, 5)
        self.assertEqual(
            [(check.field_name, check.valid) for check in result.check_results],
            [
                ("passportNumber", True),
                ("dob", True),
                ("expiryDate", True),
                ("personalNumber", True),
                ("composite", True),
            ],
        )
        self.assertEqual(
            result.to_dict(),
            {
                "line2": "E8710852<5IDN1906017M30010866403050106000214",
                "status": "MRZ_VALID",
                "valid": True,
                "validCheckCount": 5,
                "checks": [
                    {"fieldName": "passportNumber", "expected": "5", "actual": "5", "valid": True},
                    {"fieldName": "dob", "expected": "7", "actual": "7", "valid": True},
                    {"fieldName": "expiryDate", "expected": "6", "actual": "6", "valid": True},
                    {"fieldName": "personalNumber", "expected": "1", "actual": "1", "valid": True},
                    {"fieldName": "composite", "expected": "4", "actual": "4", "valid": True},
                ],
                "notes": "",
            },
        )

    def test_reports_partial_line2_validation(self) -> None:
        result = validate_td3_line2("E8710852<0IDN1906017M30010866403050106000214")

        self.assertFalse(result.valid)
        self.assertEqual(result.status, "MRZ_PARTIAL")
        self.assertEqual(result.valid_check_count, 3)
        self.assertEqual(
            [(check.field_name, check.expected, check.actual, check.valid) for check in result.check_results],
            [
                ("passportNumber", "5", "0", False),
                ("dob", "7", "7", True),
                ("expiryDate", "6", "6", True),
                ("personalNumber", "1", "1", True),
                ("composite", "9", "4", False),
            ],
        )

    def test_rejects_empty_line2(self) -> None:
        result = validate_td3_line2("")

        self.assertFalse(result.valid)
        self.assertEqual(result.status, "MRZ_FAILED")
        self.assertEqual(result.valid_check_count, 0)
        self.assertEqual(result.check_results, ())
        self.assertEqual(result.notes, "MRZ line 2 must be 44 characters.")


if __name__ == "__main__":
    unittest.main()
