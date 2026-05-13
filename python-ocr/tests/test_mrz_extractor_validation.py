from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.mrz_extractor import _build_mrz_validation, _build_validation_note, _repair_direct_line1, _repair_direct_line2, _repair_extracted_mrz_data  # noqa: E402


class MrzExtractorValidationTests(unittest.TestCase):
    def test_builds_validation_from_explicit_line2(self) -> None:
        result = _build_mrz_validation({"line2": "E8710852<5IDN1906017M30010866403050106000214"})

        self.assertTrue(result.valid)
        self.assertEqual(result.valid_check_count, 5)
        self.assertEqual(_build_validation_note(result), "MRZ checksum valid.")

    def test_builds_validation_from_raw_text_when_line2_missing(self) -> None:
        result = _build_mrz_validation(
            {
                "raw_text": (
                    "P<IDNRAMADAN<<KARIM<ALFARIZI<<<<<<<<<<<<<<<<\n"
                    "E8710852<5IDN1906017M30010866403050106000214"
                )
            }
        )

        self.assertTrue(result.valid)
        self.assertEqual(result.line2, "E8710852<5IDN1906017M30010866403050106000214")

    def test_builds_partial_validation_note(self) -> None:
        result = _build_mrz_validation({"line2": "E8710852<0IDN1906017M30010866403050106000214"})

        self.assertFalse(result.valid)
        self.assertEqual(
            _build_validation_note(result),
            "MRZ checksum partial: 3/5 valid (passportNumber, composite failed).",
        )

    def test_builds_missing_line_note(self) -> None:
        result = _build_mrz_validation({})

        self.assertFalse(result.valid)
        self.assertEqual(_build_validation_note(result), "MRZ line 2 must be 44 characters.")

    def test_repairs_document_number_letter_confusion_with_checksum(self) -> None:
        repaired = _repair_direct_line2("12657616<71DN8204011M33032416309060104000696")

        self.assertEqual(repaired, "E2657616<7IDN8204011M33032416309060104000696")
        self.assertTrue(_build_mrz_validation({"line2": repaired}).valid)

    def test_repairs_leading_extra_character_and_date_ocr_confusion(self) -> None:
        repaired = _repair_direct_line2("7E9229500<31DNO708270M3507108630906270800027")

        self.assertEqual(repaired, "E9229500<3IDN0708270M35071086309062708000270")
        self.assertTrue(_build_mrz_validation({"line2": repaired}).valid)

    def test_repairs_line1_indonesia_country_confusion(self) -> None:
        repaired = _repair_direct_line1("P<IDHPURNAWAN<<MOHAMAD<KERIEF")

        self.assertTrue(repaired.startswith("P<IDNPURNAWAN"))

    def test_repairs_passport_check_digit_letter_confusion(self) -> None:
        repaired = _repair_direct_line2("X8489039<O1DN5807237F31011266303056307000108")

        self.assertEqual(repaired, "X8489039<0IDN5807237F31011266303056307000108")
        self.assertTrue(_build_mrz_validation({"line2": repaired}).valid)

    def test_repairs_line2_extracted_from_raw_text(self) -> None:
        data = _repair_extracted_mrz_data(
            {
                "raw_text": (
                    "P<IDNSUDARWATI<<<<<<<K<<KKKKKKKKKKKKKKKKKKKK\n"
                    "X8489039<O1DN5807237F31011266303056307000108"
                )
            }
        )

        self.assertEqual(data["line2"], "X8489039<0IDN5807237F31011266303056307000108")
        self.assertTrue(_build_mrz_validation(data).valid)


if __name__ == "__main__":
    unittest.main()
