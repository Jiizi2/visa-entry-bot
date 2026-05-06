from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from export_golden_review_html import build_review_html  # noqa: E402


class ExportGoldenReviewHtmlTests(unittest.TestCase):
    def test_build_review_html_renders_image_and_expected_fields(self) -> None:
        html = build_review_html(
            {
                "passportsDir": "C:/passports",
                "candidates": [
                    {
                        "fileName": "A & B.png",
                        "sourcePath": "C:/passports/A & B.png",
                        "reviewApproved": False,
                        "recordReviewStatus": "NEEDS_REVIEW",
                        "reviewReasons": ["GENERATED_FROM_CURRENT_OCR"],
                        "recordReviewReasons": ["NAME_NORMALIZED_FROM_VISUAL"],
                        "goldenDraft": {
                            "fileName": "A & B.png",
                            "expected": {
                                "status": "VALID",
                                "passportNumber": "E1234567",
                                "nationality": "INDONESIA",
                            },
                        },
                    }
                ],
            },
            output=Path("review/output.html"),
        )

        self.assertIn("Golden OCR Review Pack", html)
        self.assertIn("A &amp; B.png", html)
        self.assertIn("NEEDS_REVIEW: 1", html)
        self.assertIn("E1234567", html)
        self.assertIn("NAME_NORMALIZED_FROM_VISUAL", html)
        self.assertIn("table-wrap", html)
        self.assertIn("white-space: nowrap", html)


if __name__ == "__main__":
    unittest.main()
