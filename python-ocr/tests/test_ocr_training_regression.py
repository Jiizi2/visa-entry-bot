from __future__ import annotations

import contextlib
import io
import json
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from main import process_passport

ROOT = Path(__file__).resolve().parents[2]
FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "ocr_training_golden.json"
TRAINING_DIR = ROOT / "data" / "example-group" / "passports" / "trainingData"


@unittest.skipUnless(
    os.environ.get("OCR_IMAGE_REGRESSION") == "1",
    "Set OCR_IMAGE_REGRESSION=1 to run slow image OCR regression tests.",
)
class OcrTrainingRegressionTests(unittest.TestCase):
    def test_training_golden_samples(self) -> None:
        fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        for item in fixture:
            file_name = item["fileName"]
            with self.subTest(fileName=file_name):
                file_path = TRAINING_DIR / file_name
                self.assertTrue(file_path.exists(), f"Missing sample image: {file_path}")
                with contextlib.redirect_stdout(io.StringIO()):
                    record = process_passport(str(file_path))
                extracted = record.get("passportExtracted", {})
                extracted = extracted if isinstance(extracted, dict) else {}
                actual = {"status": str(record.get("status", ""))}
                actual.update({key: str(value or "") for key, value in extracted.items()})
                for field_name, expected_value in item["expected"].items():
                    self.assertEqual(actual.get(field_name, ""), expected_value, field_name)


if __name__ == "__main__":
    unittest.main()
