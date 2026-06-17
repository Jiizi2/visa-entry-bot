from services.indonesia_field_ocr import _apply_date_confusion_fix, _apply_location_confusion_fix

def test_date_confusion_fix_ocr_at_year():
    """'14 OCT 199O' -> '14 OCT 1990' (O di akhir tahun difix ke 0)"""
    assert _apply_date_confusion_fix("14 OCT 199O") == "14 OCT 1990"

def test_date_confusion_fix_i_as_1():
    """'I4 OCT 1990' -> '14 OCT 1990' (I di awal hari difix ke 1)"""
    assert _apply_date_confusion_fix("I4 OCT 1990") == "14 OCT 1990"

def test_date_confusion_fix_month_letters():
    """'14 0CT 1990' -> '14 OCT 1990' (0 di tengah bulan difix ke O)"""
    assert _apply_date_confusion_fix("14 0CT 1990") == "14 OCT 1990"

def test_location_confusion_mixed_token():
    """'JAKARTA T1MUR' -> 'JAKARTA TIMUR'"""
    assert _apply_location_confusion_fix("JAKARTA T1MUR") == "JAKARTA TIMUR"

def test_location_confusion_all_digit_token_unchanged():
    """Token yang murni angka tidak diubah."""
    assert _apply_location_confusion_fix("2024") == "2024"
