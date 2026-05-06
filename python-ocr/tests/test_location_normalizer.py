from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.location_normalizer import is_known_location_value, normalize_location_value, pick_best_location_value  # noqa: E402


class LocationNormalizerTests(unittest.TestCase):
    def test_parepare_uses_single_canonical_form(self) -> None:
        self.assertEqual(normalize_location_value("placeOfBirth", "PARE PARE"), "PAREPARE")
        self.assertEqual(pick_best_location_value("placeOfBirth", ["PARE PARE", "PAREPARE"]), "PAREPARE")
        self.assertTrue(is_known_location_value("placeOfBirth", "PARE PARE"))


if __name__ == "__main__":
    unittest.main()
