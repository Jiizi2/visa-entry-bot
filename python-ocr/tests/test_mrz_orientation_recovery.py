from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.mrz_extractor import _read_direct_mrz, _read_best_mrz
from services.mrz_parser import DirectMrzResult, _repair_direct_line2_digits
from services.mrz_validation import calculate_mrz_check_digit
from services.pipeline_stages import _stage_mrz, _stage_visual_fields
from services.scan_context import ScanContext
from services.visual_identity import VisualIdentityEvidence


def _verified_mrz() -> DirectMrzResult:
    return DirectMrzResult(
        line1="P<IDNRAMADAN<<KARIM<ALFARIZI<<<<<<<<<<<<<<<<",
        line2="E8710852<5IDN1906017M30010866403050106000214",
        valid_score=100,
    )


def test_exhausted_mrz_stage_does_not_build_enhanced_full_image_variants():
    with (patch("services.mrz_extractor._read_direct_mrz", return_value=None),
          patch("services.mrz_extractor.ocr_time_remaining", return_value=0.0),
          patch("services.mrz_extractor.temporary_mrz_variants") as variants):
        assert _read_best_mrz("missing.jpg") == (None, "")
        variants.assert_not_called()


def test_indonesian_serial_digit_confusion_requires_its_printed_check_digit():
    serial = "E1234567<"
    check = calculate_mrz_check_digit(serial)
    raw = "E1234S67<" + check + "IDN9001010M3001010<<<<<<<<<<<<<<<0"
    raw = raw[:44].ljust(44, "<")
    assert _repair_direct_line2_digits(raw).startswith(serial + check)
    wrong_check = str((int(check) + 1) % 10)
    assert _repair_direct_line2_digits(raw[:9] + wrong_check + raw[10:]).startswith("E1234S67<")


def test_mrz_failure_retains_the_page_orientation_for_visible_fields():
    ctx = ScanContext("clipped.jpg", "clipped.jpg", 30_000)
    with (patch("services.pipeline_stages.extract_mrz_data", side_effect=ValueError("Clipped MRZ")),
          patch("services.pipeline_stages.infer_passport_rotation", return_value=270)):
        _stage_mrz(ctx)
    assert ctx.ocr_rotation_degrees == 270
    assert ctx.mrz_error == "Clipped MRZ"


def test_unreadable_landscape_band_does_not_suppress_sideways_recovery():
    # A dark band can pass the image heuristic without containing readable MRZ.
    image = np.zeros((200, 300, 3), dtype=np.uint8)
    rotated = np.rot90(image, 3)
    expected_region = rotated[int(rotated.shape[0] * 0.82):, :]

    def read_region(region, **_kwargs):
        return _verified_mrz() if np.array_equal(region, expected_region) else None

    with (
        patch("services.mrz_extractor._load_image", return_value=image),
        patch("services.mrz_extractor.detect_passport_data_page_crop", return_value=None),
        patch("services.mrz_extractor._extract_direct_mrz_from_region", side_effect=read_region),
    ):
        result = _read_direct_mrz("sideways-spread.jpg")

    assert result is not None
    assert result.rotation_degrees == 90


def test_rotation_recrops_the_original_spread_instead_of_the_wrong_page():
    image = (np.arange(400 * 600 * 3).reshape(400, 600, 3) % 251).astype(np.uint8)
    rotated = np.rot90(image, 3)
    wrong_page = image[100:350, 100:500]
    data_page = rotated[280:580, :]
    expected_region = data_page[int(data_page.shape[0] * 0.82):, :]

    def detect_page(candidate):
        return data_page if np.array_equal(candidate, rotated) else wrong_page

    def read_region(region, **_kwargs):
        return _verified_mrz() if np.array_equal(region, expected_region) else None

    with (
        patch("services.mrz_extractor._load_image", return_value=image),
        patch("services.mrz_extractor.detect_passport_data_page_crop", side_effect=detect_page) as detector,
        patch("services.mrz_extractor._extract_direct_mrz_from_region", side_effect=read_region),
    ):
        result = _read_direct_mrz("sideways-spread.jpg")

    assert result is not None
    assert result.rotation_degrees == 90
    assert any(np.array_equal(call.args[0], rotated) for call in detector.call_args_list)


def test_mrz_above_a_large_printed_footer_is_kept_in_the_scan_band():
    image = np.full((1500, 2200, 3), 245, dtype=np.uint8)
    page = np.full((700, 1000, 3), 245, dtype=np.uint8)
    # The first MRZ row is just above the old 75% boundary; both rows are needed.
    for column in range(50, 950, 19):
        page[520:530, column:column + 8] = (10, 20, 30)
        page[560:570, column:column + 8] = (11, 21, 31)

    def read_region(region, **_kwargs):
        first_row = np.all(region == (10, 20, 30), axis=2).any()
        second_row = np.all(region == (11, 21, 31), axis=2).any()
        return _verified_mrz() if first_row and second_row else None

    with (
        patch("services.mrz_extractor._load_image", return_value=image),
        patch("services.mrz_extractor.detect_passport_data_page_crop", return_value=page),
        patch("services.mrz_extractor._extract_direct_mrz_from_region", side_effect=read_region),
    ):
        result = _read_direct_mrz("spread-with-footer.jpg")

    assert result is not None
    assert result.rotation_degrees == 0


def test_geometric_priority_keeps_other_orientations_when_ocr_does_not_verify():
    image = (np.arange(400 * 600 * 3).reshape(400, 600, 3) % 251).astype(np.uint8)
    correct = np.rot90(image, 3)
    misleading = np.rot90(image, 1)
    expected_region = correct[int(correct.shape[0] * 0.82):, :]

    def locate(candidate):
        return 0.65 if np.array_equal(candidate, misleading) else None

    def read_region(region, **_kwargs):
        return _verified_mrz() if np.array_equal(region, expected_region) else None

    with (
        patch("services.mrz_extractor._load_image", return_value=image),
        patch("services.mrz_extractor.detect_passport_data_page_crop", side_effect=lambda candidate: candidate),
        patch("services.mrz_extractor.find_mrz_band_start", side_effect=locate),
        patch("services.mrz_extractor._extract_direct_mrz_from_region", side_effect=read_region) as reader,
    ):
        result = _read_direct_mrz("misleading-dark-band.jpg")

    assert result is not None
    assert result.rotation_degrees == 90
    assert any(np.array_equal(call.args[0], misleading[int(misleading.shape[0] * 0.65):, :])
               for call in reader.call_args_list)


@pytest.mark.parametrize("degrees", [90, 180, 270])
def test_mrz_orientation_reaches_visual_identity_and_locations(degrees):
    ctx = ScanContext("rotated.jpg", "rotated.jpg", 30_000)
    data = {**_verified_mrz().to_dict(), "rotationDegrees": degrees}
    extraction = {"data": data, "confidence": 0.99, "mrzValidation": {"valid": True}}

    with (
        patch("services.pipeline_stages.extract_mrz_data", return_value=extraction),
        patch("services.pipeline_stages.extract_fast_location_fields", return_value={}) as locations,
        patch("services.pipeline_stages.extract_visual_identity_evidence", return_value=VisualIdentityEvidence()) as identity,
    ):
        _stage_mrz(ctx)
        _stage_visual_fields(ctx)

    assert ctx.ocr_rotation_degrees == degrees
    assert locations.call_args.kwargs["rotation_degrees"] == degrees
    assert identity.call_args.args[1] == degrees
