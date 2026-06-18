"""Centralized logger for the OCR worker."""

import logging
import os

_LOG_LEVEL = os.environ.get("ENTRYMATE_LOG_LEVEL", "INFO").upper()

logger = logging.getLogger("entrymate.ocr")

if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    ))
    logger.addHandler(handler)
    logger.setLevel(getattr(logging, _LOG_LEVEL, logging.INFO))
