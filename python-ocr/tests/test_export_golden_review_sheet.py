from __future__ import annotations

import csv
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from export_golden_review_sheet import build_review_rows, write_review_sheet  # noqa: E402


class ExportGoldenReviewSheetTests(unittest.TestCase):
    def test_build_review_rows_flattens_candidate_expected_fields(self) -> None:
        rows = build_review_rows(
            {
                "candidates": [
                    {
                        "fileName": "A.png",
                        "sourcePath": "C:/passports/A.png",
                        "reviewApproved": False,
                        "reviewNotes": "",
                        "recordReviewStatus": "NEEDS_REVIEW",
                        "recordStatus": "VALID",
                        "confidence": 0.75,
                        "reviewReasons": ["GENERATED_FROM_CURRENT_OCR", "OCR_NEEDS_REVIEW"],
                        "recordReviewReasons": ["MRZ_CHECKSUM_FAILED"],
                        "goldenDraft": {
                            "fileName": "A.png",
                            "expected": {
                                "status": "VALID",
                                "passportNumber": "E1234567",
                            },
                        },
                    }
                ]
            }
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["fileName"], "A.png")
        self.assertEqual(rows[0]["reviewApproved"], "FALSE")
        self.assertEqual(rows[0]["reviewReasons"], "GENERATED_FROM_CURRENT_OCR|OCR_NEEDS_REVIEW")
        self.assertEqual(rows[0]["recordReviewReasons"], "MRZ_CHECKSUM_FAILED")
        self.assertEqual(rows[0]["status"], "VALID")
        self.assertEqual(rows[0]["passportNumber"], "E1234567")

    def test_write_review_sheet_outputs_csv(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "review.csv"

            write_review_sheet([{"fileName": "A.png", "reviewApproved": "FALSE", "status": "VALID"}], output)

            with output.open("r", encoding="utf-8-sig", newline="") as handle:
                rows = list(csv.DictReader(handle))

        self.assertEqual(rows[0]["fileName"], "A.png")
        self.assertEqual(rows[0]["reviewApproved"], "FALSE")
        self.assertEqual(rows[0]["status"], "VALID")


if __name__ == "__main__":
    unittest.main()
