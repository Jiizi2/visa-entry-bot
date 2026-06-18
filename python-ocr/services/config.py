"""OCR worker configuration with environment variable overrides."""

import os

# Defaults for Nusuk resolved profile
DEFAULT_EMAIL = os.environ.get("ENTRYMATE_DEFAULT_EMAIL", "huseinghanim@gmail.com")
DEFAULT_MOBILE = os.environ.get("ENTRYMATE_DEFAULT_MOBILE", "+6282137434147")
DEFAULT_PROFESSION = "OTHER"
DEFAULT_MARITAL_STATUS = "OTHER"
DEFAULT_PASSPORT_TYPE = "NORMAL"
