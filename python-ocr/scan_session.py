from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Callable

from main import has_passport_folder, list_passport_files, process_passport, resolve_passports_dir, write_manifest
from services.image_preprocessor import cleanup_temp_root

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
ProgressCallback = Callable[[int, int, str], None]
StageCallback = Callable[[int, int, str, str, str, float], None]
MetricsCallback = Callable[[int, int, str, dict[str, object]], None]


@dataclass(frozen=True)
class ScanTarget:
    group_id: str
    group_dir: str
    passports_dir: str


@dataclass(frozen=True)
class ScanResult:
    group_id: str
    group_dir: str
    passports_dir: str
    manifest_path: str
    members: list[dict[str, object]]


def resolve_scan_target(selected_dir: str) -> ScanTarget:
    normalized = os.path.abspath(selected_dir.strip())
    if not normalized or not os.path.isdir(normalized):
        raise FileNotFoundError(f"Folder not found: {selected_dir}")

    if has_passport_folder(normalized):
        return ScanTarget(
            group_id=os.path.basename(normalized),
            group_dir=normalized,
            passports_dir=resolve_passports_dir(normalized),
        )

    if _looks_like_passports_dir(normalized):
        folder_name = os.path.basename(normalized).lower()
        if folder_name in {"passport", "passports"}:
            group_dir = os.path.dirname(normalized) or normalized
            group_id = os.path.basename(group_dir) or os.path.basename(normalized) or "scan-session"
            return ScanTarget(group_id=group_id, group_dir=group_dir, passports_dir=normalized)

        group_id = os.path.basename(normalized) or "scan-session"
        return ScanTarget(group_id=group_id, group_dir=normalized, passports_dir=normalized)

    raise FileNotFoundError(
        "Selected folder must contain passport images directly or include a passport/passports subfolder."
    )


def scan_selected_directory(
    selected_dir: str,
    progress_callback: ProgressCallback | None = None,
    stage_callback: StageCallback | None = None,
    metrics_callback: MetricsCallback | None = None,
) -> ScanResult:
    target = resolve_scan_target(selected_dir)
    passport_files = list_passport_files(target.passports_dir)
    if not passport_files:
        raise FileNotFoundError(f"No passport images found in: {target.passports_dir}")

    cleanup_temp_root()
    try:
        members = _scan_passport_files(
            passport_files,
            progress_callback=progress_callback,
            stage_callback=stage_callback,
            metrics_callback=metrics_callback,
        )
        write_manifest(target.group_id, target.group_dir, members)
        manifest_path = os.path.join(target.group_dir, "manifest.json")
        return ScanResult(
            group_id=target.group_id,
            group_dir=target.group_dir,
            passports_dir=target.passports_dir,
            manifest_path=manifest_path,
            members=members,
        )
    finally:
        cleanup_temp_root()


def _scan_passport_files(
    passport_files: list[str],
    progress_callback: ProgressCallback | None = None,
    stage_callback: StageCallback | None = None,
    metrics_callback: MetricsCallback | None = None,
) -> list[dict[str, object]]:
    members: list[dict[str, object]] = []
    total_files = len(passport_files)
    for index, file_path in enumerate(passport_files, start=1):
        file_name = os.path.basename(file_path)
        if progress_callback is not None:
            progress_callback(index - 1, total_files, file_name)
        if stage_callback is not None:
            stage_callback(index - 1, total_files, file_name, "start", "Menyiapkan file", 0.04)

        def on_step(stage_code: str, stage_label: str, file_progress: float) -> None:
            if stage_callback is not None:
                stage_callback(index - 1, total_files, file_name, stage_code, stage_label, file_progress)

        member = process_passport(file_path, step_callback=on_step)
        members.append(member)
        if metrics_callback is not None:
            metrics = member.get("processingMetrics", {})
            if isinstance(metrics, dict):
                metrics_callback(index - 1, total_files, file_name, metrics)
        if stage_callback is not None:
            stage_callback(index - 1, total_files, file_name, "complete", "Selesai", 1.0)
        if progress_callback is not None:
            progress_callback(index, total_files, file_name)
    return members


def _looks_like_passports_dir(directory: str) -> bool:
    if os.path.basename(directory).lower() in {"passport", "passports"}:
        return True

    with os.scandir(directory) as entries:
        for entry in entries:
            if entry.is_file() and os.path.splitext(entry.name)[1].lower() in IMAGE_EXTENSIONS:
                return True
    return False
