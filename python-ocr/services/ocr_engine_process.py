"""Reuse an OCR process and terminate it when an inference misses its deadline."""
from __future__ import annotations

import multiprocessing
from threading import Event, RLock, Timer
from time import perf_counter
from typing import Callable

from services.ocr_constants import OCR_INFERENCE_TIMEOUT_SECONDS


class OcrEngineError(RuntimeError):
    pass


class OcrEngineUnavailable(OcrEngineError):
    pass


class OcrEngineTimeout(TimeoutError):
    pass


def _build_rapid_engine():
    from rapidocr_onnxruntime import RapidOCR

    return RapidOCR()


def _engine_main(connection, engine_factory) -> None:
    try:
        try:
            engine = engine_factory()
        except Exception as exc:
            connection.send(("unavailable", f"{type(exc).__name__}: {exc}"))
            return
        connection.send(("ready", None))
        while True:
            try:
                request = connection.recv()
            except EOFError:
                return
            if request is None:
                return
            image, options = request
            try:
                connection.send(("result", engine(image, **options)))
            except Exception as exc:
                connection.send(("error", f"{type(exc).__name__}: {exc}"))
    except (EOFError, OSError):
        return
    finally:
        connection.close()


class ProcessOcrEngine:
    def __init__(self, engine_factory: Callable = _build_rapid_engine, *, startup_timeout_seconds: float = 30.0):
        self._engine_factory = engine_factory
        self._startup_timeout = startup_timeout_seconds
        self._context = multiprocessing.get_context("spawn")
        self._lock = RLock()
        self._process = None
        self._connection = None

    @property
    def process_id(self) -> int | None:
        return self._process.pid if self._process is not None else None

    def warm_up(self) -> None:
        with self._lock:
            self._ensure_started(self._startup_timeout)

    def _ensure_started(self, timeout_seconds: float) -> None:
        if self._process is not None and self._process.is_alive():
            return
        self._stop()
        connection, child_connection = self._context.Pipe()
        process = self._context.Process(
            target=_engine_main, args=(child_connection, self._engine_factory),
            name="passport-ocr-engine", daemon=True,
        )
        self._connection, self._process = connection, process
        try:
            process.start()
            child_connection.close()
            if not connection.poll(timeout_seconds):
                raise OcrEngineTimeout("OCR engine initialization exceeded its deadline.")
            status, message = connection.recv()
            if status != "ready":
                raise OcrEngineUnavailable(f"OCR engine initialization failed: {message}")
        except OcrEngineTimeout:
            self._stop()
            raise
        except (EOFError, OSError) as exc:
            self._stop()
            raise OcrEngineUnavailable("OCR engine exited before initialization completed.") from exc
        except Exception:
            self._stop()
            raise
        finally:
            child_connection.close()

    def __call__(self, image: object, *, timeout_seconds: float = OCR_INFERENCE_TIMEOUT_SECONDS, **options):
        with self._lock:
            deadline = perf_counter() + timeout_seconds
            self._ensure_started(min(self._startup_timeout, timeout_seconds))
            remaining = deadline - perf_counter()
            if remaining <= 0:
                self._stop()
                raise OcrEngineTimeout("OCR engine initialization consumed the inference deadline.")
            process, connection = self._process, self._connection
            finished, expired = Event(), Event()

            def expire() -> None:
                if not finished.is_set():
                    expired.set()
                    try:
                        process.terminate()
                    except (OSError, ValueError):
                        pass

            watchdog = Timer(remaining, expire)
            watchdog.daemon = True
            watchdog.start()
            try:
                try:
                    connection.send((image, options))
                    if not connection.poll(max(0.0, deadline - perf_counter())):
                        raise OcrEngineTimeout("OCR inference exceeded its deadline.")
                    status, result = connection.recv()
                    if expired.is_set() or perf_counter() > deadline:
                        raise OcrEngineTimeout("OCR inference exceeded its deadline.")
                finally:
                    finished.set()
                    watchdog.cancel()
                    watchdog.join()
            except OcrEngineTimeout:
                self._stop()
                raise
            except (EOFError, OSError) as exc:
                self._stop()
                if expired.is_set():
                    raise OcrEngineTimeout("OCR inference exceeded its deadline.") from exc
                raise OcrEngineError("OCR engine connection closed during inference.") from exc
            if status == "error":
                raise OcrEngineError(result)
            if status != "result":
                self._stop()
                raise OcrEngineError("Unexpected response from OCR engine.")
            return result

    def _stop(self) -> None:
        process, connection = self._process, self._connection
        self._process = self._connection = None
        if connection is not None:
            connection.close()
        if process is not None:
            if process.pid is not None:
                if process.is_alive():
                    process.terminate()
                process.join(timeout=1.0)
                if process.is_alive():
                    process.kill()
                    process.join(timeout=1.0)
            process.close()

    def close(self) -> None:
        with self._lock:
            self._stop()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
