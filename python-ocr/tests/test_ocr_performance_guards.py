from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.date_field_extractor import extract_document_dates
from services.expiry_date_extractor import extract_expiry_date
from services.indonesia_field_ocr import (
    _extract_field,
    _extract_raw_location_field,
    extract_fast_location_fields,
    extract_visual_fields,
    get_fast_location_ocr_stats,
)
from services.issue_date_extractor import extract_issue_date
from services.mrz_extractor import _extract_direct_mrz_from_region, _read_best_mrz, _read_direct_mrz
from services.mrz_parser import DirectMrzResult, _repair_direct_line2, _score_direct_line2
from services.ocr_result_cache import clear_ocr_result_cache
from services.passport_page import clear_passport_page_cache, collect_ocr_lines, extract_aligned_passport_page
from services.visual_region_scanner import scan_region_texts
from services.data_repairs import _apply_final_name_repairs, _apply_fast_date_repairs, _apply_fast_mrz_repairs, _apply_indonesian_visual_repairs, _apply_verified_mrz_name_repairs, _apply_verified_single_word_name, _repair_impossible_expiry_date
from services.passport_logic import _can_infer_missing_issue_date, _missing_profile_visual_panel_fields, _missing_speed_location_panel_fields, _ocr_rotation_degrees, _pick_preferred_full_name, _select_balanced_visual_field_names, _select_heavy_visual_field_names, _select_panel_field_names, _select_profile_panel_field_names, _select_speed_visual_field_names, _select_visual_field_names, _should_run_initial_panel_scan, _should_refine_names, _should_skip_panel_for_direct_location_only, _should_try_recovery_location_ocr, _should_try_speed_location_ocr, _visual_fields_need_aligned_page
from services.scan_budget import _build_budget_notes, _has_ocr_budget_for_elapsed, _is_balanced_scan, _is_heavy_scan, _is_speed_first_scan, _ocr_budget_ms, _ocr_profile


class OcrPerformanceGuardTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_ocr_result_cache()
        clear_passport_page_cache()

    def tearDown(self) -> None:
        clear_ocr_result_cache()
        clear_passport_page_cache()

    def test_scan_region_texts_continues_after_fallback_tesseract_error(self) -> None:
        region = np.zeros((10, 10), dtype=np.uint8)
        with (
            patch("services.visual_region_scanner.cv2", object()),
            patch("services.visual_region_scanner._build_variants", return_value=[region, region]),
            patch("services.ocr_runner.RAPID_OCR_INSTANCE", side_effect=[RuntimeError("boom"), ([[[[0,0], [1,0], [1,1], [0,1]], "TEXT", 0.99]], None)]),
        ):
            result = scan_region_texts(region, "ABCDEFGHIJKLMNOPQRSTUVWXYZ")

        self.assertEqual(result, ["TEXT"])

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

    def test_expiry_date_does_not_trust_implausible_current_value(self) -> None:
        with (
            patch("services.expiry_date_extractor._collect_page_candidates", return_value=["2031-01-18"]),
            patch("services.expiry_date_extractor._collect_raw_candidates") as raw_candidates,
            patch("services.expiry_date_extractor._collect_legacy_candidates") as legacy_candidates,
        ):
            result = extract_expiry_date(
                "file.png",
                dob="1990-01-01",
                current_value="1980-01-18",
                page=object(),
            )

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

    def test_visual_location_stops_after_known_candidate(self) -> None:
        with (
            patch("services.indonesia_field_ocr.crop_relative", side_effect=[object(), object()]),
            patch("services.indonesia_field_ocr.scan_region_texts", side_effect=[["TANJUNG REDEB"], ["NOISE"]]) as scanner,
        ):
            result = _extract_field(object(), "issuingOffice")

        self.assertEqual(result, "TANJUNG REDEB")
        self.assertEqual(scanner.call_count, 1)

    def test_visual_birth_place_tries_psm6_before_psm7(self) -> None:
        with (
            patch("services.indonesia_field_ocr.crop_relative", return_value=object()),
            patch("services.indonesia_field_ocr.scan_region_texts", return_value=["SEMARANG"]) as scanner,
        ):
            result = _extract_field(object(), "placeOfBirth")

        self.assertEqual(result, "SEMARANG")

    def test_visual_field_scope_limits_extracted_fields(self) -> None:
        page = object()
        with (
                        patch("services.indonesia_field_ocr.extract_aligned_passport_page", return_value=page),
            patch("services.indonesia_field_ocr._extract_raw_location_field", return_value=""),
            patch(
                "services.indonesia_field_ocr._extract_field",
                side_effect=lambda _page, field_name, _lines=None: field_name.upper(),
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

    def test_visual_location_uses_raw_accuracy_probe_before_aligned_page(self) -> None:
        page = object()
        raw_image = np.zeros((100, 100, 3), dtype=np.uint8)
        region = np.zeros((20, 20, 3), dtype=np.uint8)
        with (
                        patch("services.indonesia_field_ocr._extract_field") as extractor,
            patch("services.indonesia_field_ocr._load_image", return_value=raw_image),
            patch("services.indonesia_field_ocr.crop_relative", return_value=region),
            patch("services.indonesia_field_ocr.scan_region_texts", return_value=["PACITAN"]) as scanner,
        ):
            result = extract_visual_fields("file.png", page=page, field_names=("placeOfBirth",))

        self.assertEqual(result, {"placeOfBirth": "PACITAN"})
        extractor.assert_not_called()
        self.assertEqual(scanner.call_args.kwargs["variant_mode"], "fast")
        self.assertFalse(scanner.call_args.kwargs["include_psm_fallback"])

    def test_fast_location_fields_scan_raw_right_side_windows_without_preprocess_by_default(self) -> None:
        image = np.zeros((100, 100, 3), dtype=np.uint8)
        processed = np.zeros((100, 100), dtype=np.uint8)
        region = np.zeros((10, 10), dtype=np.uint8)
        with (
            patch.dict("os.environ", {"PASSPORT_FAST_LOCATION_PREPROCESS": ""}, clear=False),
                        patch("services.indonesia_field_ocr.build_processed_document_image", return_value=processed) as preprocess,
            patch("services.indonesia_field_ocr._load_image", return_value=image),
            patch("services.indonesia_field_ocr.crop_relative", return_value=region),
            patch(
                "services.indonesia_field_ocr.scan_region_texts",
                side_effect=[["TEMPAT LAHIR PAREPARE"], ["KANTOR YANG MENGELUARKAN PARE PARE"]],
            ) as scanner,
        ):
            result = extract_fast_location_fields("file.png")

        self.assertEqual(result, {"placeOfBirth": "PAREPARE", "issuingOffice": "PAREPARE"})
        preprocess.assert_not_called()
        self.assertEqual(scanner.call_count, 2)
        self.assertTrue(all(call.kwargs["variant_mode"] == "fast" for call in scanner.call_args_list))
        self.assertTrue(all(call.kwargs["include_psm_fallback"] is False for call in scanner.call_args_list))
        stats = get_fast_location_ocr_stats()
        self.assertEqual(stats["requestedFields"], ["placeOfBirth", "issuingOffice"])
        self.assertEqual(stats["foundFields"], ["issuingOffice", "placeOfBirth"])
        self.assertEqual(stats["cropAttempts"], 2)
        self.assertEqual(stats["scanCalls"], 2)
        self.assertEqual(stats["debugSamples"], [])

    def test_fast_location_debug_records_raw_candidates_when_enabled(self) -> None:
        image = np.zeros((100, 100, 3), dtype=np.uint8)
        region = np.zeros((10, 10), dtype=np.uint8)
        with (
            patch.dict("os.environ", {"PASSPORT_LOCATION_OCR_DEBUG": "1"}, clear=False),
                        patch("services.indonesia_field_ocr._load_image", return_value=image),
            patch("services.indonesia_field_ocr.crop_relative", return_value=region),
            patch("services.indonesia_field_ocr.scan_region_texts", return_value=["TEMPAT LAHIR PAREPARE"]),
        ):
            result = extract_fast_location_fields("file.png", field_names=("placeOfBirth",))

        self.assertEqual(result, {"placeOfBirth": "PAREPARE"})
        stats = get_fast_location_ocr_stats()
        self.assertTrue(stats["debugEnabled"])
        self.assertEqual(stats["debugSamples"][0]["field"], "placeOfBirth")
        self.assertIn("TEMPAT LAHIR PAREPARE", stats["debugSamples"][0]["raw"])

    def test_fast_location_preprocess_is_opt_in_fallback_for_missing_fields(self) -> None:
        image = np.zeros((100, 100, 3), dtype=np.uint8)
        processed = np.zeros((100, 100), dtype=np.uint8)
        with (
            patch.dict("os.environ", {"PASSPORT_FAST_LOCATION_PREPROCESS": "fallback"}, clear=False),
                        patch("services.indonesia_field_ocr._load_image", return_value=image),
            patch("services.indonesia_field_ocr.build_processed_document_image", return_value=processed) as preprocess,
            patch(
                "services.indonesia_field_ocr._extract_fast_location_from_image",
                side_effect=["", "PAREPARE", "PAREPARE"],
            ) as extractor,
        ):
            result = extract_fast_location_fields("file.png")

        self.assertEqual(result, {"placeOfBirth": "PAREPARE", "issuingOffice": "PAREPARE"})
        preprocess.assert_called_once_with("file.png")
        self.assertEqual(extractor.call_args_list[0].args, (image, "placeOfBirth"))
        self.assertEqual(extractor.call_args_list[1].args, (image, "issuingOffice"))
        self.assertEqual(extractor.call_args_list[2].args, (processed, "placeOfBirth"))

    def test_fast_location_fields_use_label_neighbor_value_without_extra_windows(self) -> None:
        image = np.zeros((100, 100, 3), dtype=np.uint8)
        region = np.zeros((10, 10), dtype=np.uint8)
        with (
            patch.dict("os.environ", {"PASSPORT_FAST_LOCATION_PREPROCESS": ""}, clear=False),
                        patch("services.indonesia_field_ocr._load_image", return_value=image),
            patch("services.indonesia_field_ocr.crop_relative", return_value=region),
            patch(
                "services.indonesia_field_ocr.scan_region_texts",
                return_value=["TEMPAT LAHIR PLACE OF BIRTH", "PARE-PARE"],
            ) as scanner,
        ):
            result = extract_fast_location_fields("file.png", field_names=("placeOfBirth",))

        self.assertEqual(result, {"placeOfBirth": "PAREPARE"})
        self.assertEqual(scanner.call_count, 1)

    def test_fast_location_fields_rotate_raw_image_for_upside_down_passport(self) -> None:
        image = np.arange(12, dtype=np.uint8).reshape((2, 2, 3))
        captured_images = []

        def extract_from_image(image_arg: object, field_name: str) -> str:
            captured_images.append(np.array(image_arg))
            return "PAREPARE"

        with (
                        patch("services.indonesia_field_ocr._load_image", return_value=image),
            patch("services.indonesia_field_ocr.build_processed_document_image") as preprocess,
            patch("services.indonesia_field_ocr._extract_fast_location_from_image", side_effect=extract_from_image),
        ):
            result = extract_fast_location_fields(
                "file.png",
                field_names=("placeOfBirth",),
                rotation_degrees=180,
            )

        self.assertEqual(result, {"placeOfBirth": "PAREPARE"})
        np.testing.assert_array_equal(captured_images[0], image[::-1, ::-1])
        preprocess.assert_not_called()

    def test_fast_location_fields_rotate_raw_image_for_sideways_passport(self) -> None:
        image = np.arange(18, dtype=np.uint8).reshape((2, 3, 3))
        captured_images = []

        def extract_from_image(image_arg: object, field_name: str) -> str:
            captured_images.append(np.array(image_arg))
            return "PAREPARE"

        with (
                        patch("services.indonesia_field_ocr._load_image", return_value=image),
            patch("services.indonesia_field_ocr.build_processed_document_image") as preprocess,
            patch("services.indonesia_field_ocr._extract_fast_location_from_image", side_effect=extract_from_image),
        ):
            result = extract_fast_location_fields(
                "file.png",
                field_names=("placeOfBirth",),
                rotation_degrees=90,
            )

        self.assertEqual(result, {"placeOfBirth": "PAREPARE"})
        np.testing.assert_array_equal(captured_images[0], np.rot90(image, 3))
        preprocess.assert_not_called()

    def test_visual_location_falls_back_to_default_when_fast_probe_is_unstable(self) -> None:
        raw_image = np.zeros((100, 100, 3), dtype=np.uint8)
        region = np.zeros((20, 20, 3), dtype=np.uint8)
        with (
            patch("services.indonesia_field_ocr._load_image", return_value=raw_image),
            patch("services.indonesia_field_ocr.crop_relative", return_value=region),
            patch(
                "services.indonesia_field_ocr.RAW_LOCATION_WINDOWS",
                {"issuingOffice": ((0, 1, 0, 1),)},
            ),
            patch("services.indonesia_field_ocr.RAW_LOCATION_WINDOW_ORDER", {"issuingOffice": (0,)}),
            patch(
                "services.indonesia_field_ocr._weighted_raw_location_texts",
                side_effect=[
                    [("KARAWANG", 5), ("CIANJUR", 4)],
                    [("BANDUNG", 5)],
                ],
            ),
            patch(
                "services.indonesia_field_ocr.scan_region_texts",
                side_effect=[["raw"], ["raw"]],
            ) as scanner,
        ):
            result = _extract_raw_location_field("file.png", "issuingOffice")

        self.assertEqual(result, "BANDUNG")
        self.assertEqual([call.kwargs["variant_mode"] for call in scanner.call_args_list], ["fast", "default"])

    def test_visual_location_uses_aligned_page_when_raw_probe_misses(self) -> None:
        with (
                        patch("services.indonesia_field_ocr._extract_raw_location_field", return_value=""),
            patch("services.indonesia_field_ocr._extract_field", return_value="PACITAN"),
        ):
            result = extract_visual_fields("file.png", page=object(), field_names=("placeOfBirth",))

        self.assertEqual(result, {"placeOfBirth": "PACITAN"})

    def test_visual_fields_use_processed_document_when_alignment_fails(self) -> None:
        processed_page = object()
        with (
                        patch("services.indonesia_field_ocr._extract_raw_location_field", return_value=""),
            patch("services.indonesia_field_ocr.extract_aligned_passport_page", return_value=None),
            patch("services.indonesia_field_ocr.build_processed_document_image", return_value=processed_page) as preprocess,
            patch("services.indonesia_field_ocr._extract_field", return_value="PACITAN") as extractor,
        ):
            result = extract_visual_fields("file.png", field_names=("placeOfBirth",))

        self.assertEqual(result, {"placeOfBirth": "PACITAN"})
        preprocess.assert_called_once_with("file.png")
        extractor.assert_called_once_with(processed_page, "placeOfBirth", [])

    def test_visual_location_can_skip_aligned_fallback_after_raw_probe_misses(self) -> None:
        with (
                        patch("services.indonesia_field_ocr._extract_raw_location_field", return_value=""),
            patch("services.indonesia_field_ocr.extract_aligned_passport_page") as align_page,
        ):
            result = extract_visual_fields(
                "file.png",
                field_names=("placeOfBirth",),
                allow_aligned_fallback=False,
            )

        self.assertEqual(result, {})
        align_page.assert_not_called()

    def test_location_only_visual_scope_can_skip_aligned_page(self) -> None:
        self.assertFalse(_visual_fields_need_aligned_page(("placeOfBirth", "issuingOffice")))
        self.assertTrue(_visual_fields_need_aligned_page(("placeOfBirth", "fullName")))
        self.assertTrue(_visual_fields_need_aligned_page(None))

    def test_panel_fallback_still_verifies_locations_when_panel_has_needed_fields(self) -> None:
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

        self.assertEqual(result, ("placeOfBirth", "issuingOffice"))

    def test_panel_fallback_visual_scope_always_rechecks_optional_locations(self) -> None:
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

        self.assertEqual(result, ("placeOfBirth", "issuingOffice"))

    def test_fast_visual_scope_skips_issue_date_when_it_can_be_inferred(self) -> None:
        parsed = {
            "firstName": "MUHAMMAD FADIL",
            "familyName": "HAZIQ",
            "passportNumber": "E9229500",
            "nationality": "INDONESIA",
            "dob": "2007-08-27",
            "issueDate": "",
            "expiryDate": "2035-07-10",
            "gender": "MALE",
        }

        result = _select_visual_field_names(parsed, {"confidence": 1.0}, False, {})

        self.assertEqual(result, ("placeOfBirth", "issuingOffice"))

    def test_balanced_visual_scope_rechecks_issue_date_even_when_it_can_be_inferred(self) -> None:
        parsed = {
            "firstName": "MUHAMMAD FADIL",
            "familyName": "HAZIQ",
            "passportNumber": "E9229500",
            "nationality": "INDONESIA",
            "dob": "2007-08-27",
            "issueDate": "",
            "expiryDate": "2035-07-10",
            "gender": "MALE",
        }

        result = _select_balanced_visual_field_names(parsed, {"confidence": 1.0}, False, {})

        self.assertEqual(result, ("placeOfBirth", "issuingOffice", "issueDate"))

    def test_speed_visual_scope_only_reads_location_fields_for_indonesian_hint(self) -> None:
        parsed = {
            "passportNumber": "X6725064",
            "nationality": "",
            "dob": "",
            "expiryDate": "",
            "gender": "",
        }
        extraction = {"data": {"line2": "X6725064<91DN9501289F30112616403066801000176"}}

        self.assertEqual(_select_speed_visual_field_names(parsed, extraction), ("placeOfBirth", "issuingOffice"))
        self.assertEqual(_select_speed_visual_field_names(parsed, {"data": {"line2": "A1234567<8USA9001011M3001012<<<<<<<<<<<<<<04"}}), ())

    def test_speed_location_ocr_skips_ambiguous_indonesian_passport_numbers_by_default(self) -> None:
        parsed = {
            "passportNumber": "E8710852",
            "nationality": "",
            "dob": "2019-06-01",
            "expiryDate": "2030-01-08",
            "gender": "MALE",
        }

        with patch.dict("os.environ", {"PASSPORT_LOCATION_OCR_AMBIGUOUS": ""}, clear=False):
            self.assertFalse(_should_try_speed_location_ocr(parsed, {"data": {"country": ""}}))
            self.assertEqual(_select_speed_visual_field_names(parsed, {"data": {"country": ""}}), ())

    def test_speed_location_ocr_can_opt_in_for_ambiguous_indonesian_passport_numbers(self) -> None:
        parsed = {
            "passportNumber": "E8710852",
            "nationality": "",
            "dob": "2019-06-01",
            "expiryDate": "2030-01-08",
            "gender": "MALE",
        }

        with patch.dict("os.environ", {"PASSPORT_LOCATION_OCR_AMBIGUOUS": "1"}, clear=False):
            self.assertTrue(_should_try_speed_location_ocr(parsed, {"data": {"country": ""}}))
            self.assertEqual(_select_speed_visual_field_names(parsed, {"data": {"country": ""}}), ("placeOfBirth", "issuingOffice"))

    def test_recovery_location_ocr_allows_ambiguous_indonesian_passport_without_speed_opt_in(self) -> None:
        parsed = {
            "passportNumber": "E8710852",
            "nationality": "",
            "dob": "2019-06-01",
            "expiryDate": "2030-01-08",
            "gender": "MALE",
        }

        self.assertTrue(_should_try_recovery_location_ocr(parsed, {"data": {"country": ""}}))
        self.assertFalse(
            _should_try_recovery_location_ocr(
                {**parsed, "passportNumber": "A1234567", "nationality": "UNITED STATES"},
                {"data": {"country": "USA"}},
            )
        )

    def test_speed_location_ocr_skips_clear_non_indonesian_mrz(self) -> None:
        parsed = {
            "passportNumber": "A1234567",
            "nationality": "UNITED STATES",
            "dob": "1990-01-01",
            "expiryDate": "2030-01-01",
            "gender": "MALE",
        }
        extraction = {"data": {"country": "USA", "line1": "P<USADOE<<JOHN<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<"}}

        self.assertFalse(_should_try_speed_location_ocr(parsed, extraction))
        self.assertEqual(_select_speed_visual_field_names(parsed, extraction), ())

    def test_speed_panel_fallback_targets_only_missing_location_fields(self) -> None:
        self.assertEqual(
            _missing_speed_location_panel_fields(("placeOfBirth", "issuingOffice"), {}),
            ("placeOfBirth", "issuingOffice"),
        )
        self.assertEqual(
            _missing_speed_location_panel_fields(
                ("placeOfBirth", "issuingOffice"),
                {"placeOfBirth": "BERAU", "issuingOffice": ""},
            ),
            ("issuingOffice",),
        )
        self.assertEqual(
            _missing_speed_location_panel_fields(
                ("placeOfBirth", "issuingOffice", "fullName"),
                {"placeOfBirth": "BERAU", "issuingOffice": "TANJUNG REDEB"},
            ),
            (),
        )
        self.assertEqual(_missing_speed_location_panel_fields((), {}), ())
        self.assertEqual(_missing_speed_location_panel_fields(None, {}), ())

    def test_balanced_panel_recovery_targets_missing_review_fields_only(self) -> None:
        result = _missing_profile_visual_panel_fields(
            "balanced",
            ("placeOfBirth", "issuingOffice", "issueDate", "fullName"),
            {"placeOfBirth": "BERAU"},
            {},
        )

        self.assertEqual(result, ("issuingOffice", "issueDate"))

    def test_heavy_panel_recovery_targets_full_missing_visual_scope(self) -> None:
        result = _missing_profile_visual_panel_fields(
            "heavy",
            None,
            {"placeOfBirth": "BERAU"},
            {"passportNumber": "E8710852"},
        )

        self.assertEqual(
            result,
            ("issuingOffice", "issueDate", "expiryDate", "dob", "gender", "nationality", "fullName"),
        )

    def test_ocr_rotation_degrees_uses_direct_mrz_orientation_hint(self) -> None:
        self.assertEqual(_ocr_rotation_degrees({"data": {"rotationDegrees": 90}}), 90)
        self.assertEqual(_ocr_rotation_degrees({"data": {"rotationDegrees": 180}}), 180)
        self.assertEqual(_ocr_rotation_degrees({"data": {"rotationDegrees": 270}}), 270)
        self.assertEqual(_ocr_rotation_degrees({"notes": "MRZ recovered after 90-degree rotation."}), 90)
        self.assertEqual(_ocr_rotation_degrees({"notes": "MRZ recovered after 180-degree rotation."}), 180)
        self.assertEqual(_ocr_rotation_degrees({"data": {"rotationDegrees": 0}, "notes": ""}), 0)

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

    def test_profile_panel_policy_keeps_balanced_selective_and_heavy_full_scope(self) -> None:
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
        extraction = {"confidence": 1.0, "notes": ""}

        self.assertFalse(_should_run_initial_panel_scan("speed", extraction))
        self.assertFalse(_should_run_initial_panel_scan("balanced", extraction))
        self.assertTrue(_should_run_initial_panel_scan("heavy", extraction))
        self.assertEqual(
            _select_profile_panel_field_names("heavy", parsed, extraction),
            (
                "fullName",
                "passportNumber",
                "nationality",
                "dob",
                "gender",
                "placeOfBirth",
                "issueDate",
                "expiryDate",
                "issuingOffice",
            ),
        )

    def test_direct_mrz_location_only_panel_scope_can_use_visual_path(self) -> None:
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
        extraction = {"confidence": 1.0, "notes": "MRZ recovered from direct lower-band OCR.; Image glare detected."}

        self.assertTrue(
            _should_skip_panel_for_direct_location_only(
                parsed,
                extraction,
                ("placeOfBirth", "issuingOffice"),
            )
        )
        self.assertFalse(
            _should_skip_panel_for_direct_location_only(
                parsed,
                {"confidence": 1.0, "notes": "MRZ recovered from direct lower-band OCR."},
                ("placeOfBirth", "issuingOffice"),
            )
        )
        self.assertFalse(
            _should_skip_panel_for_direct_location_only(
                parsed,
                extraction,
                ("placeOfBirth", "fullName"),
            )
        )

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

    def test_verified_single_word_mrz_keeps_visual_name_recovery_scope(self) -> None:
        extraction = {"confidence": 1.0, "mrzValidation": {"valid": True}}

        parsed, note = _apply_verified_single_word_name({"firstName": "", "familyName": "MARGONO"}, extraction)

        self.assertEqual(parsed["firstName"], "MARGONO")
        self.assertEqual(note, "SINGLE-WORD NAME DUPLICATED TO SATISFY REQUIRED FIELDS")
        self.assertIn("fullName", _select_panel_field_names(parsed, extraction))
        self.assertTrue(_should_refine_names(parsed, extraction, panel_fallback_used=True, preferred_full_name=""))

    def test_unverified_single_word_mrz_keeps_name_recovery_scope(self) -> None:
        extraction = {"confidence": 1.0, "mrzValidation": {"valid": False}}

        parsed, note = _apply_verified_single_word_name({"firstName": "", "familyName": "MARGONO"}, extraction)

        self.assertEqual(parsed, {"firstName": "", "familyName": "MARGONO"})
        self.assertEqual(note, "")
        self.assertIn("fullName", _select_panel_field_names(parsed, extraction))

    def test_verified_single_word_mrz_ignores_distinct_filename_name_hint(self) -> None:
        extraction = {"confidence": 1.0, "mrzValidation": {"valid": True}}

        parsed, note = _apply_verified_mrz_name_repairs(
            {"firstName": "", "familyName": "YUSUF"},
            extraction,
            file_name="Copy of Djumadi Yusuf.jpeg",
        )

        self.assertEqual(parsed, {"firstName": "YUSUF", "familyName": "YUSUF"})
        self.assertEqual(note, "SINGLE-WORD NAME DUPLICATED TO SATISFY REQUIRED FIELDS")
        self.assertIn("fullName", _select_panel_field_names(parsed, extraction))

    def test_verified_single_word_with_initial_filename_still_uses_mrz_only(self) -> None:
        extraction = {"confidence": 1.0, "mrzValidation": {"valid": True}}

        parsed, note = _apply_verified_mrz_name_repairs(
            {"firstName": "", "familyName": "HAMDI"},
            extraction,
            file_name="M HAMDI 1.png",
        )

        self.assertEqual(parsed["firstName"], "HAMDI")
        self.assertEqual(parsed["familyName"], "HAMDI")
        self.assertEqual(note, "SINGLE-WORD NAME DUPLICATED TO SATISFY REQUIRED FIELDS")

    def test_verified_indonesian_initial_single_name_duplicates_full_mrz_name(self) -> None:
        extraction = {"confidence": 1.0, "mrzValidation": {"valid": True}}

        parsed, note = _apply_verified_mrz_name_repairs(
            {"firstName": "M", "familyName": "HAMDI", "nationality": "INDONESIA"},
            extraction,
            file_name="M HAMDI 1.png",
        )

        self.assertEqual(parsed["firstName"], "M HAMDI")
        self.assertEqual(parsed["familyName"], "M HAMDI")
        self.assertEqual(note, "INITIAL SINGLE-NAME MRZ DUPLICATED TO SATISFY REQUIRED FIELDS")

        parsed, note = _apply_final_name_repairs(parsed)

        self.assertEqual(parsed["firstName"], "M HAMDI")
        self.assertEqual(parsed["familyName"], "M HAMDI")
        self.assertEqual(note, "")

    def test_verified_name_repairs_drop_repeated_filler_tokens(self) -> None:
        extraction = {"confidence": 1.0, "mrzValidation": {"valid": True}}

        parsed, note = _apply_verified_mrz_name_repairs(
            {"firstName": "SITI SSSSSSSSSSESSES", "familyName": "HADIJAH", "nationality": "INDONESIA"},
            extraction,
        )

        self.assertEqual(parsed["firstName"], "SITI")
        self.assertEqual(parsed["familyName"], "HADIJAH")
        self.assertEqual(note, "COMMON NAME OCR NOISE REPAIRED")

        parsed, note = _apply_verified_mrz_name_repairs(
            {"firstName": "SSSKSSSSEEE", "familyName": "SUDARWATI", "nationality": "INDONESIA"},
            extraction,
        )

        self.assertEqual(parsed["firstName"], "SUDARWATI")
        self.assertEqual(parsed["familyName"], "SUDARWATI")
        self.assertEqual(
            note,
            "COMMON NAME OCR NOISE REPAIRED; SINGLE-WORD NAME DUPLICATED TO SATISFY REQUIRED FIELDS",
        )

    def test_name_repairs_split_mrz_separator_read_as_x(self) -> None:
        parsed, note = _apply_final_name_repairs({"firstName": "ALSAXSALSABILA", "familyName": "SUDRAJAT"})

        self.assertEqual(parsed["firstName"], "ALSA SALSABILA")
        self.assertEqual(parsed["familyName"], "SUDRAJAT")
        self.assertEqual(note, "COMMON NAME OCR NOISE REPAIRED")

    def test_preferred_full_name_does_not_use_filename_for_name_repair(self) -> None:
        self.assertEqual(
            _pick_preferred_full_name(
                {"firstName": "ADEN", "familyName": "USTOMI"},
                {},
                {},
                file_name="ADEN BUSTOMI.jpg",
            ),
            "",
        )
        self.assertEqual(
            _pick_preferred_full_name(
                {"firstName": "", "familyName": "NSUDRAGAT"},
                {},
                {},
                file_name="ALSA_SALSABILA_SUDRAJAT_page_001.jpg",
            ),
            "",
        )

    def test_rejected_panel_name_does_not_fall_back_to_filename(self) -> None:
        self.assertEqual(
            _pick_preferred_full_name(
                {"firstName": "", "familyName": "NSUDRAGAT"},
                {},
                {"fullName": "OBOEEC QRSO EOSSSSR"},
                file_name="ALSA_SALSABILA_SUDRAJAT_page_001.jpg",
            ),
            "",
        )

    def test_final_name_repairs_ignore_single_filename_hints(self) -> None:
        parsed, _ = _apply_final_name_repairs({"firstName": "PUJUI", "familyName": "HARTADI"}, file_name="PUJI.png")
        self.assertEqual(parsed["firstName"], "PUJUI")

        parsed, _ = _apply_final_name_repairs({"firstName": "ROBIY ANTO", "familyName": "KASIM"}, file_name="ROBIYANTO.png")
        self.assertEqual(parsed["firstName"], "ROBIY ANTO")

        parsed, _ = _apply_final_name_repairs({"firstName": "DIANACKKRIKA", "familyName": "DIANACKKRIKA"}, file_name="RIKA.png")
        self.assertEqual(parsed["firstName"], "DIANACKKRIKA")
        self.assertEqual(parsed["familyName"], "DIANACKKRIKA")

    def test_final_name_repairs_ignore_full_filename_for_duplicate_surname_cases(self) -> None:
        parsed, note = _apply_final_name_repairs(
            {"firstName": "SAPUTRA", "familyName": "SAPUTRA"},
            file_name="KEAN_WIJAYA_SAPUTRA_page_001.jpg",
        )

        self.assertEqual(parsed["firstName"], "SAPUTRA")
        self.assertEqual(parsed["familyName"], "SAPUTRA")
        self.assertNotIn("FULL NAME REPAIRED FROM FILE NAME", note)

    def test_final_name_repairs_do_not_add_unconfirmed_filename_surname_to_single_word_name(self) -> None:
        parsed, note = _apply_final_name_repairs(
            {"firstName": "ROSIKAH", "familyName": "ROSIKAH"},
            file_name="ROSIKAH_WIRAHADI_page_001.jpg",
        )

        self.assertEqual(parsed["firstName"], "ROSIKAH")
        self.assertEqual(parsed["familyName"], "ROSIKAH")
        self.assertNotIn("FULL NAME REPAIRED FROM FILE NAME", note)

    def test_filename_full_name_does_not_replace_reliable_mrz_spelling(self) -> None:
        self.assertEqual(
            _pick_preferred_full_name(
                {"firstName": "NANANG RIDWAN", "familyName": "IYUN"},
                {},
                {},
                file_name="NANAG RIDWAN IYUN.jpg",
            ),
            "",
        )
        parsed, note = _apply_final_name_repairs(
            {"firstName": "NANANG RIDWAN", "familyName": "IYUN"},
            file_name="NANAG RIDWAN IYUN.jpg",
        )

        self.assertEqual(parsed["firstName"], "NANANG RIDWAN")
        self.assertEqual(parsed["familyName"], "IYUN")
        self.assertNotIn("FULL NAME REPAIRED FROM FILE NAME", note)

    def test_noisy_family_cases_are_sent_to_visual_name_refinement_without_filename(self) -> None:
        self.assertTrue(_should_refine_names({"firstName": "ATIE", "familyName": "RACHMIATLE"}, {"confidence": 1.0}, False, ""))
        self.assertTrue(_should_refine_names({"firstName": "GITA", "familyName": "MARNI ASARI"}, {"confidence": 1.0}, False, ""))

    def test_common_name_noise_repairs_rachmiatie_without_filename(self) -> None:
        parsed, note = _apply_final_name_repairs({"firstName": "ATIE", "familyName": "RACHMIATLE"})

        self.assertEqual(parsed["firstName"], "ATIE")
        self.assertEqual(parsed["familyName"], "RACHMIATIE")
        self.assertEqual(note, "COMMON NAME OCR NOISE REPAIRED")

    def test_noisy_panel_full_name_matching_current_name_is_not_preferred(self) -> None:
        self.assertEqual(
            _pick_preferred_full_name(
                {"firstName": "ATIE", "familyName": "RACHMIATLE"},
                {},
                {"fullName": "ATIE RACHMIATLE"},
            ),
            "",
        )
        self.assertEqual(
            _pick_preferred_full_name(
                {"firstName": "ATIE", "familyName": "RACHMIATLE"},
                {"fullName": "ATIE RACHMIATIE"},
                {"fullName": "ATIE RACHMIATLE"},
            ),
            "ATIE RACHMIATIE",
        )

    def test_final_name_repairs_ignore_full_filename_when_first_name_missing(self) -> None:
        parsed, _ = _apply_final_name_repairs(
            {"firstName": "", "familyName": "SRESPITAWULAN WANANG"},
            file_name="RESPITAWULAN_NANANG_RIDWAN_page_001.jpg",
        )

        self.assertEqual(parsed["firstName"], "")
        self.assertEqual(parsed["familyName"], "SRESPITAWULAN WANANG")

    def test_final_name_repairs_ignore_full_filename_for_shifted_family_token(self) -> None:
        parsed, _ = _apply_final_name_repairs(
            {"firstName": "TIA", "familyName": "MUTHIAH"},
            file_name="TIA_MUTHIAH_UMAR_page_001.jpg",
        )

        self.assertEqual(parsed["firstName"], "TIA")
        self.assertEqual(parsed["familyName"], "MUTHIAH")

    def test_indonesian_visual_repairs_recover_dob_from_unverified_mrz(self) -> None:
        parsed = {"nationality": "IO3", "dob": ""}
        extraction = {"data": {"line2": "27<31DN6301031F34080213204064301000896<<<<<<"}}

        result = _apply_indonesian_visual_repairs(parsed, extraction, {"placeOfBirth": "BANDUNG"})

        self.assertEqual(result["nationality"], "INDONESIA")
        self.assertEqual(result["dob"], "1963-01-03")

    def test_fast_mrz_repairs_fill_critical_fields_without_visual_scan(self) -> None:
        parsed = {
            "passportNumber": "",
            "nationality": "IO3",
            "dob": "",
            "gender": "",
        }
        extraction = {"data": {"line2": "X6725064<91DN9501289F30112616403066801000176"}}

        result, note = _apply_fast_mrz_repairs(parsed, extraction)

        self.assertEqual(result["passportNumber"], "X6725064")
        self.assertEqual(result["nationality"], "INDONESIA")
        self.assertEqual(result["dob"], "1995-01-28")
        self.assertEqual(result["gender"], "FEMALE")
        self.assertIn("NATIONALITY REPAIRED FROM MRZ HINT IN FAST SCAN", note)
        self.assertIn("PASSPORT NUMBER REPAIRED FROM MRZ HINT IN FAST SCAN", note)
        self.assertIn("DOB REPAIRED FROM MRZ HINT IN FAST SCAN", note)
        self.assertIn("GENDER REPAIRED FROM MRZ HINT IN FAST SCAN", note)

    def test_fast_mrz_repairs_ignore_non_indonesian_hint(self) -> None:
        parsed = {
            "passportNumber": "",
            "nationality": "",
            "dob": "",
            "gender": "",
        }
        extraction = {"data": {"line2": "A1234567<8USA9001011M3001012<<<<<<<<<<<<<<04"}}

        result, note = _apply_fast_mrz_repairs(parsed, extraction)

        self.assertEqual(result, parsed)
        self.assertEqual(note, "")

    def test_impossible_expiry_repair_infers_issue_from_repaired_expiry(self) -> None:
        parsed, note = _repair_impossible_expiry_date(
            {"dob": "1984-07-16", "issueDate": "", "expiryDate": "1953-03-20"}
        )

        self.assertEqual(parsed["issueDate"], "2023-03-20")
        self.assertEqual(parsed["expiryDate"], "2033-03-20")
        self.assertIn("ISSUE DATE INFERRED FROM REPAIRED EXPIRY", note)

    def test_speed_profile_is_default_and_fast_date_repair_avoids_ocr_scan(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            self.assertTrue(_is_speed_first_scan())
            self.assertFalse(_is_balanced_scan())
            self.assertEqual(_ocr_budget_ms(), 15_000)

        parsed, note = _apply_fast_date_repairs(
            {"dob": "1984-07-16", "issueDate": "", "expiryDate": "2033-03-20"}
        )

        self.assertEqual(parsed["issueDate"], "2023-03-20")
        self.assertEqual(note, "ISSUE DATE INFERRED FROM EXPIRY DATE IN FAST SCAN")

    def test_accuracy_profile_can_be_enabled_for_deep_scan(self) -> None:
        with patch.dict("os.environ", {"PASSPORT_OCR_PROFILE": "accuracy"}):
            self.assertFalse(_is_speed_first_scan())
            self.assertTrue(_is_heavy_scan())
            self.assertEqual(_ocr_profile(), "heavy")
            self.assertEqual(_ocr_budget_ms(), 90_000)

    def test_balanced_profile_uses_recovery_path_without_heavy_visual_scope(self) -> None:
        with patch.dict("os.environ", {"PASSPORT_OCR_PROFILE": "balanced"}):
            self.assertFalse(_is_speed_first_scan())
            self.assertTrue(_is_balanced_scan())
            self.assertFalse(_is_heavy_scan())
            self.assertEqual(_ocr_profile(), "balanced")
            self.assertEqual(_ocr_budget_ms(), 30_000)

    def test_ocr_budget_gates_optional_stages_by_remaining_time(self) -> None:
        self.assertTrue(_has_ocr_budget_for_elapsed(10_000, 15_000, "speed_panel"))
        self.assertFalse(_has_ocr_budget_for_elapsed(13_000, 15_000, "speed_panel"))
        self.assertTrue(_has_ocr_budget_for_elapsed(82_000, 90_000, "names"))
        self.assertEqual(_build_budget_notes(["panel", "dates"]), "OCR TIME BUDGET SKIPPED: panel, dates")

    def test_heavy_visual_scope_rechecks_all_indonesian_visual_fields(self) -> None:
        parsed = {
            "firstName": "ANI",
            "familyName": "YUNINGSIH",
            "passportNumber": "X3238127",
            "nationality": "INDONESIA",
            "dob": "1963-01-03",
            "issueDate": "2024-08-02",
            "expiryDate": "2034-08-02",
            "gender": "FEMALE",
        }

        result = _select_heavy_visual_field_names(parsed, {"confidence": 1.0}, {})

        self.assertEqual(
            result,
            (
                "placeOfBirth",
                "issuingOffice",
                "issueDate",
                "expiryDate",
                "dob",
                "gender",
                "nationality",
                "fullName",
            ),
        )

    def test_preferred_full_name_cannot_use_filename_when_family_matches(self) -> None:
        result = _pick_preferred_full_name(
            {"firstName": "", "familyName": "GHAISAN"},
            {},
            {},
            file_name="Copy of Faith Ghaisan 1.jpeg",
        )

        self.assertEqual(result, "")

    def test_verified_mrz_repairs_split_common_given_name_before_panel_scope(self) -> None:
        extraction = {"confidence": 1.0, "mrzValidation": {"valid": True}}

        parsed, note = _apply_verified_mrz_name_repairs({"firstName": "MUHA MMAD", "familyName": "IHSAN"}, extraction)

        self.assertEqual(parsed["firstName"], "MUHAMMAD")
        self.assertEqual(note, "GIVEN NAME SPACING REPAIRED FROM MRZ")
        self.assertNotIn("fullName", _select_panel_field_names(parsed, extraction))
        self.assertFalse(_should_refine_names(parsed, extraction, panel_fallback_used=True, preferred_full_name=""))

    def test_verified_mrz_strips_common_given_name_filler_before_panel_scope(self) -> None:
        extraction = {"confidence": 1.0, "mrzValidation": {"valid": True}}

        parsed, note = _apply_verified_mrz_name_repairs({"firstName": "MUHAMMADK", "familyName": "IHSAN"}, extraction)

        self.assertEqual(parsed["firstName"], "MUHAMMAD")
        self.assertEqual(note, "GIVEN NAME NOISE REPAIRED FROM MRZ")
        self.assertNotIn("fullName", _select_panel_field_names(parsed, extraction))
        self.assertFalse(_should_refine_names(parsed, extraction, panel_fallback_used=True, preferred_full_name=""))

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

    def test_rotated_indonesian_direct_mrz_skips_passporteye_variants(self) -> None:
        direct = DirectMrzResult(
            line1="P<IDNRAMADAN<<KARIM<ALFARIZI<<<<<<<<<<<<<<<<",
            line2="E8710852<5IDN1906017M30010866403050106000214",
            valid_score=100,
            rotation_degrees=180,
        )
        with (
            patch("services.mrz_extractor._read_direct_mrz", return_value=direct),
            patch("services.mrz_extractor._read_mrz") as read_mrz,
        ):
            mrz, note = _read_best_mrz("file.png")

        self.assertIs(mrz, direct)
        self.assertIn("180-degree rotation", note)
        read_mrz.assert_not_called()

    def test_direct_mrz_falls_back_to_180_degree_rotation(self) -> None:
        image = np.zeros((100, 200, 3), dtype=np.uint8)
        rotated = np.ones((100, 200, 3), dtype=np.uint8)
        direct = DirectMrzResult(
            line1="P<IDNRAMADAN<<KARIM<ALFARIZI<<<<<<<<<<<<<<<<",
            line2="E8710852<5IDN1906017M30010866403050106000214",
            valid_score=100,
        )
        with (
            patch.dict("os.environ", {"PASSPORT_OCR_PROFILE": "legacy"}),
            patch("services.mrz_extractor.cv2.imread", return_value=image),
            patch("services.mrz_extractor.detect_passport_data_page_crop", return_value=image),
            patch("services.mrz_extractor._rotate_image_180", return_value=rotated),
            patch("services.mrz_extractor._extract_direct_mrz_from_region", side_effect=[None, None, direct]) as extractor,
        ):
            result = _read_direct_mrz("file.png")

        self.assertIsNotNone(result)
        self.assertEqual(result.rotation_degrees, 180)
        self.assertEqual(extractor.call_count, 3)

    def test_direct_mrz_falls_back_to_sideways_rotation(self) -> None:
        image = np.zeros((100, 200, 3), dtype=np.uint8)
        rotated_90 = np.ones((200, 100, 3), dtype=np.uint8)
        direct = DirectMrzResult(
            line1="P<IDNRAMADAN<<KARIM<ALFARIZI<<<<<<<<<<<<<<<<",
            line2="E8710852<5IDN1906017M30010866403050106000214",
            valid_score=100,
        )
        with (
            patch.dict("os.environ", {"PASSPORT_OCR_PROFILE": "legacy"}),
            patch("services.mrz_extractor.cv2.imread", return_value=image),
            patch("services.mrz_extractor.detect_passport_data_page_crop", return_value=image),
            patch("services.mrz_extractor._rotate_image_180", return_value=image),
            patch("services.mrz_extractor._rotate_image_90", return_value=rotated_90),
            patch("services.mrz_extractor._extract_direct_mrz_from_region", side_effect=[None, None, None, None, direct]) as extractor,
        ):
            result = _read_direct_mrz("file.png")

        self.assertIsNotNone(result)
        self.assertEqual(result.rotation_degrees, 90)
        self.assertEqual(extractor.call_count, 5)

    def test_direct_mrz_skips_rotations_for_upright_landscape_mrz_band(self) -> None:
        image = np.zeros((100, 200, 3), dtype=np.uint8)
        with (
            patch.dict("os.environ", {"PASSPORT_OCR_PROFILE": "legacy"}),
            patch("services.mrz_extractor.cv2.imread", return_value=image),
            patch("services.mrz_extractor.detect_passport_data_page_crop", return_value=image),
            patch("services.mrz_extractor._mrz_band_score", return_value=180.0),
            patch("services.mrz_extractor._rotate_image_180") as rotate_180,
            patch("services.mrz_extractor._extract_direct_mrz_from_region", return_value=None) as extractor,
        ):
            result = _read_direct_mrz("file.png")

        self.assertIsNone(result)
        self.assertEqual(extractor.call_count, 2)
        rotate_180.assert_not_called()

    def test_direct_mrz_region_stops_after_high_confidence_candidate(self) -> None:
        region = np.zeros((40, 2000), dtype=np.uint8)
        text = "\n".join(
            [
                "P<IDNRAMADAN<<KARIM<ALFARIZI<<<<<<<<<<<<<<<<",
                "E8710852<5IDN1906017M30010866403050106000214",
            ]
        )
        with (
            patch("services.mrz_extractor._build_direct_mrz_variants", return_value=[region, region]),
            patch("services.mrz_extractor.run_rapid_ocr", return_value=text) as tesseract,
        ):
            result = _extract_direct_mrz_from_region(region)

        self.assertIsNotNone(result)
        self.assertEqual(result.valid_score, 100)
        self.assertEqual(tesseract.call_count, 1)

    def test_weak_indonesian_direct_mrz_does_not_short_circuit_variant(self) -> None:
        direct = DirectMrzResult(
            line1="P<IDNRAMADAN<<KARIM<ALFARIZI<<<<<<<<<<<<<<<<",
            line2="E8710852<5IDN1906017M30010866403050106000214",
            valid_score=86,
        )
        passporteye = _FakeMrz(valid_score=98, valid=True)
        with (
            patch("services.mrz_extractor._read_direct_mrz", return_value=direct),
            patch("services.mrz_extractor.temporary_mrz_variants", return_value=_FakeVariants()),
            patch("services.mrz_extractor._read_mrz", return_value=passporteye) as read_mrz,
        ):
            mrz, note = _read_best_mrz("file.png")

        self.assertIs(mrz, passporteye)
        self.assertEqual(note, "variant")
        self.assertEqual(read_mrz.call_count, 1)

    def test_non_indonesian_direct_mrz_does_not_short_circuit_better_variant(self) -> None:
        direct = DirectMrzResult(
            line1="P<USADOE<<JOHN<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<",
            line2="A1234567<8USA9001011M3001012<<<<<<<<<<<<<<04",
            valid_score=74,
        )
        passporteye = _FakeMrz(valid_score=98, valid=True)
        with (
            patch("services.mrz_extractor._read_direct_mrz", return_value=direct),
            patch("services.mrz_extractor.temporary_mrz_variants", return_value=_FakeVariants()),
            patch("services.mrz_extractor._read_mrz", return_value=passporteye) as read_mrz,
        ):
            mrz, note = _read_best_mrz("file.png")

        self.assertIs(mrz, passporteye)
        self.assertEqual(note, "variant")
        self.assertEqual(read_mrz.call_count, 1)

    def test_optimized_profile_invariants(self) -> None:
        # 1. Rotation: optimized should only yield 0°
        from services.mrz_extractor import _direct_mrz_orientation_candidates, _build_direct_mrz_variants, _extract_direct_mrz_from_region
        import numpy as np
        
        image = np.zeros((100, 200), dtype=np.uint8)
        with patch.dict("os.environ", {"PASSPORT_OCR_PROFILE": "optimized"}):
            candidates = list(_direct_mrz_orientation_candidates(image))
            self.assertEqual(len(candidates), 1)
            self.assertEqual(candidates[0][1], 0)
            
            # 2. Variant: optimized should return 3 elements (gray, clahe, otsu)
            with patch("services.mrz_extractor.time_stage"):
                variants = _build_direct_mrz_variants(image)
                self.assertEqual(len(variants), 3)

            # 3. Width: optimized should only attempt target width 1600
            with patch("services.mrz_extractor._scale_gray_image", return_value=image) as scale_mock, \
                 patch("services.mrz_extractor._process_variants_for_width", return_value=None):
                _extract_direct_mrz_from_region(image)
                # Verify we called scaling only with width 1600
                scale_mock.assert_called_once()
                self.assertEqual(scale_mock.call_args[0][1], 1600)

    def test_legacy_profile_invariants(self) -> None:
        # 1. Rotation: legacy should yield rotations (since _should_try_direct_mrz_rotations returns True)
        from services.mrz_extractor import _direct_mrz_orientation_candidates, _build_direct_mrz_variants, _extract_direct_mrz_from_region
        import numpy as np
        
        image = np.zeros((100, 200), dtype=np.uint8)
        with patch.dict("os.environ", {"PASSPORT_OCR_PROFILE": "legacy"}):
            candidates = list(_direct_mrz_orientation_candidates(image))
            # Should have rotations (0, 180, 90, 270)
            self.assertEqual(len(candidates), 4)
            self.assertEqual([c[1] for c in candidates], [0, 180, 90, 270])
            
            # 2. Variant: legacy should return 4 elements (gray, clahe, otsu, adaptive)
            with patch("services.mrz_extractor.time_stage"):
                variants = _build_direct_mrz_variants(image)
                self.assertEqual(len(variants), 4)

            # 3. Width: legacy should attempt both 1600 and 2000
            with patch("services.mrz_extractor._scale_gray_image", return_value=image) as scale_mock, \
                 patch("services.mrz_extractor._process_variants_for_width", return_value=None):
                _extract_direct_mrz_from_region(image)
                self.assertEqual(scale_mock.call_count, 2)
                called_widths = [call[0][1] for call in scale_mock.call_args_list]
                self.assertEqual(called_widths, [1600, 2000])


class _EmptyVariants:
    def __enter__(self) -> list[tuple[str, str]]:
        return [("missing-page.png", "")]

    def __exit__(self, *args: object) -> bool:
        return False


class _FakeVariants:
    def __enter__(self) -> list[tuple[str, str]]:
        return [("variant.png", "variant")]

    def __exit__(self, *args: object) -> bool:
        return False


class _FakeMrz:
    def __init__(self, valid_score: int, valid: bool) -> None:
        self.valid_score = valid_score
        self.valid = valid


if __name__ == "__main__":
    unittest.main()
