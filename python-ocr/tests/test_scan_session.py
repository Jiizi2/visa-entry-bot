from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scan_session import resolve_scan_target


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


if __name__ == "__main__":
    unittest.main()
