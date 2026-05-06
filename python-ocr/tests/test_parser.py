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

    def test_repairs_line2_nationality_confusion_before_parsing(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNRAMADAN<<KARIM<ALFARIZI<<<<<<<<<<<<<<<<",
                "line2": "E8710852<51DN1906017L30010866403050106000214",
            }
        )

        self.assertEqual(parsed["nationality"], "INDONESIA")
        self.assertEqual(parsed["gender"], "MALE")

    def test_rejects_line2_without_any_valid_check_digit(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNDOE<<JOHN<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<",
                "line2": "A1234567<0IDN9001010M3001010<<<<<<<<<<<<<<04",
            }
        )

        self.assertEqual(parsed["passportNumber"], "")
        self.assertEqual(parsed["dob"], "")
        self.assertEqual(parsed["expiryDate"], "")

    def test_drops_direct_mrz_name_filler_tokens(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNMAULIDDHAN<<RASYDDIQ<<<<<<<<<<<SKK6KKKK",
                "line2": "X4068853<1IDN1003031M29112056403050303000138",
            }
        )

        self.assertEqual(parsed["firstName"], "RASYDDIQ")
        self.assertEqual(parsed["familyName"], "MAULIDDHAN")

    def test_drops_k_dominant_name_filler_tokens(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNSALSAHBILLA<<MEYSI<<K<<<<<KKSKE<KEKKK<<",
                "line2": "X6724875<4IDN0305255F30111796403056505000282",
            }
        )

        self.assertEqual(parsed["firstName"], "MEYSI")
        self.assertEqual(parsed["familyName"], "SALSAHBILLA")

    def test_drops_short_k_filler_after_given_names(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNGIFARI<<MUHAMMAD<MUGNI<ZAR<<<<<<<<<KK<<",
                "line2": "X6724876<7IDN1003042M30111796403050403000168",
            }
        )

        self.assertEqual(parsed["firstName"], "MUHAMMAD MUGNI ZAR")
        self.assertEqual(parsed["familyName"], "GIFARI")

    def test_repairs_noisy_k_name_separator_from_mrz_line1(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNGHAISAN<K<FAITH<<<<<<<S<SKKSKSKKRKSK<<<",
                "line2": "X6725077<5IDN1001015M30112617316020101000296",
            }
        )

        self.assertEqual(parsed["firstName"], "FAITH")
        self.assertEqual(parsed["familyName"], "GHAISAN")

    def test_noisy_k_name_separator_does_not_break_single_word_name(self) -> None:
        parsed = parse_mrz_data(
            {
                "line1": "P<IDNMARGONO<K<<<<<<<<KK<KKKKKKKKKKKKKKKKKKK",
                "line2": "X6725059<7IDN6312154M30112616403051512000360",
            }
        )

        self.assertEqual(parsed["firstName"], "")
        self.assertEqual(parsed["familyName"], "MARGONO")

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
