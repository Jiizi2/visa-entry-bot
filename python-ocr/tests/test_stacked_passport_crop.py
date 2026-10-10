from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.image_preprocessor import detect_passport_data_page_crop, find_mrz_band_start
from services.indonesia_field_ocr import _select_fast_location_image


def passport_spread_on_canvas(scale: float = 1.0):
    spread = np.full((1400, 1000, 3), (236, 221, 228), dtype=np.uint8)
    cv2.rectangle(spread, (5, 5), (994, 1394), (20, 20, 20), 10)
    cv2.line(spread, (10, 700), (990, 700), (80, 80, 80), 3)
    for y in range(180, 540, 60):
        cv2.putText(spread, "INSTRUCTION PAGE", (280, y), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (100, 100, 100), 2)
    # This marker represents the header at the very top of the identity page.
    # A crop optimized only for MRZ density would remove it.
    cv2.rectangle(spread, (50, 720), (150, 765), (10, 240, 10), -1)
    cv2.rectangle(spread, (50, 810), (270, 1160), (70, 70, 70), -1)
    cv2.putText(spread, "TEST FULL NAME", (320, 850), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (20, 20, 20), 2)
    cv2.putText(spread, "P<IDNSAMPLE<<TEST<<<<<<<<<<<<<<<<<<<<<<<<<<<", (40, 1270), cv2.FONT_HERSHEY_SIMPLEX, 0.78, (20, 20, 20), 2)
    cv2.putText(spread, "A1234567<0IDN9001010M3001010<<<<<<<<<<<<<<<0", (40, 1320), cv2.FONT_HERSHEY_SIMPLEX, 0.78, (20, 20, 20), 2)
    canvas = np.full((1500, 2200, 3), 245, dtype=np.uint8)
    canvas[50:1450, 600:1600] = spread
    if scale != 1.0:
        canvas = cv2.resize(canvas, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    return canvas


@pytest.mark.parametrize("scale", [1.0, 0.7])
def test_landscape_scan_of_two_pages_preserves_identity_header_and_mrz(scale):
    canvas = passport_spread_on_canvas(scale)
    page = detect_passport_data_page_crop(canvas)
    assert page is not None
    height, width = page.shape[:2]
    assert 1.30 <= width / height <= 1.75
    header = (page[:, :, 1] > 220) & (page[:, :, 0] < 30) & (page[:, :, 2] < 30)
    assert header.any(), "The top of the identity page must survive the crop."
    assert header[:height // 3].any()
    assert (page[int(height * 0.75):int(height * 0.95)] < 50).any()


def test_portrait_document_without_mrz_evidence_is_not_split_in_half():
    canvas = np.full((1500, 2200, 3), 245, dtype=np.uint8)
    document = np.full((1400, 1000, 3), 245, dtype=np.uint8)
    with patch("services.image_preprocessor.detect_document_crop", return_value=document):
        assert detect_passport_data_page_crop(canvas) is document


def test_complete_identity_crop_is_used_even_when_canvas_has_passport_aspect():
    canvas = passport_spread_on_canvas()
    page = detect_passport_data_page_crop(canvas)
    assert _select_fast_location_image(canvas, page) is page


def test_internal_crop_does_not_replace_a_tightly_framed_passport():
    image = np.full((700, 1000, 3), 230, dtype=np.uint8)
    for y in range(10, 690, 20):
        cv2.line(image, (10, y), (990, y), (40, 40, 40), 2)
    internal_panel = image[200:500, 100:550]
    assert _select_fast_location_image(image, internal_panel) is image


def test_blank_margin_does_not_authorize_a_narrow_internal_slice():
    canvas = passport_spread_on_canvas()
    narrow_slice = canvas[1100:1400, 650:1550]
    assert _select_fast_location_image(canvas, narrow_slice) is canvas


def test_solid_cover_edges_are_not_used_as_mrz_rows():
    page = np.full((700, 1000, 3), 245, dtype=np.uint8)
    page[520:535, 40:960] = 20
    page[570:585, 40:960] = 20
    assert find_mrz_band_start(page) is None


def test_tilted_mrz_in_a_photo_with_a_wide_table_background_keeps_the_whole_page():
    page = np.full((700, 1000, 3), 240, dtype=np.uint8)
    cv2.rectangle(page, (40, 30), (150, 65), (10, 240, 10), -1)
    cv2.putText(page, "FULL NAME", (320, 180), cv2.FONT_HERSHEY_SIMPLEX, 1, (40, 40, 40), 2)
    cv2.putText(page, "P<IDNSAMPLE<<TEST<<<<<<<<<<<<<<<<<<<<<<<<<<<", (40, 575), cv2.FONT_HERSHEY_SIMPLEX, .8, (20, 20, 20), 2)
    cv2.putText(page, "E1234567<0IDN9001010M3001010<<<<<<<<<<<<<<<0", (40, 625), cv2.FONT_HERSHEY_SIMPLEX, .8, (20, 20, 20), 2)
    tilted = cv2.warpAffine(page, cv2.getRotationMatrix2D((500, 350), -3, 1), (1000, 700), borderValue=(240, 240, 240))
    canvas = np.full((1200, 1900, 3), (145, 165, 185), dtype=np.uint8)
    canvas[400:1100, 650:1650] = tilted
    with patch("services.image_preprocessor.detect_document_crop", return_value=canvas):
        cropped = detect_passport_data_page_crop(canvas)
    assert cropped is not None
    assert 1.2 <= cropped.shape[1] / cropped.shape[0] <= 1.75
    assert find_mrz_band_start(cropped) is not None
    assert ((cropped[:, :, 1] > 220) & (cropped[:, :, 0] < 30)).any()
    assert _select_fast_location_image(canvas, cropped) is cropped
