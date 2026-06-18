from typing import Optional, Dict, Any, List, TypedDict
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
    """Dict subclass that supports attribute-style access.
    
    WARNING: Attribute access (obj.key) returns None for missing keys
    instead of raising AttributeError. Use with caution — typos in
    field names will silently return None.
    """
    def __getattr__(self, key):
        return self.get(key)
    def __setattr__(self, key, value):
        self[key] = value
    def as_dict(self):
        return dict(self)

class ParsedPassportDataFields(TypedDict, total=False):
    """Type-checked schema for passport data fields.
    
    Use this for static analysis (mypy, pyright). At runtime,
    ParsedPassportData (DictObject) is used for backward compatibility.
    """
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

class MrzValidation(DictObject):
    """MRZ validation result container."""
    valid: bool
    details: Dict[str, Any]

class ExtractionEvidence(DictObject):
    """Evidence from MRZ extraction including confidence and validation."""
    data: Dict[str, Any]
    confidence: float
    mrzValidation: Optional[MrzValidation]

class ParsedPassportData(DictObject):
    """Parsed passport data with dict + attribute access.
    
    See ParsedPassportDataFields for the expected field schema.
    This class inherits from DictObject for backward compatibility
    with code that uses both dict-style and attribute-style access.
    """
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
    """Processing performance metrics."""
    totalMs: int
    mrzMs: int
    panelMs: int
    visualMs: int
    recoveryMs: int
    tesseract: Dict[str, Any]
    ocrMode: str
    ocrModeReasons: List[str]
