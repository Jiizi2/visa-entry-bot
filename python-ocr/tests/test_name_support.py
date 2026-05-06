from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.name_support import repair_common_given_name_spacing, repair_common_name_noise  # noqa: E402


class NameSupportTests(unittest.TestCase):
    def test_repairs_common_k_noise_in_given_names(self) -> None:
        parsed, note = repair_common_name_noise(
            {"firstName": "MUHAMMAD HANIFKAL", "familyName": "KHAIRY"}
        )

        self.assertEqual(parsed["firstName"], "MUHAMMAD HANIF AL")
        self.assertEqual(parsed["familyName"], "KHAIRY")
        self.assertEqual(note, "COMMON NAME OCR NOISE REPAIRED")

    def test_strips_common_family_suffix_noise(self) -> None:
        parsed, _ = repair_common_name_noise(
            {"firstName": "NUR KFIQIH SS", "familyName": "SAPUTRIK"}
        )

        self.assertEqual(parsed["firstName"], "NUR FIQIH")
        self.assertEqual(parsed["familyName"], "SAPUTRI")

    def test_strips_family_trailing_c_noise(self) -> None:
        parsed, _ = repair_common_name_noise({"firstName": "RIKA", "familyName": "DIANAC"})

        self.assertEqual(parsed["familyName"], "DIANA")

    def test_preserves_real_kyazid_name_while_repairing_k_particles(self) -> None:
        parsed, _ = repair_common_name_noise(
            {"firstName": "ABDULLAH KYAZID KAL", "familyName": "FATIH"}
        )

        self.assertEqual(parsed["firstName"], "ABDULLAH KYAZID AL")

    def test_expands_common_muhammad_abbreviation(self) -> None:
        parsed, note = repair_common_given_name_spacing({"firstName": "MUH", "familyName": "IHSAN"})

        self.assertEqual(parsed["firstName"], "MUHAMMAD")
        self.assertEqual(note, "GIVEN NAME ABBREVIATION REPAIRED FROM MRZ")

    def test_repairs_djumadi_prefix_confusion(self) -> None:
        parsed, _ = repair_common_name_noise({"firstName": "DIUMADI", "familyName": "YUSUF"})

        self.assertEqual(parsed["firstName"], "DJUMADI")


if __name__ == "__main__":
    unittest.main()
