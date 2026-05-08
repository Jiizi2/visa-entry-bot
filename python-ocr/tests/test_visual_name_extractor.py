from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.visual_name_extractor import refine_names_from_scan  # noqa: E402


class VisualNameExtractorTests(unittest.TestCase):
    def test_single_word_mrz_name_rejects_visual_given_name_noise(self) -> None:
        parsed, note = refine_names_from_scan(
            "unused.png",
            {"firstName": "", "familyName": "MARGONO"},
            preferred_full_name="JINEATEN MARGONO",
        )

        self.assertEqual(parsed["firstName"], "MARGONO")
        self.assertEqual(parsed["familyName"], "MARGONO")
        self.assertEqual(note, "SINGLE-WORD NAME DUPLICATED TO SATISFY REQUIRED FIELDS")

    def test_preferred_name_restores_missing_leading_family_letter(self) -> None:
        parsed, note = refine_names_from_scan(
            "unused.png",
            {"firstName": "ADEN", "familyName": "USTOMI"},
            preferred_full_name="ADEN BUSTOMI",
        )

        self.assertEqual(parsed["firstName"], "ADEN")
        self.assertEqual(parsed["familyName"], "BUSTOMI")
        self.assertEqual(note, "NAME NORMALIZED FROM FULL NAME FIELD")

    def test_preferred_name_uses_filename_style_suffix_despite_mrz_noise(self) -> None:
        parsed, _ = refine_names_from_scan(
            "unused.png",
            {"firstName": "", "familyName": "NSUDRAGAT"},
            preferred_full_name="ALSA SALSABILA SUDRAJAT",
        )

        self.assertEqual(parsed["firstName"], "ALSA SALSABILA")
        self.assertEqual(parsed["familyName"], "SUDRAJAT")

    def test_preferred_name_strips_visual_prefix_noise_without_filename(self) -> None:
        parsed, _ = refine_names_from_scan(
            "unused.png",
            {"firstName": "", "familyName": "SAPUTRA"},
            preferred_full_name="SIG KIRANA AYU SAPUTRA",
        )

        self.assertEqual(parsed["firstName"], "KIRANA AYU")
        self.assertEqual(parsed["familyName"], "SAPUTRA")

        parsed, _ = refine_names_from_scan(
            "unused.png",
            {"firstName": "", "familyName": "SAPUTRA"},
            preferred_full_name="AGES KEAN WIJAYA SAPUTRA",
        )

        self.assertEqual(parsed["firstName"], "KEAN WIJAYA")
        self.assertEqual(parsed["familyName"], "SAPUTRA")

    def test_preferred_name_repairs_noisy_family_spelling_from_visual(self) -> None:
        parsed, note = refine_names_from_scan(
            "unused.png",
            {"firstName": "ATIE", "familyName": "RACHMIATLE"},
            preferred_full_name="ATIE RACHMIATIE",
        )

        self.assertEqual(parsed["firstName"], "ATIE")
        self.assertEqual(parsed["familyName"], "RACHMIATIE")
        self.assertEqual(note, "NAME NORMALIZED FROM FULL NAME FIELD")

    def test_preferred_name_repairs_split_family_from_visual(self) -> None:
        parsed, note = refine_names_from_scan(
            "unused.png",
            {"firstName": "GITA", "familyName": "MARNI ASARI"},
            preferred_full_name="GITA MARNIKASARI",
        )

        self.assertEqual(parsed["firstName"], "GITA")
        self.assertEqual(parsed["familyName"], "MARNIKASARI")
        self.assertEqual(note, "NAME NORMALIZED FROM FULL NAME FIELD")

    def test_preferred_name_drops_leading_visual_noise_before_known_given_name(self) -> None:
        parsed, _ = refine_names_from_scan(
            "unused.png",
            {"firstName": "TRESNAS", "familyName": "WIWITAN"},
            preferred_full_name="EFDEE TRESNA WIWITAN",
        )

        self.assertEqual(parsed["firstName"], "TRESNA")
        self.assertEqual(parsed["familyName"], "WIWITAN")

        parsed, _ = refine_names_from_scan(
            "unused.png",
            {"firstName": "YENI YUNLATI", "familyName": "KUSMAN"},
            preferred_full_name="AIGF YENI YUNIATI KUSMAN",
        )

        self.assertEqual(parsed["firstName"], "YENI YUNIATI")
        self.assertEqual(parsed["familyName"], "KUSMAN")


if __name__ == "__main__":
    unittest.main()
