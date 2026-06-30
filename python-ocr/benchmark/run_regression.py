#!/usr/bin/env python3
"""Automated regression testing and benchmarking runner for the OCR pipeline."""

import os
import sys
import json
import time
import shutil
from pathlib import Path

# Setup pathing
BENCHMARK_DIR = Path(__file__).resolve().parent
ROOT_DIR = BENCHMARK_DIR.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from main import process_passport
from services.scan_budget import _ocr_profile

def find_sample_images() -> list[Path]:
    """Finds up to 3 sample images in the workspace to seed the benchmark folders."""
    candidates = []
    data_dir = ROOT_DIR / "data"
    if not data_dir.exists():
        data_dir = ROOT_DIR.parent / "data"
    if data_dir.exists():
        for root, _, files in os.walk(data_dir):
            for file in files:
                ext = Path(file).suffix.lower()
                if ext in (".png", ".jpeg", ".jpg"):
                    candidates.append(Path(root) / file)
                    if len(candidates) >= 3:
                        return candidates
    return candidates

def initialize_benchmarks() -> None:
    """Pre-populates sample benchmark folders if they are empty."""
    images = find_sample_images()
    for idx, img_path in enumerate(images, 1):
        folder_name = f"passport_{idx:03d}"
        folder_path = BENCHMARK_DIR / folder_name
        if not folder_path.exists():
            folder_path.mkdir(parents=True, exist_ok=True)
            # Copy sample image
            target_img_path = folder_path / f"image{img_path.suffix}"
            shutil.copy(img_path, target_img_path)
            
            # Generate baseline expected JSON
            expected = {
                "passportNumber": "",
                "firstName": "",
                "familyName": "",
                "dob": "",
                "expiryDate": "",
                "nationality": "",
                "gender": "",
                "placeOfBirth": "",
                "issuingOffice": "",
                "status": "VALID"
            }
            # Run one time to build the baseline draft
            try:
                # Set environment profile temporarily
                os.environ["PASSPORT_OCR_PROFILE"] = "speed"
                res = process_passport(str(target_img_path))
                parsed = res.get("passportExtracted", {})
                for k in expected.keys():
                    if k == "status":
                        expected[k] = res.get("status", "VALID")
                    else:
                        expected[k] = parsed.get(k, "")
            except Exception:
                pass
                
            with open(folder_path / "expected.json", "w", encoding="utf-8") as f:
                json.dump(expected, f, indent=2)
            print(f"Initialized benchmark case: {folder_name} (using {img_path.name})")

def run_regression() -> int:
    """Runs OCR pipeline on all benchmark cases and compares them to expected.json."""
    initialize_benchmarks()
    
    cases = sorted([d for d in BENCHMARK_DIR.iterdir() if d.is_dir() and d.name.startswith("passport_")])
    if not cases:
        print("No benchmark cases found and no sample images in data/ directory to seed.")
        return 1
        
    print(f"Running regression tests on {len(cases)} benchmark case(s)...")
    
    total_fields = 0
    correct_fields = 0
    regressions = 0
    crashes = 0
    wrong_overwrites = 0
    
    profile = os.environ.get("PASSPORT_OCR_PROFILE", "balanced")
    print(f"Active OCR Profile: {profile.upper()}")
    print("-" * 60)
    
    start_time = time.perf_counter()
    
    for case_dir in cases:
        # Find image in the directory
        img_files = [f for f in case_dir.iterdir() if f.suffix.lower() in (".png", ".jpeg", ".jpg")]
        if not img_files:
            continue
        img_path = img_files[0]
        
        expected_path = case_dir / "expected.json"
        if not expected_path.exists():
            continue
            
        with open(expected_path, "r", encoding="utf-8") as f:
            expected = json.load(f)
            
        print(f"Case: {case_dir.name} ({img_path.name})")
        
        try:
            res = process_passport(str(img_path))
            
            # Check for crash (empty passportExtracted or ERROR status when expected was VALID)
            passport_extracted = res.get("passportExtracted", {})
            status = res.get("status", "ERROR")
            
            if not passport_extracted or (status == "ERROR" and expected.get("status") == "VALID"):
                print(f"  -> WARNING: Pipeline returned empty or error record.")
                
            # Compare fields
            for field, exp_val in expected.items():
                if field == "status":
                    actual_val = status
                else:
                    actual_val = passport_extracted.get(field, "")
                    
                total_fields += 1
                if actual_val == exp_val:
                    correct_fields += 1
                else:
                    # Detect regression or wrong overwrite
                    print(f"  -> Field mismatch: '{field}' (Expected: '{exp_val}' | Actual: '{actual_val}')")
                    if exp_val != "" and actual_val == "":
                        regressions += 1
                    elif exp_val != "" and actual_val != exp_val:
                        wrong_overwrites += 1
                        
            # Print decision trace if present
            field_metadata = res.get("fieldMetadata", {})
            if field_metadata:
                print("  -> Decision Trace:")
                for field_name, meta in field_metadata.items():
                    if isinstance(meta, dict):
                        print(f"     * {field_name}: Source: {meta.get('source')} | Decision: {meta.get('decision')} | Reason: {meta.get('reason')}")
                        
        except Exception as exc:
            crashes += 1
            print(f"  -> CRITICAL CRASH: {exc}")
            
        print("-" * 60)
        
    elapsed = time.perf_counter() - start_time
    accuracy = (correct_fields / total_fields * 100) if total_fields > 0 else 0.0
    
    print("\n" + "=" * 40)
    print("REGRESSION SAFETY REPORT")
    print("=" * 40)
    print(f"Success Rate:         {100.0 if crashes == 0 else 0.0:.1f}%")
    print(f"Field Accuracy:       {accuracy:.2f}%")
    print(f"Total Regressions:    {regressions}")
    print(f"Total Crashes:        {crashes}")
    print(f"Wrong Overwrites:     {wrong_overwrites}")
    print(f"Execution Time:       {elapsed:.2f}s")
    print("=" * 40)
    
    return 0 if (regressions == 0 and crashes == 0) else 1

if __name__ == "__main__":
    sys.exit(run_regression())
