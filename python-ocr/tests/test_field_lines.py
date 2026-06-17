import numpy as np
from services.image_preprocessor import detect_horizontal_field_lines, snap_crop_to_field_lines

def test_snap_crop_to_field_lines():
    field_lines = [100, 200, 300, 400]
    height = 1000
    
    # Should snap y_start from 105 (0.105*1000) to 100
    # Should snap y_end from 390 (0.39*1000) to 400
    y_start, y_end = snap_crop_to_field_lines(0.105, 0.39, height, field_lines, snap_tolerance_px=20)
    assert y_start == 100
    assert y_end == 400
    
    # Beyond tolerance: should not snap
    # 0.15 * 1000 = 150 (nearest line is 100 or 200, diff 50 > 20)
    y_start, y_end = snap_crop_to_field_lines(0.15, 0.39, height, field_lines, snap_tolerance_px=20)
    assert y_start == 150
    assert y_end == 400

def test_detect_horizontal_lines_empty_image():
    # Empty black image
    img = np.zeros((500, 500, 3), dtype=np.uint8)
    lines = detect_horizontal_field_lines(img)
    assert len(lines) == 0
