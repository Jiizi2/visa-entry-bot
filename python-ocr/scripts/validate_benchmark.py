from __future__ import annotations

import json
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
PYTHON_OCR_DIR = SCRIPTS_DIR.parent
BENCHMARK_DIR = PYTHON_OCR_DIR / "benchmark"
BUDGET_PATH = BENCHMARK_DIR / "performance_budget.json"
BASELINE_PATH = BENCHMARK_DIR / "baseline_snapshot.json"
COMPARISON_PATH = BENCHMARK_DIR / "comparison.json"


def validate_benchmark(profile: str = "optimized") -> int:
    profile_dir = BENCHMARK_DIR / profile

    # 1. Check if budget and baseline configuration files exist
    if not BUDGET_PATH.exists():
        print(f"Error: Performance budget file is missing: {BUDGET_PATH}")
        return 2
    if not BASELINE_PATH.exists():
        print(f"Error: Baseline snapshot file is missing: {BASELINE_PATH}")
        return 2

    # 2. Check existence of benchmark artifacts for the given profile
    required_artifacts = [
        "per_image_results.json",
        "summary.json",
        "metadata.json",
        "stage_breakdown.json",
        "ocr_attempts.json",
        "report.md"
    ]
    
    artifacts_status = "PASS"
    for artifact_name in required_artifacts:
        art_path = profile_dir / artifact_name
        if not art_path.exists():
            print(f"Artifact check FAILED: Missing {artifact_name} under {profile_dir}")
            artifacts_status = "FAIL"

    if artifacts_status == "FAIL":
        print("\nArtifacts ........ FAIL")
        print("Accuracy ......... NOT RUN")
        print("OCR Attempts ..... NOT RUN")
        print("Fallback ......... NOT RUN")
        print("Runtime .......... NOT RUN")
        print("Overall .......... FAIL")
        return 2

    # 3. Read budget, baseline, and latest benchmark files
    try:
        with open(BUDGET_PATH, "r", encoding="utf-8") as f:
            budget = json.load(f)
        with open(BASELINE_PATH, "r", encoding="utf-8") as f:
            baseline = json.load(f)
        with open(profile_dir / "per_image_results.json", "r", encoding="utf-8") as f:
            per_image_results = json.load(f)
        with open(profile_dir / "ocr_attempts.json", "r", encoding="utf-8") as f:
            ocr_attempts = json.load(f)
        with open(profile_dir / "summary.json", "r", encoding="utf-8") as f:
            summary = json.load(f)
    except Exception as exc:
        print(f"Error reading configuration or benchmark files: {exc}")
        return 2

    # Calculate runtime parameters from summary
    # Check key shapes in summary
    elapsed_stats = summary.get("elapsed_ms", {})
    avg_runtime = elapsed_stats.get("avg", 0.0)
    p95_runtime = elapsed_stats.get("p95", 0.0)

    # 4. Perform Quality Gate Validations
    accuracy_status = "PASS"
    attempts_status = "PASS"
    fallback_status = "PASS"
    runtime_status = "PASS"
    regression_status = "PASS"
    
    reasons = []

    # Accuracy validation
    total_passports = len(per_image_results)
    success_count = sum(1 for r in per_image_results if r.get("success"))
    accuracy_percent = (success_count / total_passports * 100.0) if total_passports > 0 else 0.0
    min_accuracy = budget.get("min_accuracy_percent", 100.0)
    
    if accuracy_percent < min_accuracy:
        accuracy_status = "FAIL"
        reasons.append(f"Accuracy ({accuracy_percent:.2f}%) is below budget min ({min_accuracy:.2f}%)")

    # OCR Attempts validation
    total_attempts = len(ocr_attempts)
    max_attempts = budget.get("max_ocr_attempts", 320)
    if total_attempts > max_attempts:
        attempts_status = "FAIL"
        reasons.append(f"Total OCR attempts ({total_attempts}) exceeds budget max ({max_attempts})")

    # Fallback validation
    fallback_count = sum(1 for r in per_image_results if r.get("fallback"))
    max_fallbacks = budget.get("max_fallback_count", 20)
    if fallback_count > max_fallbacks:
        fallback_status = "FAIL"
        reasons.append(f"Fallback count ({fallback_count}) exceeds budget max ({max_fallbacks})")

    # Regression validation (from comparison.json if it exists)
    if COMPARISON_PATH.exists():
        try:
            with open(COMPARISON_PATH, "r", encoding="utf-8") as f:
                comparison = json.load(f)
            regressions_list = comparison.get("regressions", [])
            if regressions_list:
                regression_status = "FAIL"
                reasons.append(f"Regressions detected: {len(regressions_list)} passports failed optimized scan")
        except Exception as exc:
            print(f"Warning: Failed to parse comparison.json for regressions check: {exc}")

    # Runtime validation (against baseline)
    baseline_avg = baseline.get("average_runtime_ms", 3000.0)
    baseline_p95 = baseline.get("p95_runtime_ms", 7000.0)
    
    if avg_runtime > 1.5 * baseline_avg:
        runtime_status = "WARNING"
        reasons.append(f"Average runtime ({avg_runtime:.1f}ms) is >1.5x baseline average ({baseline_avg:.1f}ms)")
    if p95_runtime > 1.5 * baseline_p95:
        runtime_status = "WARNING"
        reasons.append(f"P95 runtime ({p95_runtime:.1f}ms) is >1.5x baseline P95 ({baseline_p95:.1f}ms)")

    # Overall Status evaluation
    # WARNING does not fail the gate, only FAIL does
    gate_failed = (
        artifacts_status == "FAIL" or
        accuracy_status == "FAIL" or
        attempts_status == "FAIL" or
        fallback_status == "FAIL" or
        regression_status == "FAIL"
    )
    overall_status = "FAIL" if gate_failed else "PASS"

    # Print results summary
    print("========================================================")
    print("Performance & Quality Gate Validation Results")
    print("========================================================")
    print(f"Artifacts ........ {artifacts_status}")
    print(f"Accuracy ......... {accuracy_status}")
    print(f"OCR Attempts ..... {attempts_status}")
    print(f"Fallback ......... {fallback_status}")
    print(f"Runtime .......... {runtime_status}")
    if COMPARISON_PATH.exists():
        print(f"Regression ....... {regression_status}")
    print(f"Overall .......... {overall_status}")
    print("========================================================")

    if reasons:
        print("Details:")
        for r in reasons:
            print(f"  - {r}")
        print("========================================================")

    return 1 if gate_failed else 0


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Validate MRZ benchmark performance budget.")
    parser.add_argument("--profile", default="optimized", choices=["legacy", "optimized"], help="Benchmark profile directory to validate.")
    args = parser.parse_args()
    sys.exit(validate_benchmark(args.profile))
