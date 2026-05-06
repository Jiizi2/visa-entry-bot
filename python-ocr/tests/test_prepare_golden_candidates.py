from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from prepare_golden_candidates import (  # noqa: E402
    _build_candidate,
    _candidate_expected,
    _discover_passport_files,
    _duplicate_file_names,
    _load_golden_names,
    _select_candidate_files,
)


class PrepareGoldenCandidatesTests(unittest.TestCase):
    def test_candidate_expected_uses_status_and_non_empty_passport_fields(self) -> None:
        result = _candidate_expected(
            {
                "status": "VALID",
                "passportExtracted": {
                    "passportNumber": "E1234567",
                    "nationality": "INDONESIA",
                    "birthCity": "",
                },
            }
        )

        self.assertEqual(result, {"status": "VALID", "passportNumber": "E1234567", "nationality": "INDONESIA"})

    def test_select_candidate_files_skips_existing_golden_names(self) -> None:
        files = [Path("A.png"), Path("B.png")]

        self.assertEqual(_select_candidate_files(files, {"A.png"}, include_existing=False), [Path("B.png")])
        self.assertEqual(_select_candidate_files(files, {"A.png"}, include_existing=True), files)

    def test_discover_passport_files_supports_recursive_mode(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            nested = root / "nested"
            nested.mkdir()
            (root / "A.png").write_bytes(b"png")
            (nested / "B.jpeg").write_bytes(b"jpeg")
            (nested / "notes.txt").write_text("skip", encoding="utf-8")

            self.assertEqual([path.name for path in _discover_passport_files(root, recursive=False)], ["A.png"])
            self.assertEqual([path.name for path in _discover_passport_files(root, recursive=True)], ["A.png", "B.jpeg"])

    def test_load_golden_names(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            golden_path = Path(temp_dir) / "golden.json"
            golden_path.write_text(json.dumps([{"fileName": "A.png"}, {"fileName": "B.png"}]), encoding="utf-8")

            self.assertEqual(_load_golden_names(golden_path), {"A.png", "B.png"})

    def test_build_candidate_marks_review_and_duplicates(self) -> None:
        candidate = _build_candidate(
            Path("A.png"),
            {
                "status": "VALID",
                "reviewStatus": "NEEDS_REVIEW",
                "requiresReview": True,
                "reviewReasons": ["MRZ_CHECKSUM_PARTIAL"],
                "passportExtracted": {"passportNumber": "E1234567"},
            },
            {"A.png": ["one/A.png", "two/A.png"]},
        )

        self.assertTrue(candidate["reviewRequired"])
        self.assertFalse(candidate["reviewApproved"])
        self.assertEqual(candidate["reviewReasons"], ["GENERATED_FROM_CURRENT_OCR", "OCR_NEEDS_REVIEW", "DUPLICATE_FILE_NAME"])
        self.assertEqual(candidate["reviewChecklist"][0], {"field": "status", "candidate": "VALID", "status": "needs_review"})
        self.assertEqual(candidate["goldenDraft"], {"fileName": "A.png", "expected": {"status": "VALID", "passportNumber": "E1234567"}})

    def test_duplicate_file_names(self) -> None:
        result = _duplicate_file_names([Path("one/A.png"), Path("two/A.png"), Path("B.png")])

        self.assertEqual(result, {"A.png": ["one\\A.png", "two\\A.png"]} if "\\" in str(Path("one/A.png")) else {"A.png": ["one/A.png", "two/A.png"]})


if __name__ == "__main__":
    unittest.main()
