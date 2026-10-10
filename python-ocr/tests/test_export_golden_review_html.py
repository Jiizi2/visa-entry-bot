from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from export_golden_review_html import _image_src, build_review_html  # noqa: E402


class ExportGoldenReviewHtmlTests(unittest.TestCase):
    def test_image_src_uses_relative_path_on_same_drive(self) -> None:
        image_src = _image_src(
            str(Path("passports/A & B.png").resolve()),
            output=Path("review/output.html"),
        )

        self.assertEqual(image_src, "../passports/A%20%26%20B.png")

    @unittest.skipUnless(sys.platform == "win32", "Requires Windows drive letters")
    def test_build_review_html_links_images_across_drives(self) -> None:
        html = build_review_html(
            {
                "candidates": [
                    {
                        "fileName": "A & B.png",
                        "sourcePath": "C:/passports/A & B.png",
                    },
                ],
            },
            output=Path("D:/review/output.html"),
        )

        self.assertIn('href="file:///C:/passports/A%20%26%20B.png"', html)
        self.assertIn('src="file:///C:/passports/A%20%26%20B.png"', html)

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
                        "processingMetrics": {"totalMs": 1234},
                    },
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
        self.assertIn("data-zoom-root", html)
        self.assertIn("data-zoom-action=\"in\"", html)
        self.assertIn("WHEEL_THRESHOLD = 120", html)
        self.assertIn("Timed: 1", html)
        self.assertIn("Avg scan: 1.2 s", html)
        self.assertIn("Scan: 1.2 s", html)


if __name__ == "__main__":
    unittest.main()
