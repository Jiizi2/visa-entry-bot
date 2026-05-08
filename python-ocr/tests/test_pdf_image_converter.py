from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.pdf_image_converter import (  # noqa: E402
    PDF_PREFLIGHT_MIN_PASSPORT_SCORE,
    _score_pdf_preflight_text,
    _select_pdf_page_indices_from_scores,
)


class PdfImageConverterTests(unittest.TestCase):
    def test_pdf_preflight_scores_mrz_bio_page_as_passport_candidate(self) -> None:
        text = "\n".join(
            [
                "P<IDNRAMADAN<<KARIM<ALFARIZI<<<<<<<<<<<<<<<<",
                "E8710852<5IDN1906017M30010866403050106000214",
            ]
        )

        self.assertGreaterEqual(_score_pdf_preflight_text(text), PDF_PREFLIGHT_MIN_PASSPORT_SCORE)

    def test_pdf_preflight_keeps_keyword_only_page_below_passport_threshold(self) -> None:
        text = "REPUBLIC OF INDONESIA PASSPORT\nENDORSEMENTS"

        self.assertLess(_score_pdf_preflight_text(text), PDF_PREFLIGHT_MIN_PASSPORT_SCORE)

    def test_pdf_preflight_keeps_endorsement_page_below_passport_threshold(self) -> None:
        text = "ENDORSEMENTS VISA STAMP USED PAGES 03 04 05"

        self.assertLess(_score_pdf_preflight_text(text), PDF_PREFLIGHT_MIN_PASSPORT_SCORE)

    def test_pdf_preflight_ignores_short_p_prefix_noise(self) -> None:
        text = "\n".join(["P <", "PI SHEGRTESR", "P ATS R0"])

        self.assertLess(_score_pdf_preflight_text(text), PDF_PREFLIGHT_MIN_PASSPORT_SCORE)

    def test_pdf_page_selection_uses_first_page_for_known_batch_format(self) -> None:
        selected = _select_pdf_page_indices_from_scores([0, PDF_PREFLIGHT_MIN_PASSPORT_SCORE, 15])

        self.assertEqual(selected, (0,))

    def test_pdf_page_selection_keeps_first_page_only_even_with_multiple_confident_pages(self) -> None:
        selected = _select_pdf_page_indices_from_scores(
            [PDF_PREFLIGHT_MIN_PASSPORT_SCORE + 20, PDF_PREFLIGHT_MIN_PASSPORT_SCORE + 10, 0]
        )

        self.assertEqual(selected, (0,))

    def test_pdf_page_selection_falls_back_to_first_page_when_no_confident_candidate(self) -> None:
        selected = _select_pdf_page_indices_from_scores([0, 20, 15])

        self.assertEqual(selected, (0,))


if __name__ == "__main__":
    unittest.main()
