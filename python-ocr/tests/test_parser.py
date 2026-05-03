from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.parser import parse_mrz_data


class ParserTests(unittest.TestCase):
    def test_prefers_explicit_mrz_lines_over_text_noise(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNDOE<<JOHN<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<",
                "line2": "A1234567<8IDN9001011M3001012<<<<<<<<<<<<<<04",
                "text": "NOTMRZ\nALSO NOISE",
            }
        )

        self.assertEqual(parsed["passportNumber"], "A1234567")
        self.assertEqual(parsed["dob"], "1990-01-01")
        self.assertEqual(parsed["expiryDate"], "2030-01-01")
        self.assertEqual(parsed["gender"], "MALE")

    def test_accepts_direct_ocr_line2_with_single_filler(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNRAMADAN<<KARIM<ALFARIZI<<<<<<<<<<<<<<<<",
                "line2": "E8710852<5IDN1906017M30010866403050106000214",
            }
        )

        self.assertEqual(parsed["firstName"], "KARIM ALFARIZI")
        self.assertEqual(parsed["familyName"], "RAMADAN")
        self.assertEqual(parsed["passportNumber"], "E8710852")
        self.assertEqual(parsed["nationality"], "INDONESIA")
        self.assertEqual(parsed["dob"], "2019-06-01")
        self.assertEqual(parsed["expiryDate"], "2030-01-08")
        self.assertEqual(parsed["gender"], "MALE")

    def test_drops_direct_mrz_name_filler_tokens(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNMAULIDDHAN<<RASYDDIQ<<<<<<<<<<<SKK6KKKK",
                "line2": "X4068853<1IDN1003031M29112056403050303000138",
            }
        )

        self.assertEqual(parsed["firstName"], "RASYDDIQ")
        self.assertEqual(parsed["familyName"], "MAULIDDHAN")

    def test_single_name_line_ignores_single_separator_filler(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNPURWANTO<K<<<<<<<<KKKKKKKEKKKKKEKKKKKKK",
                "line2": "X6725279<3IDN8005300M30121106403093005000680",
            }
        )

        self.assertEqual(parsed["firstName"], "")
        self.assertEqual(parsed["familyName"], "PURWANTO")


if __name__ == "__main__":
    unittest.main()
