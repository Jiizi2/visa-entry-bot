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
            patch("services.image_preprocessor.detect_document_crop", return_value=None),
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


if __name__ == "__main__":
    unittest.main()
