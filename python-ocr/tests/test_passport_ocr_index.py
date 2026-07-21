from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.ocr_observation import OcrDetailedResult, build_observation  # noqa: E402
from services.passport_ocr_index import PassportOcrIndex  # noqa: E402


def observation(text: str, left: int, top: int, right: int, bottom: int):
    return build_observation(
        text=text,
        confidence=0.95,
        box=((left, top), (right, top), (right, bottom), (left, bottom)),
        image_width=1000,
        image_height=1000,
    )


class PassportOcrIndexTests(unittest.TestCase):
    def test_returns_nearest_observations_below_anchor(self) -> None:
        label = observation("PLACE OF BIRTH", 400, 300, 600, 320)
        value = observation("BERAU", 420, 330, 560, 350)
        distant = observation("TANJUNG REDEB", 420, 500, 620, 525)
        index = PassportOcrIndex.from_result(OcrDetailedResult((distant, value, label), 1, True, True, "test"))

        self.assertEqual(index.below(label), [value])


if __name__ == "__main__":
    unittest.main()
