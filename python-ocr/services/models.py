from dataclasses import dataclass, field
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

@dataclass
class MrzValidation:
    valid: bool = False
    details: Dict[str, Any] = field(default_factory=dict)

@dataclass
class ExtractionEvidence:
    data: Dict[str, Any] = field(default_factory=dict)
    confidence: float = 0.0
    mrzValidation: Optional[MrzValidation] = None
    
    def as_dict(self) -> Dict[str, Any]:
        res = {
            "data": self.data,
            "confidence": self.confidence,
        }
        if self.mrzValidation:
            res["mrzValidation"] = {"valid": self.mrzValidation.valid, "details": self.mrzValidation.details}
        return res

@dataclass
class ParsedPassportData:
    passportNumber: str = ""
    fullName: str = ""
    firstName: str = ""
    familyName: str = ""
    nationality: str = ""
    dob: str = ""
    gender: str = ""
    placeOfBirth: str = ""
    issueDate: str = ""
    expiryDate: str = ""
    issuingOffice: str = ""
    
    def as_dict(self) -> Dict[str, str]:
        return {
            "passportNumber": self.passportNumber,
            "fullName": self.fullName,
            "firstName": self.firstName,
            "familyName": self.familyName,
            "nationality": self.nationality,
            "dob": self.dob,
            "gender": self.gender,
            "placeOfBirth": self.placeOfBirth,
            "issueDate": self.issueDate,
            "expiryDate": self.expiryDate,
            "issuingOffice": self.issuingOffice,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, str]) -> "ParsedPassportData":
        return cls(
            passportNumber=data.get("passportNumber", ""),
            fullName=data.get("fullName", ""),
            firstName=data.get("firstName", ""),
            familyName=data.get("familyName", ""),
            nationality=data.get("nationality", ""),
            dob=data.get("dob", ""),
            gender=data.get("gender", ""),
            placeOfBirth=data.get("placeOfBirth", ""),
            issueDate=data.get("issueDate", ""),
            expiryDate=data.get("expiryDate", ""),
            issuingOffice=data.get("issuingOffice", ""),
        )

@dataclass
class ProcessingMetrics:
    totalMs: int = 0
    mrzMs: int = 0
    panelMs: int = 0
    visualMs: int = 0
    recoveryMs: int = 0
    tesseract: Dict[str, Any] = field(default_factory=dict)
    ocrMode: str = ""
    ocrModeReasons: List[str] = field(default_factory=list)
