from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.scan_budget import _classify_ocr_mode, _ocr_mode_reasons  # noqa: E402


class OcrModeTests(unittest.TestCase):
    def test_classifies_fast_when_no_recovery_work_is_needed(self) -> None:
        self.assertEqual(
            _classify_ocr_mode(
                mrz_error="",
                panel_fallback_used=False,
                visual_ocr_used=False,
                needs_date_scan=False,
                needs_name_scan=False,
                review_status="VALID",
            ),
            "FAST",
        )
        self.assertEqual(
            _ocr_mode_reasons(
                mrz_error="",
                panel_fallback_used=False,
                visual_ocr_used=False,
                needs_date_scan=False,
                needs_name_scan=False,
                review_status="VALID",
            ),
            [],
        )

    def test_classifies_recovery_when_fallback_work_is_used(self) -> None:
        reasons = _ocr_mode_reasons(
            mrz_error="",
            panel_fallback_used=True,
            visual_ocr_used=False,
            needs_date_scan=True,
            needs_name_scan=False,
            review_status="NEEDS_REVIEW",
        )

        self.assertEqual(
            _classify_ocr_mode(
                mrz_error="",
                panel_fallback_used=True,
                visual_ocr_used=False,
                needs_date_scan=True,
                needs_name_scan=False,
                review_status="NEEDS_REVIEW",
            ),
            "RECOVERY",
        )
        self.assertEqual(reasons, ["PANEL_FALLBACK", "DATE_RECOVERY", "REVIEW_STATUS"])

    def test_classifies_deep_when_mrz_fails_or_record_errors(self) -> None:
        self.assertEqual(
            _classify_ocr_mode(
                mrz_error="MRZ not detected",
                panel_fallback_used=True,
                visual_ocr_used=True,
                needs_date_scan=True,
                needs_name_scan=True,
                review_status="ERROR",
            ),
            "DEEP",
        )


if __name__ == "__main__":
    unittest.main()
