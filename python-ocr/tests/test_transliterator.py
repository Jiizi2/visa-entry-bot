from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.transliterator import transliterate_name


class TransliteratorTests(unittest.TestCase):
    def test_common_given_name_overrides(self) -> None:
        self.assertEqual(transliterate_name("MUHAMMAD"), "\u0645\u062d\u0645\u062f")
        self.assertEqual(transliterate_name("AHMAD"), "\u0623\u062d\u0645\u062f")
        self.assertEqual(transliterate_name("FATIMAH"), "\u0641\u0627\u0637\u0645\u0629")

    def test_islamic_particles_are_normalized(self) -> None:
        self.assertEqual(
            transliterate_name("ABDUL ALLAH BIN UMAR"),
            "\u0639\u0628\u062f \u0627\u0644\u0644\u0647 \u0628\u0646 \u0639\u0645\u0631",
        )
        self.assertEqual(
            transliterate_name("AL FARISI BINTI AISYAH"),
            "\u0627\u0644 \u0641\u0627\u0631\u0633\u064a \u0628\u0646\u062a \u0639\u0627\u0626\u0634\u0629",
        )

    def test_apostrophe_maps_to_arabic_marker(self) -> None:
        self.assertEqual(transliterate_name("SYAFI'I"), "\u0634\u0627\u0641\u0639\u064a")
        self.assertEqual(transliterate_name("'ALI"), "\u0639\u0644\u064a")

    def test_short_words_keep_middle_vowels(self) -> None:
        self.assertEqual(transliterate_name("SITI"), "\u0633\u064a\u062a\u064a")

    def test_batch_override_file_is_used(self) -> None:
        self.assertEqual(transliterate_name("MAULANA"), "\u0645\u0648\u0644\u0627\u0646\u0627")
        self.assertEqual(transliterate_name("NURHIDAYAH"), "\u0646\u0648\u0631 \u0647\u062f\u0627\u064a\u0629")


if __name__ == "__main__":
    unittest.main()
