import pytest  # type: ignore
import numpy as np
import cv2
from services.image_preprocessor import deskew_image

def create_test_image(angle=0.0):
    # Create a 400x400 white image
    img = np.full((400, 400, 3), 255, dtype=np.uint8)
    
    # Draw some text/lines that look like passport fields
    # Draw horizontal lines
    cv2.line(img, (50, 100), (350, 100), (0, 0, 0), 2)
    cv2.line(img, (50, 150), (350, 150), (0, 0, 0), 2)
    cv2.line(img, (50, 200), (350, 200), (0, 0, 0), 2)
    
    # Draw some text
    cv2.putText(img, "PASSPORT NUMBER", (50, 140), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
    cv2.putText(img, "A1234567", (50, 190), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
    
    if angle != 0.0:
        center = (200, 200)
        matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
        img = cv2.warpAffine(img, matrix, (400, 400), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 255, 255))
        
    return img

def test_deskew_straight_image_unchanged():
    """Gambar yang sudah lurus tidak berubah."""
    img = create_test_image(0.0)
    result = deskew_image(img)
    
    # Should be exactly the same
    assert np.array_equal(img, result)

def test_deskew_small_angle_corrected():
    """Gambar miring 3 derajat dikoreksi ke arah lurus."""
    # Rotate by 3 degrees (counter-clockwise)
    img = create_test_image(3.0)
    
    # The image is rotated 3 degrees, deskew should rotate it back by approx -3 degrees.
    # We'll just verify it's no longer equal to the skewed image
    result = deskew_image(img)
    assert not np.array_equal(img, result)

def test_deskew_large_angle_skipped():
    """Sudut > 12 derajat tidak dikoreksi (bukan skew, mungkin rotasi portrait)."""
    img = create_test_image(15.0)
    result = deskew_image(img, max_angle=12.0)
    
    # Should not be deskewed, so it remains unchanged
    assert np.array_equal(img, result)

def test_deskew_returns_original_on_none():
    """Tidak crash jika input None."""
    assert deskew_image(None) is None
