from typing import Callable
import os

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT_DIR, "data")
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png"}
from services.models import OcrProfile
OCR_PROFILE_ALIASES = {OcrProfile.ACCURACY: OcrProfile.HEAVY}
OCR_PROFILE_ALIASES = {OcrProfile.ACCURACY: OcrProfile.HEAVY}
OCR_PROFILES = {OcrProfile.SPEED, OcrProfile.BALANCED, OcrProfile.HEAVY}
OCR_PROFILE_BUDGET_MS = {
    OcrProfile.SPEED: 20_000,
    OcrProfile.BALANCED: 30_000,
    OcrProfile.HEAVY: 90_000,
}
OCR_SPEED_FAST_PATH_BUDGET_MS = 15_000
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
    "speed_visual": 3_000,
    "panel": 3_000,
    "speed_panel": 2_500,
    "visual_recovery": 5_000,
    "page_align": 4_000,
    "dates": 3_000,
    "names": 4_000,
}
StepCallback = Callable[[str, str, float], None]
