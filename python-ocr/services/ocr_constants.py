from typing import Callable
import os

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT_DIR, "data")
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png"}
OCR_PROFILE_SPEED = "speed"
OCR_PROFILE_BALANCED = "balanced"
OCR_PROFILE_HEAVY = "heavy"
OCR_PROFILE_ACCURACY = "accuracy"
OCR_PROFILE_ALIASES = {OCR_PROFILE_ACCURACY: OCR_PROFILE_HEAVY}
OCR_PROFILES = {OCR_PROFILE_SPEED, OCR_PROFILE_BALANCED, OCR_PROFILE_HEAVY}
OCR_PROFILE_BUDGET_MS = {
    OCR_PROFILE_SPEED: 15_000,
    OCR_PROFILE_BALANCED: 30_000,
    OCR_PROFILE_HEAVY: 90_000,
}
OCR_BALANCED_PANEL_RECOVERY_FIELDS = ("placeOfBirth", "issuingOffice", "issueDate")
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
OCR_FULL_VISUAL_FIELD_SCOPE = (
    "placeOfBirth",
    "issuingOffice",
    "issueDate",
    "expiryDate",
    "dob",
    "gender",
    "nationality",
    "fullName",
)
OCR_STAGE_MIN_REMAINING_MS = {
    "visual": 1_000,
    "panel": 3_000,
    "speed_panel": 2_500,
    "visual_recovery": 5_000,
    "page_align": 4_000,
    "dates": 3_000,
    "names": 4_000,
}
StepCallback = Callable[[str, str, float], None]
