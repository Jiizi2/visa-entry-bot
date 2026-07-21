from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.location_normalizer import is_known_location_value, normalize_location_value, pick_best_location_value  # noqa: E402


class LocationNormalizerTests(unittest.TestCase):
    def test_accepts_lampung_birth_places_printed_on_passports(self) -> None:
        self.assertEqual(normalize_location_value("placeOfBirth", "DAYAMURNI"), "DAYAMURNI")
        self.assertEqual(normalize_location_value("placeOfBirth", "SRIBHAWANO"), "SRIBHAWANO")
        self.assertEqual(normalize_location_value("placeOfBirth", "WANGI-WANGI SELATAN"), "WANGI-WANGI SELATAN")
        self.assertEqual(normalize_location_value("issuingOffice", "TANJUNG PERAK"), "TANJUNG PERAK")
        self.assertEqual(normalize_location_value("placeOfBirth", "BANGISRIAGUNG"), "BANGI SRI AGUNG")
        self.assertEqual(normalize_location_value("placeOfBirth", "DADI MULYO"), "DADI MULYO")
        self.assertEqual(normalize_location_value("placeOfBirth", "SAKAL"), "SAKAL")

    def test_parepare_uses_single_canonical_form(self) -> None:
        self.assertEqual(normalize_location_value("placeOfBirth", "PARE PARE"), "PAREPARE")
        self.assertEqual(pick_best_location_value("placeOfBirth", ["PARE PARE", "PAREPARE"]), "PAREPARE")
        self.assertTrue(is_known_location_value("placeOfBirth", "PARE PARE"))

    def test_normalizes_split_banjarmasin_and_tanjong_redeb_aliases(self) -> None:
        self.assertEqual(normalize_location_value("placeOfBirth", "BANJARMA SIN"), "BANJARMASIN")
        self.assertEqual(normalize_location_value("placeOfBirth", "PALANGKARAYA"), "PALANGKA RAYA")
        self.assertEqual(normalize_location_value("issuingOffice", "PALANGKA RAYA"), "PALANGKARAYA")
        self.assertEqual(normalize_location_value("issuingOffice", "TANJONG REDEB"), "TANJUNG REDEB")
        self.assertEqual(
            pick_best_location_value("issuingOffice", ["TANJUNGREDES", "TANJUNGREDEB", "TANJUNG", "TANJUNG"]),
            "TANJUNG REDEB",
        )
        self.assertEqual(normalize_location_value("issuingOffice", "TANJUNGREDES"), "TANJUNG REDEB")
        self.assertTrue(is_known_location_value("placeOfBirth", "SEMARANG"))
        self.assertTrue(is_known_location_value("placeOfBirth", "PACITAN"))

    def test_new_prod_locations_are_not_dropped_as_unknown(self) -> None:
        self.assertEqual(normalize_location_value("placeOfBirth", "BOGOR"), "BOGOR")
        self.assertEqual(normalize_location_value("issuingOffice", "BANDUNG"), "BANDUNG")
        self.assertEqual(normalize_location_value("placeOfBirth", "TSEP LMMALANG"), "MALANG")
        self.assertEqual(normalize_location_value("placeOfBirth", "COPIEKARAWANG"), "KARAWANG")
        self.assertEqual(normalize_location_value("issuingOffice", "BSSCIANIJUR"), "CIANJUR")
        self.assertEqual(normalize_location_value("issuingOffice", "JAKARTA PUSAT"), "JAKARTA PUSAT")
        self.assertEqual(pick_best_location_value("placeOfBirth", ["BSSBOG OR"]), "BOGOR")
        self.assertEqual(pick_best_location_value("placeOfBirth", ["LT", "LT"]), "")

    def test_common_ocr_confusions_and_more_cities_are_normalized(self) -> None:
        self.assertEqual(normalize_location_value("placeOfBirth", "8ANDUNG"), "BANDUNG")
        self.assertEqual(normalize_location_value("placeOfBirth", "JAKAR7A"), "JAKARTA")
        self.assertEqual(normalize_location_value("issuingOffice", "PARE-PARE"), "PAREPARE")
        self.assertEqual(normalize_location_value("placeOfBirth", "SURABAYA"), "SURABAYA")
        self.assertEqual(normalize_location_value("issuingOffice", "DENPASAR"), "DENPASAR")


if __name__ == "__main__":
    unittest.main()
