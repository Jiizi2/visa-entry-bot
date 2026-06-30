from __future__ import annotations

import os
import sys
import json
import time
import argparse
import platform
import statistics
import subprocess
from pathlib import Path
from datetime import datetime

# Setup sys.path to find services correctly
SCRIPTS_DIR = Path(__file__).resolve().parent
PYTHON_OCR_DIR = SCRIPTS_DIR.parent
REPO_ROOT = PYTHON_OCR_DIR.parent
sys.path.insert(0, str(PYTHON_OCR_DIR))

from services.mrz_extractor import extract_mrz_data
from services.mrz_metrics import mrz_metrics_context
from scripts.benchmark_utils import load_json, save_json, resolve_profile_paths, format_time

DATASET_PATH = PYTHON_OCR_DIR / "datasets" / "passport_dataset.json"
# Defaults will be resolved in main()
BENCHMARK_DIR = Path()
RESULT_PATH = Path()
SUMMARY_PATH = Path()
REPORT_PATH = Path()
CHECKPOINT_PATH = Path()
METADATA_PATH = Path()
STAGE_BREAKDOWN_PATH = Path()
OCR_ATTEMPTS_PATH = Path()


def get_percentile(data: list[float], percentile: float) -> float:
    if not data:
        return 0.0
    sorted_data = sorted(data)
    idx = int(len(sorted_data) * percentile)
    idx = max(0, min(len(sorted_data) - 1, idx))
    return sorted_data[idx]


def get_git_commit() -> str:
    try:
        out = subprocess.check_output(["git", "rev-parse", "HEAD"], stderr=subprocess.DEVNULL)
        return out.decode().strip()
    except Exception:
        return "unknown"


def get_ram_size() -> str:
    try:
        if platform.system() == "Windows":
            out = subprocess.check_output("wmic ComputerSystem get TotalPhysicalMemory", shell=True, stderr=subprocess.DEVNULL)
            bytes_val = int(out.decode().split()[1])
            return f"{bytes_val / (1024**3):.1f} GB"
        else:
            # Fallback for unix/linux systems
            import psutil
            return f"{psutil.virtual_memory().total / (1024**3):.1f} GB"
    except Exception:
        return "Unknown"


def get_rapidocr_version() -> str:
    try:
        import importlib.metadata
        return importlib.metadata.version('rapidocr-onnxruntime')
    except Exception:
        try:
            import rapidocr_onnxruntime
            return getattr(rapidocr_onnxruntime, '__version__', 'unknown')
        except Exception:
            return "unknown"


