from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.expiry_date_extractor import extract_expiry_date
from services.indonesia_field_ocr import _extract_field
from services.issue_date_extractor import extract_issue_date
from services.ocr_result_cache import clear_ocr_result_cache
from services.passport_page import collect_ocr_lines


class OcrPerformanceGuardTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_ocr_result_cache()

    def tearDown(self) -> None:
        clear_ocr_result_cache()

    def test_collect_ocr_lines_reuses_cached_result(self) -> None:
        region = np.zeros((10, 10), dtype=np.uint8)
        with (
            patch("services.passport_page.configure_tesseract", return_value=True),
            patch("services.passport_page._build_variants", return_value=[region]),
            patch("services.passport_page.pytesseract.image_to_string", return_value="LINE 1\n") as image_to_string,
        ):
            first = collect_ocr_lines(region, psm_values=(6,), variant_mode="fast", max_lines=10)
            second = collect_ocr_lines(region, psm_values=(6,), variant_mode="fast", max_lines=10)

        self.assertEqual(first, ["LINE 1"])
        self.assertEqual(second, ["LINE 1"])
        self.assertEqual(image_to_string.call_count, 1)

    def test_issue_date_skips_raw_scan_when_page_candidates_resolve(self) -> None:
        with (
            patch("services.issue_date_extractor._collect_page_candidates", return_value=["2026-01-18"]),
            patch("services.issue_date_extractor._collect_raw_candidates") as raw_candidates,
            patch("services.issue_date_extractor._collect_legacy_candidates") as legacy_candidates,
        ):
            result = extract_issue_date("file.png", dob="1952-10-12", expiry_date="2031-01-18", page=object())

        self.assertEqual(result, "2026-01-18")
        raw_candidates.assert_not_called()
        legacy_candidates.assert_not_called()

    def test_expiry_date_skips_raw_scan_when_page_candidates_resolve(self) -> None:
        with (
            patch("services.expiry_date_extractor._collect_page_candidates", return_value=["2031-01-18"]),
            patch("services.expiry_date_extractor._collect_raw_candidates") as raw_candidates,
            patch("services.expiry_date_extractor._collect_legacy_candidates") as legacy_candidates,
        ):
            result = extract_expiry_date("file.png", dob="1952-10-12", issue_date="2026-01-18", page=object())

        self.assertEqual(result, "2031-01-18")
        raw_candidates.assert_not_called()
        legacy_candidates.assert_not_called()

    def test_visual_field_stops_after_stable_candidate(self) -> None:
        with (
            patch("services.indonesia_field_ocr.crop_relative", side_effect=[object(), object()]),
            patch("services.indonesia_field_ocr.scan_region_texts", side_effect=[["18 JAN 2031", "18 JAN 2031"], ["17 JAN 2031"]]) as scanner,
        ):
            result = _extract_field(object(), "expiryDate")

        self.assertEqual(result, "2031-01-18")
        self.assertEqual(scanner.call_count, 1)


if __name__ == "__main__":
    unittest.main()
