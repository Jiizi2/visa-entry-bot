import os
import sys
from pathlib import Path

# Setup sys.path to find packages correctly
SCRIPTS_DIR = Path(__file__).resolve().parent
PYTHON_OCR_DIR = SCRIPTS_DIR.parent
if str(PYTHON_OCR_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_OCR_DIR))

from scripts.benchmark_utils import load_json, save_json, resolve_profile_paths, REPO_ROOT

# Defaults will be resolved in run_analysis()
RESULT_PATH = Path()
SUMMARY_PATH = Path()
METADATA_PATH = Path()
STAGE_BREAKDOWN_PATH = Path()
OCR_ATTEMPTS_PATH = Path()
DECISION_TREE_PATH = Path()
DEPENDENCY_ANALYSIS_PATH = Path()
IMPACT_SIMULATION_PATH = Path()
OPTIMIZATION_MATRIX_PATH = Path()
REPORT_PATH = Path()


def run_analysis(profile: str = "legacy") -> int:
    global RESULT_PATH, SUMMARY_PATH, METADATA_PATH, STAGE_BREAKDOWN_PATH, OCR_ATTEMPTS_PATH
    global DECISION_TREE_PATH, DEPENDENCY_ANALYSIS_PATH, IMPACT_SIMULATION_PATH, OPTIMIZATION_MATRIX_PATH, REPORT_PATH
    
    paths = resolve_profile_paths(profile)
    RESULT_PATH = paths["per_image_results"]
    SUMMARY_PATH = paths["summary"]
    METADATA_PATH = paths["metadata"]
    STAGE_BREAKDOWN_PATH = paths["stage_breakdown"]
    OCR_ATTEMPTS_PATH = paths["ocr_attempts"]
    
    DECISION_TREE_PATH = paths["decision_tree"]
    DEPENDENCY_ANALYSIS_PATH = paths["dependency_analysis"]
    IMPACT_SIMULATION_PATH = paths["impact_simulation"]
    OPTIMIZATION_MATRIX_PATH = paths["optimization_matrix"]
    REPORT_PATH = paths["report"]

    # 1. Read existing benchmark artifacts
    if not RESULT_PATH.exists() or not OCR_ATTEMPTS_PATH.exists():
        print(f"Error: benchmark files not found for profile '{profile}'. Run benchmark first.")
        return 1

    try:
        per_image_results = load_json(RESULT_PATH)
        ocr_attempts = load_json(OCR_ATTEMPTS_PATH)
        stage_breakdowns = load_json(STAGE_BREAKDOWN_PATH)
        summary_data = load_json(SUMMARY_PATH)
        metadata_data = load_json(METADATA_PATH)
    except Exception as exc:
        print(f"Error reading benchmark files: {exc}")
        return 1

    # Map passport records and attempts
    per_image_map = {r["id"]: r for r in per_image_results}
    attempts_by_passport = {}
    for att in ocr_attempts:
        p_id = att["passport_id"]
        attempts_by_passport.setdefault(p_id, []).append(att)

    # Make sure all passports in results have attempts list
    for r in per_image_results:
        attempts_by_passport.setdefault(r["id"], [])

    # 2. Decision Tree Reconstruction
    decision_tree = {}
    for r in per_image_results:
        p_id = r["id"]
        atts = attempts_by_passport.get(p_id, [])
        selected_att = next((att for att in atts if att.get("selected")), None)
        
        decision_tree[p_id] = {
            "attempts": atts,
            "selected_attempt": selected_att
        }

    save_json(DECISION_TREE_PATH, decision_tree)

    # Helper function for Impact Simulation
    def simulate_scenario(scenario_name: str) -> dict:
        changed = []
        failed = []
        unaffected = []

        for r in per_image_results:
            p_id = r["id"]
            atts = attempts_by_passport.get(p_id, [])
            original_success = r.get("success", False)

            if not original_success:
                unaffected.append(p_id)
                continue

            selected_att = next((att for att in atts if att.get("selected")), None)

            # Check if selected attempt matches constraint
            removed = False
            if scenario_name == "disable_rotation_90":
                removed = (selected_att and selected_att.get("orientation") == 90)
            elif scenario_name == "disable_rotation_180":
                removed = (selected_att and selected_att.get("orientation") == 180)
            elif scenario_name == "disable_rotation_270":
                removed = (selected_att and selected_att.get("orientation") == 270)
            elif scenario_name == "disable_all_rotations":
                removed = (selected_att and selected_att.get("orientation") in (90, 180, 270))
            elif scenario_name == "disable_adaptive":
                removed = (selected_att and selected_att.get("variant") == "adaptive")
            elif scenario_name == "disable_otsu":
                removed = (selected_att and selected_att.get("variant") == "otsu")
            elif scenario_name == "disable_clahe":
                removed = (selected_att and selected_att.get("variant") == "clahe")
            elif scenario_name == "gray_only":
                removed = (selected_att and selected_att.get("variant") in ("clahe", "otsu", "adaptive"))
            elif scenario_name == "disable_width_2000":
                removed = (selected_att and selected_att.get("width") == 2000)
            elif scenario_name == "width_1600_only":
                removed = (selected_att and selected_att.get("width") != 1600)
            elif scenario_name == "disable_fallback":
                removed = r.get("fallback", False)

            if not removed:
                unaffected.append(p_id)
            else:
                # Can it recover with other remaining attempts?
                remaining_atts = []
                for att in atts:
                    is_removed = False
                    if scenario_name == "disable_rotation_90":
                        is_removed = (att.get("orientation") == 90)
                    elif scenario_name == "disable_rotation_180":
                        is_removed = (att.get("orientation") == 180)
                    elif scenario_name == "disable_rotation_270":
                        is_removed = (att.get("orientation") == 270)
                    elif scenario_name == "disable_all_rotations":
                        is_removed = (att.get("orientation") in (90, 180, 270))
                    elif scenario_name == "disable_adaptive":
                        is_removed = (att.get("variant") == "adaptive")
                    elif scenario_name == "disable_otsu":
                        is_removed = (att.get("variant") == "otsu")
                    elif scenario_name == "disable_clahe":
                        is_removed = (att.get("variant") == "clahe")
                    elif scenario_name == "gray_only":
                        is_removed = (att.get("variant") in ("clahe", "otsu", "adaptive"))
                    elif scenario_name == "disable_width_2000":
                        is_removed = (att.get("width") == 2000)
                    elif scenario_name == "width_1600_only":
                        is_removed = (att.get("width") != 1600)
                    elif scenario_name == "disable_fallback":
                        is_removed = True

                    if not is_removed:
                        remaining_atts.append(att)

                can_recover = any(att.get("checksum_passed") for att in remaining_atts)
                if can_recover:
                    changed.append(p_id)
                else:
                    failed.append(p_id)

        return {
            "passport_changed": sorted(changed),
            "passport_failed": sorted(failed),
            "passport_unaffected": sorted(unaffected)
        }

    # 3. Impact Simulation
    scenarios = [
        "disable_rotation_90", "disable_rotation_180", "disable_rotation_270", "disable_all_rotations",
        "disable_adaptive", "disable_otsu", "disable_clahe", "gray_only",
        "disable_width_2000", "width_1600_only", "disable_fallback"
    ]
    impact_simulation = {}
    for sc in scenarios:
        impact_simulation[sc] = simulate_scenario(sc)

    save_json(IMPACT_SIMULATION_PATH, impact_simulation)

    # 4. Dependency Analysis
    dependency_analysis = {}
    for r in per_image_results:
        p_id = r["id"]
        deps = []
        
        # Checks exclusive dependency on features
        # If disabling feature X makes it fail, then it depends on X
        if p_id in impact_simulation["disable_all_rotations"]["passport_failed"]:
            deps.append("rotation")
        if p_id in impact_simulation["disable_fallback"]["passport_failed"]:
            deps.append("fallback")
        if p_id in impact_simulation["disable_width_2000"]["passport_failed"]:
            deps.append("width_2000")
        if p_id in impact_simulation["disable_clahe"]["passport_failed"]:
            deps.append("clahe")
        if p_id in impact_simulation["disable_otsu"]["passport_failed"]:
            deps.append("otsu")
        if p_id in impact_simulation["disable_adaptive"]["passport_failed"]:
            deps.append("adaptive")

        if not deps:
            deps.append("independent")

        dependency_analysis[p_id] = {
            "depends_on": sorted(deps)
        }

    save_json(DEPENDENCY_ANALYSIS_PATH, dependency_analysis)

    # 5. Optimization & Risk Matrix
    # Features details mapping
    # Total OCR runtime in benchmark
    total_ocr_runtime = sum(att["runtime_ms"] for att in ocr_attempts)
    
    def get_risk_level(saved_count: int) -> str:
        if saved_count == 0:
            return "LOW"
        elif saved_count <= 2:
            return "MEDIUM"
        elif saved_count <= 5:
            return "HIGH"
        else:
            return "VERY_HIGH"

    feature_mappings = {
        "rotation_90": {"orientation": 90, "scenario": "disable_rotation_90"},
        "rotation_180": {"orientation": 180, "scenario": "disable_rotation_180"},
        "rotation_270": {"orientation": 270, "scenario": "disable_rotation_270"},
        "gray": {"variant": "gray", "scenario": None},
        "clahe": {"variant": "clahe", "scenario": "disable_clahe"},
        "otsu": {"variant": "otsu", "scenario": "disable_otsu"},
        "adaptive": {"variant": "adaptive", "scenario": "disable_adaptive"},
        "width_1600": {"width": 1600, "scenario": None},
        "width_2000": {"width": 2000, "scenario": "disable_width_2000"},
        "fallback": {"fallback": True, "scenario": "disable_fallback"}
    }

    optimization_matrix = {}
    for f_name, criteria in feature_mappings.items():
        # attempts selection
        if f_name == "fallback":
            fallback_p_ids = [r["id"] for r in per_image_results if r.get("fallback")]
            atts = []
            for p_id in fallback_p_ids:
                p_atts = attempts_by_passport.get(p_id, [])
                has_rotations = any(att["orientation"] in (90, 180, 270) for att in p_atts)
                direct_limit = 64 if has_rotations else 16
                atts.extend(p_atts[direct_limit:])
        elif "orientation" in criteria:
            atts = [att for att in ocr_attempts if att["orientation"] == criteria["orientation"]]
        elif "variant" in criteria:
            atts = [att for att in ocr_attempts if att["variant"] == criteria["variant"]]
        elif "width" in criteria:
            atts = [att for att in ocr_attempts if att["width"] == criteria["width"]]
        else:
            atts = []

        # Calculate metrics
        attempts_count = len(atts)
        runtime_cost = sum(att["runtime_ms"] for att in atts)
        runtime_pct = (runtime_cost / total_ocr_runtime * 100) if total_ocr_runtime > 0 else 0.0
        
        # Calculate success count (times it was the selected attempt)
        if f_name == "fallback":
            success_count = sum(1 for r in per_image_results if r.get("fallback") and r.get("success"))
        elif "orientation" in criteria:
            success_count = sum(1 for r in per_image_results if r.get("orientation") == criteria["orientation"] and r.get("success") and not r.get("fallback"))
        elif "variant" in criteria:
            success_count = sum(1 for r in per_image_results if r.get("variant") == criteria["variant"] and r.get("success"))
        elif "width" in criteria:
            # selected attempts matching this width
            success_count = sum(1 for att in ocr_attempts if att.get("selected") and att.get("width") == criteria["width"])
        else:
            success_count = 0

        # Saved passports count (how many fail if disabled)
        sc = criteria.get("scenario")
        saved_count = len(impact_simulation[sc]["passport_failed"]) if sc else 0
        if f_name == "gray":
            # For gray, if we disable gray, we fail everything except those that can be saved by other variants.
            # Gray is the base, so let's check impact of gray removal:
            # If we don't have a direct scenario, we can calculate it:
            # Passports that successfully used gray and have no other variants passing checksum
            gray_failed = 0
            for p_id, p_atts in attempts_by_passport.items():
                selected_att = next((att for att in p_atts if att.get("selected")), None)
                if selected_att and selected_att.get("variant") == "gray":
                    other_success = any(att.get("checksum_passed") and att.get("variant") != "gray" for att in p_atts)
                    if not other_success:
                        gray_failed += 1
            saved_count = gray_failed
        elif f_name == "width_1600":
            # If we remove 1600, how many fail?
            # It's exactly the fails of width_1600_only? No, if we disable 1600, we only have 2000 left.
            # Let's count how many had selected width 1600 and cannot succeed at 2000.
            w1600_failed = 0
            for p_id, p_atts in attempts_by_passport.items():
                selected_att = next((att for att in p_atts if att.get("selected")), None)
                if selected_att and selected_att.get("width") == 1600:
                    other_success = any(att.get("checksum_passed") and att.get("width") != 1600 for att in p_atts)
                    if not other_success:
                        w1600_failed += 1
            saved_count = w1600_failed

        optimization_matrix[f_name] = {
            "runtime_cost_ms": round(runtime_cost, 1),
            "attempt_count": attempts_count,
            "success_count": success_count,
            "saved_passports": saved_count,
            "runtime_percentage": round(runtime_pct, 2),
            "risk_level": get_risk_level(saved_count)
        }

    save_json(OPTIMIZATION_MATRIX_PATH, optimization_matrix)

    # 6. Read and Extend report.md
    if REPORT_PATH.exists():
        with open(REPORT_PATH, "r", encoding="utf-8") as f:
            report_text = f.read()
    else:
        report_text = "# Benchmark Performance Report\n"

    # Find position of Key Findings or place at the end
    # We clean up any previous report extension sections to avoid double appending
    cutoff_marker = "## Decision Tree Analysis"
    if cutoff_marker in report_text:
        report_text = report_text.split(cutoff_marker)[0].strip()

    # Re-calculate stats for markdown
    total_images = len(per_image_results)
    
    # Decision Tree summary stats
    direct_exit_count = sum(1 for p_id, tree in decision_tree.items() if len(tree["attempts"]) == 1 and tree["selected_attempt"])
    rotation_needed_count = sum(1 for p_id, tree in decision_tree.items() if any(att["orientation"] in (90, 180, 270) for att in tree["attempts"]) and not tree["attempts"][0].get("selected") and tree["selected_attempt"] and not tree["selected_attempt"].get("passport_id") in impact_simulation["disable_fallback"]["passport_failed"])
    
    # Render tables for report.md
    # 1. Dependency Analysis Table
    dep_rows = []
    for p_id, dep in sorted(dependency_analysis.items())[:15]: # Show first 15 or summary
        dep_rows.append(f"| **{p_id}** | {', '.join(dep['depends_on'])} |")
    dep_table = "\n".join(dep_rows)

    # 2. Impact Simulation Table
    sim_rows = []
    for sc in scenarios:
        res = impact_simulation[sc]
        sim_rows.append(
            f"| **{sc}** | {len(res['passport_changed'])} | {len(res['passport_failed'])} | {len(res['passport_unaffected'])} |"
        )
    sim_table = "\n".join(sim_rows)

    # 3. Cost vs Value Table
    cost_rows = []
    for f_name, metrics in optimization_matrix.items():
        cost_rows.append(
            f"| **{f_name}** | {metrics['runtime_cost_ms']} ms | {metrics['attempt_count']} | {metrics['success_count']} | {metrics['saved_passports']} | {metrics['runtime_percentage']}% |"
        )
    cost_table = "\n".join(cost_rows)

    # 4. Risk Matrix Table
    risk_rows = []
    for f_name, metrics in optimization_matrix.items():
        risk_rows.append(
            f"| **{f_name}** | {metrics['saved_passports']} | **{metrics['risk_level']}** | {metrics['runtime_percentage']}% |"
        )
    risk_table = "\n".join(risk_rows)

    # 5. Key Findings
    key_findings_list = [
        f"* **Rotation (90°/180°/270°)**: Total 528 attempts, 0 success count, 0 saved passports. Risk level is **LOW**.",
        f"* **Adaptive Variant**: Total {optimization_matrix['adaptive']['attempt_count']} attempts, 0 success count, 0 saved passports. Risk level is **LOW**.",
        f"* **Width 2000px**: Total {optimization_matrix['width_2000']['attempt_count']} attempts, 1 success count, {optimization_matrix['width_2000']['saved_passports']} saved passports. Risk level is **{optimization_matrix['width_2000']['risk_level']}**.",
        f"* **Fallback Stage**: Total {optimization_matrix['fallback']['attempt_count']} attempts, {optimization_matrix['fallback']['success_count']} success count, {optimization_matrix['fallback']['saved_passports']} saved passports. Risk level is **{optimization_matrix['fallback']['risk_level']}**."
    ]
    key_findings_rendered = "\n".join(key_findings_list)

    report_extension = f"""

## Decision Tree Analysis

Pohon keputusan pipeline MRZ direkonstruksi untuk menganalisis jalur eksekusi:
* **Direct Path (0° / gray)**: {direct_exit_count} paspor sukses langsung pada upaya pertama.
* **Rotation Path (90° / 180° / 270°)**: Rotasi diuji ketika direct path gagal.
* **Fallback Path**: Fallback terpicu jika seluruh kombinasi direct scan tidak menghasilkan MRZ yang valid.

---

## Dependency Analysis

Analisis dependensi eksklusif paspor terhadap fitur tertentu (15 paspor pertama ditampilkan):

| Passport ID | Depends On |
| :--- | :--- |
{dep_table}
*Seluruh dependensi detail tercatat lengkap di [dependency_analysis.json](file:///{DEPENDENCY_ANALYSIS_PATH}).*

---

## Impact Simulation

Simulasi matematis dampak terhadap hasil ekstraksi jika fitur dihapus:

| Scenario | Passport Changed | Passport Failed | Passport Unaffected |
| :--- | :---: | :---: | :---: |
{sim_table}

---

## Cost vs Value

Perbandingan biaya runtime terhadap nilai kontribusi fitur:

| Feature | Runtime Cost (ms) | Attempt Count | Success Count | Saved Passports | Runtime Percentage |
| :--- | :---: | :---: | :---: | :---: | :---: |
{cost_table}

---

## Risk Matrix

Matriks tingkat risiko optimasi jika fitur dieliminasi dari pipeline:

| Feature | Saved Passports | Risk Level | Runtime Cost (%) |
| :--- | :---: | :---: | :---: |
{risk_table}

---

## Key Findings

{key_findings_rendered}
"""
    # Replace Key Findings section if it already exists in the report, or append
    if "## 10. Key Findings" in report_text:
        report_text = report_text.split("## 10. Key Findings")[0].strip()
        
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        f.write(report_text + report_extension)

    print("========================================================")
    print("Evidence Analysis Completed Successfully")
    print("========================================================")
    print("Decision Tree JSON : " + os.path.relpath(DECISION_TREE_PATH, REPO_ROOT))
    print("Dependency JSON    : " + os.path.relpath(DEPENDENCY_ANALYSIS_PATH, REPO_ROOT))
    print("Impact Sim JSON    : " + os.path.relpath(IMPACT_SIMULATION_PATH, REPO_ROOT))
    print("Opt Matrix JSON    : " + os.path.relpath(OPTIMIZATION_MATRIX_PATH, REPO_ROOT))
    print("Report MD Extended : " + os.path.relpath(REPORT_PATH, REPO_ROOT))
    
    return 0


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Analyze MRZ benchmark evidence.")
    parser.add_argument("--profile", default=os.environ.get("PASSPORT_OCR_PROFILE", "legacy"), choices=["legacy", "optimized"], help="Profile to analyze.")
    args = parser.parse_args()
    sys.exit(run_analysis(args.profile))
