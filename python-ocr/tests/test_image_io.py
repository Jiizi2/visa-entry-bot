import numpy as np

from services.image_io import read_image, write_image
from services.image_preprocessor import _load_image
from services.mrz_extractor import _read_image


def test_unicode_file_and_directory_preserve_image_pixels(tmp_path):
    directory = tmp_path / "日本_حج"
    directory.mkdir()
    image = np.arange(12 * 18 * 3, dtype=np.uint8).reshape(12, 18, 3)
    path = str(directory / "paspor_é.png")
    assert write_image(path, image)
    for loader in (read_image, _load_image, _read_image):
        assert np.array_equal(loader(path), image)


def test_unreadable_images_return_none(tmp_path):
    assert read_image(str(tmp_path / "missing.png")) is None
    path = tmp_path / "invalid.png"
    path.write_bytes(b"not an image")
    assert read_image(str(path)) is None
    path.write_bytes(b"")
    assert read_image(str(path)) is None


def test_image_write_failure_is_reported(tmp_path):
    image = np.zeros((8, 8, 3), dtype=np.uint8)
    assert not write_image(str(tmp_path / "missing" / "image.png"), image)
    assert not write_image(str(tmp_path / "image.unsupported"), image)
