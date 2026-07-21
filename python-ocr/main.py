from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import date
from typing import Callable

from services.log import logger

from services.image_preprocessor import (
    cleanup_temp_root,
    clear_image_preprocess_cache,
    get_image_preprocessor_stats,
    reset_image_preprocessor_stats,
)
from services.indonesia_field_ocr import reset_fast_location_ocr_stats
from services.nusuk_manifest import build_error_record
from services.ocr_result_cache import (
    end_ocr_result_cache_session,
    get_ocr_result_cache_stats,
    start_ocr_result_cache_session,
)
from services.passport_page import clear_passport_page_cache
from services.ocr_runner import get_ocr_stats, reset_ocr_stats
from services.scan_context import ScanContext
from services.ocr_constants import ROOT_DIR, DATA_DIR, SUPPORTED_EXTENSIONS, StepCallback
from services.scan_budget import _ocr_profile, _ocr_budget_ms, _elapsed_ms, _budget_exceeded
from services.path_utils import normalize_filesystem_path as _normalize_filesystem_path

from services.pipeline_stages import (
    _stage_mrz,
    _stage_initial_panel,
    _stage_visual_fields,
    _stage_speed_adaptive_recovery,
    _stage_recovery_panel,
    _stage_visual_recovery,
    _stage_fallback_panel,
    _stage_dates_recovery,
    _stage_names_recovery,
    _stage_validation_and_metrics,
)













def resolve_group_context() -> tuple[str, str]:
    if len(sys.argv) > 1 and sys.argv[1].strip():
        group_dir = resolve_group_dir(sys.argv[1].strip())
        if group_dir:
            return os.path.basename(group_dir), group_dir
        raise SystemExit(
            f"Group folder not found: {sys.argv[1].strip()}. "
            "Use a group ID or a folder path such as example/group."
        )

    groups = discover_group_dirs()
    if len(groups) == 1:
        group_dir = groups[0]
        return os.path.basename(group_dir), group_dir
    if not groups:
        raise SystemExit(
            "No group folders found. Create <GROUP_ID>/passport/, <GROUP_ID>/passports/, "
            "or data/<GROUP_ID>/passports/."
        )
    raise SystemExit("Multiple groups found. Run: python main.py <GROUP_ID or group path>")


def resolve_group_dir(group_ref: str) -> str | None:
    candidates = []
    if os.path.isdir(group_ref):
        candidates.append(os.path.abspath(group_ref))
    candidates.append(os.path.join(ROOT_DIR, group_ref))
    candidates.append(os.path.join(DATA_DIR, group_ref))

    for candidate in candidates:
        normalized = os.path.abspath(candidate)
        if os.path.isdir(normalized):
            return normalized
    return None


def discover_group_dirs() -> list[str]:
    groups: list[str] = []
    for search_root in (ROOT_DIR, DATA_DIR):
        if not os.path.isdir(search_root):
            continue
        for entry in sorted(os.listdir(search_root)):
            group_dir = os.path.join(search_root, entry)
            if not os.path.isdir(group_dir):
                continue
            if group_dir == os.path.abspath(os.path.dirname(__file__)):
                continue
            if has_passport_folder(group_dir):
                groups.append(os.path.abspath(group_dir))
    return unique_paths(groups)


def has_passport_folder(group_dir: str) -> bool:
    return any(os.path.isdir(os.path.join(group_dir, folder_name)) for folder_name in ("passport", "passports"))


def resolve_passports_dir(group_dir: str) -> str:
    for folder_name in ("passport", "passports"):
        candidate = os.path.join(group_dir, folder_name)
        if os.path.isdir(candidate):
            return candidate
    raise FileNotFoundError(f"Passport folder not found: {group_dir}")


def unique_paths(paths: list[str]) -> list[str]:
    seen = set()
    unique = []
    for path in paths:
        normalized = os.path.abspath(path)
        if normalized not in seen:
            seen.add(normalized)
            unique.append(normalized)
    return unique


def list_passport_files(passports_dir: str) -> list[str]:
    if not os.path.isdir(passports_dir):
        raise FileNotFoundError(f"Passport folder not found: {passports_dir}")

    files = []
    for entry in sorted(os.listdir(passports_dir)):
        file_path = os.path.join(passports_dir, entry)
        extension = os.path.splitext(entry)[1].lower()
        if os.path.isfile(file_path) and extension in SUPPORTED_EXTENSIONS:
            files.append(file_path)
    return files