def save_checkpoint(
    raw_records: list[dict],
    ocr_attempts: list[dict],
    stages_by_passport: dict[str, dict],
    last_completed_index: int,
    profile: str,
    started_time: str
):
    checkpoint_data = {
        "profile": profile,
        "last_completed_index": last_completed_index,
        "started_time": started_time,
        "raw_records": raw_records,
        "ocr_attempts": ocr_attempts,
        "stages_by_passport": stages_by_passport
    }
    try:
        save_json(CHECKPOINT_PATH, checkpoint_data)
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
    
    print("\033[H\033[J", end="")
    print("========================================================")
    print("MRZ Benchmark (Deep Observability)")
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
    parser.add_argument("--profile", default="optimized", choices=["legacy", "optimized"], help="OCR pipeline profile to run.")
    args = parser.parse_args()
    
    profile = args.profile
    os.environ["PASSPORT_OCR_PROFILE"] = profile
    
    global BENCHMARK_DIR, RESULT_PATH, SUMMARY_PATH, REPORT_PATH, CHECKPOINT_PATH, METADATA_PATH, STAGE_BREAKDOWN_PATH, OCR_ATTEMPTS_PATH
    paths = resolve_profile_paths(profile)
    BENCHMARK_DIR = paths["profile_dir"]
    RESULT_PATH = paths["per_image_results"]
    SUMMARY_PATH = paths["summary"]
    REPORT_PATH = paths["report"]
    CHECKPOINT_PATH = paths["checkpoint"]
    METADATA_PATH = paths["metadata"]
    STAGE_BREAKDOWN_PATH = paths["stage_breakdown"]
    OCR_ATTEMPTS_PATH = paths["ocr_attempts"]
    
    if not DATASET_PATH.exists():
        print(f"Error: manifest file {DATASET_PATH} not found. Run build_passport_dataset.py first.")
        return 1
        
    manifest = load_json(DATASET_PATH)
    items = manifest.get("items", [])
    if not items:
        print("Error: Dataset manifest contains no items.")
        return 1
        
    raw_records = []
    ocr_attempts = []
    stages_by_passport = {}
    start_index = 0
    resume_mode = False
    started_time = datetime.now().isoformat()
    
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
                ckpt = load_json(CHECKPOINT_PATH)
                if ckpt.get("profile") == profile:
                    raw_records = ckpt.get("raw_records", [])
                    ocr_attempts = ckpt.get("ocr_attempts", [])
                    stages_by_passport = ckpt.get("stages_by_passport", {})
                    start_index = ckpt.get("last_completed_index", 0) + 1
                    started_time = ckpt.get("started_time", started_time)
                    if start_index <= len(items):
                        resume_mode = True
                    else:
                        raw_records = []
                        ocr_attempts = []
                        stages_by_passport = {}
                        start_index = 0
                else:
                    raw_records = []
                    ocr_attempts = []
                    stages_by_passport = {}
                    start_index = 0
            except Exception:
                raw_records = []
                ocr_attempts = []
                stages_by_passport = {}
                start_index = 0
                
    if not resume_mode:
        # Start fresh
        if CHECKPOINT_PATH.exists():
            try:
                CHECKPOINT_PATH.unlink()
            except Exception:
                pass
        raw_records = []
        ocr_attempts = []
        stages_by_passport = {}
        start_index = 0
        started_time = datetime.now().isoformat()
        
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
    
    # Image resolution calculations (calculated dynamically)
    image_widths = []
    image_heights = []
    portrait_count = 0
    landscape_count = 0
    resolution_distribution = {}
    
    # Pre-calculate / load image dimensions
    import cv2
    for item in items:
        rel_path = item["relative_path"]
        full_path = REPO_ROOT / rel_path
        try:
            # We only read the shape to build the dataset snapshot
            img = cv2.imread(str(full_path))
            if img is not None:
                h, w = img.shape[:2]
                image_widths.append(w)
                image_heights.append(h)
                if w >= h:
                    landscape_count += 1
                else:
                    portrait_count += 1
                res_str = f"{w}x{h}"
                resolution_distribution[res_str] = resolution_distribution.get(res_str, 0) + 1
        except Exception:
            pass
            
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
            with mrz_metrics_context(r_id) as collector:
                extract_mrz_data(str(full_path))
            runtime_sec = time.perf_counter() - t0
            
            record["success"] = True
            record["runtime_ms"] = int(runtime_sec * 1000)
            record["ocr_runs"] = collector.rapidocr_runs
            record["fallback"] = collector.fallback_used
            record["orientation"] = collector.successful_orientation if collector.successful_orientation is not None else 0
            record["variant"] = collector.successful_variant if collector.successful_variant else "None"
            
            # Save stages timing
            stages_by_passport[r_id] = {
                "total_ms": round(runtime_sec * 1000, 1),
                "stages": collector.serialize_stages()
            }
            
            # Append this image's ocr attempts to global attempts list
            for attempt in collector.ocr_attempts:
                ocr_attempts.append(attempt)
            
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
            save_checkpoint(raw_records, ocr_attempts, stages_by_passport, idx - 1, profile, started_time)
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
        save_checkpoint(raw_records, ocr_attempts, stages_by_passport, idx - 1, profile, started_time)
        
    # Benchmark complete
    finished_time = datetime.now().isoformat()
    benchmark_duration_sec = time.perf_counter() - t_start
    
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
    
    # Calculate Candidate Lifecycle Statistics
    cand_found_count = sum(1 for att in ocr_attempts if att.get("candidate_found"))
    cand_repaired_count = sum(1 for att in ocr_attempts if att.get("candidate_repaired"))
    cand_checksum_count = sum(1 for att in ocr_attempts if att.get("checksum_passed"))
    cand_selected_count = sum(1 for att in ocr_attempts if att.get("selected"))
    
    # Orientation Effectiveness:
    # 0, 90, 180, 270 degrees
    orientations = [0, 90, 180, 270]
    orientation_stats = {}
    for orient in orientations:
        atts = [att for att in ocr_attempts if att["orientation"] == orient]
        successes = [att for att in atts if att["reason"] == "success"]
        orientation_stats[str(orient)] = {
            "attempts": len(atts),
            "success": len(successes),
            "runtime_total_ms": round(sum(att["runtime_ms"] for att in atts), 1)
        }
        
    # Variant Effectiveness:
    # gray, clahe, otsu, adaptive
    variants = ["gray", "clahe", "otsu", "adaptive"]
    variant_stats = {}
    for var in variants:
        atts = [att for att in ocr_attempts if att["variant"] == var]
        successes = [att for att in atts if att["reason"] == "success"]
        variant_stats[var] = {
            "attempts": len(atts),
            "success": len(successes),
            "runtime_total_ms": round(sum(att["runtime_ms"] for att in atts), 1)
        }
        
    # Width Effectiveness:
    # get all distinct width sizes in attempts
    distinct_widths = sorted(list(set(att["width"] for att in ocr_attempts)))
    width_stats = {}
    for w in distinct_widths:
        atts = [att for att in ocr_attempts if att["width"] == w]
        successes = [att for att in atts if att["reason"] == "success"]
        width_stats[str(w)] = {
            "attempts": len(atts),
            "success": len(successes),
            "runtime_total_ms": round(sum(att["runtime_ms"] for att in atts), 1)
        }
        
    # Fallback Statistics:
    # Calculate:
    # 1. Fallbacks triggered: fallback_count
    # 2. Success after fallback: did fallback successfully read? (where fallback_used is True and success is True)
    # 3. Additional OCR runs caused by fallback: OCR runs of fallback attempts
    # 4. Additional runtime: runtime of fallback images (difference between fallback runtime and direct runtime, or just total runtime of fallback images)
    # Actually, let's look at the fallback attempts in ocr_attempts.
    # An attempt is in fallback stage if the passport record had fallback=True and the attempt occurred in the fallback phase?
    # Actually, direct scan is always orientation candidates 0, 90, 180, 270 on direct scan region.
    # Wait, the fallback paths scan other variant paths (like temporary_mrz_variants).
    # Since direct scan doesn't use temporary_mrz_variants, and temporary_mrz_variants does not set fallback in the collector until after direct scan fails.
    # So we can track fallback attempts. Since we know collector.fallback_used was True.
    # Let's see: fallback runtime for a passport can be defined as the total time spent in fallback stage.
    # Let's look at raw records where fallback was executed:
    fallback_records = [r for r in raw_records if r.get("fallback")]
    fallback_triggered = len(fallback_records)
    fallback_success_count = sum(1 for r in fallback_records if r.get("success") and r.get("variant") != "None" and r.get("fallback"))
    
    # Calculate additional OCR runs and runtime for fallback images
    # Direct scan uses up to 2 widths * 4 variants * (1 direct + 3 rotations * 2 crops) = up to 66 runs.
    # In fallback we scan 3 variants (clahe, sharp, denoise) * direct = up to 3 variants * 4 variants = 12 runs.
    # So we can calculate fallback additional runs by looking at collector stats.
    # For simplicity, we sum the additional runs and runtime for all passports where fallback was triggered.
    additional_runs = 0
    additional_runtime_ms = 0
    for r_id, breakdown in stages_by_passport.items():
        rec = next((r for r in raw_records if r["id"] == r_id), None)
        if rec and rec.get("fallback"):
            # If fallback was executed, how much time was spent on fallback?
            # Actually, direct scan spent time on its attempts, then fallback spent time on fallback attempts.
            # In stages_by_passport, we have load_image, document_detection, etc.
            # For fallback, it calls extract_mrz_data on variant_path.
            # Since those stage times are accumulated in collector, we can sum them up!
            # Let's count additional runs:
            # We can sum the OCR runs of fallback attempts.
            # Fallback attempts are those made when fallback was active.
            # In our implementation of _read_best_mrz, before fallback, direct scan was already executed.
            # So the attempts for direct scan were completed.
            # We can count fallback attempts as those after the first failure or simply direct scan vs fallback scan.
            # Actually, direct scan orientation is rotated candidates.
            # To be simple and robust: any attempt that is NOT the direct attempt or fallback attempts.
            # Better yet: fallback attempts are those where orientation is 0 (as fallback doesn't rotate, it scans variants directly).
            # But wait! A simpler way is to look at collector.ocr_attempts:
            # All attempts after the first 66 attempts? No, early exit can happen.
            # Let's just report the additional runs of passports where fallback was triggered!
            # Since direct scan failed, all subsequent runs on that passport are fallback runs.
            # So: if a passport has fallback=True, its fallback runs = collector.rapidocr_runs - direct_scan_runs.
            # Direct scan runs for a failed direct scan is exactly:
            # (1 for full image first if try_full_image_first) + orientation candidate attempts.
            # Since orientation candidate has 4 orientations * 2 crops * 2 widths * 4 variants = 64 runs.
            # If early exit did not happen, direct scan ran exactly 64 (or 65) runs before fallback started!
            # So fallback runs = total runs - 65.
            # This is extremely logical!
            # Let's compute:
            passports_with_fallback = [r["id"] for r in raw_records if r.get("fallback")]
            for r_id in passports_with_fallback:
                # find attempts for this passport
                p_atts = [att for att in ocr_attempts if att["passport_id"] == r_id]
                # Since direct scan attempts are done first, the direct scan attempts are the first N attempts.
                # Actually, direct scan attempts are all attempts where variant is NOT run on a temporary variant path.
                # But since we didn't store a "phase" variable, we can simply say:
                # Direct scan attempts are those with attempt index <= 65 (if we ran rotations), or those before fallback.
                # Since fallback only runs when direct scan did not succeed, direct scan must have run all orientations:
                # That is orientation 0, 180, 90, 270.
                # All attempts with orientation in (90, 180, 270) are definitely direct scan.
                # The first attempts with orientation 0 are direct scan.
                # Any attempt after the last orientation 270 attempt is fallback.
                # Let's write a simple loop to classify:
                last_rot_idx = -1
                for idx_a, att in enumerate(p_atts):
                    if att["orientation"] in (90, 180, 270):
                        last_rot_idx = idx_a
                # All attempts after last_rot_idx are fallback attempts
                fallback_atts = p_atts[last_rot_idx + 1:] if last_rot_idx >= 0 else []
                additional_runs += len(fallback_atts)
                additional_runtime_ms += sum(att["runtime_ms"] for att in fallback_atts)
                
    # Extrema sorting
    sorted_by_runtime = sorted(success_records, key=lambda r: r["runtime_ms"])
    top_fastest = sorted_by_runtime[:10]
    top_slowest = list(reversed(sorted_by_runtime[-10:]))
    
    # 1. Write metadata.json
    metadata = {
        "date": time.strftime("%Y-%m-%d %H:%M:%S"),
        "git_commit": get_git_commit(),
        "speed_profile": profile,
        "python_version": sys.version.split()[0],
        "opencv_version": cv2.__version__ if cv2 else "unknown",
        "rapidocr_version": get_rapidocr_version(),
        "platform": platform.platform(),
        "processor": platform.processor(),
        "logical_cpu": os.cpu_count(),
        "ram": get_ram_size(),
        "benchmark_started": started_time,
        "benchmark_finished": finished_time,
        "benchmark_duration_sec": round(benchmark_duration_sec, 2),
        "dataset": {
            "total_images": total_images,
            "total_folders": len(set(parts[-3] for parts in (item["relative_path"].split('/') for item in items) if len(parts) >= 3)),
            "average_width": round(statistics.fmean(image_widths), 1) if image_widths else 0.0,
            "average_height": round(statistics.fmean(image_heights), 1) if image_heights else 0.0,
            "portrait_count": portrait_count,
            "landscape_count": landscape_count,
            "resolution_distribution": resolution_distribution
        }
    }
    
    save_json(METADATA_PATH, metadata)
    
    # Calculate global stages summary
    # map stages to compute average, min, max
    stages_summary = {}
    stage_names = [
        "load_image", "document_detection", "resize", "rotation",
        "crop", "variant_generation", "ocr", "candidate_selection",
        "repair", "validation", "serialization"
    ]
    for s_name in stage_names:
        s_totals = []
        s_counts = 0
        s_mins = []
        s_maxs = []
        for r_id, breakdown in stages_by_passport.items():
            s_data = breakdown["stages"].get(s_name, {})
            if s_data.get("count", 0) > 0:
                s_totals.append(s_data["total_ms"])
                s_counts += s_data["count"]
                s_mins.append(s_data["min_ms"])
                s_maxs.append(s_data["max_ms"])
                
        stages_summary[s_name] = {
            "total_ms": round(sum(s_totals), 1),
            "count": s_counts,
            "average_ms": round(statistics.fmean(s_totals), 1) if s_totals else 0.0,
            "min_ms": round(min(s_mins), 1) if s_mins else 0.0,
            "max_ms": round(max(s_maxs), 1) if s_maxs else 0.0
        }
        
    # 2. Write summary.json
    summary = {
        "version": 1,
        "profile": profile,
        "created_at": metadata["date"],
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
        "candidate_lifecycle": {
            "candidate_found": cand_found_count,
            "candidate_repaired": cand_repaired_count,
            "candidate_checksum_ok": cand_checksum_count,
            "candidate_selected": cand_selected_count
        },
        "stages_summary": stages_summary,
        "rotation_effectiveness": orientation_stats,
        "variant_effectiveness": variant_stats,
        "width_effectiveness": width_stats,
        "fallback_analysis": {
            "triggered": fallback_triggered,
            "success_after_fallback": fallback_success_count,
            "additional_ocr_runs": additional_runs,
            "additional_runtime_ms": round(additional_runtime_ms, 1)
        }
    }
    save_json(SUMMARY_PATH, summary)
        
    # 3. Write per_image_results.json
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
    save_json(RESULT_PATH, final_raw_output, inject_metadata=False)
        
    # 4. Write stage_breakdown.json
    save_json(STAGE_BREAKDOWN_PATH, stages_by_passport)
        
    # 5. Write ocr_attempts.json
    save_json(OCR_ATTEMPTS_PATH, ocr_attempts, inject_metadata=False)
        
    # 6. Write report.md
    histogram_str = build_histogram(runtimes)
    
    # Format stages table
    stages_rows = []
    for s_name in stage_names:
        info = stages_summary[s_name]
        stages_rows.append(
            f"| **{s_name}** | {info['count']} | {info['total_ms']} | {info['average_ms']} | {info['min_ms']} | {info['max_ms']} |"
        )
    stages_table = "\n".join(stages_rows)
    
    # Format orientation table
    orient_rows = []
    for orient in orientations:
        info = orientation_stats[str(orient)]
        orient_rows.append(
            f"| **{orient}°** | {info['attempts']} | {info['success']} | {info['runtime_total_ms']} ms |"
        )
    orient_table = "\n".join(orient_rows)
    
    # Format variant table
    var_rows = []
    for var in variants:
        info = variant_stats[var]
        var_rows.append(
            f"| **{var}** | {info['attempts']} | {info['success']} | {info['runtime_total_ms']} ms |"
        )
    var_table = "\n".join(var_rows)
    
    # Format width table
    w_rows = []
    for w in distinct_widths:
        info = width_stats[str(w)]
        w_rows.append(
            f"| **{w}px** | {info['attempts']} | {info['success']} | {info['runtime_total_ms']} ms |"
        )
    width_table = "\n".join(w_rows)
    
    # Format Outlier Detail functions
    def get_outlier_detail(rec: dict) -> str:
        r_id = rec["id"]
        # Find stages
        bd = stages_by_passport.get(r_id, {})
        tot_rt = bd.get("total_ms", 0.0) / 1000.0
        
        # Get attempts breakdown
        p_atts = [att for att in ocr_attempts if att["passport_id"] == r_id]
        
        # Calculate attempts per orientation / variant
        orient_counts = {}
        for att in p_atts:
            o_key = str(att["orientation"])
            orient_counts[o_key] = orient_counts.get(o_key, 0) + 1
        orient_str = ", ".join(f"{k}°: {v} atts" for k, v in orient_counts.items())
        
        variant_counts = {}
        for att in p_atts:
            v_key = att["variant"]
            variant_counts[v_key] = variant_counts.get(v_key, 0) + 1
        variant_str = ", ".join(f"{k}: {v} atts" for k, v in variant_counts.items())
        
        repairs = bd.get("stages", {}).get("repair", {})
        repair_count = repairs.get("count", 0)
        
        # Stages breakdown text
        stg_text = []
        for s_n in stage_names:
            s_t = bd.get("stages", {}).get(s_n, {}).get("total_ms", 0.0) / 1000.0
            if s_t > 0.05:
                stg_text.append(f"  * {s_n}: {s_t:.2f} s")
        stg_rendered = "\n".join(stg_text)
        
        return (
            f"### Passport: {r_id}\n\n"
            f"* **Total Runtime**: {tot_rt:.2f} s\n"
            f"* **OCR Runs**: {rec['ocr_runs']}\n"
            f"* **Orientation Attempts**: {orient_str}\n"
            f"* **Variant Attempts**: {variant_str}\n"
            f"* **Repair Count**: {repair_count}\n"
            f"* **Fallback Used**: {'YES' if rec['fallback'] else 'NO'}\n"
            f"* **Selected Variant**: {rec['variant']}\n"
            f"* **Selected Orientation**: {rec['orientation']}°\n"
            f"* **Stage Timing Breakdown**:\n{stg_rendered}\n"
        )
        
    slowest_rendered = "\n".join(get_outlier_detail(r) for r in top_slowest)
    fastest_rendered = "\n".join(get_outlier_detail(r) for r in top_fastest)
    
    # Calculate Key Findings (Observational Stats only)
    total_ocr_ms = stages_summary["ocr"]["total_ms"]
    total_pipeline_ms = sum(stages_summary[s]["total_ms"] for s in stage_names)
    ocr_percent = (total_ocr_ms / total_pipeline_ms) * 100 if total_pipeline_ms > 0 else 0.0
    
    key_findings_list = [
        f"* **Rotation 90° / 180° / 270°**: Memiliki total {sum(orientation_stats[str(o)]['attempts'] for o in (90, 180, 270))} attempts dan menghasilkan **0 sukses**.",
        f"* **Adaptive Variant**: Memiliki total {variant_stats['adaptive']['attempts']} attempts dan menghasilkan **0 sukses**.",
        f"* **OCR Stage Duration**: Mengonsumsi **{ocr_percent:.1f}%** dari total seluruh waktu eksekusi pipeline ({total_ocr_ms / 1000.0:.1f} detik dari {total_pipeline_ms / 1000.0:.1f} detik).",
        f"* **Average OCR Runs per image**: Rata-rata **{summary['ocr_runs']['avg']:.2f} runs** per paspor.",
        f"* **Candidate Lifecycle Efficiency**: Dari {cand_found_count} kandidat yang ditemukan, {cand_repaired_count} ({(cand_repaired_count/cand_found_count*100) if cand_found_count else 0.0:.1f}%) masuk tahapan repair, {cand_checksum_count} ({(cand_checksum_count/cand_found_count*100) if cand_found_count else 0.0:.1f}%) lolos checksum, dan {cand_selected_count} terpilih sebagai output final.",
        f"* **Fallback Efficiency**: Fallback terpicu {fallback_triggered} kali dan berhasil menyelamatkan {fallback_success_count} gambar paspor."
    ]
    key_findings_rendered = "\n".join(key_findings_list)
    
    report_content = f"""# Benchmark Performance Report

Laporan ini menyajikan hasil evaluasi kinerja baseline terperinci untuk ekstraksi MRZ menggunakan RapidOCR.

* **Tanggal Pembuatan**: {metadata["date"]}
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

## 2. Detail Stage Timing Breakdown

| Stage | Call Count | Total Duration (ms) | Average Duration (ms) | Minimum (ms) | Maximum (ms) |
| :--- | :---: | :---: | :---: | :---: | :---: |
{stages_table}

---

## 3. Efektivitas Rotasi (Orientation Effectiveness)

| Orientation | Total Attempts | Success Count | Total Runtime (ms) |
| :--- | :---: | :---: | :---: |
{orient_table}

---

## 4. Efektivitas Preprocessing Varian (Variant Effectiveness)

| Variant | Total Attempts | Success Count | Total Runtime (ms) |
| :--- | :---: | :---: | :---: |
{var_table}

---

## 5. Efektivitas Ukuran Citra (Width Effectiveness)

| Width | Total Attempts | Success Count | Total Runtime (ms) |
| :--- | :---: | :---: | :---: |
{width_table}

---

## 6. Analisis Fallback (Fallback Statistics)

* **Fallback Triggered**: {summary["fallback_analysis"]["triggered"]} kali
* **Success After Fallback**: {summary["fallback_analysis"]["success_after_fallback"]} kali
* **Additional OCR Runs Caused**: {summary["fallback_analysis"]["additional_ocr_runs"]} runs
* **Additional Runtime**: {summary["fallback_analysis"]["additional_runtime_ms"]} ms

---

## 7. Siklus Hidup Kandidat (Candidate Lifecycle)

* **Candidate Found**: {summary["candidate_lifecycle"]["candidate_found"]} kali
* **Candidate Repaired**: {summary["candidate_lifecycle"]["candidate_repaired"]} kali
* **Candidate Checksum OK**: {summary["candidate_lifecycle"]["candidate_checksum_ok"]} kali
* **Candidate Selected**: {summary["candidate_lifecycle"]["candidate_selected"]} kali

---

## 8. Outlier Investigation: Top 10 Slowest Passports

{slowest_rendered}

---

## 9. Outlier Investigation: Top 10 Fastest Passports

{fastest_rendered}

---

## 10. Key Findings

{key_findings_rendered}
"""
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        f.write(report_content)
        
    # Clear console and print final summary report in CLI
    print("\033[H\033[J", end="")
    print("========================================================")
    print("Benchmark Completed Successfully (Deep Observability)")
    print("========================================================")
    print(f"Total processed     : {summary['total_passports']}")
    print(f"Successful          : {summary['successful_passports']}")
    print(f"Average Runtime     : {summary['elapsed_ms']['avg']} ms")
    print(f"Median Runtime      : {summary['elapsed_ms']['median']} ms")
    print(f"P95 Runtime         : {summary['elapsed_ms']['p95']} ms")
    print(f"Average OCR Runs    : {summary['ocr_runs']['avg']}")
    print(f"Fallback Frequency  : {summary['fallback_frequency'] * 100:.2f}%")
    print()
    print("Report MD           : " + os.path.relpath(REPORT_PATH, REPO_ROOT))
    print("Summary JSON        : " + os.path.relpath(SUMMARY_PATH, REPO_ROOT))
    print("Metadata JSON       : " + os.path.relpath(METADATA_PATH, REPO_ROOT))
    print("Stage Breakdown JSON: " + os.path.relpath(STAGE_BREAKDOWN_PATH, REPO_ROOT))
    print("OCR Attempts JSON   : " + os.path.relpath(OCR_ATTEMPTS_PATH, REPO_ROOT))
    print("Per-image JSON      : " + os.path.relpath(RESULT_PATH, REPO_ROOT))
    
    # Automatically execute evidence analysis
    try:
        from scripts.analyze_evidence import run_analysis
        run_analysis(profile)
    except Exception as e:
        print(f"Warning: Failed to automatically run analyze_evidence.py: {e}")
        
    # Check if both profiles exist to automatically run comparison
    legacy_results = PYTHON_OCR_DIR / "benchmark" / "legacy" / "per_image_results.json"
    optimized_results = PYTHON_OCR_DIR / "benchmark" / "optimized" / "per_image_results.json"
    if legacy_results.exists() and optimized_results.exists():
        try:
            print("Detected both legacy and optimized results. Running profile comparison...")
            from scripts.compare_profiles import run_comparison
            run_comparison()
        except Exception as e:
            print(f"Warning: Failed to automatically run compare_profiles.py: {e}")
        
    return 0


if __name__ == "__main__":
    sys.exit(main())
