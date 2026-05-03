from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OVERRIDES_PATH = ROOT / "services" / "data" / "arabic_name_overrides.json"
ARABIC_SCRIPT_PATTERN = re.compile(r"[\u0600-\u06FF]")
KEY_PATTERN = re.compile(r"^[A-Z0-9]{2,40}$")


def validate_overrides(path: Path) -> list[str]:
    errors: list[str] = []

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        return [f"Gagal membaca JSON: {exc}"]

    if not isinstance(payload, dict):
        return ["Format invalid: root JSON harus object/dictionary."]

    if not payload:
        return ["File override kosong. Tambahkan minimal 1 entri."]

    for key, value in payload.items():
        if not isinstance(key, str) or not isinstance(value, str):
            errors.append(f"Entry invalid: key/value harus string. Key={key!r}")
            continue
        if key != key.upper():
            errors.append(f"Key harus uppercase: {key!r}")
        if not KEY_PATTERN.fullmatch(key):
            errors.append(f"Key hanya boleh A-Z/0-9 (2-40 chars): {key!r}")
        text = re.sub(r"\s+", " ", value).strip()
        if not text:
            errors.append(f"Value kosong untuk key: {key!r}")
            continue
        if not ARABIC_SCRIPT_PATTERN.search(text):
            errors.append(f"Value harus mengandung huruf Arab untuk key: {key!r}")

    return errors


def main() -> int:
    errors = validate_overrides(OVERRIDES_PATH)
    if errors:
        print(f"[FAIL] {OVERRIDES_PATH}")
        for error in errors:
            print(f"- {error}")
        return 1

    print(f"[OK] {OVERRIDES_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
