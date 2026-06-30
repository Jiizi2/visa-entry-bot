import os
import sys
from pathlib import Path

# Setup sys.path to find packages correctly
SCRIPTS_DIR = Path(__file__).resolve().parent
PYTHON_OCR_DIR = SCRIPTS_DIR.parent
if str(PYTHON_OCR_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_OCR_DIR))

from scripts.benchmark_utils import load_json, save_json, resolve_profile_paths, COMPARISON_PATH, COMPARISON_MD_PATH, PYTHON_OCR_DIR


def run_comparison(base: str = "legacy", candidate: str = "optimized") -> int:
    paths_legacy = resolve_profile_paths(base)
    paths_optimized = resolve_profile_paths(candidate)

    leg_results_path = paths_legacy["per_image_results"]
    opt_results_path = paths_optimized["per_image_results"]
    leg_attempts_path = paths_legacy["ocr_attempts"]
    opt_attempts_path = paths_optimized["ocr_attempts"]
    leg_summary_path = paths_legacy["summary"]
    opt_summary_path = paths_optimized["summary"]

    required_keys = ["per_image_results", "ocr_attempts", "summary"]
    for key in required_keys:
        if not paths_legacy[key].exists():
            print(f"Error: Required file {paths_legacy[key].name} is missing in base profile '{base}'.")
            return 1
        if not paths_optimized[key].exists():
            print(f"Error: Required file {paths_optimized[key].name} is missing in candidate profile '{candidate}'.")
            return 1

    try:
        leg_results = load_json(leg_results_path)
        opt_results = load_json(opt_results_path)
        leg_attempts = load_json(leg_attempts_path)
        opt_attempts = load_json(opt_attempts_path)
        leg_summary = load_json(leg_summary_path)
        opt_summary = load_json(opt_summary_path)
    except Exception as exc:
        print(f"Error reading benchmark files: {exc}")
        return 1

    # Map elements
    leg_results_map = {r["id"]: r for r in leg_results}
    opt_results_map = {r["id"]: r for r in opt_results}

    leg_atts_by_passport = {}
    for att in leg_attempts:
        leg_atts_by_passport.setdefault(att["passport_id"], []).append(att)

    opt_atts_by_passport = {}
    for att in opt_attempts:
        opt_atts_by_passport.setdefault(att["passport_id"], []).append(att)

    # Core Stats
    total_legacy_runtime_ms = sum(r["runtime_ms"] for r in leg_results)
    total_optimized_runtime_ms = sum(r["runtime_ms"] for r in opt_results)
    runtime_saved_ms = total_legacy_runtime_ms - total_optimized_runtime_ms
    runtime_saved_percent = (runtime_saved_ms / total_legacy_runtime_ms * 100) if total_legacy_runtime_ms > 0 else 0.0

    avg_legacy_runtime = total_legacy_runtime_ms / len(leg_results) if leg_results else 0
    avg_optimized_runtime = total_optimized_runtime_ms / len(opt_results) if opt_results else 0

    total_legacy_runs = sum(r["ocr_runs"] for r in leg_results)
    total_optimized_runs = sum(r["ocr_runs"] for r in opt_results)
    runs_diff = total_optimized_runs - total_legacy_runs

    success_legacy = sum(1 for r in leg_results if r["success"])
    success_optimized = sum(1 for r in opt_results if r["success"])
    
    accuracy_legacy = (success_legacy / len(leg_results) * 100) if leg_results else 0.0
    accuracy_optimized = (success_optimized / len(opt_results) * 100) if opt_results else 0.0

    fallback_legacy = sum(1 for r in leg_results if r["fallback"])
    fallback_optimized = sum(1 for r in opt_results if r["fallback"])

    candidates_found_legacy = sum(1 for att in leg_attempts if att.get("candidate_found"))
    candidates_found_optimized = sum(1 for att in opt_attempts if att.get("candidate_found"))

    # Compare passports individual outcomes
    changed_passports = []
    regressions = []
    improved = []

    for p_id in sorted(leg_results_map.keys()):
        leg_rec = leg_results_map[p_id]
        opt_rec = opt_results_map.get(p_id)
        if not opt_rec:
            continue

        leg_succ = leg_rec["success"]
        opt_succ = opt_rec["success"]

        # Regression: legacy success, optimized fails
        if leg_succ and not opt_succ:
            regressions.append({
                "passport_id": p_id,
                "legacy_status": "SUCCESS",
                "optimized_status": "FAILED",
                "reason": "Failed to extract valid MRZ in optimized pipeline."
            })
            continue

        # Improvement: legacy failed, optimized success
        if not leg_succ and opt_succ:
            improved.append({
                "passport_id": p_id,
                "legacy_status": "FAILED",
                "optimized_status": "SUCCESS"
            })
            continue

        # If both are successful, compare selected candidates
        if leg_succ and opt_succ:
            leg_atts = leg_atts_by_passport.get(p_id, [])
            opt_atts = opt_atts_by_passport.get(p_id, [])

            leg_sel = next((a for a in leg_atts if a.get("selected")), None)
            opt_sel = next((a for a in opt_atts if a.get("selected")), None)

            if leg_sel and opt_sel:
                diff_width = leg_sel.get("width") != opt_sel.get("width")
                diff_variant = leg_sel.get("variant") != opt_sel.get("variant")
                diff_orient = leg_sel.get("orientation") != opt_sel.get("orientation")

                if diff_width or diff_variant or diff_orient:
                    reasons = []
                    if diff_width:
                        reasons.append(f"Width changed from {leg_sel.get('width')}px to {opt_sel.get('width')}px")
                    if diff_variant:
                        reasons.append(f"Variant changed from '{leg_sel.get('variant')}' to '{opt_sel.get('variant')}'")
                    if diff_orient:
                        reasons.append(f"Orientation changed from {leg_sel.get('orientation')}° to {opt_sel.get('orientation')}°")
                    
                    changed_passports.append({
                        "passport_id": p_id,
                        "before": {
                            "width": leg_sel.get("width"),
                            "variant": leg_sel.get("variant"),
                            "orientation": leg_sel.get("orientation")
                        },
                        "after": {
                            "width": opt_sel.get("width"),
                            "variant": opt_sel.get("variant"),
                            "orientation": opt_sel.get("orientation")
                        },
                        "reason": "; ".join(reasons)
                    })

    # Prepare JSON structure
    comparison_data = {
        "summary": {
            "runtime_legacy_ms": round(total_legacy_runtime_ms, 1),
            "runtime_optimized_ms": round(total_optimized_runtime_ms, 1),
            "runtime_diff_ms": round(-runtime_saved_ms, 1),
            "runtime_diff_percent": round(-runtime_saved_percent, 2),
            "avg_runtime_legacy_ms": round(avg_legacy_runtime, 1),
            "avg_runtime_optimized_ms": round(avg_optimized_runtime, 1),
            "ocr_runs_legacy": total_legacy_runs,
            "ocr_runs_optimized": total_optimized_runs,
            "ocr_runs_diff": runs_diff,
            "accuracy_legacy": round(accuracy_legacy, 2),
            "accuracy_optimized": round(accuracy_optimized, 2),
            "accuracy_diff": round(accuracy_optimized - accuracy_legacy, 2),
            "fallback_legacy": fallback_legacy,
            "fallback_optimized": fallback_optimized,
            "fallback_diff": fallback_optimized - fallback_legacy,
            "candidates_found_legacy": candidates_found_legacy,
            "candidates_found_optimized": candidates_found_optimized,
            "candidates_found_diff": candidates_found_optimized - candidates_found_legacy
        },
        "changed_passports": changed_passports,
        "regressions": regressions,
        "improved_passports": improved
    }

    save_json(COMPARISON_PATH, comparison_data)

    # Render Markdown Comparison Report
    reg_status = "PASSED" if not regressions else f"FAILED ({len(regressions)} regressions detected)"
    
    # Tables formatting
    # Changed passports rows
    changed_rows = []
    for c in changed_passports:
        changed_rows.append(
            f"| **{c['passport_id']}** | Width: {c['before']['width']}<br>Variant: {c['before']['variant']}<br>Orient: {c['before']['orientation']}° | Width: {c['after']['width']}<br>Variant: {c['after']['variant']}<br>Orient: {c['after']['orientation']}° | {c['reason']} |"
        )
    changed_table = "\n".join(changed_rows) if changed_rows else "| *None* | | | |"

    # Regression rows
    reg_rows = []
    for r in regressions:
        reg_rows.append(
            f"| **{r['passport_id']}** | {r['legacy_status']} | {r['optimized_status']} | {r['reason']} |"
        )
    reg_table = "\n".join(reg_rows) if reg_rows else "| *None* | | | |"

    base_label = base.capitalize()
    cand_label = candidate.capitalize()

    # Recommendation formulation based on data
    if regressions:
        recommendation = f"Mengingat adanya regresi fungsional (paspor yang gagal dibaca pada pipeline {candidate} tetapi sukses di {base}), **TIDAK DIREKOMENDASIKAN** untuk melakukan aktivasi profil {candidate} ke produksi sebelum penyebab kegagalan dianalisis dan diperbaiki."
    else:
        recommendation = f"Profil `{candidate}` menunjukkan penghematan runtime yang signifikan sebesar **{runtime_saved_percent:.2f}%** ({runtime_saved_ms/1000.0:.2f} detik) dan pengurangan OCR runs sebesar **{-runs_diff}** tanpa adanya regresi akurasi (0 regresi dari {len(leg_results)} paspor). Profil {candidate} saat ini telah dipromosikan menjadi default produksi. Mode {base} dipertahankan sebagai compatibility mode dan dapat diaktifkan secara eksplisit via variabel lingkungan `PASSPORT_OCR_PROFILE={base}` jika sewaktu-waktu diperlukan rollback atau investigasi."

    markdown_content = f"""# Benchmark Profile Comparison Report

Laporan ini membandingkan kinerja dan akurasi antara pipeline **{base_label}** (Baseline) dan pipeline **{cand_label}** (Hasil Perbandingan).

---

## 1. Executive Summary

* **{base_label} Runtime (Total)**: {total_legacy_runtime_ms / 1000.0:.2f} s
* **{cand_label} Runtime (Total)**: {total_optimized_runtime_ms / 1000.0:.2f} s
* **Runtime Saving**: **{runtime_saved_ms / 1000.0:.2f} s ({runtime_saved_percent:.2f}%)**
* **Akurasi {base_label}**: {accuracy_legacy:.2f}% ({success_legacy}/{len(leg_results)})
* **Akurasi {cand_label}**: {accuracy_optimized:.2f}% ({success_optimized}/{len(opt_results)})
* **Status Regresi**: **{reg_status}**

---

## 2. Performance Comparison

| Metric | {base_label} | {cand_label} | Difference | Change (%) |
| :--- | :---: | :---: | :---: | :---: |
| **Total Runtime** | {total_legacy_runtime_ms:.1f} ms | {total_optimized_runtime_ms:.1f} ms | {-runtime_saved_ms:.1f} ms | {-runtime_saved_percent:.2f}% |
| **Average Runtime** | {avg_legacy_runtime:.1f} ms | {avg_optimized_runtime:.1f} ms | {avg_optimized_runtime - avg_legacy_runtime:.1f} ms | {((avg_optimized_runtime - avg_legacy_runtime)/avg_legacy_runtime * 100):.2f}% |
| **Total OCR Runs** | {total_legacy_runs} | {total_optimized_runs} | {runs_diff} | {((runs_diff)/total_legacy_runs * 100):.2f}% |
| **Average Runs / Image** | {(total_legacy_runs/len(leg_results)):.2f} | {(total_optimized_runs/len(opt_results)):.2f} | {((total_optimized_runs/len(opt_results)) - (total_legacy_runs/len(leg_results))):.2f} | |

---

## 3. Accuracy & Fallback Comparison

| Metric | {base_label} | {cand_label} | Difference |
| :--- | :---: | :---: | :---: |
| **Success Rate (Accuracy)** | {accuracy_legacy:.2f}% | {accuracy_optimized:.2f}% | {accuracy_optimized - accuracy_legacy:.2f}% |
| **Fallback Triggered** | {fallback_legacy} | {fallback_optimized} | {fallback_optimized - fallback_legacy} |
| **Candidates Found** | {candidates_found_legacy} | {candidates_found_optimized} | {candidates_found_optimized - candidates_found_legacy} |

---

## 4. Regression Analysis

Berikut adalah paspor yang berhasil pada {base_label} tetapi gagal pada {cand_label}:

| Passport ID | {base_label} Status | {cand_label} Status | Reason |
| :--- | :---: | :---: | :--- |
{reg_table}

---

## 5. Candidate Difference Analysis

Berikut adalah paspor yang sukses pada kedua profil tetapi menggunakan kandidat variant, width, atau orientation yang berbeda:

| Passport ID | {base_label} Candidate | {cand_label} Candidate | Reason / Difference |
| :--- | :--- | :--- | :--- |
{changed_table}

---

## 6. Conclusion & Recommendation

{recommendation}
"""

    with open(COMPARISON_MD_PATH, "w", encoding="utf-8") as f:
        f.write(markdown_content)

    print("========================================================")
    print("Profile Comparison Completed Successfully")
    print("========================================================")
    print("Comparison JSON : " + os.path.relpath(COMPARISON_PATH, PYTHON_OCR_DIR.parent))
    print("Comparison MD   : " + os.path.relpath(COMPARISON_MD_PATH, PYTHON_OCR_DIR.parent))
    
    return 0


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Compare two benchmark profiles.")
    parser.add_argument("--base", default="legacy", choices=["legacy", "optimized", "speed", "balanced", "heavy"], help="Base profile for comparison.")
    parser.add_argument("--candidate", default="optimized", choices=["legacy", "optimized", "speed", "balanced", "heavy"], help="Candidate profile for comparison.")
    args = parser.parse_args()
    sys.exit(run_comparison(args.base, args.candidate))
