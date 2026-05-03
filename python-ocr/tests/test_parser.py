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


if __name__ == "__main__":
    unittest.main()
