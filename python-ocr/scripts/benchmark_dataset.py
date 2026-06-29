from __future__ import annotations

import os
import sys
import json
import time
import argparse
import statistics
from pathlib import Path

# Setup sys.path to find services correctly
SCRIPTS_DIR = Path(__file__).resolve().parent
PYTHON_OCR_DIR = SCRIPTS_DIR.parent
REPO_ROOT = PYTHON_OCR_DIR.parent
sys.path.insert(0, str(PYTHON_OCR_DIR))

from services.mrz_extractor import extract_mrz_data
from services.mrz_metrics import mrz_metrics_context

DATASET_PATH = PYTHON_OCR_DIR / "datasets" / "passport_dataset.json"
BENCHMARK_DIR = PYTHON_OCR_DIR / "benchmark"
RESULT_PATH = BENCHMARK_DIR / "benchmark_result.json"
SUMMARY_PATH = BENCHMARK_DIR / "benchmark_summary.json"
REPORT_PATH = BENCHMARK_DIR / "benchmark_report.md"


def get_percentile(data: list[float], percentile: float) -> float:
    if not data:
        return 0.0
    sorted_data = sorted(data)
    idx = int(len(sorted_data) * percentile)
    idx = max(0, min(len(sorted_data) - 1, idx))
    return sorted_data[idx]


def build_histogram(runtimes_ms: list[float]) -> str:
    if not runtimes_ms:
        return "No data to build histogram"
        
    # Define buckets in milliseconds
    buckets = [
        (0, 1000, "0s - 1s "),
        (1000, 2000, "1s - 2s "),
        (2000, 3000, "2s - 3s "),
        (3000, 4000, "3s - 4s "),
        (4000, 5000, "4s - 5s "),
        (5000, float('inf'), "5s+    ")
    ]
    
    counts = [0] * len(buckets)
    for r in runtimes_ms:
        for i, (low, high, _) in enumerate(buckets):
            if low <= r < high:
                counts[i] += 1
                break
                
    max_count = max(counts) if max(counts) > 0 else 1
    max_width = 30  # Max character width of the bar
    
    lines = []
    for (low, high, label), count in zip(buckets, counts):
        bar_len = int((count / max_count) * max_width)
        bar = "█" * bar_len
        if bar_len == 0 and count > 0:
            bar = "░"
        lines.append(f"{label}: {bar:<{max_width}} ({count})")
        
    return "\n".join(lines)


