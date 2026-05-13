from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services import image_preprocessor  # noqa: E402


@unittest.skipIf(image_preprocessor.cv2 is None, "OpenCV is not installed")
class ImagePreprocessorTests(unittest.TestCase):
    def setUp(self) -> None:
        image_preprocessor.clear_image_preprocess_cache()
        image_preprocessor.reset_image_preprocessor_stats()

    def tearDown(self) -> None:
        image_preprocessor.clear_image_preprocess_cache()
        image_preprocessor.reset_image_preprocessor_stats()

    def test_processed_document_image_records_cost_and_cache_hits(self) -> None:
        image = np.full((120, 240, 3), 240, dtype=np.uint8)
        image[40:80, 80:180] = 40

        with (
            patch.dict("os.environ", {"PASSPORT_IMAGE_PREPROCESS_MODE": "light"}, clear=False),
            patch("services.image_preprocessor._load_image", return_value=image),
            patch("services.image_preprocessor.detect_passport_data_page_crop", return_value=None),
        ):
            first = image_preprocessor.build_processed_document_image("sample.png")
            second = image_preprocessor.build_processed_document_image("sample.png")

        self.assertIsNotNone(first)
        self.assertIs(first, second)
        stats = image_preprocessor.get_image_preprocessor_stats()
        self.assertEqual(stats["requestCount"], 2)
        self.assertEqual(stats["cacheHitCount"], 1)
        self.assertEqual(stats["callCount"], 1)
        self.assertEqual(stats["errorCount"], 0)
        self.assertGreaterEqual(stats["inputMegaPixels"], 0.028)
        self.assertGreater(stats["estimatedPeakMb"], 0)

    def test_processed_document_image_can_be_disabled(self) -> None:
        with patch.dict("os.environ", {"PASSPORT_IMAGE_PREPROCESS_MODE": "off"}, clear=False):
            result = image_preprocessor.build_processed_document_image("sample.png")

        self.assertIsNone(result)
        self.assertEqual(image_preprocessor.get_image_preprocessor_stats()["requestCount"], 0)

    def test_stacked_passport_crop_prefers_lower_data_page_with_mrz_band(self) -> None:
        image = np.full((1000, 500, 3), 255, dtype=np.uint8)
        instruction_page = np.full((320, 500, 3), 255, dtype=np.uint8)
        instruction_page[250:270, 360:460] = 20
        data_page = np.full((320, 500, 3), 255, dtype=np.uint8)
        data_page[235:248, 35:465] = 20
        data_page[270:283, 35:465] = 20

        with patch(
            "services.image_preprocessor.detect_document_crop",
            side_effect=[instruction_page, data_page, None, None, None, None, None],
        ):
            result = image_preprocessor.detect_passport_data_page_crop(image)

        self.assertIs(result, data_page)

    def test_stacked_passport_crop_prefers_comparable_shorter_data_page(self) -> None:
        image = np.full((1200, 600, 3), 255, dtype=np.uint8)
        full_stack_crop = np.full((980, 600, 3), 255, dtype=np.uint8)
        data_page = np.full((500, 600, 3), 255, dtype=np.uint8)

        with (
            patch(
                "services.image_preprocessor.detect_document_crop",
                side_effect=[full_stack_crop, data_page, None, None, None, None, None],
            ),
            patch("services.image_preprocessor._mrz_band_score", side_effect=[220.0, 210.0, 0.0, 0.0, 0.0, 0.0, 0.0]),
        ):
            result = image_preprocessor.detect_passport_data_page_crop(image)

        self.assertIs(result, data_page)

    def test_comparable_overly_wide_slice_does_not_replace_full_passport_page(self) -> None:
        full_page = np.full((360, 520, 3), 255, dtype=np.uint8)
        overly_wide_slice = np.full((245, 520, 3), 255, dtype=np.uint8)

        self.assertFalse(
            image_preprocessor._is_better_passport_data_crop(
                overly_wide_slice,
                220.0,
                full_page,
                220.0,
            )
        )

    def test_marginally_better_overcropped_slice_does_not_replace_page(self) -> None:
        current_page = np.full((420, 520, 3), 255, dtype=np.uint8)
        overcropped_slice = np.full((300, 520, 3), 255, dtype=np.uint8)

        self.assertFalse(
            image_preprocessor._is_better_passport_data_crop(
                overcropped_slice,
                207.0,
                current_page,
                200.0,
            )
        )


if __name__ == "__main__":
    unittest.main()
