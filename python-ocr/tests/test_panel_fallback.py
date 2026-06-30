from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.panel_fallback import (
    _best_passport_candidate,
    _build_panel,
    _clean_date,
    _extract_issuing_office_focus,
    _extract_date_fields,
    _extract_passport_number,
    _extract_passport_candidates_from_lines,
    _extract_simple_field,
    _simple_field_psm_passes,
    fuse_panel_fields,
    _pick_stable_simple_field,
    _pick_strong_name_candidate,
    _prioritized_name_windows,
    _split_full_name,
    extract_document_panel_fields,
    should_use_panel_fallback,
)
from services.panel_name_support import normalize_name_candidate


class PanelFallbackTests(unittest.TestCase):
    def test_clean_date_rejects_impossible_dates(self) -> None:
        self.assertEqual(_clean_date("31 FEB 2025"), "")
        self.assertEqual(_clean_date("11 JUL 2027"), "2027-07-11")

    def test_extract_date_fields_uses_only_date_windows(self) -> None:
        panel_modes = {
            "panel": {
                "issueDate": ((0.10, 0.20, 0.30, 0.40),),
                "expiryDate": ((0.50, 0.60, 0.70, 0.80),),
            }
        }
        with patch(
            "services.panel_fallback._collect_date_candidates",
            side_effect=[["2022-07-11"], ["2027-07-11", "1969-04-27"]],
        ) as collector, patch("services.panel_fallback.load_indonesia_panel_modes", return_value=panel_modes):
            fields = _extract_date_fields(object(), "panel", "1969-04-27")

        self.assertEqual(collector.call_count, 2)
        self.assertEqual(collector.call_args_list[0].args[1], ((0.10, 0.20, 0.30, 0.40),))
        self.assertEqual(collector.call_args_list[1].args[1], ((0.50, 0.60, 0.70, 0.80),))
        self.assertEqual(fields["issueDate"], "2022-07-11")
        self.assertEqual(fields["expiryDate"], "2027-07-11")

    def test_extract_date_fields_skips_expiry_scan_when_current_expiry_is_trusted(self) -> None:
        panel_modes = {
            "panel": {
                "issueDate": ((0.10, 0.20, 0.30, 0.40),),
                "expiryDate": ((0.50, 0.60, 0.70, 0.80),),
            }
        }
        with patch(
            "services.panel_fallback._collect_date_candidates",
            return_value=["11 JUL 2022"],
        ) as collector, patch("services.panel_fallback.load_indonesia_panel_modes", return_value=panel_modes):
            fields = _extract_date_fields(
                object(),
                "panel",
                "1969-04-27",
                requested_fields=("issueDate",),
                current_expiry_date="2027-07-11",
            )

        self.assertEqual(fields, {"issueDate": "2022-07-11"})
        self.assertEqual(collector.call_count, 1)
        self.assertEqual(collector.call_args.args[1], ((0.10, 0.20, 0.30, 0.40),))

    def test_passport_candidate_joins_neighbor_prefix(self) -> None:
        candidates = _extract_passport_candidates_from_lines(["6725064", "X"])

        self.assertEqual(_best_passport_candidate(candidates), "X6725064")

    def test_panel_passport_number_uses_strong_candidate_early_stop(self) -> None:
        with (
            patch("services.panel_fallback.crop_relative", return_value=object()),
            patch("services.panel_fallback.collect_ocr_lines", return_value=["E8710852"]) as collector,
        ):
            result = _extract_passport_number(object(), ((0.1, 0.2, 0.3, 0.4),))

        self.assertEqual(result, "E8710852")
        self.assertTrue(callable(collector.call_args.kwargs["stop_when"]))
        self.assertTrue(collector.call_args.kwargs["stop_when"](["E8710852"]))

    def test_direct_mrz_uses_panel_for_visual_fields(self) -> None:
        self.assertTrue(
            should_use_panel_fallback(
                {
                    "confidence": 1.0,
                    "notes": "MRZ recovered from direct lower-band OCR.",
                }
            )
        )

    def test_panel_field_scope_skips_unrequested_extractors(self) -> None:
        with (
            patch("services.panel_fallback._build_panel", return_value=(object(), "panel")),
            patch("services.panel_fallback._extract_name") as extract_name,
            patch("services.panel_fallback._extract_passport_number") as extract_passport,
            patch(
                "services.panel_fallback._extract_simple_field",
                side_effect=lambda _panel, _windows, field_name: field_name.upper(),
            ) as extract_simple,
            patch("services.panel_fallback._extract_date_fields") as extract_dates,
        ):
            fields = extract_document_panel_fields(
                "file.png",
                field_names=("placeOfBirth", "issuingOffice"),
            )

        self.assertEqual(fields, {"placeOfBirth": "PLACEOFBIRTH", "issuingOffice": "ISSUINGOFFICE"})
        extract_name.assert_not_called()
        extract_passport.assert_not_called()
        extract_dates.assert_not_called()
        self.assertEqual([call.args[2] for call in extract_simple.call_args_list], ["placeOfBirth", "issuingOffice"])

    def test_build_panel_downscales_large_data_page_before_windowing(self) -> None:
        large_crop = np.full((3600, 5200, 3), 255, dtype=np.uint8)
        resized_crop = np.full((1246, 1800, 3), 255, dtype=np.uint8)

        with (
            patch("services.panel_fallback._load_image", return_value=object()),
            patch("services.panel_fallback.detect_passport_data_page_crop", return_value=large_crop),
            patch("services.panel_fallback.resize_to_max_edge", return_value=resized_crop) as resize,
        ):
            panel, mode = _build_panel("sample.jpg")

        resize.assert_called_once_with(large_crop, max_edge=1800)
        self.assertEqual(mode, "compact")
        self.assertEqual(panel.shape, resized_crop.shape)

    def test_panel_location_candidate_can_stop_after_known_match(self) -> None:
        self.assertEqual(_pick_stable_simple_field("issuingOffice", ["TANJUNGREDEB"]), "TANJUNG REDEB")
        self.assertEqual(_pick_stable_simple_field("placeOfBirth", ["SDINRANG"]), "PINRANG")

    def test_panel_location_uses_psm11_before_psm7_after_psm6_misses(self) -> None:
        with (
            patch("services.panel_fallback.crop_relative", return_value=object()),
            patch("services.panel_fallback.collect_ocr_lines", side_effect=[["NOISE"], ["BERAU"]]) as collector,
        ):
            result = _extract_simple_field(object(), ((0, 1, 0, 1),), "placeOfBirth")

        self.assertEqual(result, "BERAU")
        self.assertEqual([call.kwargs["psm_values"] for call in collector.call_args_list], [(6,), (11,)])
        self.assertEqual(_simple_field_psm_passes("issuingOffice"), ((6,), (11,), (7,)))

    def test_panel_location_uses_known_location_early_stop(self) -> None:
        with (
            patch("services.panel_fallback.crop_relative", return_value=object()),
            patch("services.panel_fallback.collect_ocr_lines", return_value=["TANJUNG REDEB"]) as collector,
        ):
            result = _extract_simple_field(object(), ((0, 1, 0, 1),), "issuingOffice")

        self.assertEqual(result, "TANJUNG REDEB")
        self.assertTrue(callable(collector.call_args.kwargs["stop_when"]))
        self.assertTrue(collector.call_args.kwargs["stop_when"](["TANJUNG REDEB"]))

    def test_issuing_office_focus_reads_value_after_label(self) -> None:
        with (
            patch("services.panel_fallback.crop_relative", return_value=object()),
            patch(
                "services.panel_fallback.collect_ocr_lines",
                return_value=["KANTOR YANG MENGELUARKAN", "ISSUING OFFICE", "BANDUNG"],
            ) as collector,
        ):
            result = _extract_issuing_office_focus(object())

        self.assertEqual(result, "BANDUNG")
        self.assertTrue(collector.call_args.kwargs["stop_when"](["KANTOR YANG MENGELUARKAN", "BANDUNG"]))

    def test_panel_location_falls_back_to_issuing_office_focus_when_generic_windows_miss(self) -> None:
        with (
            patch("services.panel_fallback.crop_relative", return_value=object()),
            patch(
                "services.panel_fallback.collect_ocr_lines",
                side_effect=[
                    [],
                    [],
                    [],
                    ["KANTOR YANG MENGELUARKAN", "BANDUNG"],
                ],
            ) as collector,
        ):
            result = _extract_simple_field(object(), ((0, 1, 0, 1),), "issuingOffice")

        self.assertEqual(result, "BANDUNG")
        self.assertEqual(collector.call_count, 4)

    def test_panel_name_prioritizes_value_window_when_family_hint_exists(self) -> None:
        windows = ((1, 2, 3, 4), (5, 6, 7, 8), (9, 10, 11, 12))

        self.assertEqual(_prioritized_name_windows(windows, ["DZAKI"]), ((9, 10, 11, 12), (1, 2, 3, 4), (5, 6, 7, 8)))
        self.assertEqual(_pick_strong_name_candidate([(204, "MUHAMMAD DZAKI")], ["DZAKI"]), "MUHAMMAD DZAKI")
        self.assertEqual(_pick_strong_name_candidate([(111, "AAALAIAD AHTI DAATIADAA")], ["RANI"]), "")

    def test_panel_name_does_not_replace_unmatched_mrz_family_hint(self) -> None:
        from services.scan_context import ScanContext
        from services.models import ParsedPassportData
        ctx = ScanContext("dummy.jpg", "dummy.jpg", "balanced", 30000)
        ctx.parsed = ParsedPassportData(firstName="RASYDDIQ", familyName="MAULIDDHAN")

        notes = fuse_panel_fields(ctx, {"fullName": "RENBITIP SLSERRE SRAPEBNOM"})

        self.assertEqual(ctx.parsed["firstName"], "RASYDDIQ")
        self.assertEqual(ctx.parsed["familyName"], "MAULIDDHAN")
        self.assertEqual(notes, "")

    def test_panel_name_splits_compact_names_with_family_hint(self) -> None:
        self.assertEqual(normalize_name_candidate("MASKURDISKUNDAPUTRA", ["PUTRA"]), "MASKURDI SKUNDA PUTRA")
        self.assertEqual(normalize_name_candidate("RAYHANARIFMAULANA", ["MAULANA"]), "RAYHAN ARIF MAULANA")
        self.assertEqual(normalize_name_candidate("PURWANTO", ["PURWANTO"]), "PURWANTO")

    def test_panel_name_repairs_split_common_given_name(self) -> None:
        self.assertEqual(_split_full_name("MUHA MMAD IHSAN"), {"firstName": "MUHAMMAD", "familyName": "IHSAN"})


if __name__ == "__main__":
    unittest.main()
