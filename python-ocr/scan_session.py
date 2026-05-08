from __future__ import annotations

import os
import re
import shutil
from dataclasses import dataclass
from typing import Callable

from main import has_passport_folder, process_passport, resolve_passports_dir, write_manifest
from services.image_preprocessor import cleanup_temp_root
from services.nusuk_manifest import build_error_record
from services.pdf_image_converter import PdfImageConversionResult, convert_pdf_to_images

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
PDF_EXTENSION = ".pdf"
SCAN_INPUT_EXTENSIONS = IMAGE_EXTENSIONS | {PDF_EXTENSION}
PDF_IMAGE_DIR_NAME = ".passport-assistant-pdf-images"
MAX_NESTED_SCAN_TARGET_DEPTH = 2
ProgressCallback = Callable[[int, int, str], None]
StageCallback = Callable[[int, int, str, str, str, float], None]
MetricsCallback = Callable[[int, int, str, dict[str, object]], None]
LogCallback = Callable[[str], None]


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


@dataclass(frozen=True)
class PreparedScanInputs:
    source_files: list[str]
    passport_files: list[str]
    error_records: list[dict[str, object]]
    converted_count: int = 0

    @property
    def total_targets(self) -> int:
        return len(self.passport_files) + len(self.error_records)


def resolve_scan_target(selected_dir: str) -> ScanTarget:
    selected_dir = selected_dir.strip()
    if not selected_dir:
        raise FileNotFoundError("Folder not found: empty path")

    normalized = os.path.abspath(selected_dir)
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
        "Folder yang dipilih harus berisi file passport JPG, PNG, atau PDF secara langsung, "
        "di subfolder, atau di folder passport/passports."
    )


