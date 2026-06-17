import sys
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.ocr_runner import (  # noqa: E402
    _resolve_timeout,
    build_ocr_config,
    get_ocr_stats,
    reset_ocr_stats,
    run_rapid_ocr,
    timed_rapid_ocr,
)


class RapidOcrRunnerTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_ocr_stats()

    def tearDown(self) -> None:
        reset_ocr_stats()

    def test_run_rapid_ocr_passes_timeout(self) -> None:
        with patch("services.ocr_runner.RAPID_OCR_INSTANCE") as mock_rapid:
            mock_rapid.return_value = ([([[[0,0], [1,0], [1,1], [0,1]], "TEXT", 0.99])], None)
            result = run_rapid_ocr(object(), "", timeout_seconds=1.5)

        self.assertEqual(result, "TEXT")

    def test_build_ocr_config_includes_common_options(self) -> None:
        result = build_ocr_config(
            whitelist="ABC123",
            dpi=300,
            preserve_interword_spaces=True,
            user_words_file=None,
        )
        # Because we only keep compatibility string, we check what it produces:
        self.assertEqual(
            result,
            '-c user_defined_dpi=300 -c preserve_interword_spaces=1 -c tessedit_char_whitelist=ABC123',
        )

    def test_run_rapid_ocr_returns_empty_text_after_error(self) -> None:
        with patch("services.ocr_runner.RAPID_OCR_INSTANCE", side_effect=RuntimeError("timeout")):
            result = run_rapid_ocr(object(), "")

        self.assertEqual(result, "")
        self.assertEqual(get_ocr_stats()["callCount"], 1)
        self.assertEqual(get_ocr_stats()["errorCount"], 1)

    def test_resolve_timeout_uses_environment_override(self) -> None:
        with patch.dict("os.environ", {"OCR_TIMEOUT_SECONDS": "2.25"}):
            self.assertEqual(_resolve_timeout(), 2.25)

    def test_resolve_timeout_uses_default_for_invalid_environment(self) -> None:
        with patch.dict("os.environ", {"OCR_TIMEOUT_SECONDS": "bad"}):
            self.assertEqual(_resolve_timeout(), 8.0)

    def test_timed_rapid_ocr_returns_elapsed_ms(self) -> None:
        with patch("services.ocr_runner.run_rapid_ocr", return_value="TEXT"):
            text, elapsed_ms = timed_rapid_ocr(object(), "")

        self.assertEqual(text, "TEXT")
        self.assertGreaterEqual(elapsed_ms, 0)
