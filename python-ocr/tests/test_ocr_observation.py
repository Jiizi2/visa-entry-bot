from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.ocr_observation import build_observation, filter_ocr_text, normalize_ocr_text  # noqa: E402


class OcrObservationTests(unittest.TestCase):
    def test_normalizes_unicode_before_ascii_whitelist(self) -> None:
        self.assertEqual(normalize_ocr_text("RÉDEB"), "REDEB")
        self.assertEqual(filter_ocr_text("TANJUNG RÉDEB", "ABCDEFGHIJKLMNOPQRSTUVWXYZ "), "TANJUNG REDEB")

    def test_builds_full_image_box_for_recognition_only_result(self) -> None:
        observation = build_observation(
            text="BERAU",
            confidence=0.9,
            box=None,
            image_width=200,
            image_height=100,
        )

        self.assertEqual(observation.normalized_box, ((0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)))
        self.assertEqual(observation.center_x, 0.5)
        self.assertEqual(observation.center_y, 0.5)


if __name__ == "__main__":
    unittest.main()
