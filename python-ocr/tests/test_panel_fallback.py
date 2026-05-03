from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.panel_fallback import (
    _best_passport_candidate,
    _clean_date,
    _extract_date_fields,
    _extract_passport_candidates_from_lines,
    _extract_simple_field,
    fuse_panel_fields,
    _pick_stable_simple_field,
    _pick_strong_name_candidate,
    _prioritized_name_windows,
    extract_document_panel_fields,
    should_use_panel_fallback,
)
from services.panel_name_support import normalize_name_candidate


class PanelFallbackTests(unittest.TestCase):
    def test_clean_date_rejects_impossible_dates(self) -> None:
        self.assertEqual(_clean_date("31 FEB 2025"), "")
        self.assertEqual(_clean_date("11 JUL 2027"), "2027-07-11")

    def test_extract_date_fields_uses_only_date_windows(self) -> None:
        with patch(
            "services.panel_fallback._collect_date_candidates",
            side_effect=[["2022-07-11"], ["2027-07-11", "1969-04-27"]],
        ) as collector:
            fields = _extract_date_fields(object(), "panel", "1969-04-27")

        self.assertEqual(collector.call_count, 2)
        self.assertEqual(fields["issueDate"], "2022-07-11")
        self.assertEqual(fields["expiryDate"], "2027-07-11")

    def test_passport_candidate_joins_neighbor_prefix(self) -> None:
        candidates = _extract_passport_candidates_from_lines(["6725064", "X"])

        self.assertEqual(_best_passport_candidate(candidates), "X6725064")

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

    def test_panel_location_candidate_can_stop_after_known_match(self) -> None:
        self.assertEqual(_pick_stable_simple_field("issuingOffice", ["TANJUNGREDEB"]), "TANJUNG REDEB")
        self.assertEqual(_pick_stable_simple_field("placeOfBirth", ["SDINRANG"]), "PINRANG")

    def test_panel_location_uses_psm7_only_after_psm6_misses(self) -> None:
        with (
            patch("services.panel_fallback.crop_relative", return_value=object()),
            patch("services.panel_fallback.collect_ocr_lines", side_effect=[["NOISE"], ["BERAU"]]) as collector,
        ):
            result = _extract_simple_field(object(), ((0, 1, 0, 1),), "placeOfBirth")

        self.assertEqual(result, "BERAU")
        self.assertEqual([call.kwargs["psm_values"] for call in collector.call_args_list], [(6,), (7,)])

    def test_panel_name_prioritizes_value_window_when_family_hint_exists(self) -> None:
        windows = ((1, 2, 3, 4), (5, 6, 7, 8), (9, 10, 11, 12))

        self.assertEqual(_prioritized_name_windows(windows, ["DZAKI"]), ((9, 10, 11, 12), (1, 2, 3, 4), (5, 6, 7, 8)))
        self.assertEqual(_pick_strong_name_candidate([(204, "MUHAMMAD DZAKI")], ["DZAKI"]), "MUHAMMAD DZAKI")
        self.assertEqual(_pick_strong_name_candidate([(111, "AAALAIAD AHTI DAATIADAA")], ["RANI"]), "")

    def test_panel_name_does_not_replace_unmatched_mrz_family_hint(self) -> None:
        parsed = {"firstName": "RASYDDIQ", "familyName": "MAULIDDHAN"}

        updated, notes = fuse_panel_fields(parsed, None, {"fullName": "RENBITIP SLSERRE SRAPEBNOM"})

        self.assertEqual(updated, parsed)
        self.assertEqual(notes, "")

    def test_panel_name_splits_compact_names_with_family_hint(self) -> None:
        self.assertEqual(normalize_name_candidate("MASKURDISKUNDAPUTRA", ["PUTRA"]), "MASKURDI SKUNDA PUTRA")
        self.assertEqual(normalize_name_candidate("RAYHANARIFMAULANA", ["MAULANA"]), "RAYHAN ARIF MAULANA")
        self.assertEqual(normalize_name_candidate("PURWANTO", ["PURWANTO"]), "PURWANTO")


if __name__ == "__main__":
    unittest.main()
