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


if __name__ == "__main__":
    unittest.main()