def execute_safe_stage(stage_func: Callable[[ScanContext], None], ctx: ScanContext) -> None:
    from services.scan_context import StageResult
    stage_started = time.perf_counter()
    pre_metadata = dict(ctx.field_metadata)
    pre_rejections = dict(ctx.field_metadata.get("rejections", {}))
    
    try:
        stage_func(ctx)
        elapsed_ms = int((time.perf_counter() - stage_started) * 1000)
        
        # Track changed fields
        changed = []
        for k, v in ctx.field_metadata.items():
            if k == "rejections":
                continue
            if k not in pre_metadata or pre_metadata[k].get("value") != v.get("value"):
                changed.append(k)
                
        # Track rejected fields
        rejected = []
        for k, v in ctx.field_metadata.get("rejections", {}).items():
            if k not in pre_rejections or pre_rejections[k].get("value") != v.get("value"):
                rejected.append(k)
                
        result = StageResult(
            stage_name=stage_func.__name__.lstrip("_stage_"),
            duration_ms=elapsed_ms,
            fields_changed=changed,
            fields_rejected=rejected,
            warnings=[]
        )
        ctx.stage_reports.append(result)
        
    except Exception as exc:
        elapsed_ms = int((time.perf_counter() - stage_started) * 1000)
        logger.error(f"Stage {stage_func.__name__} crashed: {exc}", exc_info=True)
        
        result = StageResult(
            stage_name=stage_func.__name__.lstrip("_stage_"),
            duration_ms=elapsed_ms,
            fields_changed=[],
            fields_rejected=[],
            warnings=[f"Stage execution crashed: {str(exc)}"],
            exception=str(exc)
        )
        ctx.stage_reports.append(result)


def process_passport(file_path: str, step_callback: StepCallback | None = None) -> dict[str, object]:
    file_name = os.path.basename(file_path)
    started_at = time.perf_counter()
    stage_durations_ms: dict[str, int] = {}
    skipped_ocr_stages: list[str] = []
    panel_fallback_used = False
    visual_ocr_used = False

    def report_step(code: str, label: str, progress: float, console_message: str) -> None:
        logger.info(console_message)
        if step_callback is not None:
            step_callback(code, label, progress)

    report_step("start", "Menyiapkan file", 0.04, f"Processing: {file_name}")
    clear_passport_page_cache()
    clear_image_preprocess_cache()
    start_ocr_result_cache_session(file_path)
    reset_ocr_stats()
    reset_image_preprocessor_stats()
    reset_fast_location_ocr_stats()

    try:
        ocr_profile = _ocr_profile()
        ctx = ScanContext(
            file_path=file_path,
            file_name=file_name,
            ocr_profile=ocr_profile,
            ocr_budget_ms=_ocr_budget_ms(ocr_profile),
            step_callback=step_callback
        )
        ctx.started_at = started_at
        
        execute_safe_stage(_stage_mrz, ctx)
        execute_safe_stage(_stage_initial_panel, ctx)
        execute_safe_stage(_stage_visual_fields, ctx)
        execute_safe_stage(_stage_speed_adaptive_recovery, ctx)
        execute_safe_stage(_stage_recovery_panel, ctx)
        execute_safe_stage(_stage_visual_recovery, ctx)
        execute_safe_stage(_stage_fallback_panel, ctx)
        execute_safe_stage(_stage_dates_recovery, ctx)
        execute_safe_stage(_stage_names_recovery, ctx)
        
        return _stage_validation_and_metrics(ctx)
    except Exception as exc:  # noqa: BLE001
        if step_callback is not None:
            step_callback("error", "Gagal memproses file", 0.0)
        record = build_error_record(file_name, file_path, str(exc))
        record["errorCode"] = "OCR_PASSPORT_PROCESSING_FAILED"
        record["processingMetrics"] = {
            "totalMs": _elapsed_ms(started_at),
            "stagesMs": stage_durations_ms,
            "panelFallbackUsed": panel_fallback_used,
            "visualOcrUsed": visual_ocr_used,
            "mrzFallbackUsed": bool(locals().get("mrz_error", "")),
            "ocrProfile": _ocr_profile(),
            "budgetMs": _ocr_budget_ms(),
            "elapsedMs": _elapsed_ms(started_at),
            "budgetExceeded": _budget_exceeded(started_at, _ocr_budget_ms()),
            "skippedStages": list(skipped_ocr_stages),
            "ocrCache": get_ocr_result_cache_stats(),
            "rapidocr": get_ocr_stats(),
            "imagePreprocessor": get_image_preprocessor_stats(),
            "ocrMode": "DEEP",
            "ocrModeReasons": ["PROCESSING_EXCEPTION"],
        }
        return record
    finally:
        clear_passport_page_cache()
        clear_image_preprocess_cache()
        end_ocr_result_cache_session()
        reset_ocr_stats()
        reset_image_preprocessor_stats()

