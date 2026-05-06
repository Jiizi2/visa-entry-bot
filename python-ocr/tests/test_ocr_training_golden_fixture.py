from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from validate_golden_fixture import validate_golden_fixture  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


class OcrTrainingGoldenFixtureTests(unittest.TestCase):
    def test_training_golden_fixture_is_valid(self) -> None:
        fixture_path = ROOT / "tests" / "fixtures" / "ocr_training_golden.json"
        fixture = json.loads(fixture_path.read_text(encoding="utf-8"))

        report = validate_golden_fixture(fixture)

        self.assertEqual(report["errorCount"], 0, report["records"])
        self.assertEqual(report["duplicateFileNames"], [])


if __name__ == "__main__":
    unittest.main()
