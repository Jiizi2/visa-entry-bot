from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from compare_golden_fixtures import compare_golden_fixtures  # noqa: E402


class CompareGoldenFixturesTests(unittest.TestCase):
    def test_compare_reports_additive_only_fixture(self) -> None:
        report = compare_golden_fixtures(
            [{"fileName": "A.png", "expected": {"status": "VALID"}}],
            [
                {"fileName": "A.png", "expected": {"status": "VALID"}},
                {"fileName": "B.png", "expected": {"status": "ERROR"}},
            ],
        )

        self.assertEqual(report["oldCount"], 1)
        self.assertEqual(report["newCount"], 2)
        self.assertEqual(report["addedFileNames"], ["B.png"])
        self.assertEqual(report["removedFileNames"], [])
        self.assertEqual(report["changed"], [])
        self.assertTrue(report["isAdditiveOnly"])

    def test_compare_reports_changed_and_removed_records(self) -> None:
        report = compare_golden_fixtures(
            [
                {"fileName": "A.png", "expected": {"status": "VALID", "passportNumber": "E1234567"}},
                {"fileName": "B.png", "expected": {"status": "ERROR"}},
            ],
            [
                {"fileName": "A.png", "expected": {"status": "VALID", "passportNumber": "E7654321"}},
                {"fileName": "C.png", "expected": {"status": "ERROR"}},
            ],
        )

        self.assertEqual(report["addedFileNames"], ["C.png"])
        self.assertEqual(report["removedFileNames"], ["B.png"])
        self.assertEqual(report["changedCount"], 1)
        self.assertEqual(
            report["changed"],
            [
                {
                    "fileName": "A.png",
                    "fieldChanges": {
                        "passportNumber": {"old": "E1234567", "new": "E7654321"},
                    },
                }
            ],
        )
        self.assertFalse(report["isAdditiveOnly"])


if __name__ == "__main__":
    unittest.main()
