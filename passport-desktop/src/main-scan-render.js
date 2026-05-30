import { formatDurationMs, formatProgressValue } from "./main-utils.js";
import { scanTimingSummary } from "./main-metrics.js";

export function renderProgressPanelView({ dom, state, members = [] }) {
  const total = state.progressTotal || state.totalFiles || 0;
  const current = Math.min(state.progressCurrent || 0, total || 0);
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
  const lastLog = state.lastWorkerMessage || state.scanLogs[state.scanLogs.length - 1] || "";
  const timing = scanTimingSummary({
    scanPerfSummary: state.scanPerfSummary,
    lastScanMetric: state.lastScanMetric,
    scanMetricRecords: state.scanMetricRecords,
    members,
  });

  dom.progressTitle.textContent = state.isScanning
    ? `Proses berjalan ${percentage}%`
    : state.manifestPath
      ? "Proses selesai"
      : "Belum ada proses aktif";

  if (state.progressFileName && state.progressStageLabel) {
    dom.progressCaption.textContent =
      `${state.progressFileName} | ${state.progressStageLabel} | ${formatProgressValue(current)}/${total || "?"}`;
  } else if (state.progressFileName) {
    dom.progressCaption.textContent = `${state.progressFileName} | ${formatProgressValue(current)}/${total || "?"}`;
  } else if (state.isScanning) {
    dom.progressCaption.textContent = lastLog || "Menunggu pembaruan proses...";
  } else {
    dom.progressCaption.textContent = "Progress akan tampil di sini saat proses berjalan.";
  }

  dom.progressFill.style.width = `${percentage}%`;
  dom.progressFill.parentElement?.setAttribute("aria-valuenow", String(percentage));

  if (dom.scanStatTotal) {
    dom.scanStatTotal.textContent = String(total || 0);
  }
  if (dom.scanStatDone) {
    dom.scanStatDone.textContent = String(Math.floor(current || 0));
  }
  if (dom.scanStatLeft) {
    dom.scanStatLeft.textContent = String(Math.max((total || 0) - Math.floor(current || 0), 0));
  }
  if (dom.scanStatAverage) {
    dom.scanStatAverage.textContent = formatDurationMs(timing.avgTotalMs);
  }
  if (dom.scanStatLastTime) {
    dom.scanStatLastTime.textContent = formatDurationMs(timing.latest?.totalMs);
  }

  if (dom.scanConsoleState) {
    const status = scanConsoleStatusDescriptor(state);
    dom.scanConsoleState.textContent = status.label;
    dom.scanConsoleState.className = `status-chip ${status.tone}`;
  }
}

export function renderScanLogsView({ dom, state }) {
  const logs = state.scanLogs;
  if (!logs.length) {
    dom.scanLogBox.textContent = "Menunggu proses dimulai...";
    dom.logCounter.textContent = "0 log";
    if (dom.scanLogToggle) {
      dom.scanLogToggle.disabled = true;
      dom.scanLogToggle.textContent = "Detail";
    }
    return;
  }

  const visibleLogs = state.showFullScanLog ? logs : logs.slice(-2);
  dom.scanLogBox.textContent = visibleLogs.join("\n");
  dom.logCounter.textContent = `${logs.length} log`;
  if (dom.scanLogToggle) {
    dom.scanLogToggle.disabled = false;
    dom.scanLogToggle.textContent = state.showFullScanLog ? "Ringkas" : "Detail";
  }
}

export function refreshCompactLogsForState(state, members = []) {
  state.scanLogs = compactScanLogs(state, members);
}

export function compactScanLogs(state, members = []) {
  const total = Number(state.progressTotal || state.totalFiles || 0);
  const completed = Math.min(Math.max(Math.floor(Number(state.progressCurrent || 0)), 0), total || 0);
  const active = state.isScanning && state.progressFileName && state.progressStageLabel !== "Selesai" ? 1 : 0;
  const remaining = Math.max(total - completed - active, 0);
  const lines = [];

  if (total > 0) {
    lines.push(`${completed} selesai | +${active} aktif | -${remaining} sisa`);
  } else if (state.isScanning) {
    lines.push("Menyiapkan scan...");
  }

  if (state.progressFileName && active) {
    lines.push(`${state.progressFileName} | ${state.progressStageLabel || "Sedang bekerja"}`);
  }

  if (state.lastWorkerMessage) {
    const lastLine = lines[lines.length - 1] || "";
    if (lastLine !== state.lastWorkerMessage) {
      lines.push(state.lastWorkerMessage);
    }
  }

  if (!state.isScanning && state.manifestPath) {
    const timing = scanTimingSummary({
      scanPerfSummary: state.scanPerfSummary,
      lastScanMetric: state.lastScanMetric,
      scanMetricRecords: state.scanMetricRecords,
      members,
    });
    const timingText = timing.filesWithMetrics > 0 ? ` | avg ${formatDurationMs(timing.avgTotalMs)}` : "";
    lines.push(`Hasil akhir | VALID ${state.validCount} | REVIEW ${state.reviewCount} | ERROR ${state.errorCount}${timingText}`);
  }

  return lines.slice(-3);
}

export function scanConsoleStatusDescriptor(state) {
  if (state.isScanning) {
    return { label: "Berjalan", tone: "info" };
  }
  if (state.manifestPath) {
    return { label: "Selesai", tone: "ready" };
  }
  return { label: "Menunggu", tone: "neutral" };
}
