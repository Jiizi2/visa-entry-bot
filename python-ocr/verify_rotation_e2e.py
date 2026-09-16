"""End-to-end rotation verification for the single OCR pipeline.

Reproduces the reported regression: a rotated passport photo must still have its
MRZ/identity recovered in the optimized pipeline. Pre-fix, 90/180/270deg
produced empty identity fields -> ERROR. Post-fix, all orientations should return
the same identity as 0deg.
"""
import sys
import tempfile

import cv2

from main import process_passport

IDENTITY_KEYS = ("passportNumber", "dob", "firstName", "familyName", "issueDate")
ROT_MAP = {0: None, 90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}


def identity(rec: dict) -> dict:
    ext = rec.get("passportExtracted") or {}
    return {k: ext.get(k, "") for k in IDENTITY_KEYS}


def run(path: str) -> None:
    img = cv2.imread(path)
    if img is None:
        print(f"SKIP (cannot read): {path}")
        return
    print(f"\n=== {os.path.basename(path)} ===")
    baseline = None
    for deg, flag in ROT_MAP.items():
        rot = img if flag is None else cv2.rotate(img, flag)
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tf:
            tmp = tf.name
        cv2.imwrite(tmp, rot)
        try:
            rec = process_passport(tmp)
        finally:
            os.unlink(tmp)
        ident = identity(rec)
        status = rec.get("status", "?")
        has_id = bool(ident.get("passportNumber"))
        mark = "OK " if has_id else "FAIL"
        print(f"  [{mark}] {deg:>3}deg  status={status:<8} {ident}")
        if deg == 0:
            baseline = ident
        elif baseline and ident.get("passportNumber") != baseline.get("passportNumber"):
            print(f"        ! passportNumber mismatch vs 0deg ({baseline.get('passportNumber')})")


if __name__ == "__main__":
    paths = sys.argv[1:]
    if not paths:
        print("usage: python verify_rotation_e2e.py <image> [<image> ...]")
        sys.exit(2)
    for p in paths:
        run(p)