def run_benchmark() -> int:
    # Ensure profile is balanced if not set, to exercise fallbacks
    if "PASSPORT_OCR_PROFILE" not in os.environ:
        os.environ["PASSPORT_OCR_PROFILE"] = "balanced"
        
    profile = os.environ["PASSPORT_OCR_PROFILE"]
    
    if not DATASET_PATH.exists():
        print(f"Error: manifest file {DATASET_PATH} not found. Run build_passport_dataset.py first.")
        return 1
        
    with open(DATASET_PATH, "r", encoding="utf-8") as f:
        manifest = json.load(f)
        
    items = manifest.get("items", [])
    if not items:
        print("Error: Dataset manifest contains no items.")
        return 1
        
    print(f"Starting benchmark on {len(items)} items (profile: {profile})...")
    
    raw_records = []
    success_runtimes = []
    runs_list = []
    fallback_count = 0
    orientation_counts = {"0": 0, "90": 0, "180": 0, "270": 0}
    successful_orientations = {"0": 0, "90": 0, "180": 0, "270": 0, "None": 0}
    successful_variants = {"gray": 0, "clahe": 0, "otsu": 0, "adaptive": 0, "None": 0}
    
    direct_success_count = 0
    fallback_success_count = 0
    early_exit_count = 0
    
    slowest_passport = None
    fastest_passport = None
    
    for idx, item in enumerate(items, 1):
        r_id = item["id"]
        rel_path = item["relative_path"]
        full_path = REPO_ROOT / rel_path
        
        print(f"[{idx}/{len(items)}] Processing {r_id}...", end="\r", flush=True)
        
        record = {
            "id": r_id,
            "relative_path": rel_path,
            "success": False
        }
        
        try:
            with mrz_metrics_context() as collector:
                extract_mrz_data(str(full_path))
                
            record["success"] = True
            
            # Extract internal metrics
            t_ocr_ms = int(collector.t_ocr * 1000)
            t_repair_ms = int(collector.t_repair * 1000)
            t_total_ms = int(collector.t_total * 1000)
            t_preprocess_ms = max(0, t_total_ms - t_ocr_ms - t_repair_ms)
            
            record["elapsed_ms"] = {
                "preprocess": t_preprocess_ms,
                "ocr": t_ocr_ms,
                "repair": t_repair_ms,
                "total": t_total_ms
            }
            record["rapidocr_runs"] = collector.rapidocr_runs
            record["variant_attempts"] = collector.variant_attempts
            record["orientation_attempts"] = {str(k): v for k, v in collector.orientation_attempts.items()}
            record["successful_variant"] = str(collector.successful_variant) if collector.successful_variant else "None"
            record["successful_orientation"] = str(collector.successful_orientation) if collector.successful_orientation is not None else "None"
            record["fallback_used"] = collector.fallback_used
            record["direct_success"] = collector.direct_success
            record["fallback_success"] = collector.fallback_success
            record["early_exit_triggered"] = collector.early_exit_triggered
            
            # Aggregate stats
            success_runtimes.append(t_total_ms)
            runs_list.append(collector.rapidocr_runs)
            
            if collector.fallback_used:
                fallback_count += 1
            if collector.direct_success:
                direct_success_count += 1
            if collector.fallback_success:
                fallback_success_count += 1
            if collector.early_exit_triggered:
                early_exit_count += 1
                
            for k, v in collector.orientation_attempts.items():
                orientation_counts[str(k)] += v
                
            successful_orientations[record["successful_orientation"]] += 1
            successful_variants[record["successful_variant"]] += 1
            
            if slowest_passport is None or t_total_ms > slowest_passport["total_ms"]:
                slowest_passport = {
                    "id": r_id,
                    "relative_path": rel_path,
                    "total_ms": t_total_ms
                }
            if fastest_passport is None or t_total_ms < fastest_passport["total_ms"]:
                fastest_passport = {
                    "id": r_id,
                    "relative_path": rel_path,
                    "total_ms": t_total_ms
                }
                
        except Exception as exc:
            record["error"] = str(exc)
            
        raw_records.append(record)
        
    print()  # Clear line carriage return
    
    total_images = len(items)
    success_count = len(success_runtimes)
    failed_count = total_images - success_count
    
    # Compute summary
    summary = {
        "version": 1,
        "profile": profile,
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "total_passports": total_images,
        "successful_passports": success_count,
        "failed_passports": failed_count,
        "elapsed_ms": {
            "avg": float(f"{statistics.fmean(success_runtimes):.1f}") if success_runtimes else 0.0,
            "median": float(f"{statistics.median(success_runtimes):.1f}") if success_runtimes else 0.0,
            "p95": float(f"{get_percentile(success_runtimes, 0.95):.1f}") if success_runtimes else 0.0,
            "p99": float(f"{get_percentile(success_runtimes, 0.99):.1f}") if success_runtimes else 0.0,
            "min": min(success_runtimes) if success_runtimes else 0,
            "max": max(success_runtimes) if success_runtimes else 0
        },
        "rapidocr_runs": {
            "avg": float(f"{statistics.fmean(runs_list):.2f}") if runs_list else 0.0,
            "max": max(runs_list) if runs_list else 0
        },
        "fallback_rate": float(f"{fallback_count / total_images:.4f}") if total_images > 0 else 0.0,
        "orientation_distribution": orientation_counts,
        "successful_orientation_distribution": successful_orientations,
        "successful_variant_distribution": successful_variants,
        "direct_success_count": direct_success_count,
        "fallback_success_count": fallback_success_count,
        "early_exit_count": early_exit_count,
        "slowest_passport": slowest_passport,
        "fastest_passport": fastest_passport
    }
    
    # Write benchmark_result.json
    BENCHMARK_DIR.mkdir(parents=True, exist_ok=True)
    with open(RESULT_PATH, "w", encoding="utf-8") as f:
        json.dump({"records": raw_records}, f, indent=2, ensure_ascii=False)
        
    # Write benchmark_summary.json
    with open(SUMMARY_PATH, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
        
    # Generate markdown report
    histogram_str = build_histogram(success_runtimes)
    
    report_content = f"""# Benchmark Performance Report

Laporan ini menyajikan hasil evaluasi kinerja baseline untuk ekstraksi MRZ menggunakan RapidOCR.

* **Tanggal Pembuatan**: {summary["created_at"]}
* **Profil OCR**: {summary["profile"]}
* **Jumlah Paspor**: {summary["total_passports"]} (Sukses: {summary["successful_passports"]}, Gagal: {summary["failed_passports"]})

---

## 1. Distribusi Waktu Eksekusi (Runtime)

| Parameter | Waktu (ms) |
| :--- | :---: |
| **Rata-rata (Average)** | {summary["elapsed_ms"]["avg"]} ms |
| **Median** | {summary["elapsed_ms"]["median"]} ms |
| **Persentil 95 (P95)** | {summary["elapsed_ms"]["p95"]} ms |
| **Persentil 99 (P99)** | {summary["elapsed_ms"]["p99"]} ms |
| **Minimum** | {summary["elapsed_ms"]["min"]} ms |
| **Maksimum** | {summary["elapsed_ms"]["max"]} ms |

### Histogram Distribusi Runtime
```text
{histogram_str}
```

---

## 2. Metrik Pemanggilan OCR & Alur Kerja

| Parameter | Nilai / Distribusi |
| :--- | :--- |
| **Rata-rata Pemanggilan RapidOCR** | {summary["rapidocr_runs"]["avg"]} runs |
| **Maksimum Pemanggilan RapidOCR** | {summary["rapidocr_runs"]["max"]} runs |
| **Fallback Rate** | {summary["fallback_rate"] * 100:.2f}% ({fallback_count} paspor) |
| **Direct Success Count** | {summary["direct_success_count"]} paspor |
| **Fallback Success Count** | {summary["fallback_success_count"]} paspor |
| **Early Exit (Indonesian Fast Path)** | {summary["early_exit_count"]} paspor |

---

## 3. Distribusi Orientasi & Varian Sukses

### Distribusi Orientasi yang Diproses (Attempts)
* **0 derajat**: {summary["orientation_distribution"]["0"]} kali
* **90 derajat**: {summary["orientation_distribution"]["90"]} kali
* **180 derajat**: {summary["orientation_distribution"]["180"]} kali
* **270 derajat**: {summary["orientation_distribution"]["270"]} kali

### Distribusi Orientasi Sukses Akhir
* **0 derajat**: {summary["successful_orientation_distribution"]["0"]} paspor
* **90 derajat**: {summary["successful_orientation_distribution"]["90"]} paspor
* **180 derajat**: {summary["successful_orientation_distribution"]["180"]} paspor
* **270 derajat**: {summary["successful_orientation_distribution"]["270"]} paspor
* **Tidak Terdeteksi**: {summary["successful_orientation_distribution"]["None"]} paspor

### Distribusi Varian Biner Sukses Akhir
* **gray**: {summary["successful_variant_distribution"]["gray"]} paspor
* **clahe**: {summary["successful_variant_distribution"]["clahe"]} paspor
* **otsu**: {summary["successful_variant_distribution"]["otsu"]} paspor
* **adaptive**: {summary["successful_variant_distribution"]["adaptive"]} paspor
* **Tidak Terdeteksi**: {summary["successful_variant_distribution"]["None"]} paspor

---

## 4. Ekstremum Paspor

* **Paspor Paling Cepat**: `{summary["fastest_passport"]["id"]}` ({summary["fastest_passport"]["total_ms"]} ms) - `[{summary["fastest_passport"]["relative_path"]}](file:///{REPO_ROOT.as_posix()}/{summary["fastest_passport"]["relative_path"]})`
* **Paspor Paling Lambat**: `{summary["slowest_passport"]["id"]}` ({summary["slowest_passport"]["total_ms"]} ms) - `[{summary["slowest_passport"]["relative_path"]}](file:///{REPO_ROOT.as_posix()}/{summary["slowest_passport"]["relative_path"]})`
"""
    
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        f.write(report_content)
        
    print("------------------------------------")
    print("Benchmark Completed Successfully")
    print("------------------------------------")
    print(f"Summary JSON : {os.path.relpath(SUMMARY_PATH, REPO_ROOT)}")
    print(f"Raw Result   : {os.path.relpath(RESULT_PATH, REPO_ROOT)}")
    print(f"Report MD    : {os.path.relpath(REPORT_PATH, REPO_ROOT)}")
    
    return 0


if __name__ == "__main__":
    sys.exit(run_benchmark())
