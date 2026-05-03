from __future__ import annotations

import contextlib
import io
import json
import statistics
import sys
import threading


def emit(event: str, **payload: object) -> None:
    message = {"event": event}
    message.update(payload)
    stream = getattr(sys, "__stdout__", sys.stdout)
    print(json.dumps(message, ensure_ascii=False), file=stream, flush=True)


def emit_error(code: str, message: str, *, stage: str = "", fatal: bool = False, details: dict[str, object] | None = None) -> None:
    payload: dict[str, object] = {"code": code, "message": message, "fatal": fatal}
    if stage:
        payload["stage"] = stage
    if details:
        payload["details"] = details
    emit("scan_error", **payload)
    if fatal:
        emit("scan_failed", message=f"[{code}] {message}")


def summarize_scan_metrics(members: list[dict[str, object]]) -> dict[str, object]:
    total_ms_values: list[int] = []
    panel_fallback_used = 0
    visual_ocr_used = 0
    mrz_fallback_used = 0
    for member in members:
        metrics = member.get("processingMetrics", {})
        if not isinstance(metrics, dict):
            continue
        total_ms = metrics.get("totalMs")
        if isinstance(total_ms, int):
            total_ms_values.append(total_ms)
        if metrics.get("panelFallbackUsed"):
            panel_fallback_used += 1
        if metrics.get("visualOcrUsed"):
            visual_ocr_used += 1
        if metrics.get("mrzFallbackUsed"):
            mrz_fallback_used += 1

    if not total_ms_values:
        return {
            "filesWithMetrics": 0,
            "avgTotalMs": 0,
            "p95TotalMs": 0,
            "maxTotalMs": 0,
            "panelFallbackUsed": panel_fallback_used,
            "visualOcrUsed": visual_ocr_used,
            "mrzFallbackUsed": mrz_fallback_used,
        }

    sorted_values = sorted(total_ms_values)
    p95_index = min(len(sorted_values) - 1, max(0, int(len(sorted_values) * 0.95) - 1))
    return {
        "filesWithMetrics": len(total_ms_values),
        "avgTotalMs": int(statistics.fmean(total_ms_values)),
        "p95TotalMs": sorted_values[p95_index],
        "maxTotalMs": max(total_ms_values),
        "panelFallbackUsed": panel_fallback_used,
        "visualOcrUsed": visual_ocr_used,
        "mrzFallbackUsed": mrz_fallback_used,
    }


def start_boot_heartbeat() -> threading.Event:
    stop_event = threading.Event()

    def heartbeat() -> None:
        elapsed_seconds = 0
        while not stop_event.wait(8):
            elapsed_seconds += 8
            emit(
                "scan_log",
                message=f"Worker Python masih memuat engine OCR... ({elapsed_seconds} detik)",
            )

    thread = threading.Thread(target=heartbeat, name="ocr-worker-heartbeat", daemon=True)
    thread.start()
    return stop_event


def main() -> int:
    if len(sys.argv) < 2 or not sys.argv[1].strip():
        print("Usage: python scan_worker.py <folder>", file=sys.stderr)
        return 2

    selected_dir = sys.argv[1].strip()
    emit("scan_log", message="Worker Python aktif. Memuat engine OCR...")
    boot_heartbeat = start_boot_heartbeat()

    try:
        from main import list_passport_files
        from scan_session import resolve_scan_target, scan_selected_directory
    except Exception as exc:  # noqa: BLE001
        emit_error("OCR_BOOT_FAILURE", str(exc), stage="bootstrap", fatal=True)
        return 1
    finally:
        boot_heartbeat.set()

    emit("scan_log", message="Engine OCR siap. Memeriksa folder passport...")

    def on_progress(done: int, total: int, file_name: str) -> None:
        emit("scan_progress", current=done, total=total, fileName=file_name)

    def on_stage(done: int, total: int, file_name: str, stage: str, message: str, file_progress: float) -> None:
        emit(
            "scan_stage",
            current=done,
            total=total,
            fileName=file_name,
            stage=stage,
            message=message,
            fileProgress=file_progress,
        )

    def on_metrics(done: int, total: int, file_name: str, metrics: dict[str, object]) -> None:
        emit(
            "scan_metric",
            current=done,
            total=total,
            fileName=file_name,
            metrics=metrics,
        )

    try:
        target = resolve_scan_target(selected_dir)
        passport_files = list_passport_files(target.passports_dir)
        emit(
            "scan_log",
            message=f"Menemukan {len(passport_files)} passport di {target.passports_dir}.",
        )
        emit(
            "scan_started",
            groupId=target.group_id,
            groupDir=target.group_dir,
            passportsDir=target.passports_dir,
            totalFiles=len(passport_files),
        )
        with contextlib.redirect_stdout(io.StringIO()):
            result = scan_selected_directory(
                selected_dir,
                progress_callback=on_progress,
                stage_callback=on_stage,
                metrics_callback=on_metrics,
            )
    except Exception as exc:  # noqa: BLE001
        emit_error("SCAN_EXECUTION_FAILED", str(exc), stage="scan_session", fatal=True)
        return 1

    performance_summary = summarize_scan_metrics(result.members)
    emit("scan_perf_summary", summary=performance_summary)
    emit(
        "scan_log",
        message=(
            "Performa OCR | "
            f"avg {performance_summary['avgTotalMs']}ms | "
            f"p95 {performance_summary['p95TotalMs']}ms | "
            f"max {performance_summary['maxTotalMs']}ms | "
            f"panel {performance_summary['panelFallbackUsed']} | "
            f"visual {performance_summary['visualOcrUsed']} | "
            f"mrz fallback {performance_summary['mrzFallbackUsed']}"
        ),
    )

    valid_count = sum(1 for member in result.members if member.get("status") == "VALID")
    error_count = len(result.members) - valid_count
    emit(
        "scan_complete",
        groupId=result.group_id,
        groupDir=result.group_dir,
        passportsDir=result.passports_dir,
        manifestPath=result.manifest_path,
        totalFiles=len(result.members),
        validCount=valid_count,
        errorCount=error_count,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
