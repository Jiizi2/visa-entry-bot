from typing import Callable
import os

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT_DIR, "data")
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png"}
OCR_BUDGET_MS = 20_000
OCR_FAST_PATH_BUDGET_MS = 15_000
OCR_FULL_PANEL_FIELD_SCOPE = (
    "fullName",
    "passportNumber",
    "nationality",
    "dob",
    "gender",
    "placeOfBirth",
    "issueDate",
    "expiryDate",
    "issuingOffice",
)
OCR_STAGE_MIN_REMAINING_MS = {
    "visual": 1_000,
    "location": 3_000,
    "panel": 3_000,
    "visual_recovery": 5_000,
    "page_align": 4_000,
    "dates": 3_000,
    "names": 4_000,
}
StepCallback = Callable[[str, str, float], None]
