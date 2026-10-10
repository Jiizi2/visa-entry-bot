from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.ocr_observation import OcrDetailedResult, build_observation
from services.passport_ocr_index import PassportOcrIndex
from services.visual_identity import extract_cached_visual_identity, recognize_name_words, resolve_visual_identity, resolve_visual_identity_evidence
from services.scan_context import ScanContext
from services.models import ParsedPassportData
from services.pipeline_stages import _stage_names_recovery
from services.nusuk_manifest import build_member_record


def observation(text, box, confidence=0.99):
    return build_observation(text=text, confidence=confidence, box=box, image_width=1000, image_height=1000)


def rectangle(text, x, y, width=250, height=20):
    return observation(text, ((x, y), (x + width, y), (x + width, y + height), (x, y + height)))


def index(*items):
    return PassportOcrIndex.from_result(OcrDetailedResult(tuple(items), 1, True, False, "test"))


class VisualIdentityTests(unittest.TestCase):
    def test_damaged_name_label_does_not_include_the_endorsement_name(self):
        data = index(rectangle("NAMALENGLARFPUELN", 300, 100),
            rectangle("ALIF BUDI", 300, 140),
            rectangle("NAMA TAMBAHAN/ADDITIONAL NAME", 300, 300),
            rectangle("ALIF BUDI CANDRA", 300, 340))
        self.assertEqual(resolve_visual_identity(None, data), {"fullName": "ALIF BUDI"})

    def test_labelled_visual_fields_are_available_without_mrz_line_two(self):
        data = index(rectangle("NO.PASPOR/PASSPORT NO", 700, 100), rectangle("E1234567", 700, 140),
            rectangle("FULL NAME", 300, 100), rectangle("ALIF BUDI", 300, 140),
            rectangle("KEWARGANEGARAAN/NATIONALITY", 300, 200), rectangle("INDONESIA", 300, 240),
            rectangle("TGLLAHIR/DATEOFBIRTH", 300, 300), rectangle("07FEB1992", 300, 340),
            rectangle("KELAMIN/SEX", 570, 300, width=120), rectangle("P/F", 570, 340, width=90))
        self.assertEqual(resolve_visual_identity(None, data), {"fullName": "ALIF BUDI", "passportNumber": "E1234567",
            "nationality": "INDONESIA", "dob": "1992-02-07", "gender": "FEMALE"})

    def test_date_column_alignment_takes_priority_over_a_tiny_vertical_difference(self):
        data = index(rectangle("DATE OF EXPIRY", 770, 500, width=180),
            rectangle("04DEC2025", 590, 532, width=130), rectangle("04DEC2035", 790, 534, width=130))
        self.assertEqual(resolve_visual_identity(None, data), {"expiryDate": "2035-12-04"})

    def test_shaded_expiry_label_can_recover_the_printed_date(self):
        data = index(rectangle("XGLHABIS SERLAKUJDATE OY EOPTRY", 700, 500),
            rectangle("03JAN2034", 700, 545))
        self.assertEqual(resolve_visual_identity(None, data), {"expiryDate": "2034-01-03"})

    def test_birthplace_without_a_label_requires_an_observed_birth_date_row(self):
        data = index(rectangle("TGLLAHIR/DATEOFBIRTH", 300, 450), rectangle("07FEB1992", 300, 500),
            rectangle("KARAWANG", 760, 510))
        self.assertEqual(resolve_visual_identity_evidence(None, data).location_values, {"placeOfBirth": "KARAWANG"})
        self.assertEqual(resolve_visual_identity_evidence(None, index(*data.observations[1:])).location_values, {})

    def test_missing_expiry_label_reads_the_date_along_the_issued_date(self):
        data = index(rectangle("DATE OF ISSUE", 300, 450), rectangle("14SEP2026", 300, 500),
            rectangle("14SEP2031", 760, 512))
        self.assertEqual(resolve_visual_identity(None, data), {"issueDate": "2026-09-14", "expiryDate": "2031-09-14"})
        self.assertEqual(resolve_visual_identity(None, index(*data.observations[:2])), {"issueDate": "2026-09-14"})

    def test_unlabelled_serial_needs_a_visible_name_and_a_unique_printed_number(self):
        data = (rectangle("FULL NAME", 300, 100), rectangle("ALIF BUDI", 300, 140), rectangle("E1234567", 700, 90))
        self.assertEqual(resolve_visual_identity(None, index(*data))["passportNumber"], "E1234567")
        self.assertNotIn("passportNumber", resolve_visual_identity(None, index(*data, rectangle("X1234567", 700, 80))))

    def test_unlabelled_name_requires_every_observed_letter_to_match_printed_mrz(self):
        data = index(rectangle("ALIF BUDI", 300, 140), rectangle("P<IDNBUDI<<ALIF<<<<<<<<<<<<<<", 100, 800))
        self.assertEqual(resolve_visual_identity(None, data)["fullName"], "ALIF BUDI")
        self.assertEqual(resolve_visual_identity(None, index(rectangle("ALIFA BUDI", 300, 140), data.observations[-1])), {})

    def test_observed_name_and_dates_with_skewed_overlapping_boxes(self):
        data = index(
            observation("NAMA LENGKAP/FULL NAME", ((300, 210), (500, 190), (500, 215), (300, 235))),
            rectangle("FATIH RAFAIZAN ARDIAN", 300, 232),
            rectangle("TGL PENGELUARAN/DATE OF ISSUE", 300, 550),
            rectangle("25AUG2023", 300, 595),
            observation("TGL HABIS BERLAKU/DATE OF EXPIRY", ((700, 510), (950, 540), (950, 560), (700, 530))),
            rectangle("25AUG2028", 700, 555),
        )
        self.assertEqual(resolve_visual_identity(None, data), {
            "fullName": "FATIH RAFAIZAN ARDIAN", "issueDate": "2023-08-25", "expiryDate": "2028-08-25",
        })

    def test_missing_labels_do_not_guess_identity_from_unrelated_text(self):
        self.assertEqual(resolve_visual_identity(None, index(rectangle("INDONESIA", 300, 300))), {})

    def test_long_name_can_extend_beyond_its_label_center(self):
        data = index(
            rectangle("FULL NAME", 300, 100, width=180),
            rectangle("MUHAMMAD TSABIT TSAQIB AL BARSUNDI", 300, 140, width=650),
        )
        evidence = resolve_visual_identity_evidence(None, data)
        self.assertEqual(evidence.fields["fullName"], "MUHAMMAD TSABIT TSAQIB AL BARSUNDI")
        self.assertTrue(evidence.name_words_verified)

    def test_name_in_a_separate_column_is_not_selected(self):
        data = index(
            rectangle("FULL NAME", 100, 100, width=150),
            rectangle("OTHER PERSON", 650, 140, width=250),
        )
        self.assertNotIn("fullName", resolve_visual_identity(None, data))

    def test_conflicting_full_name_observations_are_not_selected(self):
        data = index(rectangle("FULL NAME", 300, 100), rectangle("ALI BUDI", 300, 140), rectangle("FULL NAME", 300, 300), rectangle("SITI AMINAH", 300, 340))
        self.assertNotIn("fullName", resolve_visual_identity(None, data))
        self.assertEqual(resolve_visual_identity_evidence(None, data).name_candidates, ("ALI BUDI", "SITI AMINAH"))

    def test_mononym_observation_is_preserved_when_segmentation_is_unavailable(self):
        data = index(rectangle("FULL NAME", 300, 100), rectangle("SAKDILLAH", 300, 140))
        evidence = resolve_visual_identity_evidence(None, data)
        self.assertEqual(evidence.fields["fullName"], "SAKDILLAH")
        self.assertFalse(evidence.name_words_verified)
        self.assertGreater(evidence.confidence["fullName"], 0.98)

    def test_merged_name_remains_evidence_if_word_recognition_fails(self):
        data = index(rectangle("FULL NAME", 300, 100), rectangle("MEYSISALSAHBILLA", 300, 140))
        with patch("services.visual_identity.recognize_name_words", return_value=""):
            evidence = resolve_visual_identity_evidence(None, data)
        self.assertEqual(evidence.fields["fullName"], "MEYSISALSAHBILLA")
        self.assertFalse(evidence.name_words_verified)

    def test_visible_word_gaps_are_used_without_dictionary_splitting(self):
        image = np.full((50, 400, 3), 255, np.uint8)
        cv2.putText(image, "FATIH   RAFAIZAN   ARDIAN", (2, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
        name = observation("FATIHRAFAIZANARDIAN", ((0, 8), (340, 8), (340, 39), (0, 39)))
        def recognized(text):
            return OcrDetailedResult((rectangle(text, 0, 0),), 1, False, False, "test")
        with patch("services.visual_identity.run_rapid_ocr_detailed", side_effect=[recognized("FATIH"), recognized("RAFAIZAN"), recognized("ARDIAN")]) as ocr:
            self.assertEqual(recognize_name_words(image, name), "FATIH RAFAIZAN ARDIAN")
            self.assertEqual(ocr.call_count, 3)
        with patch("services.visual_identity.run_rapid_ocr_detailed", side_effect=[recognized("FATIH"), recognized("RAFAIZAN"), recognized("ARDIANA")] * 2):
            self.assertEqual(recognize_name_words(image, name), "")
        with patch("services.visual_identity.run_rapid_ocr_detailed", side_effect=[
            recognized("FATIH"), recognized("RAFAIZAN"), recognized("RDIAN"),
            recognized("FATIH"), recognized("RAFAIZAN"), recognized("ARDIAN"),
        ]):
            self.assertEqual(recognize_name_words(image, name), "FATIH RAFAIZAN ARDIAN")

    def test_missing_cached_page_does_not_start_another_full_page_scan(self):
        with patch("services.visual_identity.run_rapid_ocr_detailed") as ocr:
            self.assertEqual(extract_cached_visual_identity("missing.png"), {})
            ocr.assert_not_called()

    def test_observed_name_replaces_broken_mrz_as_a_pair_even_after_budget_expires(self):
        ctx = ScanContext("missing.png", "missing.png", -1)
        ctx.parsed = ParsedPassportData(firstName="ZFA", familyName="ARDIAN")
        ctx.merged_visual_fields = {"fullName": "FATIH RAFAIZAN ARDIAN"}
        ctx.field_metadata = {field: {"source": "MRZ", "validated": True, "confidence": 0.99} for field in ("firstName", "familyName")}
        _stage_names_recovery(ctx)
        self.assertEqual(ctx.parsed["firstName"], "FATIH RAFAIZAN")
        self.assertEqual(ctx.parsed["familyName"], "ARDIAN")
        self.assertIn("PASSPORT NAME DISAGREEMENT REQUIRES REVIEW", ctx.name_notes)
        self.assertEqual(ctx.field_metadata["firstName"]["source"], "VISUAL")

    def test_disagreement_with_passport_full_name_cannot_be_marked_valid(self):
        record = build_member_record("passport.png", "passport.png", ParsedPassportData(firstName="MUHAMMAD CHOLID", familyName="HIDAYATULLAH"), {"fullName": "FATIH RAFAIZAN ARDIAN"}, {"data": {}, "confidence": 0.99}, "VALID", 0.99, "")
        self.assertIn("NAME_EVIDENCE_CONFLICT", record["reviewReasons"])
        self.assertEqual(record["reviewStatus"], "NEEDS_REVIEW")


if __name__ == "__main__":
    unittest.main()
