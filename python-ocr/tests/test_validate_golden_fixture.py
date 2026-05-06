from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from validate_golden_fixture import load_golden_fixture, validate_golden_fixture  # noqa: E402


class ValidateGoldenFixtureTests(unittest.TestCase):
    def test_validate_golden_fixture_accepts_valid_record(self) -> None:
        report = validate_golden_fixture(
            [
                {
                    "fileName": "A.png",
                    "expected": {
                        "status": "VALID",
                        "passportNumber": "E1234567",
                        "nationality": "INDONESIA",
                        "dob": "1990-01-01",
                        "issueDate": "2025-01-01",
                        "expiryDate": "2030-01-01",
                        "gender": "MALE",
                    },
                }
            ]
        )

        self.assertEqual(report["recordCount"], 1)
        self.assertEqual(report["errorCount"], 0)

    def test_validate_golden_fixture_reports_duplicates_and_invalid_fields(self) -> None:
        report = validate_golden_fixture(
            [
                {"fileName": "A.png", "expected": {"status": "VALID", "passportNumber": "BAD"}},
                {"fileName": "A.png", "expected": {"status": "NEEDS_REVIEW"}},
            ]
        )

        self.assertEqual(report["errorCount"], 2)
        self.assertEqual(report["duplicateFileNames"], ["A.png"])
        self.assertIn("fileName:duplicate", report["records"][0]["errors"])
        self.assertIn("passportNumber:invalid", report["records"][0]["errors"])
        self.assertIn("status:invalid", report["records"][1]["errors"])

    def test_validate_golden_fixture_can_verify_image_references(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            images_dir = Path(temp_dir)
            (images_dir / "A.png").write_bytes(b"png")

            report = validate_golden_fixture(
                [
                    {"fileName": "A.png", "expected": {"status": "ERROR"}},
                    {"fileName": "B.png", "expected": {"status": "ERROR"}},
                ],
                images_dir=images_dir,
            )

        self.assertEqual(report["errorCount"], 1)
        self.assertEqual(report["records"][1]["errors"], ["fileName:image_missing"])

    def test_load_golden_fixture_rejects_non_list_payload(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture = Path(temp_dir) / "fixture.json"
            fixture.write_text(json.dumps({"fileName": "A.png"}), encoding="utf-8")

            with self.assertRaises(ValueError):
                load_golden_fixture(fixture)


if __name__ == "__main__":
    unittest.main()
