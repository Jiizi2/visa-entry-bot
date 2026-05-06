from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from summarize_golden_review import summarize_review_progress  # noqa: E402


class SummarizeGoldenReviewTests(unittest.TestCase):
    def test_summary_counts_pending_ready_blocked_and_unmatched_rows(self) -> None:
        summary = summarize_review_progress(
            [{"fileName": "existing.png", "expected": {"status": "VALID"}}],
            {
                "candidates": [
                    {
                        "fileName": "ready.png",
                        "reviewApproved": True,
                        "recordStatus": "VALID",
                        "recordReviewStatus": "VALID",
                        "reviewReasons": ["GENERATED_FROM_CURRENT_OCR"],
                        "goldenDraft": {
                            "fileName": "ready.png",
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
                        "fileName": "pending.png",
                        "reviewApproved": False,
                        "recordStatus": "VALID",
                        "recordReviewStatus": "NEEDS_REVIEW",
                        "reviewReasons": ["OCR_NEEDS_REVIEW"],
                        "goldenDraft": {"fileName": "pending.png", "expected": {"status": "VALID"}},
                    },
                    {
                        "fileName": "blocked.png",
                        "reviewApproved": True,
                        "recordStatus": "VALID",
                        "recordReviewStatus": "VALID",
                        "goldenDraft": {
                            "fileName": "blocked.png",
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
                    },
                ]
            },
            review_rows=[{"fileName": "ready.png"}, {"fileName": "orphan.png"}],
        )

        self.assertEqual(summary["existingGoldenCount"], 1)
        self.assertEqual(summary["candidateCount"], 3)
        self.assertEqual(summary["reviewRowCount"], 2)
        self.assertEqual(summary["unmatchedReviewRows"], ["orphan.png"])
        self.assertEqual(summary["approvedCount"], 2)
        self.assertEqual(summary["pendingCount"], 1)
        self.assertEqual(summary["readyToAppendCount"], 1)
        self.assertEqual(summary["blockedApprovedCount"], 1)
        self.assertEqual(summary["nextGoldenCount"], 2)
        self.assertEqual(summary["readyFileNames"], ["ready.png"])
        self.assertEqual(summary["pendingFileNames"], ["pending.png"])
        self.assertEqual(summary["blockReasonCounts"], {"INVALID_EXPECTED_FIELDS": 1})
        self.assertEqual(summary["recordReviewStatusCounts"], {"NEEDS_REVIEW": 1, "VALID": 2})
        self.assertEqual(summary["reviewReasonCounts"], {"GENERATED_FROM_CURRENT_OCR": 1, "OCR_NEEDS_REVIEW": 1})


if __name__ == "__main__":
    unittest.main()
