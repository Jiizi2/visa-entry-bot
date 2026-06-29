from __future__ import annotations

import os
import sys
import json
import time
import argparse
from pathlib import Path

# Setup sys.path to find services correctly
SCRIPTS_DIR = Path(__file__).resolve().parent
PYTHON_OCR_DIR = SCRIPTS_DIR.parent
REPO_ROOT = PYTHON_OCR_DIR.parent
sys.path.insert(0, str(PYTHON_OCR_DIR))

SUPPORTED_IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.bmp', '.tif', '.tiff', '.webp'}
DATASET_PATH = PYTHON_OCR_DIR / "datasets" / "passport_dataset.json"


def scan_passports(passports_dir: Path) -> tuple[list[dict[str, str]], int, int]:
    folder_to_images = {}
    skipped_count = 0
    folders_scanned = set()
    
    for root, dirs, files in os.walk(passports_dir):
        # Prune hidden/temp directories starting with dot or named _tmp
        dirs[:] = [d for d in dirs if not d.startswith('.') and d != '_tmp']
        
        folders_scanned.add(root)
        for f in files:
            file_path = Path(root) / f
            ext = file_path.suffix.lower()
            if ext in SUPPORTED_IMAGE_EXTS:
                if root not in folder_to_images:
                    folder_to_images[root] = []
                folder_to_images[root].append(file_path)
            else:
                if file_path.is_file():
                    skipped_count += 1
                    
    records = []
    for folder_path, images in folder_to_images.items():
        folder_name = Path(folder_path).name
        # Sort images deterministically by filename
        images = sorted(images, key=lambda p: p.name.lower())
        
        if len(images) == 1:
            img = images[0]
            rel_path = os.path.relpath(img, REPO_ROOT).replace('\\', '/')
            records.append({
                "id": folder_name,
                "image": rel_path,
                "folder": os.path.relpath(folder_path, REPO_ROOT).replace('\\', '/'),
                "filename": img.name
            })
        else:
            for img in images:
                rel_path = os.path.relpath(img, REPO_ROOT).replace('\\', '/')
                base_name = img.stem
                record_id = f"{folder_name}_{base_name}"
                records.append({
                    "id": record_id,
                    "image": rel_path,
                    "folder": os.path.relpath(folder_path, REPO_ROOT).replace('\\', '/'),
                    "filename": img.name
                })
                
    # Sort dataset records by folder, then filename
    records = sorted(records, key=lambda r: (r["folder"].lower(), r["filename"].lower()))
    
    final_items = []
    for r in records:
        final_items.append({
            "id": r["id"],
            "relative_path": r["image"]
        })
        
    return final_items, len(folders_scanned), skipped_count


def validate_dataset(items: list[dict[str, str]]) -> list[str]:
    errors = []
    seen_ids = set()
    seen_paths = set()
    
    for item in items:
        r_id = item.get("id")
        r_path = item.get("relative_path")
        
        if not r_id:
            errors.append("Record contains empty ID")
            continue
        if not r_path:
            errors.append(f"Record {r_id} contains empty relative_path")
            continue
            
        if r_id in seen_ids:
            errors.append(f"Duplicate ID found: {r_id}")
        seen_ids.add(r_id)
        
        if r_path in seen_paths:
            errors.append(f"Duplicate relative_path found: {r_path}")
        seen_paths.add(r_path)
        
        full_path = REPO_ROOT / r_path
        if not full_path.exists():
            errors.append(f"File does not exist: {r_path} (ID: {r_id})")
        elif not full_path.is_file():
            errors.append(f"Path is not a file: {r_path} (ID: {r_id})")
            
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Build or verify passport evaluation dataset.")
    parser.add_argument("--verify", action="store_true", help="Only verify the existing manifest without rebuilding.")
    args = parser.parse_args()
    
    t0 = time.perf_counter()
    passports_dir = REPO_ROOT / "data" / "example-group" / "passports"
    
    if args.verify:
        if not DATASET_PATH.exists():
            print(f"Error: manifest file {DATASET_PATH} not found. Cannot verify.")
            return 1
        try:
            with open(DATASET_PATH, "r", encoding="utf-8") as f:
                manifest = json.load(f)
            items = manifest.get("items", [])
            errors = validate_dataset(items)
            if errors:
                print("------------------------------------")
                print("Dataset Verification FAILED")
                print("------------------------------------")
                for err in errors:
                    print(f"- {err}")
                return 1
            else:
                print("------------------------------------")
                print("Dataset Verification SUCCESSFUL")
                print("------------------------------------")
                print(f"Verified {len(items)} items. No errors found.")
                return 0
        except Exception as exc:
            print(f"Error during verification: {exc}")
            return 1
            
    # Build dataset
    if not passports_dir.exists():
        print(f"Error: passports directory {passports_dir} does not exist.")
        return 1
        
    items, folders_scanned, skipped_files = scan_passports(passports_dir)
    
    # Internal validation before writing
    errors = validate_dataset(items)
    if errors:
        print("Error: Generated dataset failed validation:")
        for err in errors:
            print(f"- {err}")
        return 1
        
    manifest = {
        "version": 1,
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "root": "data/example-group/passports",
        "count": len(items),
        "items": items
    }
    
    # Write output
    DATASET_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(DATASET_PATH, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        
    elapsed = time.perf_counter() - t0
    
    print("------------------------------------")
    print("Dataset Builder")
    print("------------------------------------")
    print(f"Folders scanned : {folders_scanned}")
    print(f"Passport images : {len(items)}")
    print(f"Skipped files   : {skipped_files}")
    print(f"Output          : {os.path.relpath(DATASET_PATH, REPO_ROOT)}")
    print(f"Elapsed         : {elapsed:.3f}s")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
