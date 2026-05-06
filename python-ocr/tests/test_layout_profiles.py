from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.indonesia_field_ocr import _extract_field  # noqa: E402
from services.layout_profiles import (  # noqa: E402
    _parse_indonesia_layout_profile,
    clear_layout_profile_cache,
    load_indonesia_passport_layout_profile,
)


class LayoutProfileTests(unittest.TestCase):
    def tearDown(self) -> None:
        clear_layout_profile_cache()

    def test_loads_indonesia_visual_field_profile(self) -> None:
        profile = load_indonesia_passport_layout_profile()

        self.assertEqual(profile["country"], "IDN")
        self.assertEqual(profile["documentType"], "passport")
        self.assertEqual(profile["version"], "indonesia_default")
        self.assertEqual(profile["fieldTemplates"][0]["expiryDate"], (0.61, 0.71, 0.80, 0.99))
        self.assertEqual(profile["extraWindows"]["issuingOffice"][0], (0.76, 0.94, 0.68, 0.99))
        self.assertEqual(profile["nameWindows"][0], (0.16, 0.40, 0.16, 0.90))
        self.assertEqual(profile["panelModes"]["panel"]["issueDate"][0], (0.52, 0.64, 0.20, 0.55))
        self.assertEqual(profile["panelModes"]["compact"]["passportNumber"][0], (0.14, 0.26, 0.72, 0.98))

    def test_rejects_invalid_layout_window(self) -> None:
        payload = {
            "country": "IDN",
            "documentType": "passport",
            "visualFieldOcr": {
                "fieldTemplates": [
                    {
                        "fullName": [0.20, 0.33, 0.24, 0.80],
                        "nationality": [0.41, 0.48, 0.34, 0.58],
                        "dob": [0.53, 0.61, 0.34, 0.56],
                        "gender": [0.53, 0.61, 0.60, 0.68],
                        "placeOfBirth": [0.53, 0.61, 0.84, 0.97],
                        "issueDate": [0.64, 0.72, 0.34, 0.56],
                        "expiryDate": [0.71, 0.61, 0.80, 0.99],
                        "issuingOffice": [0.80, 0.91, 0.71, 0.99],
                    }
                ],
                "nameWindows": [[0.16, 0.40, 0.16, 0.90]],
                "nameValueWindows": [[0.30, 0.42, 0.22, 0.84]],
            },
        }

        with self.assertRaises(ValueError):
            _parse_indonesia_layout_profile(payload)

    def test_visual_field_uses_layout_profile_windows(self) -> None:
        page = object()
        region = object()
        profile = {
            "fieldTemplates": ({"expiryDate": (0.10, 0.20, 0.30, 0.40)},),
            "extraWindows": {},
            "nameWindows": (),
            "nameValueWindows": (),
        }

        with (
            patch("services.indonesia_field_ocr.load_indonesia_passport_layout_profile", return_value=profile),
            patch("services.indonesia_field_ocr.crop_relative", return_value=region) as crop_relative,
            patch("services.indonesia_field_ocr.scan_region_texts", return_value=["18 JAN 2031"]),
        ):
            result = _extract_field(page, "expiryDate")

        self.assertEqual(result, "2031-01-18")
        crop_relative.assert_called_once_with(page, 0.10, 0.20, 0.30, 0.40)


if __name__ == "__main__":
    unittest.main()
