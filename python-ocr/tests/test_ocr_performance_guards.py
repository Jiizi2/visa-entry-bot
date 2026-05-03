from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.date_field_extractor import extract_document_dates
from services.expiry_date_extractor import extract_expiry_date
from services.indonesia_field_ocr import _extract_field, extract_visual_fields
from services.issue_date_extractor import extract_issue_date
from services.mrz_extractor import DirectMrzResult, _read_best_mrz, _repair_direct_line2, _score_direct_line2
from services.ocr_result_cache import clear_ocr_result_cache
from services.passport_page import clear_passport_page_cache, collect_ocr_lines, extract_aligned_passport_page
from main import _can_infer_missing_issue_date, _select_panel_field_names, _select_visual_field_names, _should_refine_names


class OcrPerformanceGuardTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_ocr_result_cache()
        clear_passport_page_cache()

    def tearDown(self) -> None:
        clear_ocr_result_cache()
        clear_passport_page_cache()

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

    def test_issue_date_trusts_current_expected_issue(self) -> None:
        with (
            patch("services.issue_date_extractor._collect_page_candidates") as page_candidates,
            patch("services.issue_date_extractor._collect_raw_candidates") as raw_candidates,
            patch("services.issue_date_extractor._collect_legacy_candidates") as legacy_candidates,
        ):
            result = extract_issue_date(
                "file.png",
                dob="1990-01-01",
                expiry_date="2031-01-18",
                current_value="2026-01-18",
                page=object(),
            )

        self.assertEqual(result, "2026-01-18")
        page_candidates.assert_not_called()
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

    def test_document_dates_reuses_current_complete_pair(self) -> None:
        with (
            patch("services.date_field_extractor._collect_issue_page_candidates") as issue_page,
            patch("services.date_field_extractor._collect_expiry_page_candidates") as expiry_page,
            patch("services.date_field_extractor._collect_issue_raw_candidates") as issue_raw,
            patch("services.date_field_extractor._collect_expiry_raw_candidates") as expiry_raw,
        ):
            result = extract_document_dates(
                "file.png",
                dob="1990-01-01",
                current_issue_date="2026-01-18",
                current_expiry_date="2031-01-18",
                page=object(),
            )

        self.assertEqual(result, {"issueDate": "2026-01-18", "expiryDate": "2031-01-18"})
        issue_page.assert_not_called()
        expiry_page.assert_not_called()
        issue_raw.assert_not_called()
        expiry_raw.assert_not_called()

    def test_document_dates_infers_issue_from_current_expiry_without_alignment(self) -> None:
        with patch("services.date_field_extractor.extract_aligned_passport_page") as align_page:
            result = extract_document_dates(
                "file.png",
                dob="1990-01-01",
                current_expiry_date="2031-01-18",
            )

        self.assertEqual(result, {"issueDate": "2026-01-18", "expiryDate": "2031-01-18"})
        align_page.assert_not_called()

    def test_document_dates_scans_page_before_infer_issue_date(self) -> None:
        with (
            patch("services.date_field_extractor._collect_issue_page_candidates", return_value=["2026-01-18"]),
            patch("services.date_field_extractor._collect_expiry_page_candidates", return_value=[]),
            patch("services.date_field_extractor._collect_issue_raw_candidates") as issue_raw,
            patch("services.date_field_extractor._collect_expiry_raw_candidates") as expiry_raw,
            patch("services.date_field_extractor._collect_issue_legacy_candidates") as issue_legacy,
            patch("services.date_field_extractor._collect_expiry_legacy_candidates") as expiry_legacy,
        ):
            result = extract_document_dates(
                "file.png",
                dob="1990-01-01",
                current_expiry_date="2031-01-18",
                page=object(),
            )

        self.assertEqual(result, {"issueDate": "2026-01-18", "expiryDate": "2031-01-18"})
        issue_raw.assert_not_called()
        expiry_raw.assert_not_called()
        issue_legacy.assert_not_called()
        expiry_legacy.assert_not_called()

    def test_visual_field_stops_after_stable_candidate(self) -> None:
        with (
            patch("services.indonesia_field_ocr.crop_relative", side_effect=[object(), object()]),
            patch("services.indonesia_field_ocr.scan_region_texts", side_effect=[["18 JAN 2031", "18 JAN 2031"], ["17 JAN 2031"]]) as scanner,
        ):
            result = _extract_field(object(), "expiryDate")

        self.assertEqual(result, "2031-01-18")
        self.assertEqual(scanner.call_count, 1)

    def test_visual_field_scope_limits_extracted_fields(self) -> None:
        page = object()
        with (
            patch("services.indonesia_field_ocr.configure_tesseract", return_value=True),
            patch("services.indonesia_field_ocr.extract_aligned_passport_page", return_value=page),
            patch(
                "services.indonesia_field_ocr._extract_field",
                side_effect=lambda _page, field_name: field_name.upper(),
            ) as extractor,
        ):
            result = extract_visual_fields(
                "file.png",
                field_names=("placeOfBirth", "issuingOffice", "unknown"),
            )

        self.assertEqual(result, {"placeOfBirth": "PLACEOFBIRTH", "issuingOffice": "ISSUINGOFFICE"})
        self.assertEqual(
            [call.args[1] for call in extractor.call_args_list],
            ["placeOfBirth", "issuingOffice"],
        )

    def test_panel_fallback_skips_visual_when_panel_has_needed_fields(self) -> None:
        parsed = {
            "firstName": "MUHAMMAD",
            "familyName": "DZAKI",
            "passportNumber": "E8710843",
            "nationality": "INDONESIA",
            "dob": "2012-05-02",
            "issueDate": "2025-01-07",
            "expiryDate": "2030-01-07",
            "gender": "MALE",
        }
        panel_fields = {
            "fullName": "MUHAMMAD DZAKI",
            "placeOfBirth": "BERAU",
            "issuingOffice": "TANJUNG REDEB",
            "nationality": "INDONESIA",
            "dob": "2012-05-02",
            "issueDate": "2025-01-07",
            "expiryDate": "2030-01-07",
            "gender": "MALE",
        }

        result = _select_visual_field_names(parsed, {"confidence": 0.3}, True, panel_fields)

        self.assertEqual(result, ())

    def test_panel_fallback_visual_scope_only_requests_missing_optional_locations(self) -> None:
        parsed = {
            "firstName": "MAWAR",
            "familyName": "RANI",
            "passportNumber": "X6725064",
            "nationality": "INDONESIA",
            "dob": "1995-01-28",
            "issueDate": "2025-11-26",
            "expiryDate": "2030-11-26",
            "gender": "FEMALE",
        }
        panel_fields = {
            "fullName": "MAWAR NURANI LA RANI",
            "issuingOffice": "TANJUNG REDEB",
            "nationality": "INDONESIA",
            "dob": "1995-01-28",
            "issueDate": "2025-11-26",
            "expiryDate": "2030-11-26",
            "gender": "FEMALE",
        }

        result = _select_visual_field_names(parsed, {"confidence": 0.3}, True, panel_fields)

        self.assertEqual(result, ("placeOfBirth",))

    def test_direct_mrz_panel_scope_skips_fields_available_from_mrz(self) -> None:
        parsed = {
            "firstName": "KARIM ALFARIZI",
            "familyName": "RAMADAN",
            "passportNumber": "E8710852",
            "nationality": "INDONESIA",
            "dob": "2019-06-01",
            "issueDate": "",
            "expiryDate": "2030-01-08",
            "gender": "MALE",
        }

        result = _select_panel_field_names(parsed, {"notes": "MRZ recovered from direct lower-band OCR."})

        self.assertEqual(result, ("placeOfBirth", "issuingOffice"))

    def test_direct_mrz_with_good_names_skips_name_scan_without_panel_name(self) -> None:
        parsed = {
            "firstName": "KARIM ALFARIZI",
            "familyName": "RAMADAN",
        }

        self.assertFalse(
            _should_refine_names(
                parsed,
                {"confidence": 1.0, "notes": "MRZ recovered from direct lower-band OCR."},
                panel_fallback_used=True,
                preferred_full_name="",
            )
        )

    def test_missing_issue_with_expiry_can_skip_page_alignment(self) -> None:
        parsed = {
            "dob": "2019-06-01",
            "issueDate": "",
            "expiryDate": "2030-01-08",
        }

        self.assertTrue(_can_infer_missing_issue_date(parsed))

    def test_aligned_page_cache_reuses_failed_alignment(self) -> None:
        with (
            patch("services.passport_page.cv2", object()),
            patch("services.passport_page.MRZPipeline", object()),
            patch("services.passport_page.configure_tesseract", return_value=True),
            patch("services.passport_page._extract_page_from_path", return_value=None) as extract_page,
            patch("services.passport_page.temporary_mrz_variants", return_value=_EmptyVariants()),
        ):
            first = extract_aligned_passport_page("missing-page.png")
            second = extract_aligned_passport_page("missing-page.png")

        self.assertIsNone(first)
        self.assertIsNone(second)
        self.assertEqual(extract_page.call_count, 1)

    def test_direct_mrz_line2_repairs_nationality_ocr_confusion(self) -> None:
        line2 = _repair_direct_line2("X6725064<91DN9501289F30112616403066801000176")

        self.assertEqual(line2[10:13], "IDN")
        self.assertEqual(_score_direct_line2(line2), 3)

        self.assertEqual(_repair_direct_line2("X6724738<410N9407015M30110546403090107000640")[10:13], "IDN")
        self.assertEqual(_repair_direct_line2("E1685106<71IDN7308107M3302060640303100800027")[10:13], "IDN")

    def test_indonesian_direct_mrz_skips_passporteye_variants(self) -> None:
        direct = DirectMrzResult(
            line1="P<IDNRAMADAN<<KARIM<ALFARIZI<<<<<<<<<<<<<<<<",
            line2="E8710852<5IDN1906017M30010866403050106000214",
            valid_score=100,
        )
        with (
            patch("services.mrz_extractor._read_direct_mrz", return_value=direct),
            patch("services.mrz_extractor._read_mrz") as read_mrz,
        ):
            mrz, note = _read_best_mrz("file.png")

        self.assertIs(mrz, direct)
        self.assertIn("direct lower-band OCR", note)
        read_mrz.assert_not_called()


class _EmptyVariants:
    def __enter__(self) -> list[tuple[str, str]]:
        return [("missing-page.png", "")]

    def __exit__(self, *args: object) -> bool:
        return False


if __name__ == "__main__":
    unittest.main()
