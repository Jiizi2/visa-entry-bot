from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from apply_golden_candidates import apply_review_sheet, merge_approved_candidates, validate_expected_fields  # noqa: E402


class ApplyGoldenCandidatesTests(unittest.TestCase):
    def test_merge_appends_only_review_approved_candidates(self) -> None:
        merged, summary = merge_approved_candidates(
            [{"fileName": "A.png", "expected": {"status": "VALID"}}],
            {
                "candidates": [
                    {
                        "fileName": "B.png",
                        "reviewApproved": True,
                        "goldenDraft": {
                            "fileName": "B.png",
                            "expected": {
                                "status": "VALID",
                                "passportNumber": "E1234567",
                                "nationality": "INDONESIA",
                                "dob": "1990-01-01",
                                "issueDate": "2025-01-01",
                                "expiryDate": "2030-01-01",
                                "gender": "MALE",
                            },
                        },
                    },
                    {
                        "fileName": "C.png",
                        "reviewApproved": False,
                        "goldenDraft": {"fileName": "C.png", "expected": {"status": "VALID"}},
                    },
                ]
            },
        )

        self.assertEqual(
            merged,
            [
                {"fileName": "A.png", "expected": {"status": "VALID"}},
                {
                    "fileName": "B.png",
                    "expected": {
                        "status": "VALID",
                        "passportNumber": "E1234567",
                        "nationality": "INDONESIA",
                        "dob": "1990-01-01",
                        "issueDate": "2025-01-01",
                        "expiryDate": "2030-01-01",
                        "gender": "MALE",
                    },
                },
            ],
        )
        self.assertEqual(summary["approvedCount"], 1)
        self.assertEqual(summary["appendedCount"], 1)
        self.assertEqual(summary["approvedSkippedCount"], 0)
        self.assertEqual(summary["skipped"], [{"fileName": "C.png", "reason": "NOT_REVIEW_APPROVED"}])

    def test_merge_skips_approved_duplicate_file_name(self) -> None:
        _, summary = merge_approved_candidates(
            [],
            {
                "duplicateFileNames": [{"fileName": "A.png"}],
                "candidates": [
                    {
                        "fileName": "A.png",
                        "reviewApproved": True,
                        "goldenDraft": {"fileName": "A.png", "expected": {"status": "VALID"}},
                    }
                ],
            },
        )

        self.assertEqual(summary["approvedCount"], 1)
        self.assertEqual(summary["appendedCount"], 0)
        self.assertEqual(summary["approvedSkippedCount"], 1)
        self.assertEqual(summary["skipped"], [{"fileName": "A.png", "reason": "DUPLICATE_FILE_NAME"}])

    def test_merge_skips_approved_existing_golden_name(self) -> None:
        _, summary = merge_approved_candidates(
            [{"fileName": "A.png", "expected": {"status": "VALID"}}],
            {
                "candidates": [
                    {
                        "fileName": "A.png",
                        "reviewApproved": True,
                        "goldenDraft": {"fileName": "A.png", "expected": {"status": "VALID"}},
                    }
                ],
            },
        )

        self.assertEqual(summary["approvedSkippedCount"], 1)
        self.assertEqual(summary["skipped"], [{"fileName": "A.png", "reason": "ALREADY_IN_GOLDEN"}])

    def test_apply_review_sheet_promotes_approved_overrides(self) -> None:
        report = apply_review_sheet(
            {
                "candidates": [
                    {
                        "fileName": "A.png",
                        "reviewApproved": False,
                        "reviewNotes": "",
                        "goldenDraft": {
                            "fileName": "A.png",
                            "expected": {"status": "VALID", "passportNumber": "E0000000"},
                        },
                    }
                ]
            },
            [
                {
                    "fileName": "A.png",
                    "reviewApproved": "TRUE",
                    "reviewNotes": "checked image",
                    "status": "VALID",
                    "passportNumber": "E1234567",
                    "firstName": "",
                }
            ],
        )

        candidate = report["candidates"][0]
        self.assertTrue(candidate["reviewApproved"])
        self.assertEqual(candidate["reviewNotes"], "checked image")
        self.assertEqual(candidate["goldenDraft"], {"fileName": "A.png", "expected": {"status": "VALID", "passportNumber": "E1234567"}})
        self.assertEqual(candidate["reviewChecklist"][0], {"field": "status", "candidate": "VALID", "status": "approved"})

    def test_merge_skips_approved_invalid_expected_fields(self) -> None:
        _, summary = merge_approved_candidates(
            [],
            {
                "candidates": [
                    {
                        "fileName": "A.png",
                        "reviewApproved": True,
                        "goldenDraft": {
                            "fileName": "A.png",
                            "expected": {
                                "status": "VALID",
                                "passportNumber": "BAD",
                                "nationality": "INDONESIA",
                                "dob": "1990-01-01",
                                "issueDate": "2025-01-01",
                                "expiryDate": "2030-01-01",
                                "gender": "MALE",
                            },
                        },
                    }
                ],
            },
        )

        self.assertEqual(summary["approvedSkippedCount"], 1)
        self.assertEqual(summary["skipped"][0]["reason"], "INVALID_EXPECTED_FIELDS")
        self.assertEqual(summary["skipped"][0]["details"], "passportNumber:invalid")

    def test_validate_expected_fields_checks_required_core_fields_and_dates(self) -> None:
        errors = validate_expected_fields(
            {
                "status": "VALID",
                "passportNumber": "E1234567",
                "nationality": "INDONESIA",
                "dob": "1990-01-01",
                "issueDate": "1989-01-01",
                "expiryDate": "1988-01-01",
                "gender": "UNKNOWN",
            }
        )

        self.assertEqual(errors, ["gender:invalid", "issueDate:not_after_dob", "expiryDate:not_after_issueDate"])

    def test_validate_expected_fields_allows_error_status_without_core_fields(self) -> None:
        self.assertEqual(validate_expected_fields({"status": "ERROR"}), [])


if __name__ == "__main__":
    unittest.main()
