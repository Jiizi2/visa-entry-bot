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
RESULT_PATH = BENCHMARK_DIR / "per_image_results.json"
SUMMARY_PATH = BENCHMARK_DIR / "benchmark_summary.json"
REPORT_PATH = BENCHMARK_DIR / "benchmark_report.md"
CHECKPOINT_PATH = BENCHMARK_DIR / "checkpoint.json"


def get_percentile(data: list[float], percentile: float) -> float:
    if not data:
        return 0.0
    sorted_data = sorted(data)
    idx = int(len(sorted_data) * percentile)
    idx = max(0, min(len(sorted_data) - 1, idx))
    return sorted_data[idx]


def format_time(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def save_checkpoint(raw_records: list[dict], last_completed_index: int, profile: str):
    checkpoint_data = {
        "profile": profile,
        "last_completed_index": last_completed_index,
        "raw_records": raw_records
    }
    try:
        BENCHMARK_DIR.mkdir(parents=True, exist_ok=True)
        with open(CHECKPOINT_PATH, "w", encoding="utf-8") as f:
            json.dump(checkpoint_data, f, indent=2, ensure_ascii=False)
    except Exception:
        pass


def draw_dashboard(
    completed: int,
    total: int,
    group: str,
    passport_name: str,
    elapsed_sec: float,
    eta_sec: float,
    moving_avg_sec: float,
    current_runtime_sec: float,
    ocr_runs: int,
    fallback_used: bool,
    success: bool,
    warning_str: str = ""
):
    percent = (completed / total) * 100 if total > 0 else 0.0
    bar_width = 30
    filled = int((completed / total) * bar_width) if total > 0 else 0
    bar = "#" * filled + "-" * (bar_width - filled)
    
    fallback_str = "YES" if fallback_used else "NO"
    success_str = "YES" if success else "NO"
    
    # Use ANSI codes to clear terminal screen and home cursor
    print("\033[H\033[J", end="")
    print("========================================================")
    print("MRZ Benchmark")
    print("========================================================")
    print()
    print("Progress :")
    print(f"[{bar}] {completed}/{total} ({percent:.1f}%)")
    print()
    print("Current Sample")
    print("--------------")
    print(f"Group      : {group}")
    print(f"Passport   : {passport_name}")
    print()
    print("Elapsed")
    print("-------")
    print(format_time(elapsed_sec))
    print()
    print("ETA")
    print("---")
    print(format_time(eta_sec))
    print()
    print("Moving Average")
    print("--------------")
    print(f"{moving_avg_sec:.2f} sec/image")
    print()
    print("Current Runtime")
    print("---------------")
    print(f"{current_runtime_sec:.2f} sec")
    print()
    print("OCR Runs")
    print("--------")
    print(f"{ocr_runs}")
    print()
    print("Fallback")
    print("--------")
    print(fallback_str)
    print()
    print("Success")
    print("-------")
    print(success_str)
    print()
    if warning_str:
        print(warning_str)
    sys.stdout.flush()


def build_histogram(runtimes_ms: list[float]) -> str:
    if not runtimes_ms:
        return "No data to build histogram"
        
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
    max_width = 30
    
    lines = []
    for (low, high, label), count in zip(buckets, counts):
        bar_len = int((count / max_count) * max_width)
        bar = "█" * bar_len
        if bar_len == 0 and count > 0:
            bar = "░"
        lines.append(f"{label}: {bar:<{max_width}} ({count})")
        
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run MRZ extraction benchmark on dataset.")
    parser.add_argument("--resume", action="store_true", default=None, help="Resume benchmark from checkpoint.")
    parser.add_argument("--no-resume", action="store_true", help="Start fresh and ignore checkpoint.")
    args = parser.parse_args()
    
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
        
    raw_records = []
    start_index = 0
    resume_mode = False
    
    # Check resume options
    if args.resume or (not args.no_resume and CHECKPOINT_PATH.exists()):
        should_resume = False
        if args.resume:
            should_resume = True
        elif CHECKPOINT_PATH.exists():
            if sys.stdin.isatty():
                print("Previous benchmark checkpoint detected.")
                ans = input("Resume? (Y/n): ").strip().lower()
                should_resume = ans not in ("n", "no")
            else:
                should_resume = True
                
        if should_resume and CHECKPOINT_PATH.exists():
            try:
                with open(CHECKPOINT_PATH, "r", encoding="utf-8") as f:
                    ckpt = json.load(f)
                if ckpt.get("profile") == profile:
                    raw_records = ckpt.get("raw_records", [])
                    start_index = ckpt.get("last_completed_index", 0) + 1
                    if start_index <= len(items):
                        resume_mode = True
                    else:
                        raw_records = []
                        start_index = 0
                else:
                    raw_records = []
                    start_index = 0
            except Exception:
                raw_records = []
                start_index = 0
                
    if not resume_mode:
        # Start fresh
        if CHECKPOINT_PATH.exists():
            try:
                CHECKPOINT_PATH.unlink()
            except Exception:
                pass
        raw_records = []
        start_index = 0
        
    total_images = len(items)
    
    # Statistics calculations initialization
    recent_runtimes = []
    # If resuming, load existing runtimes to seed moving average
    for rec in raw_records:
        if rec.get("success"):
            recent_runtimes.append(rec["runtime_ms"] / 1000.0)
            if len(recent_runtimes) > 10:
                recent_runtimes.pop(0)
                
    slow_warnings = []
    
    # Prepare console (clear it)
    print("\033[H\033[J", end="")
    sys.stdout.flush()
    
    t_start = time.perf_counter()
    
    for idx in range(start_index + 1, total_images + 1):
        item = items[idx - 1]
        r_id = item["id"]
        rel_path = item["relative_path"]
        full_path = REPO_ROOT / rel_path
        
        # Deduce group folder name
        parts = rel_path.split('/')
        group = parts[-3] if len(parts) >= 3 else "unknown"
        passport_name = parts[-1]
        
        # Initial draw before starting OCR
        elapsed = time.perf_counter() - t_start
        moving_avg = statistics.fmean(recent_runtimes) if recent_runtimes else 0.0
        eta = (total_images - (idx - 1)) * moving_avg
        
        warning_str = ""
        if slow_warnings:
            warning_str += "\n========================================================\n"
            warning_str += "RECENT SLOW SAMPLES DETECTED\n"
            warning_str += "========================================================\n"
            for w in slow_warnings[-3:]:
                warning_str += f"{w}\n"
                
        draw_dashboard(
            completed=idx - 1,
            total=total_images,
            group=group,
            passport_name=passport_name,
            elapsed_sec=elapsed,
            eta_sec=eta,
            moving_avg_sec=moving_avg,
            current_runtime_sec=0.0,
            ocr_runs=0,
            fallback_used=False,
            success=False,
            warning_str=warning_str
        )
        
        record = {
            "id": r_id,
            "runtime_ms": 0,
            "ocr_runs": 0,
            "fallback": False,
            "orientation": 0,
            "variant": "None",
            "success": False,
            "relative_path": rel_path
        }
        
        try:
            t0 = time.perf_counter()
            with mrz_metrics_context() as collector:
                extract_mrz_data(str(full_path))
            runtime_sec = time.perf_counter() - t0
            
            record["success"] = True
            record["runtime_ms"] = int(runtime_sec * 1000)
            record["ocr_runs"] = collector.rapidocr_runs
            record["fallback"] = collector.fallback_used
            record["orientation"] = collector.successful_orientation if collector.successful_orientation is not None else 0
            record["variant"] = collector.successful_variant if collector.successful_variant else "None"
            
            # Seed moving average
            recent_runtimes.append(runtime_sec)
            if len(recent_runtimes) > 10:
                recent_runtimes.pop(0)
                
            # Slow sample detection
            if len(recent_runtimes) >= 5 and moving_avg > 0:
                if runtime_sec > 2.0 * moving_avg:
                    warning_msg = (
                        f"WARNING: Slow sample detected!\n"
                        f"ID      : {r_id}\n"
                        f"Runtime : {runtime_sec:.1f} sec\n"
                        f"OCR Runs: {collector.rapidocr_runs}"
                    )
                    slow_warnings.append(warning_msg)
                    
            # Draw updated state for this sample
            elapsed = time.perf_counter() - t_start
            moving_avg = statistics.fmean(recent_runtimes) if recent_runtimes else 0.0
            eta = (total_images - idx) * moving_avg
            
            warning_str = ""
            if slow_warnings:
                warning_str += "\n========================================================\n"
                warning_str += "RECENT SLOW SAMPLES DETECTED\n"
                warning_str += "========================================================\n"
                for w in slow_warnings[-3:]:
                    warning_str += f"{w}\n"
                    
            draw_dashboard(
                completed=idx,
                total=total_images,
                group=group,
                passport_name=passport_name,
                elapsed_sec=elapsed,
                eta_sec=eta,
                moving_avg_sec=moving_avg,
                current_runtime_sec=runtime_sec,
                ocr_runs=collector.rapidocr_runs,
                fallback_used=collector.fallback_used,
                success=True,
                warning_str=warning_str
            )
            
        except KeyboardInterrupt:
            # Handle Ctrl+C gracefully, save checkpoint
            print("\nBenchmark interrupted by user. Saving checkpoint...")
            save_checkpoint(raw_records, idx - 1, profile)
            return 130
        except Exception as exc:
            record["error"] = str(exc)
            elapsed = time.perf_counter() - t_start
            moving_avg = statistics.fmean(recent_runtimes) if recent_runtimes else 0.0
            eta = (total_images - idx) * moving_avg
            
            warning_str = ""
            if slow_warnings:
                warning_str += "\n========================================================\n"
                warning_str += "RECENT SLOW SAMPLES DETECTED\n"
                warning_str += "========================================================\n"
                for w in slow_warnings[-3:]:
                    warning_str += f"{w}\n"
                    
            draw_dashboard(
                completed=idx,
                total=total_images,
                group=group,
                passport_name=passport_name,
                elapsed_sec=elapsed,
                eta_sec=eta,
                moving_avg_sec=moving_avg,
                current_runtime_sec=0.0,
                ocr_runs=0,
                fallback_used=False,
                success=False,
                warning_str=warning_str
            )
            
        raw_records.append(record)
        save_checkpoint(raw_records, idx - 1, profile)
        
    # Benchmark complete
    if CHECKPOINT_PATH.exists():
        try:
            CHECKPOINT_PATH.unlink()
        except Exception:
            pass
            
    # Computations
    success_records = [r for r in raw_records if r.get("success")]
    runtimes = [r["runtime_ms"] for r in success_records]
    runs = [r["ocr_runs"] for r in success_records]
    
    fallback_count = sum(1 for r in success_records if r.get("fallback"))
    
    orientation_distribution = {"0": 0, "90": 0, "180": 0, "270": 0, "None": 0}
    variant_distribution = {"gray": 0, "clahe": 0, "otsu": 0, "adaptive": 0, "None": 0}
    for r in success_records:
        orientation_distribution[str(r.get("orientation", 0))] += 1
        variant_distribution[str(r.get("variant", "None"))] += 1
        
    sorted_by_runtime = sorted(success_records, key=lambda r: r["runtime_ms"])
    top_fastest = sorted_by_runtime[:10]
    top_slowest = list(reversed(sorted_by_runtime[-10:]))
    
    summary = {
        "version": 1,
        "profile": profile,
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "total_passports": total_images,
        "successful_passports": len(success_records),
        "failed_passports": total_images - len(success_records),
        "elapsed_ms": {
            "avg": float(f"{statistics.fmean(runtimes):.1f}") if runtimes else 0.0,
            "median": float(f"{statistics.median(runtimes):.1f}") if runtimes else 0.0,
            "p95": float(f"{get_percentile(runtimes, 0.95):.1f}") if runtimes else 0.0,
            "p99": float(f"{get_percentile(runtimes, 0.99):.1f}") if runtimes else 0.0,
            "min": min(runtimes) if runtimes else 0,
            "max": max(runtimes) if runtimes else 0
        },
        "ocr_runs": {
            "avg": float(f"{statistics.fmean(runs):.2f}") if runs else 0.0,
            "median": float(f"{statistics.median(runs):.1f}") if runs else 0.0,
            "p95": float(f"{get_percentile(runs, 0.95):.1f}") if runs else 0.0,
            "max": max(runs) if runs else 0
        },
        "fallback_frequency": float(f"{fallback_count / total_images:.4f}") if total_images > 0 else 0.0,
        "orientation_distribution": {k: v for k, v in orientation_distribution.items() if k != "None"},
        "variant_distribution": {k: v for k, v in variant_distribution.items() if k != "None"},
        "top_slowest": [
            {
                "id": r["id"],
                "relative_path": r["relative_path"],
                "runtime_ms": r["runtime_ms"],
                "ocr_runs": r["ocr_runs"]
            } for r in top_slowest
        ],
        "top_fastest": [
            {
                "id": r["id"],
                "relative_path": r["relative_path"],
                "runtime_ms": r["runtime_ms"],
                "ocr_runs": r["ocr_runs"]
            } for r in top_fastest
        ]
    }
    
    # Save per_image_results.json
    final_raw_output = []
    for r in raw_records:
        final_raw_output.append({
            "id": r["id"],
            "runtime_ms": r["runtime_ms"],
            "ocr_runs": r["ocr_runs"],
            "fallback": r["fallback"],
            "orientation": r["orientation"],
            "variant": r["variant"],
            "success": r["success"]
        })
        
    BENCHMARK_DIR.mkdir(parents=True, exist_ok=True)
    with open(RESULT_PATH, "w", encoding="utf-8") as f:
        json.dump(final_raw_output, f, indent=2, ensure_ascii=False)
        
    # Save benchmark_summary.json
    with open(SUMMARY_PATH, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
        
    # Save benchmark_report.md
    histogram_str = build_histogram(runtimes)
    
    slowest_lines = []
    for rank, r in enumerate(top_slowest, 1):
        slowest_lines.append(
            f"{rank}.\n"
            f"{r['id']}\n"
            f"{r['runtime_ms'] / 1000.0:.1f} sec\n"
            f"{r['ocr_runs']} OCR Runs\n"
        )
    slowest_rendered = "\n".join(slowest_lines)
    
    fastest_lines = []
    for rank, r in enumerate(top_fastest, 1):
        fastest_lines.append(
            f"{rank}.\n"
            f"{r['id']}\n"
            f"{r['runtime_ms'] / 1000.0:.1f} sec\n"
            f"{r['ocr_runs']} OCR Runs\n"
        )
    fastest_rendered = "\n".join(fastest_lines)
    
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
| **Rata-rata Pemanggilan RapidOCR** | {summary["ocr_runs"]["avg"]} runs |
| **Median Pemanggilan RapidOCR** | {summary["ocr_runs"]["median"]} runs |
| **Persentil 95 (P95) OCR Runs** | {summary["ocr_runs"]["p95"]} runs |
| **Maksimum Pemanggilan RapidOCR** | {summary["ocr_runs"]["max"]} runs |
| **Fallback Frequency** | {summary["fallback_frequency"] * 100:.2f}% ({fallback_count} paspor) |

---

## 3. Distribusi Orientasi & Varian Sukses

### Distribusi Orientasi Sukses Akhir
* **0 derajat**: {summary["orientation_distribution"].get("0", 0)} paspor
* **90 derajat**: {summary["orientation_distribution"].get("90", 0)} paspor
* **180 derajat**: {summary["orientation_distribution"].get("180", 0)} paspor
* **270 derajat**: {summary["orientation_distribution"].get("270", 0)} paspor

### Distribusi Varian Biner Sukses Akhir
* **gray**: {summary["variant_distribution"].get("gray", 0)} paspor
* **clahe**: {summary["variant_distribution"].get("clahe", 0)} paspor
* **otsu**: {summary["variant_distribution"].get("otsu", 0)} paspor
* **adaptive**: {summary["variant_distribution"].get("adaptive", 0)} paspor

---

## 4. Top 10 Slowest Images
```text
{slowest_rendered}
```

---

## 5. Top 10 Fastest Images
```text
{fastest_rendered}
```
"""
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        f.write(report_content)
        
    # Clear console and print final summary report in CLI as well
    print("\033[H\033[J", end="")
    print("========================================================")
    print("Benchmark Completed Successfully")
    print("========================================================")
    print(f"Total processed     : {summary['total_passports']}")
    print(f"Successful          : {summary['successful_passports']}")
    print(f"Average Runtime     : {summary['elapsed_ms']['avg']} ms")
    print(f"Median Runtime      : {summary['elapsed_ms']['median']} ms")
    print(f"P95 Runtime         : {summary['elapsed_ms']['p95']} ms")
    print(f"P99 Runtime         : {summary['elapsed_ms']['p99']} ms")
    print(f"Average OCR Runs    : {summary['ocr_runs']['avg']}")
    print(f"Fallback Frequency  : {summary['fallback_frequency'] * 100:.2f}%")
    print()
    print("Top 10 Slowest Images")
    print("---------------------")
    print(slowest_rendered)
    print()
    print("Summary JSON        : " + os.path.relpath(SUMMARY_PATH, REPO_ROOT))
    print("Per-image JSON      : " + os.path.relpath(RESULT_PATH, REPO_ROOT))
    print("Report MD           : " + os.path.relpath(REPORT_PATH, REPO_ROOT))
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
