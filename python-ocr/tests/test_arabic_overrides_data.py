from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

ARABIC_SCRIPT_PATTERN = re.compile(r"[\u0600-\u06FF]")
KEY_PATTERN = re.compile(r"^[A-Z0-9]{2,40}$")
OVERRIDES_PATH = Path(__file__).resolve().parents[1] / "services" / "data" / "arabic_name_overrides.json"


class ArabicOverridesDataTests(unittest.TestCase):
    def test_override_file_has_valid_shape(self) -> None:
        payload = json.loads(OVERRIDES_PATH.read_text(encoding="utf-8"))

        self.assertIsInstance(payload, dict)
        self.assertTrue(payload)

        for key, value in payload.items():
            self.assertIsInstance(key, str)
            self.assertIsInstance(value, str)
            self.assertEqual(key, key.upper(), msg=f"Key must be uppercase: {key}")
            self.assertRegex(key, KEY_PATTERN, msg=f"Key format invalid: {key}")
            normalized_value = re.sub(r"\s+", " ", value).strip()
            self.assertTrue(normalized_value, msg=f"Value empty for key: {key}")
            self.assertRegex(normalized_value, ARABIC_SCRIPT_PATTERN, msg=f"Arabic script missing for key: {key}")


if __name__ == "__main__":
    unittest.main()
