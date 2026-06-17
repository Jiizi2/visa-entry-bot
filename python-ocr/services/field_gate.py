from __future__ import annotations
import re
from datetime import date


def should_skip_field_recovery(
    field_name: str,
    current_value: str,
    mrz_confidence: float,
    mrz_validation_valid: bool,
) -> bool:
    """
    Mengembalikan True jika field sudah cukup baik dan tidak perlu recovery.
    """
    if not current_value:
        return False  # Tidak ada nilai, selalu perlu recovery
    
    if field_name == "passportNumber":
        return (
            mrz_validation_valid
            and mrz_confidence >= 80.0
            and bool(re.fullmatch(r"[EX]\d{7}", current_value))
        )
    
    if field_name in {"dob", "expiryDate"}:
        if not mrz_validation_valid:
            return False
        try:
            date.fromisoformat(current_value)
            return mrz_confidence >= 90.0
        except ValueError:
            return False
    
    if field_name == "gender":
        return current_value in {"MALE", "FEMALE"} and mrz_validation_valid and mrz_confidence >= 80.0
    
    if field_name == "nationality":
        return bool(current_value) and mrz_validation_valid and mrz_confidence >= 80.0
    
    # Field lain (nama, lokasi, tanggal issue) selalu perlu dicoba
    return False


def fields_needing_recovery(
    parsed_fields: dict[str, str],
    mrz_confidence: float,
    mrz_validation_valid: bool,
    candidate_fields: tuple[str, ...],
) -> tuple[str, ...]:
    """
    Filter daftar field yang benar-benar perlu di-recover.
    """
    return tuple(
        field_name for field_name in candidate_fields
        if not should_skip_field_recovery(
            field_name,
            parsed_fields.get(field_name, ""),
            mrz_confidence,
            mrz_validation_valid,
        )
    )
