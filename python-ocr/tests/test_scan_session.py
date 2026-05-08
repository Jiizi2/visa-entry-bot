from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import ANY, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scan_session import PDF_IMAGE_DIR_NAME, list_scan_source_files, prepare_scan_inputs, resolve_scan_target, scan_selected_directory
from services.pdf_image_converter import PdfImageConversionResult


class ScanSessionTests(unittest.TestCase):
    def test_resolve_group_directory_with_passports_subfolder(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            group_dir = Path(temp_dir) / "group-a"
            passports_dir = group_dir / "passports"
            passports_dir.mkdir(parents=True)
            target = resolve_scan_target(str(group_dir))

            self.assertEqual(target.group_id, "group-a")
            self.assertEqual(Path(target.group_dir), group_dir)
            self.assertEqual(Path(target.passports_dir), passports_dir)

    def test_resolve_direct_passports_directory_uses_parent_as_output(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            group_dir = Path(temp_dir) / "group-b"
            passports_dir = group_dir / "passports"
            passports_dir.mkdir(parents=True)
            target = resolve_scan_target(str(passports_dir))

            self.assertEqual(target.group_id, "group-b")
            self.assertEqual(Path(target.group_dir), group_dir)
            self.assertEqual(Path(target.passports_dir), passports_dir)

    def test_resolve_flat_image_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            image_dir = Path(temp_dir) / "flat-images"
            image_dir.mkdir()
            (image_dir / "sample-passport.jpg").write_bytes(b"jpg")
            target = resolve_scan_target(str(image_dir))

            self.assertEqual(target.group_id, "flat-images")
            self.assertEqual(Path(target.group_dir), image_dir)
            self.assertEqual(Path(target.passports_dir), image_dir)

    def test_rejects_directory_without_images_or_passport_folder(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            empty_dir = Path(temp_dir) / "empty"
            empty_dir.mkdir()

            with self.assertRaises(FileNotFoundError):
                resolve_scan_target(str(empty_dir))

    def test_resolve_flat_pdf_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            pdf_dir = Path(temp_dir) / "flat-pdfs"
            pdf_dir.mkdir()
            (pdf_dir / "passport.pdf").write_bytes(b"%PDF")

            target = resolve_scan_target(str(pdf_dir))

            self.assertEqual(target.group_id, "flat-pdfs")
            self.assertEqual(Path(target.group_dir), pdf_dir)
            self.assertEqual(Path(target.passports_dir), pdf_dir)

    def test_resolve_nested_image_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            batch_dir = Path(temp_dir) / "SecondTest"
            nested_dir = batch_dir / "45 PAX"
            nested_dir.mkdir(parents=True)
            (nested_dir / "passport.png").write_bytes(b"png")

            target = resolve_scan_target(str(batch_dir))

            self.assertEqual(target.group_id, "SecondTest")
            self.assertEqual(Path(target.group_dir), batch_dir)
            self.assertEqual(Path(target.passports_dir), batch_dir)

    def test_resolve_nested_pdf_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            batch_dir = Path(temp_dir) / "prodTest"
            nested_dir = batch_dir / "PASSPOR-001" / "PASSPOR"
            nested_dir.mkdir(parents=True)
            (nested_dir / "passport.pdf").write_bytes(b"%PDF")

            target = resolve_scan_target(str(batch_dir))

            self.assertEqual(target.group_id, "prodTest")
            self.assertEqual(Path(target.group_dir), batch_dir)
            self.assertEqual(Path(target.passports_dir), batch_dir)

    def test_list_scan_source_files_includes_nested_files_and_skips_pdf_cache(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            passports_dir = Path(temp_dir) / "passports"
            nested_dir = passports_dir / "45 PAX"
            pdf_cache_dir = passports_dir / PDF_IMAGE_DIR_NAME
            nested_dir.mkdir(parents=True)
            pdf_cache_dir.mkdir(parents=True)
            root_image = passports_dir / "A.jpg"
            nested_image = nested_dir / "B.png"
            nested_pdf = nested_dir / "C.pdf"
            cached_image = pdf_cache_dir / "old_page_001.jpg"
            root_image.write_bytes(b"jpg")
            nested_image.write_bytes(b"png")
            nested_pdf.write_bytes(b"%PDF")
            cached_image.write_bytes(b"jpg")

            files = list_scan_source_files(str(passports_dir))

            self.assertEqual(files, [str(root_image), str(nested_image), str(nested_pdf)])

    def test_prepare_scan_inputs_keeps_images_and_converts_pdfs(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            group_dir = Path(temp_dir) / "group-c"
            passports_dir = group_dir / "passports"
            passports_dir.mkdir(parents=True)
            image_path = passports_dir / "sample-passport.jpg"
            pdf_path = passports_dir / "sample-passport.pdf"
            converted_path = group_dir / PDF_IMAGE_DIR_NAME / "sample-passport_page_001.jpg"
            image_path.write_bytes(b"jpg")
            pdf_path.write_bytes(b"%PDF")
            target = resolve_scan_target(str(group_dir))

            with patch("scan_session.convert_pdf_to_images", return_value=[str(converted_path)]) as converter:
                prepared = prepare_scan_inputs(target)

            converter.assert_called_once()
            self.assertEqual(prepared.source_files, [str(image_path), str(pdf_path)])
            self.assertEqual(prepared.passport_files, [str(image_path), str(converted_path)])
            self.assertEqual(prepared.error_records, [])
            self.assertEqual(prepared.converted_count, 1)

    def test_prepare_scan_inputs_drops_skipped_pdf_pages_from_manifest_inputs(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            group_dir = Path(temp_dir) / "group-c"
            passports_dir = group_dir / "passports"
            passports_dir.mkdir(parents=True)
            pdf_path = passports_dir / "sample-passport.pdf"
            selected_path = group_dir / PDF_IMAGE_DIR_NAME / "sample-passport_page_001.jpg"
            skipped_path = group_dir / PDF_IMAGE_DIR_NAME / "sample-passport_page_002.jpg"
            pdf_path.write_bytes(b"%PDF")
            target = resolve_scan_target(str(group_dir))
            conversion = PdfImageConversionResult(
                selected_paths=[str(selected_path)],
                skipped_paths=[str(skipped_path)],
                page_scores=[120, 0],
                selected_page_indices=(0,),
            )

            with patch("scan_session.convert_pdf_to_images", return_value=conversion):
                prepared = prepare_scan_inputs(target)

            self.assertEqual(prepared.passport_files, [str(selected_path)])
            self.assertEqual(prepared.error_records, [])

    def test_scan_selected_directory_records_pdf_conversion_failure_without_stopping_images(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            group_dir = Path(temp_dir) / "group-d"
            passports_dir = group_dir / "passports"
            passports_dir.mkdir(parents=True)
            image_path = passports_dir / "good.jpg"
            pdf_path = passports_dir / "bad.pdf"
            image_path.write_bytes(b"jpg")
            pdf_path.write_bytes(b"%PDF")

            scanned_record = {
                "id": "good",
                "fileName": "good.jpg",
                "passportImagePath": str(image_path),
                "status": "VALID",
                "reviewStatus": "VALID",
                "processingMetrics": {"totalMs": 1},
            }
            with (
                patch("scan_session.convert_pdf_to_images", side_effect=RuntimeError("broken pdf")),
                patch("scan_session.process_passport", return_value=scanned_record) as process_passport,
            ):
                result = scan_selected_directory(str(group_dir))

            process_passport.assert_called_once_with(str(image_path), step_callback=ANY)
            self.assertEqual(len(result.members), 2)
            self.assertEqual(result.members[0]["fileName"], "good.jpg")
            self.assertEqual(result.members[1]["fileName"], "bad.pdf")
            self.assertEqual(result.members[1]["reviewStatus"], "ERROR")
            self.assertIn("broken pdf", str(result.members[1]["notes"]))


if __name__ == "__main__":
    unittest.main()
