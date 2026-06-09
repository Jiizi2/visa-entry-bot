import { formatDurationMs, formatProgressValue } from "../../shared/utils.js";
import { normalizeDurationMs } from "../../shared/metrics.js";
import { ocrModeLabel } from "../../shared/ocr.js";

const noop = () => {};

export async function setupScanEventBridge({
  listen,
  state,
  appendScanLog = (message?: any, level?: any) => {},
  rememberRecentBatch = (path?: any, totalFiles?: any, manifestPath?: any) => {},
  renderAll = () => {},
  scheduleRenderAll = () => {},
  loadManifest = () => {},
  closeStopScanModal = () => {},
}) {
  await listen("scan-event", async (event) => {
    await handleScanEventPayload(event?.payload, {
      state,
      appendScanLog,
      rememberRecentBatch,
      renderAll,
      scheduleRenderAll,
      loadManifest,
      closeStopScanModal,
    });
  });
}

export async function handleScanEventPayload(payload, {
  state,
  appendScanLog = (message?: any, level?: any) => {},
  rememberRecentBatch = (path?: any, totalFiles?: any, manifestPath?: any) => {},
  renderAll = () => {},
  scheduleRenderAll = () => {},
  loadManifest = () => {},
  closeStopScanModal = () => {},
}) {
  if (!payload || typeof payload !== "object") {
    return;
  }

  switch (payload.event) {
    case "scan_started":
      state.isScanning = true;
      state.isStartingScan = false;
      state.isStoppingScan = false;
      state.currentPage = "scan";
      state.totalFiles = Number(payload.totalFiles ?? 0);
      state.progressTotal = Number(payload.totalFiles ?? 0);
      state.progressCurrent = 0;
      state.progressFileName = "";
      state.progressStageLabel = "Menyiapkan antrean scan";
      state.scanPerfSummary = null;
      state.scanMetricRecords = [];
      state.lastScanMetric = null;
      state.statusHeadline = "Scan sedang berjalan";
      state.statusDetail = `Menyiapkan ${payload.totalFiles ?? 0} dokumen dari ${payload.groupId ?? "-"}.`;
      appendScanLog(`Mulai proses ${payload.totalFiles ?? 0} dokumen | grup ${payload.groupId ?? "-"} | OCR ${ocrModeLabel(payload.ocrProfile || state.ocrMode)}`);
      rememberRecentBatch(state.selectedDir, payload.totalFiles);
      renderAll();
      break;
    case "scan_stage":
      state.isScanning = true;
      state.isStartingScan = false;
      state.progressCurrent = Number(payload.current ?? 0) + Number(payload.fileProgress ?? 0);
      state.progressTotal = Number(payload.total ?? state.progressTotal ?? 0);
      state.progressFileName = payload.fileName ?? "";
      state.progressStageLabel = payload.message ?? "Sedang bekerja";
      state.statusHeadline = "Proses berjalan";
      state.statusDetail = state.progressFileName
        ? `${state.progressFileName} | ${state.progressStageLabel}`
        : state.progressStageLabel;
      appendScanLog(formatStageLog(payload));
      scheduleRenderAll();
      break;
    case "scan_progress": {
      const previousFileName = state.progressFileName;
      const previousProgress = Number(state.progressCurrent ?? 0);
      const currentProgress = Number(payload.current ?? 0);
      const totalProgress = Number(payload.total ?? state.progressTotal ?? 0);
      const currentFileName = payload.fileName ?? "";
      const isNewFile = Boolean(currentFileName) && currentFileName !== previousFileName;
      const isCompletedFile =
        Boolean(currentFileName) &&
        currentFileName === previousFileName &&
        currentProgress > Math.floor(previousProgress);

      state.isScanning = true;
      state.isStartingScan = false;
      state.progressCurrent = currentProgress;
      state.progressTotal = totalProgress;
      state.progressFileName = currentFileName;
      state.progressStageLabel = currentProgress >= totalProgress && totalProgress > 0
        ? "Selesai"
        : isCompletedFile
          ? "Selesai"
          : isNewFile
            ? "Menyiapkan file"
            : state.progressStageLabel || "Sedang bekerja";
      state.statusHeadline = "Proses berjalan";
      state.statusDetail = state.progressFileName
        ? `${state.progressFileName} | ${state.progressStageLabel}`
        : "Sedang memproses dokumen.";

      if (isNewFile) {
        appendScanLog(`Mulai ${currentFileName} (${Math.min(currentProgress + 1, totalProgress)}/${totalProgress || "?"})`);
      }
      if (isCompletedFile) {
        appendScanLog(`Selesai ${currentFileName} (${formatProgressValue(currentProgress)}/${totalProgress || "?"})`);
      }

      scheduleRenderAll();
      break;
    }
    case "scan_cancel_requested":
      state.isStoppingScan = true;
      state.statusHeadline = "Menghentikan scan";
      state.statusDetail = payload.message ?? "Worker OCR sedang dihentikan.";
      appendScanLog(payload.message ?? "Permintaan stop scan dikirim.");
      scheduleRenderAll();
      break;
    case "scan_stopped":
      state.isScanning = false;
      state.isStartingScan = false;
      state.isStoppingScan = false;
      state.progressStageLabel = "Dihentikan";
      state.statusHeadline = "Scan dihentikan";
      state.statusDetail = payload.message ?? "Proses scan dihentikan oleh pengguna.";
      appendScanLog(`Scan dihentikan | ${state.progressFileName || "worker OCR"}`);
      closeStopScanModal();
      renderAll();
      break;
    case "scan_complete":
      state.isScanning = false;
      state.isStartingScan = false;
      state.isStoppingScan = false;
      state.manifestPath = payload.manifestPath ?? "";
      state.resultDir = payload.groupDir ?? "";
      state.resultSourceDir = state.selectedDir;
      state.totalFiles = Number(payload.totalFiles ?? 0);
      state.validCount = Number(payload.validCount ?? 0);
      state.errorCount = Number(payload.errorCount ?? 0);
      state.reviewCount = Number(payload.reviewCount ?? 0);
      state.progressCurrent = state.totalFiles;
      state.progressTotal = state.totalFiles;
      state.progressStageLabel = "Semua file selesai";
      state.statusHeadline = "Scan selesai";
      state.statusDetail = `Manifest dibuat di ${state.resultDir || "-"}.`;
      appendScanLog(`Scan selesai | VALID ${payload.validCount ?? 0} | ERROR ${payload.errorCount ?? 0} | REVIEW ${payload.reviewCount ?? 0}`);
      rememberRecentBatch(state.selectedDir || state.resultDir, state.totalFiles, state.manifestPath);
      await loadManifest();
      state.currentPage = "validation";
      closeStopScanModal();
      renderAll();
      break;
    case "scan_error": {
      const code = String(payload.code ?? "SCAN_ERROR");
      const stage = String(payload.stage ?? "unknown");
      const message = String(payload.message ?? "Terjadi kegagalan worker.");
      const fatal = Boolean(payload.fatal);
      appendScanLog(`[${code}] ${message} (stage: ${stage})`);
      if (fatal) {
        state.isScanning = false;
        state.isStartingScan = false;
        state.isStoppingScan = false;
        state.progressStageLabel = "Gagal";
        state.statusHeadline = "Scan gagal";
        state.statusDetail = `[${code}] ${message}`;
        closeStopScanModal();
        renderAll();
      } else {
        scheduleRenderAll();
      }
      break;
    }
    case "scan_metric": {
      const fileName = String(payload.fileName ?? "");
      const metrics = payload.metrics && typeof payload.metrics === "object" ? payload.metrics : null;
      const totalMs = normalizeDurationMs(metrics?.totalMs);
      if (fileName && totalMs > 0) {
        const scanMetric = { fileName, totalMs, metrics };
        state.scanMetricRecords.push(scanMetric);
        state.lastScanMetric = scanMetric;
        appendScanLog(`Metrik ${fileName} | total ${formatDurationMs(totalMs)}`);
      }
      scheduleRenderAll();
      break;
    }
    case "scan_perf_summary": {
      const summary = payload.summary && typeof payload.summary === "object" ? payload.summary : null;
      if (summary) {
        state.scanPerfSummary = summary;
        const avg = Number(summary.avgTotalMs ?? 0);
        const p95 = Number(summary.p95TotalMs ?? 0);
        const max = Number(summary.maxTotalMs ?? 0);
        appendScanLog(`Ringkasan performa | avg ${formatDurationMs(avg)} | p95 ${formatDurationMs(p95)} | max ${formatDurationMs(max)}`);
      }
      scheduleRenderAll();
      break;
    }
    case "scan_failed":
      state.isScanning = false;
      state.isStartingScan = false;
      state.isStoppingScan = false;
      state.progressStageLabel = "Gagal";
      state.statusHeadline = "Scan gagal";
      state.statusDetail = payload.message ?? "Worker Python berhenti sebelum selesai.";
      appendScanLog(`Scan gagal | ${payload.message ?? "Worker Python berhenti sebelum selesai."}`);
      closeStopScanModal();
      renderAll();
      break;
    case "scan_log":
      if (state.isScanning && !state.progressFileName) {
        state.statusHeadline = "Proses sedang berjalan";
      }
      state.statusDetail = payload.message ?? state.statusDetail;
      appendScanLog(payload.message ?? "Log worker kosong.");
      scheduleRenderAll();
      break;
    default:
      break;
  }
}

export function formatStageLog(payload) {
  const fileName = payload.fileName ?? "passport";
  const label = payload.message ?? "Sedang bekerja";
  return `${fileName} | ${label}`;
}
