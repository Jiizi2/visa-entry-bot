import time

import pytest

from services.ocr_engine_process import OcrEngineError, OcrEngineTimeout, OcrEngineUnavailable, ProcessOcrEngine


class TestEngine:
    __test__ = False

    def __call__(self, image, **options):
        if image.get("hang"):
            time.sleep(10)
        if image.get("error"):
            raise ValueError("invalid image")
        return [(image["text"], 0.99)], options


def make_test_engine():
    return TestEngine()


def make_slow_engine():
    time.sleep(10)
    return TestEngine()


def make_unavailable_engine():
    raise ImportError("missing OCR dependency")


def test_engine_process_is_reused_and_options_are_forwarded():
    with ProcessOcrEngine(make_test_engine) as engine:
        engine.warm_up()
        pid = engine.process_id
        assert engine({"text": "FIRST"}, timeout_seconds=2, use_det=False) == ([("FIRST", 0.99)], {"use_det": False})
        assert engine({"text": "SECOND"}, timeout_seconds=2)[0] == [("SECOND", 0.99)]
        assert engine.process_id == pid
    assert engine.process_id is None


def test_inference_timeout_terminates_process_and_next_call_uses_new_engine():
    with ProcessOcrEngine(make_test_engine) as engine:
        engine.warm_up()
        pid = engine.process_id
        started = time.perf_counter()
        with pytest.raises(OcrEngineTimeout):
            engine({"hang": True, "text": "LATE"}, timeout_seconds=0.1)
        assert time.perf_counter() - started < 1.5
        assert engine.process_id is None
        assert engine({"text": "AFTER TIMEOUT"}, timeout_seconds=3)[0] == [("AFTER TIMEOUT", 0.99)]
        assert engine.process_id != pid


def test_initialization_timeout_cleans_up_process():
    with ProcessOcrEngine(make_slow_engine, startup_timeout_seconds=0.1) as engine:
        started = time.perf_counter()
        with pytest.raises(OcrEngineTimeout):
            engine.warm_up()
        assert time.perf_counter() - started < 1.5
        assert engine.process_id is None


def test_boot_error_is_distinct_from_empty_recognition():
    with ProcessOcrEngine(make_unavailable_engine) as engine:
        with pytest.raises(OcrEngineUnavailable, match="missing OCR dependency"):
            engine.warm_up()
        assert engine.process_id is None


def test_engine_exception_does_not_pollute_the_next_result():
    with ProcessOcrEngine(make_test_engine) as engine:
        engine.warm_up()
        with pytest.raises(OcrEngineError, match="invalid image"):
            engine({"error": True}, timeout_seconds=2)
        assert engine({"text": "RECOVERED"}, timeout_seconds=2)[0] == [("RECOVERED", 0.99)]
