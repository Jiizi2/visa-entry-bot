import sys
from pathlib import Path

# Setup sys.path to find packages correctly
SCRIPTS_DIR = Path(__file__).resolve().parent
PYTHON_OCR_DIR = SCRIPTS_DIR.parent
if str(PYTHON_OCR_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_OCR_DIR))

from scripts.benchmark_utils import (
    load_json,
    resolve_profile_paths,
    BUDGET_PATH,
    BASELINE_PATH,
    COMPARISON_PATH,
    REQUIRED_ARTIFACTS,
)


def validate_benchmark(profile: str = "optimized") -> int:
    paths = resolve_profile_paths(profile)
    profile_dir = paths["profile_dir"]

    # Initialize status values
    artifacts_status = "PASS"
    schema_status = "PASS"
    consistency_status = "PASS"
    budget_status = "PASS"
    regression_status = "PASS"
    performance_status = "PASS"

    reasons = []

    # 1. Verification: Configuration files existence
    if not BUDGET_PATH.exists():
        print(f"Error: Performance budget file is missing: {BUDGET_PATH}")
        return 2
    if not BASELINE_PATH.exists():
        print(f"Error: Baseline snapshot file is missing: {BASELINE_PATH}")
        return 2

    # 2. Verification: Artifacts Completeness & Parsability
    parsed_artifacts = {}
    for filename, fields in REQUIRED_ARTIFACTS.items():
        artifact_path = profile_dir / filename
        if not artifact_path.exists():
            artifacts_status = "FAIL"
            reasons.append(f"Missing artifact: {filename} under {profile_dir}")
            continue

        # If it's a markdown or non-JSON file, just verify existence
        if fields is None:
            continue

        # Parsability check
        try:
            parsed_data = load_json(artifact_path)
            parsed_artifacts[filename] = parsed_data
        except Exception as exc:
            artifacts_status = "FAIL"
            reasons.append(f"Unparsable JSON artifact {filename}: {exc}")
            continue

        # Schema Validation
        if isinstance(parsed_data, dict):
            # Check mandatory data fields
            for field in fields:
                if field not in parsed_data:
                    schema_status = "FAIL"
                    reasons.append(f"Schema violation in {filename}: missing mandatory field '{field}'")
            
            # Schema version warnings (backward compatible: warning only, does not fail the schema gate)
            for v_field in ["benchmark_version", "schema_version", "generator_version"]:
                if v_field not in parsed_data:
                    print(f"Info: Optional schema metadata field '{v_field}' is missing in {filename}")
        elif isinstance(parsed_data, list):
            # Check list-type artifacts
            if not isinstance(parsed_data, list):
                schema_status = "FAIL"
                reasons.append(f"Schema violation in {filename}: expected JSON list, got {type(parsed_data).__name__}")
        else:
            schema_status = "FAIL"
            reasons.append(f"Schema violation in {filename}: unexpected top-level JSON type {type(parsed_data).__name__}")

    # If artifacts are unparsable or missing, we cannot run consistency/budget checks
    if artifacts_status == "FAIL" or schema_status == "FAIL":
        print_health_report(
            artifacts=artifacts_status,
            schema=schema_status,
            consistency="NOT RUN",
            budget="NOT RUN",
            regression="NOT RUN",
            performance="NOT RUN",
            overall="FAIL",
            reasons=reasons
        )
        return 2

    # 3. Cross-Consistency Validation
    try:
        summary = parsed_artifacts["summary.json"]
        per_image_results = parsed_artifacts["per_image_results.json"]
        ocr_attempts = parsed_artifacts["ocr_attempts.json"]
        metadata = parsed_artifacts["metadata.json"]

        # C1: Passport counts consistency
        sum_total_passports = summary.get("total_passports", 0)
        actual_total_passports = len(per_image_results)
        if sum_total_passports != actual_total_passports:
            consistency_status = "FAIL"
            reasons.append(
                f"Consistency violation: summary.total_passports != results count. "
                f"Expected (summary): {sum_total_passports}, Actual (results): {actual_total_passports}, "
                f"Difference: {actual_total_passports - sum_total_passports}"
            )

        # C2: Success count consistency
        sum_successful_passports = summary.get("successful_passports", 0)
        actual_successful_passports = sum(1 for r in per_image_results if r.get("success"))
        if sum_successful_passports != actual_successful_passports:
            consistency_status = "FAIL"
            reasons.append(
                f"Consistency violation: summary.successful_passports != actual success count. "
                f"Expected (summary): {sum_successful_passports}, Actual (results): {actual_successful_passports}, "
                f"Difference: {actual_successful_passports - sum_successful_passports}"
            )

        # C3: Attempts count consistency (sum of runs vs actual ocr_attempts)
        sum_ocr_runs_by_results = sum(r.get("ocr_runs", 0) for r in per_image_results)
        actual_ocr_attempts = len(ocr_attempts)
        if sum_ocr_runs_by_results != actual_ocr_attempts:
            consistency_status = "FAIL"
            reasons.append(
                f"Consistency violation: sum of ocr_runs in results != total ocr_attempts count. "
                f"Expected (results sum): {sum_ocr_runs_by_results}, Actual (ocr_attempts): {actual_ocr_attempts}, "
                f"Difference: {actual_ocr_attempts - sum_ocr_runs_by_results}"
            )

        # C4: Metadata passports vs summary passports count
        meta_total_images = metadata.get("dataset", {}).get("total_images", 0)
        if meta_total_images != sum_total_passports:
            consistency_status = "FAIL"
            reasons.append(
                f"Consistency violation: metadata.dataset.total_images != summary.total_passports. "
                f"Expected (metadata): {meta_total_images}, Actual (summary): {sum_total_passports}, "
                f"Difference: {sum_total_passports - meta_total_images}"
            )

        # C5: Individual passport attempts mapping consistency
        for r in per_image_results:
            p_id = r["id"]
            expected_runs = r.get("ocr_runs", 0)
            actual_runs = sum(1 for att in ocr_attempts if att.get("passport_id") == p_id)
            if expected_runs != actual_runs:
                consistency_status = "FAIL"
                reasons.append(
                    f"Consistency violation: Passport '{p_id}' has mismatch in ocr_runs. "
                    f"Expected (results): {expected_runs}, Actual (ocr_attempts): {actual_runs}, "
                    f"Difference: {actual_runs - expected_runs}"
                )

    except Exception as exc:
        consistency_status = "FAIL"
        reasons.append(f"Error calculating consistency metrics: {exc}")

    # 4. Budget & Regression & Performance Validations
    try:
        budget = load_json(BUDGET_PATH)
        baseline = load_json(BASELINE_PATH)

        # Budget verification
        min_accuracy = budget.get("min_accuracy_percent", 100.0)
        success_count = sum(1 for r in per_image_results if r.get("success"))
        total_passports = len(per_image_results)
        accuracy_percent = (success_count / total_passports * 100.0) if total_passports > 0 else 0.0
        
        if accuracy_percent < min_accuracy:
            budget_status = "FAIL"
            reasons.append(f"Budget violation: Accuracy ({accuracy_percent:.2f}%) is below min budget ({min_accuracy:.2f}%)")

        total_attempts = len(ocr_attempts)
        max_attempts = budget.get("max_ocr_attempts", 320)
        if total_attempts > max_attempts:
            budget_status = "FAIL"
            reasons.append(f"Budget violation: Total OCR attempts ({total_attempts}) exceeds max budget ({max_attempts})")

        fallback_count = sum(1 for r in per_image_results if r.get("fallback"))
        max_fallbacks = budget.get("max_fallback_count", 20)
        if fallback_count > max_fallbacks:
            budget_status = "FAIL"
            reasons.append(f"Budget violation: Fallback count ({fallback_count}) exceeds max budget ({max_fallbacks})")

        # Regression verification (from comparison.json if it exists)
        if COMPARISON_PATH.exists():
            try:
                comparison = load_json(COMPARISON_PATH)
                regressions_list = comparison.get("regressions", [])
                if regressions_list:
                    regression_status = "FAIL"
                    reasons.append(f"Regression check FAILED: {len(regressions_list)} passports failed in optimized profile")
            except Exception as exc:
                print(f"Warning: Failed to parse comparison.json for regressions: {exc}")

        # Performance verification (against baseline snapshot)
        avg_runtime = summary.get("elapsed_ms", {}).get("avg", 0.0)
        p95_runtime = summary.get("elapsed_ms", {}).get("p95", 0.0)
        
        baseline_avg = baseline.get("average_runtime_ms", 3000.0)
        baseline_p95 = baseline.get("p95_runtime_ms", 7000.0)
        
        if avg_runtime > 1.5 * baseline_avg:
            performance_status = "WARNING"
            reasons.append(f"Performance warning: Average runtime ({avg_runtime:.1f}ms) is >1.5x baseline average ({baseline_avg:.1f}ms)")
        if p95_runtime > 1.5 * baseline_p95:
            performance_status = "WARNING"
            reasons.append(f"Performance warning: P95 runtime ({p95_runtime:.1f}ms) is >1.5x baseline P95 ({baseline_p95:.1f}ms)")

    except Exception as exc:
        budget_status = "FAIL"
        reasons.append(f"Error validating budget and performance metrics: {exc}")

    # Overall Status evaluation
    gate_failed = (
        artifacts_status == "FAIL" or
        schema_status == "FAIL" or
        consistency_status == "FAIL" or
        budget_status == "FAIL" or
        regression_status == "FAIL"
    )
    overall_status = "FAIL" if gate_failed else "PASS"

    print_health_report(
        artifacts=artifacts_status,
        schema=schema_status,
        consistency=consistency_status,
        budget=budget_status,
        regression=regression_status,
        performance=performance_status,
        overall=overall_status,
        reasons=reasons
    )

    return 1 if gate_failed else 0


def print_health_report(
    artifacts: str,
    schema: str,
    consistency: str,
    budget: str,
    regression: str,
    performance: str,
    overall: str,
    reasons: list[str]
) -> None:
    print("========================================================")
    print("Benchmark Health Report")
    print("========================================================")
    print(f"Artifacts ......... {artifacts}")
    print(f"Schema ............ {schema}")
    print(f"Consistency ....... {consistency}")
    print(f"Budget ............ {budget}")
    print(f"Regression ........ {regression}")
    print(f"Performance ....... {performance}")
    print(f"Overall ........... {overall}")
    print("========================================================")
    if reasons:
        print("Details:")
        for r in reasons:
            print(f"  - {r}")
        print("========================================================")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Validate MRZ benchmark performance budget and consistency.")
    parser.add_argument("--profile", default="optimized", choices=["legacy", "optimized"], help="Benchmark profile directory to validate.")
    args = parser.parse_args()
    sys.exit(validate_benchmark(args.profile))
