from services.field_gate import should_skip_field_recovery, fields_needing_recovery

def test_should_skip_field_recovery():
    # Empty value: don't skip
    assert not should_skip_field_recovery("passportNumber", "", 95.0, True)
    
    # Low confidence or invalid MRZ: don't skip
    assert not should_skip_field_recovery("passportNumber", "X1234567", 75.0, True)
    assert not should_skip_field_recovery("passportNumber", "X1234567", 95.0, False)
    
    # passportNumber: valid format (7 digits + letter prefix)
    assert should_skip_field_recovery("passportNumber", "X1234567", 95.0, True)
    assert should_skip_field_recovery("passportNumber", "E1234567", 95.0, True)
    assert not should_skip_field_recovery("passportNumber", "12345678", 95.0, True) # Not matching [EX] pattern
    
    # dates
    assert should_skip_field_recovery("dob", "1990-10-14", 95.0, True)
    assert not should_skip_field_recovery("dob", "1990-10-14", 85.0, True)
    assert not should_skip_field_recovery("dob", "14 0CT 1990", 95.0, True) # Invalid format
    
    # gender
    assert should_skip_field_recovery("gender", "MALE", 95.0, True)
    assert not should_skip_field_recovery("gender", "UNKNOWN", 95.0, True)

def test_fields_needing_recovery():
    parsed = {
        "passportNumber": "X1234567",
        "dob": "1990-10-14",
        "gender": "MALE",
        "nationality": "IDN",
        "fullName": "JOHN DOE",
        "placeOfBirth": "JAKARTA",
    }
    
    # High confidence, valid MRZ -> skip what can be skipped
    needed = fields_needing_recovery(parsed, 95.0, True, tuple(parsed.keys()))
    assert "passportNumber" not in needed
    assert "dob" not in needed
    assert "gender" not in needed
    assert "nationality" not in needed
    assert "fullName" in needed
    assert "placeOfBirth" in needed
