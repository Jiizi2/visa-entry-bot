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
    run_rapid_ocr_detailed,
    timed_rapid_ocr,
    set_ocr_deadline,
    reset_ocr_deadline,
    ocr_stage_budget,
    ocr_time_remaining,
)
from services.ocr_engine_process import OcrEngineTimeout
from time import perf_counter


class RapidOcrRunnerTests(unittest.TestCase):
    def test_nested_stage_budget_preserves_the_outer_scan_deadline(self) -> None:
        token = set_ocr_deadline(perf_counter() + 30)
        try:
            with ocr_stage_budget(12):
                self.assertLessEqual(ocr_time_remaining(), 12)
                with ocr_stage_budget(60):
                    self.assertLessEqual(ocr_time_remaining(), 12)
            self.assertGreater(ocr_time_remaining(), 29)
        finally:
            reset_ocr_deadline(token)
    def setUp(self) -> None:
        reset_ocr_stats()

    def tearDown(self) -> None:
        reset_ocr_stats()

    def test_run_rapid_ocr_passes_timeout(self) -> None:
        with patch("services.ocr_runner.RAPID_OCR_INSTANCE") as mock_rapid:
            mock_rapid.return_value = ([([[[0,0], [1,0], [1,1], [0,1]], "TEXT", 0.99])], None)
            result = run_rapid_ocr(object(), "", timeout_seconds=1.5)

        self.assertEqual(result, "TEXT")
        self.assertEqual(mock_rapid.call_args.kwargs["timeout_seconds"], 1.5)

    def test_expired_scan_deadline_skips_inference(self) -> None:
        token = set_ocr_deadline(perf_counter() - 1)
        try:
            with patch("services.ocr_runner.RAPID_OCR_INSTANCE") as engine:
                self.assertEqual(run_rapid_ocr(object(), ""), "")
                engine.assert_not_called()
            self.assertEqual(get_ocr_stats()["budgetSkipCount"], 1)
        finally:
            reset_ocr_deadline(token)

    def test_timeout_is_recorded_separately_from_engine_errors(self) -> None:
        with patch("services.ocr_runner.RAPID_OCR_INSTANCE", side_effect=OcrEngineTimeout("deadline")):
            self.assertEqual(run_rapid_ocr(object(), ""), "")
        self.assertEqual(get_ocr_stats()["timeoutCount"], 1)
        self.assertEqual(get_ocr_stats()["errorCount"], 1)

    def test_missing_engine_is_reported_as_an_error(self) -> None:
        with patch("services.ocr_runner.RAPID_OCR_INSTANCE", None):
            self.assertEqual(run_rapid_ocr(object(), ""), "")
        self.assertEqual(get_ocr_stats()["errorCount"], 1)

    def test_detailed_result_preserves_box_confidence_and_normalized_coordinates(self) -> None:
        image = MagicMock()
        image.shape = (100, 200, 3)
        with patch("services.ocr_runner.RAPID_OCR_INSTANCE") as mock_rapid:
            mock_rapid.return_value = (
                [([[20, 10], [120, 10], [120, 30], [20, 30]], "TANJUNG RÉDEB", 0.95)],
                None,
            )
            result = run_rapid_ocr_detailed(image, whitelist="ABCDEFGHIJKLMNOPQRSTUVWXYZ ")

        self.assertEqual(result.text, "TANJUNG REDEB")
        self.assertEqual(len(result.observations), 1)
        observation = result.observations[0]
        self.assertEqual(observation.text, "TANJUNG RÉDEB")
        self.assertEqual(observation.normalized_text, "TANJUNG REDEB")
        self.assertAlmostEqual(observation.confidence, 0.95)
        self.assertAlmostEqual(observation.center_x, 0.35)
        self.assertAlmostEqual(observation.center_y, 0.20)

    def test_detailed_result_supports_recognition_only_shape(self) -> None:
        image = MagicMock()
        image.shape = (30, 120)
        with patch("services.ocr_runner.RAPID_OCR_INSTANCE") as mock_rapid:
            mock_rapid.return_value = ([('BERAU', 0.91)], None)
            result = run_rapid_ocr_detailed(image, use_det=False, use_cls=False, source="rec_only")

        self.assertEqual(result.text, "BERAU")
        self.assertFalse(result.detector_used)
        self.assertEqual(get_ocr_stats()["callTypes"]["recOnly"], 1)

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
            self.assertEqual(_resolve_timeout(), 15.0)

    def test_slow_inference_finishes_within_quality_budget(self) -> None:
        clock = [100.0]

        def slow_engine(image, *, timeout_seconds, **options):
            if timeout_seconds < 10.0:
                raise OcrEngineTimeout("slow laptop needs ten seconds")
            clock[0] += 10.0
            return [(None, "TEXT", 0.99)], None

        with (
            patch.dict("os.environ", {"OCR_TIMEOUT_SECONDS": ""}),
            patch("services.ocr_runner.perf_counter", side_effect=lambda: clock[0]),
            patch("services.ocr_runner.RAPID_OCR_INSTANCE", side_effect=slow_engine) as engine,
        ):
            token = set_ocr_deadline(160.0)
            try:
                self.assertEqual(run_rapid_ocr(object(), ""), "TEXT")
                self.assertEqual(engine.call_args.kwargs["timeout_seconds"], 15.0)
                self.assertEqual(get_ocr_stats()["timeoutCount"], 0)
                self.assertEqual(get_ocr_stats()["totalMs"], 10_000)
            finally:
                reset_ocr_deadline(token)

    def test_long_timeout_override_cannot_extend_passport_deadline(self) -> None:
        clock = [158.0]
        with (
            patch.dict("os.environ", {"OCR_TIMEOUT_SECONDS": "120"}),
            patch("services.ocr_runner.perf_counter", side_effect=lambda: clock[0]),
            patch("services.ocr_runner.RAPID_OCR_INSTANCE", return_value=([(None, "TEXT", 0.99)], None)) as engine,
        ):
            token = set_ocr_deadline(160.0)
            try:
                self.assertEqual(run_rapid_ocr(object(), ""), "TEXT")
                self.assertEqual(engine.call_args.kwargs["timeout_seconds"], 2.0)
                clock[0] = 160.0
                self.assertEqual(run_rapid_ocr(object(), ""), "")
                engine.assert_called_once()
                self.assertEqual(get_ocr_stats()["budgetSkipCount"], 1)
            finally:
                reset_ocr_deadline(token)

    def test_timed_rapid_ocr_returns_elapsed_ms(self) -> None:
        with patch("services.ocr_runner.run_rapid_ocr", return_value="TEXT"):
            text, elapsed_ms = timed_rapid_ocr(object(), "")

        self.assertEqual(text, "TEXT")
        self.assertGreaterEqual(elapsed_ms, 0)
