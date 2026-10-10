"""OpenCV image I/O through Python paths, including Unicode on Windows."""
from pathlib import Path

import numpy as np

try:
    import cv2
except ImportError:  # pragma: no cover - depends on the installation
    cv2 = None


def read_image(file_path: str) -> object | None:
    if cv2 is None:
        return None
    try:
        contents = Path(file_path).read_bytes()
        if not contents:
            return None
        return cv2.imdecode(np.frombuffer(contents, dtype=np.uint8), cv2.IMREAD_COLOR)
    except (OSError, ValueError, cv2.error):
        return None


def write_image(file_path: str, image: object) -> bool:
    if cv2 is None or image is None:
        return False
    try:
        path = Path(file_path)
        success, encoded = cv2.imencode(path.suffix, image)
        if not success:
            return False
        path.write_bytes(encoded.tobytes())
        return True
    except (OSError, ValueError, cv2.error):
        return False