def scan_selected_directory(
    selected_dir: str,
    progress_callback: ProgressCallback | None = None,
    stage_callback: StageCallback | None = None,
    metrics_callback: MetricsCallback | None = None,
    prepared_inputs: PreparedScanInputs | None = None,
) -> ScanResult:
    target = resolve_scan_target(selected_dir)
    inputs = prepared_inputs or prepare_scan_inputs(target)
    if not inputs.passport_files and not inputs.error_records:
        raise FileNotFoundError(f"No passport images or PDF files found in: {target.passports_dir}")

    cleanup_temp_root()
    try:
        members = _scan_passport_files(
            inputs.passport_files,
            error_records=inputs.error_records,
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


def list_scan_source_files(passports_dir: str) -> list[str]:
    if not os.path.isdir(passports_dir):
        raise FileNotFoundError(f"Passport folder not found: {passports_dir}")

    files: list[str] = []
    for root, dir_names, file_names in os.walk(passports_dir):
        _prune_ignored_scan_dirs(dir_names)
        for file_name in sorted(file_names):
            file_path = os.path.join(root, file_name)
            if _is_scan_input_file(file_path):
                files.append(file_path)
    return sorted(
        files,
        key=lambda path: (
            _relative_depth(os.path.dirname(path), passports_dir),
            os.path.relpath(path, passports_dir).lower(),
        ),
    )


def prepare_scan_inputs(target: ScanTarget, log_callback: LogCallback | None = None) -> PreparedScanInputs:
    source_files = list_scan_source_files(target.passports_dir)
    if not source_files:
        raise FileNotFoundError(f"No passport images or PDF files found in: {target.passports_dir}")

    pdf_output_dir = os.path.join(target.group_dir, PDF_IMAGE_DIR_NAME)
    pdf_files = [path for path in source_files if os.path.splitext(path)[1].lower() == PDF_EXTENSION]
    if pdf_files:
        _reset_pdf_output_dir(pdf_output_dir)

    passport_files: list[str] = []
    error_records: list[dict[str, object]] = []
    converted_count = 0

    for file_path in source_files:
        extension = os.path.splitext(file_path)[1].lower()
        if extension in IMAGE_EXTENSIONS:
            passport_files.append(file_path)
            continue

        if extension != PDF_EXTENSION:
            continue

        file_name = os.path.basename(file_path)
        if log_callback is not None:
            log_callback(f"Mengubah PDF ke JPG: {file_name}")
        try:
            conversion = convert_pdf_to_images(file_path, pdf_output_dir)
            converted_paths, skipped_records = _pdf_conversion_outputs(file_name, conversion)
            if not converted_paths:
                error_records.append(build_error_record(file_name, file_path, "PDF tidak memiliki halaman yang bisa diproses."))
                continue
            passport_files.extend(converted_paths)
            error_records.extend(skipped_records)
            converted_count += len(converted_paths)
            if log_callback is not None:
                log_callback(f"PDF selesai dikonversi: {file_name} -> {len(converted_paths)} JPG")
        except Exception as exc:  # noqa: BLE001
            error_records.append(build_error_record(file_name, file_path, str(exc)))
            if log_callback is not None:
                log_callback(f"PDF gagal dikonversi: {file_name} | {exc}")

    return PreparedScanInputs(
        source_files=source_files,
        passport_files=passport_files,
        error_records=error_records,
        converted_count=converted_count,
    )


def _pdf_conversion_outputs(file_name: str, conversion: object) -> tuple[list[str], list[dict[str, object]]]:
    if isinstance(conversion, PdfImageConversionResult):
        return list(conversion.selected_paths), []
    return list(conversion or []), []


def _build_skipped_pdf_page_record(
    source_file_name: str,
    image_path: str,
    page_index: int,
    page_scores: list[int],
) -> dict[str, object]:
    page_number = page_index + 1 if page_index >= 0 else 0
    score = page_scores[page_index] if 0 <= page_index < len(page_scores) else 0
    file_name = os.path.basename(image_path)
    record = build_error_record(
        file_name,
        image_path,
        (
            "PDF page skipped by passport preflight. "
            "Kemungkinan halaman endorsement/non-biodata; hapus dari review jika tidak diperlukan."
        ),
    )
    record["errorCode"] = "PDF_PAGE_SKIPPED_BY_PREFLIGHT"
    record["pdfSourceFileName"] = source_file_name
    record["pdfPageNumber"] = page_number
    record["pdfPreflightScore"] = score
    record["processingMetrics"] = {
        "totalMs": 0,
        "stagesMs": {},
        "panelFallbackUsed": False,
        "visualOcrUsed": False,
        "mrzFallbackUsed": False,
        "ocrMode": "SKIPPED",
        "ocrModeReasons": ["PDF_PREFLIGHT_NON_PASSPORT_PAGE"],
    }
    return record


def _page_index_from_converted_path(path: str) -> int:
    match = re.search(r"_page_(\d+)\.[^.]+$", os.path.basename(path), re.IGNORECASE)
    if not match:
        return -1
    return max(0, int(match.group(1)) - 1)


def _scan_passport_files(
    passport_files: list[str],
    error_records: list[dict[str, object]] | None = None,
    progress_callback: ProgressCallback | None = None,
    stage_callback: StageCallback | None = None,
    metrics_callback: MetricsCallback | None = None,
) -> list[dict[str, object]]:
    members: list[dict[str, object]] = []
    queued_errors = error_records or []
    total_files = len(passport_files) + len(queued_errors)
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

    offset = len(passport_files)
    for error_index, record in enumerate(queued_errors, start=1):
        index = offset + error_index
        file_name = str(record.get("fileName") or "passport.pdf")
        if progress_callback is not None:
            progress_callback(index - 1, total_files, file_name)
        if stage_callback is not None:
            stage_callback(index - 1, total_files, file_name, "error", "PDF gagal dikonversi", 1.0)
        members.append(record)
        if progress_callback is not None:
            progress_callback(index, total_files, file_name)
    return members


def _looks_like_passports_dir(directory: str) -> bool:
    if os.path.basename(directory).lower() in {"passport", "passports"}:
        return True

    if _has_direct_scan_input_file(directory):
        return True

    return _has_nested_scan_input_file(directory, max_depth=MAX_NESTED_SCAN_TARGET_DEPTH)


def _has_direct_scan_input_file(directory: str) -> bool:
    with os.scandir(directory) as entries:
        for entry in entries:
            if entry.is_file() and _is_scan_input_file(entry.name):
                return True
    return False


def _has_nested_scan_input_file(directory: str, *, max_depth: int) -> bool:
    for root, dir_names, file_names in os.walk(directory):
        depth = _relative_depth(root, directory)
        _prune_ignored_scan_dirs(dir_names)
        if depth >= max_depth:
            dir_names.clear()
        for file_name in file_names:
            if _is_scan_input_file(file_name):
                return True
    return False


def _relative_depth(path: str, root: str) -> int:
    relative_path = os.path.relpath(path, root)
    if relative_path == ".":
        return 0
    return len(relative_path.split(os.sep))


def _prune_ignored_scan_dirs(dir_names: list[str]) -> None:
    dir_names[:] = sorted(
        name
        for name in dir_names
        if name != PDF_IMAGE_DIR_NAME and not name.startswith(".")
    )


def _is_scan_input_file(path: str) -> bool:
    return os.path.splitext(path)[1].lower() in SCAN_INPUT_EXTENSIONS


def _reset_pdf_output_dir(output_dir: str) -> None:
    if os.path.basename(output_dir) != PDF_IMAGE_DIR_NAME:
        raise RuntimeError(f"Unexpected PDF output directory: {output_dir}")
    if os.path.isdir(output_dir):
        shutil.rmtree(output_dir, ignore_errors=True)
    os.makedirs(output_dir, exist_ok=True)
