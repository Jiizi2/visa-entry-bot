from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.tesseract_runner import (  # noqa: E402
    _resolve_timeout,
    build_tesseract_config,
    get_tesseract_ocr_stats,
    reset_tesseract_ocr_stats,
    run_tesseract_ocr,
    timed_tesseract_ocr,
)


class TesseractRunnerTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_tesseract_ocr_stats()

    def tearDown(self) -> None:
        reset_tesseract_ocr_stats()

    def test_run_tesseract_ocr_passes_timeout(self) -> None:
        with patch("services.tesseract_runner.pytesseract.image_to_string", return_value="TEXT") as image_to_string:
            result = run_tesseract_ocr(object(), "--psm 6", timeout_seconds=1.5)

        self.assertEqual(result, "TEXT")
        self.assertEqual(image_to_string.call_args.kwargs["config"], "--psm 6")
        self.assertEqual(image_to_string.call_args.kwargs["timeout"], 1.5)

    def test_build_tesseract_config_includes_common_options(self) -> None:
        result = build_tesseract_config(
            psm=7,
            whitelist="ABC123",
            dpi=300,
            preserve_interword_spaces=True,
        )

        self.assertEqual(
            result,
            "--oem 3 --psm 7 -c user_defined_dpi=300 -c preserve_interword_spaces=1 -c tessedit_char_whitelist=ABC123",
        )

    def test_run_tesseract_ocr_returns_empty_text_after_error(self) -> None:
        with patch("services.tesseract_runner.pytesseract.image_to_string", side_effect=RuntimeError("timeout")):
            result = run_tesseract_ocr(object(), "--psm 6")

        self.assertEqual(result, "")
        self.assertEqual(get_tesseract_ocr_stats()["callCount"], 1)
        self.assertEqual(get_tesseract_ocr_stats()["errorCount"], 1)

    def test_resolve_timeout_uses_environment_override(self) -> None:
        with patch.dict("os.environ", {"OCR_TESSERACT_TIMEOUT_SECONDS": "2.25"}):
            self.assertEqual(_resolve_timeout(), 2.25)

    def test_resolve_timeout_uses_default_for_invalid_environment(self) -> None:
        with patch.dict("os.environ", {"OCR_TESSERACT_TIMEOUT_SECONDS": "bad"}):
            self.assertEqual(_resolve_timeout(), 8.0)

    def test_timed_tesseract_ocr_returns_elapsed_ms(self) -> None:
        with patch("services.tesseract_runner.run_tesseract_ocr", return_value="TEXT"):
            text, elapsed_ms = timed_tesseract_ocr(object(), "--psm 6")

        self.assertEqual(text, "TEXT")
        self.assertGreaterEqual(elapsed_ms, 0)


if __name__ == "__main__":
    unittest.main()
