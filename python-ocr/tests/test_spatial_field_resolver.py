from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.ocr_observation import OcrDetailedResult, build_observation  # noqa: E402
from services.passport_ocr_index import PassportOcrIndex  # noqa: E402
from services.spatial_field_resolver import location_recovery_windows, resolve_location_fields  # noqa: E402


def observation(text: str, left: int, top: int, right: int, bottom: int, confidence: float = 0.95):
    return build_observation(
        text=text,
        confidence=confidence,
        box=((left, top), (right, top), (right, bottom), (left, bottom)),
        image_width=1000,
        image_height=1000,
    )


def index_of(*items):
    return PassportOcrIndex.from_result(OcrDetailedResult(tuple(items), 1, True, True, "test"))


class SpatialFieldResolverTests(unittest.TestCase):
    def test_damaged_date_of_birth_label_is_not_a_birth_place_anchor(self):
        result = resolve_location_fields(index_of(
            observation("TGLLAHIN/OATEOFBIRTH", 300, 440, 560, 470),
            observation("08MAR1977", 300, 485, 500, 515),
            observation("EMPAYLAHIRPACEO", 700, 440, 980, 470, confidence=0.77),
            observation("KARAWANG", 700, 485, 980, 515),
        ), ("placeOfBirth",))
        self.assertEqual(result["placeOfBirth"].value, "KARAWANG")

    def test_faint_office_label_uses_only_a_corroborated_expiry_date_row(self):
        items = (observation("INDONESIA", 300, 200, 500, 225),
            observation("01JUL2026", 300, 490, 500, 515),
            observation("01JUL2036", 750, 490, 950, 515),
            observation("KARAWANG", 750, 600, 950, 625),
            observation("P<IDNBUDI<<ALIF<<<<<<<<<<<<<<<<", 50, 700, 950, 730))
        self.assertEqual(resolve_location_fields(index_of(*items))["issuingOffice"].value, "KARAWANG")
        self.assertEqual(resolve_location_fields(index_of(*items[2:]))["issuingOffice"].value, "")

    def test_overseas_office_is_preserved_under_its_own_label(self):
        result = resolve_location_fields(index_of(observation("ISSUING OFFICE", 650, 600, 980, 630),
            observation("KBRI ABU DHABI", 650, 650, 980, 685, confidence=0.99)), ("issuingOffice",))
        self.assertEqual(result["issuingOffice"].value, "KBRI ABU DHABI")

    def test_resolves_locations_below_bilingual_labels(self) -> None:
        index = index_of(
            observation("TEMPAT LAHIR/PLACE OF BIRTH", 400, 300, 620, 320),
            observation("BERAU", 430, 330, 550, 350),
            observation("KANTOR YANG MENGELUARKAN", 400, 430, 650, 450),
            observation("ISSUING OFFICE", 430, 455, 570, 475),
            observation("TANJUNG RÉDEB", 390, 485, 650, 510),
        )

        result = resolve_location_fields(index)

        self.assertEqual(result["placeOfBirth"].value, "BERAU")
        self.assertEqual(result["issuingOffice"].value, "TANJUNG REDEB")

    def test_ignores_date_and_other_field_labels(self) -> None:
        index = index_of(
            observation("TEMPATLAHIRYPLACEOFBIRTH", 400, 300, 620, 320),
            observation("UJUNG PANDANG", 400, 330, 620, 350),
            observation("TGLHABISBERLAKU DATEOFEXPIRY", 390, 355, 650, 375),
            observation("24NOV2030", 430, 385, 570, 405),
        )

        result = resolve_location_fields(index, ("placeOfBirth",))

        self.assertEqual(result["placeOfBirth"].value, "UJUNG PANDANG")

    def test_date_of_birth_is_not_fuzzy_matched_as_place_of_birth(self) -> None:
        index = index_of(
            observation("TGL.LAHIR/DATE OF BIRTH", 300, 300, 540, 320),
            observation("03 MAR 1995", 320, 330, 500, 350),
            observation("TEMPAT LAHIR/PLACE OF BIRTH", 700, 300, 980, 320),
            observation("BERAU", 800, 330, 960, 350),
        )

        result = resolve_location_fields(index, ("placeOfBirth",))

        self.assertEqual(result["placeOfBirth"].value, "BERAU")

    def test_reports_missing_label_without_guessing_global_location(self) -> None:
        index = index_of(observation("BERAU", 400, 330, 520, 350))

        result = resolve_location_fields(index, ("placeOfBirth",))

        self.assertEqual(result["placeOfBirth"].value, "")
        self.assertEqual(result["placeOfBirth"].reason, "LABEL_NOT_FOUND")

    def test_builds_single_line_recovery_window_below_lowest_label(self) -> None:
        index = index_of(
            observation("KANTOR YANG MENGELUARKAN", 400, 430, 650, 450),
            observation("ISSUING OFFICE", 430, 455, 570, 475),
        )

        windows = location_recovery_windows(index, "issuingOffice")

        self.assertEqual(len(windows), 1)
        top, bottom, left, right = windows[0]
        self.assertGreaterEqual(top, 0.477)
        self.assertGreater(bottom, top)
        self.assertLess(left, 0.43)
        self.assertGreater(right, 0.57)

    def test_resolves_birth_place_below_damaged_bilingual_label(self) -> None:
        index = index_of(
            observation("TEMPATLAHRIPLACEDFBIRTH", 700, 440, 980, 470),
            observation("BERAU", 800, 485, 960, 515),
        )

        result = resolve_location_fields(index, ("placeOfBirth",))

        self.assertEqual(result["placeOfBirth"].value, "BERAU")
        self.assertTrue(result["placeOfBirth"].label_found)

    def test_resolves_birth_place_when_gender_and_value_are_merged(self) -> None:
        index = index_of(
            observation("LAHRIPLACEOFSMTH", 700, 440, 980, 470),
            observation("LMBONTOTENGANGAE", 580, 495, 980, 525),
        )

        result = resolve_location_fields(index, ("placeOfBirth",))

        self.assertEqual(result["placeOfBirth"].value, "BONTOTENGANGAE")

    def test_preserves_confident_unlisted_birth_place_below_its_label(self) -> None:
        result = resolve_location_fields(index_of(
            observation("TEMPAT LAHIR/PLACE OF BIRTH", 700, 440, 980, 470),
            observation("SUNGAI RANYAH", 700, 485, 980, 515, confidence=0.99),
        ), ("placeOfBirth",))

        self.assertEqual(result["placeOfBirth"].value, "SUNGAI RANYAH")
        self.assertEqual(result["placeOfBirth"].reason, "VALID_NEAR_LABEL")

    def test_numeric_noise_is_not_accepted_as_an_unlisted_birth_place(self) -> None:
        result = resolve_location_fields(index_of(
            observation("TEMPAT LAHIR/PLACE OF BIRTH", 700, 440, 980, 470),
            observation("31 JUL 2031", 700, 485, 980, 515, confidence=0.99),
        ), ("placeOfBirth",))

        self.assertEqual(result["placeOfBirth"].value, "")

    def test_damaged_english_birth_label_cannot_become_an_unlisted_place(self) -> None:
        result = resolve_location_fields(index_of(
            observation("TEMPAT LAHIR", 700, 440, 980, 470),
            observation("PLACEOFBRTH", 740, 475, 980, 490, confidence=0.99),
            observation("KALUMPANG", 700, 500, 980, 525, confidence=0.99),
        ), ("placeOfBirth",))

        self.assertEqual(result["placeOfBirth"].value, "KALUMPANG")
        missing = resolve_location_fields(index_of(
            observation("TEMPAT LAHIR", 700, 440, 980, 470),
            observation("PLACEOFBRTH", 740, 475, 980, 490, confidence=0.99),
        ), ("placeOfBirth",))
        self.assertEqual(missing["placeOfBirth"].value, "")

    def test_resolves_issuing_office_from_damaged_english_label(self) -> None:
        index = index_of(
            observation("ISSUWNGOFFICE", 760, 660, 960, 690),
            observation("TANJUNGREDEB", 700, 710, 960, 745),
        )

        result = resolve_location_fields(index, ("issuingOffice",))

        self.assertEqual(result["issuingOffice"].value, "TANJUNG REDEB")

    def test_resolves_issuing_office_from_standalone_kantor_label(self) -> None:
        index = index_of(
            observation("KANTOR", 650, 650, 810, 680),
            observation("BANJARMASIN", 700, 705, 970, 740),
        )

        result = resolve_location_fields(index, ("issuingOffice",))

        self.assertEqual(result["issuingOffice"].value, "BANJARMASIN")

    def test_resolves_values_glued_to_damaged_labels_without_another_ocr_pass(self) -> None:
        index = index_of(
            observation("TEMPATLAHRIPLACEOFBIRTHBERAU", 650, 430, 980, 470),
            observation("ISSUWNGOFFICETANJUNGREDEB", 650, 680, 980, 720),
        )

        result = resolve_location_fields(index)

        self.assertEqual(result["placeOfBirth"].value, "BERAU")
        self.assertEqual(result["issuingOffice"].value, "TANJUNG REDEB")

    def test_damaged_label_endings_cannot_become_issuing_cities(self) -> None:
        for label in ("KANTORYANGMENGELUAROKAN", "KANTORYANGMENGELUARICAN?", "ISSUNMGOFFICE"):
            with self.subTest(label=label):
                label_item = observation(label, 650, 660, 950, 690)
                missing = resolve_location_fields(index_of(label_item), ("issuingOffice",))
                self.assertEqual(missing["issuingOffice"].value, "")
                present = resolve_location_fields(index_of(
                    label_item, observation("TANJUNGREDEB", 700, 710, 960, 745),
                ), ("issuingOffice",))
                self.assertEqual(present["issuingOffice"].value, "TANJUNG REDEB")

    def test_short_issuing_city_glued_to_a_label_is_preserved(self) -> None:
        result = resolve_location_fields(index_of(
            observation("ISSUINGOFFICESOLO", 650, 680, 980, 720),
        ), ("issuingOffice",))
        self.assertEqual(result["issuingOffice"].value, "SOLO")


if __name__ == "__main__":
    unittest.main()
