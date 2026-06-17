from typing import Optional, Dict, Any, List
from enum import Enum

class OcrProfile(str, Enum):
    SPEED = "speed"
    BALANCED = "balanced"
    HEAVY = "heavy"
    ACCURACY = "accuracy"

class ReviewStatus(str, Enum):
    VALID = "VALID"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    ERROR = "ERROR"

class OcrMode(str, Enum):
    FAST = "FAST"
    RECOVERY = "RECOVERY"
    DEEP = "DEEP"

class DictObject(dict):
    def __getattr__(self, key):
        return self.get(key)
    def __setattr__(self, key, value):
        self[key] = value
    def as_dict(self):
        return dict(self)

class MrzValidation(DictObject):
    valid: bool
    details: Dict[str, Any]

class ExtractionEvidence(DictObject):
    data: Dict[str, Any]
    confidence: float
    mrzValidation: Optional[MrzValidation]

class ParsedPassportData(DictObject):
    passportNumber: str
    fullName: str
    firstName: str
    familyName: str
    nationality: str
    dob: str
    gender: str
    placeOfBirth: str
    issueDate: str
    expiryDate: str
    issuingOffice: str
    
    @classmethod
    def from_dict(cls, data: Dict[str, str]) -> "ParsedPassportData":
        return cls(data)

class ProcessingMetrics(DictObject):
    totalMs: int
    mrzMs: int
    panelMs: int
    visualMs: int
    recoveryMs: int
    tesseract: Dict[str, Any]
    ocrMode: str
    ocrModeReasons: List[str]
