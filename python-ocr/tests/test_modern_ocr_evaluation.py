from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.modern_ocr_evaluation import (  # noqa: E402
    _extract_paddle_text_items,
    evaluate_expected_field_hits,
    evaluate_modern_ocr_engine,
    probe_modern_ocr_engine,
    summarize_field_hits,
)


class ModernOcrEvaluationTests(unittest.TestCase):
    def test_expected_field_hits_support_iso_date_variants(self) -> None:
        hits = evaluate_expected_field_hits(
            "Passport E8710852 expires 18 JAN 2031",
            {"passportNumber": "E8710852", "expiryDate": "2031-01-18", "status": "VALID"},
        )

        self.assertEqual(hits, {"passportNumber": True, "expiryDate": True})

    def test_summarize_field_hits(self) -> None:
        result = summarize_field_hits(
            [
                {"fieldHits": {"passportNumber": True, "expiryDate": False}},
                {"fieldHits": {"passportNumber": False, "expiryDate": True}},
            ]
        )

        self.assertEqual(result["passportNumber"], {"expectedCount": 2, "hitCount": 1, "hitRate": 0.5})
        self.assertEqual(result["expiryDate"], {"expectedCount": 2, "hitCount": 1, "hitRate": 0.5})

    def test_paddle_engine_reports_unavailable_when_dependency_missing(self) -> None:
        with patch("services.modern_ocr_evaluation.importlib.import_module", side_effect=ModuleNotFoundError("paddleocr")):
            result = evaluate_modern_ocr_engine("file.png", "paddle")

        self.assertEqual(result.status, "UNAVAILABLE")
        self.assertEqual(result.engine, "paddle")

    def test_probe_reports_unavailable_engine_dependency(self) -> None:
        with patch("services.modern_ocr_evaluation.importlib.import_module", side_effect=ModuleNotFoundError("paddleocr")):
            result = probe_modern_ocr_engine("paddle")

        self.assertEqual(result["engine"], "paddle")
        self.assertEqual(result["module"], "paddleocr")
        self.assertFalse(result["available"])
        self.assertEqual(result["status"], "UNAVAILABLE")

    def test_probe_reports_available_engine_dependency(self) -> None:
        with (
            patch("services.modern_ocr_evaluation._module_version", return_value="1.2.3"),
            patch("services.modern_ocr_evaluation.importlib.import_module", return_value=object()),
        ):
            result = probe_modern_ocr_engine("tesseract")

        self.assertEqual(result["engine"], "tesseract")
        self.assertEqual(result["module"], "pytesseract")
        self.assertTrue(result["available"])
        self.assertEqual(result["version"], "1.2.3")

    def test_extracts_nested_paddle_text(self) -> None:
        result = _extract_paddle_text_items([[[0, 0], [1, 1]], ("PASSPORT", 0.98), [[0, 0], [1, 1]], ("PASSPORT", 0.98)])

        self.assertEqual(result, ["PASSPORT"])


if __name__ == "__main__":
    unittest.main()
