from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.mrz_extractor import _build_mrz_validation, _build_validation_note  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
