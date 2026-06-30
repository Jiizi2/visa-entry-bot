from __future__ import annotations

import json
from pathlib import Path
from typing import Any

# Version constants
BENCHMARK_VERSION = "1.0.0"
SCHEMA_VERSION = "1.0"
GENERATOR_VERSION = "1.0.0"

# Directories
SCRIPTS_DIR = Path(__file__).resolve().parent
PYTHON_OCR_DIR = SCRIPTS_DIR.parent
BENCHMARK_DIR = PYTHON_OCR_DIR / "benchmark"
REPO_ROOT = PYTHON_OCR_DIR.parent

# Paths of shared artifacts (directly under benchmark/)
BUDGET_PATH = BENCHMARK_DIR / "performance_budget.json"
BASELINE_PATH = BENCHMARK_DIR / "baseline_snapshot.json"
COMPARISON_PATH = BENCHMARK_DIR / "comparison.json"
COMPARISON_MD_PATH = BENCHMARK_DIR / "comparison.md"

# Registry of required artifacts and their mandatory schema fields
REQUIRED_ARTIFACTS = {
    "summary.json": ["total_passports", "successful_passports", "elapsed_ms", "ocr_runs"],
    "metadata.json": ["date", "git_commit", "platform", "dataset"],
    "per_image_results.json": [],  # Checked as list type
    "ocr_attempts.json": [],       # Checked as list type
    "stage_breakdown.json": [],    # Checked as dict type
    "report.md": None              # Checked for existence only (not JSON)
}


def resolve_profile_paths(profile: str) -> dict[str, Path]:
    """Resolves all artifact paths for a given profile."""
    profile_dir = BENCHMARK_DIR / profile
    return {
        "profile_dir": profile_dir,
        "per_image_results": profile_dir / "per_image_results.json",
        "summary": profile_dir / "summary.json",
        "metadata": profile_dir / "metadata.json",
        "stage_breakdown": profile_dir / "stage_breakdown.json",
        "ocr_attempts": profile_dir / "ocr_attempts.json",
        "checkpoint": profile_dir / "checkpoint.json",
        "report": profile_dir / "report.md",
        "decision_tree": profile_dir / "decision_tree.json",
        "dependency_analysis": profile_dir / "dependency_analysis.json",
        "impact_simulation": profile_dir / "impact_simulation.json",
        "optimization_matrix": profile_dir / "optimization_matrix.json",
    }


def load_json(path: Path) -> Any:
    """Reads a JSON file with UTF-8 encoding."""
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: Any, inject_metadata: bool = True) -> None:
    """Writes a JSON file with UTF-8 encoding and optionally injects schema metadata."""
    if inject_metadata and isinstance(data, dict):
        # Create a shallow copy to avoid modifying the caller's dictionary in-place
        data = data.copy()
        if "schema_version" not in data:
            data["benchmark_version"] = BENCHMARK_VERSION
            data["schema_version"] = SCHEMA_VERSION
            data["generator_version"] = GENERATOR_VERSION

    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def format_time(seconds: float) -> str:
    """Formats elapsed seconds to HH:MM:SS."""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    return f"{h:02d}:{m:02d}:{s:02d}"
