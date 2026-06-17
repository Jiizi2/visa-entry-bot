from services.layout_detector import detect_passport_layout_version
import numpy as np

def test_detect_layout_version():
    img = np.zeros((500, 500, 3), dtype=np.uint8)
    assert detect_passport_layout_version(img) == "indonesia_default"
    assert detect_passport_layout_version(None) == "indonesia_default"