MANIFEST_IMAGE_PATH_FIELDS = (
    "passportImagePath",
    "originalPassportImagePath",
    "croppedPassportImagePath",
    "nusukUploadImagePath",
)
MANIFEST_PREP_METADATA_PATH_FIELDS = (
    "sourcePath",
    "originalScanPath",
    "scanPath",
    "editedPath",
)


def write_manifest(group_id: str, group_dir: str, members: list[dict[str, object]]) -> None:
    output_dir = group_dir
    _normalize_member_image_paths_for_manifest(members, output_dir)

    manifest = {
        "schemaVersion": "passport-manifest-v1",
        "groupId": group_id,
        "contractVersion": "passport-extracted-resolved-profile-v4",
        "members": members,
    }
    manifest_path = os.path.join(output_dir, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as file_handle:
        json.dump(manifest, file_handle, indent=2, ensure_ascii=False)


def _normalize_member_image_paths_for_manifest(members: list[dict[str, object]], manifest_dir: str) -> None:
    for member in members:
        if not isinstance(member, dict):
            continue
        for field_name in MANIFEST_IMAGE_PATH_FIELDS:
            if field_name in member:
                member[field_name] = _manifest_relative_output_path(str(member.get(field_name) or ""), manifest_dir)

        prep_metadata = member.get("imagePrepMetadata")
        if isinstance(prep_metadata, dict):
            for field_name in MANIFEST_PREP_METADATA_PATH_FIELDS:
                if field_name in prep_metadata:
                    prep_metadata[field_name] = _manifest_relative_output_path(
                        str(prep_metadata.get(field_name) or ""),
                        manifest_dir,
                    )


def _manifest_relative_output_path(path: str, manifest_dir: str) -> str:
    text = str(path or "").strip()
    if not text:
        return ""

    resolved = _resolve_output_path_reference(text, manifest_dir)
    try:
        return os.path.relpath(resolved, manifest_dir).replace(os.sep, "/")
    except ValueError:
        return _normalize_filesystem_path(resolved).replace(os.sep, "/")


def _resolve_output_path_reference(path: str, manifest_dir: str) -> str:
    normalized_path = _normalize_filesystem_path(path)
    if os.path.isabs(normalized_path):
        return os.path.abspath(normalized_path)

    search_roots = [
        manifest_dir,
        ROOT_DIR,
        os.getcwd(),
    ]
    for root in search_roots:
        candidate = os.path.abspath(os.path.join(root, normalized_path))
        if os.path.exists(candidate):
            return candidate
    return os.path.abspath(os.path.join(manifest_dir, normalized_path))




def print_summary(members: list[dict[str, object]]) -> None:
    valid_count = sum(1 for member in members if member.get("status") == "VALID")
    error_count = len(members) - valid_count
    review_count = sum(1 for member in members if member.get("reviewStatus") == "NEEDS_REVIEW")
    logger.info(f"Processed {len(members)} files: {valid_count} VALID, {error_count} ERROR, {review_count} NEEDS_REVIEW")


def main() -> None:
    cleanup_temp_root()
    try:
        group_id, group_dir = resolve_group_context()
        passports_dir = resolve_passports_dir(group_dir)
        passport_files = list_passport_files(passports_dir)
        if not passport_files:
            raise SystemExit(f"No passport images found in: {passports_dir}")

        members = [process_passport(file_path) for file_path in passport_files]
        write_manifest(group_id, group_dir, members)
        print_summary(members)
    finally:
        cleanup_temp_root()


if __name__ == "__main__":
    main()













