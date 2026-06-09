import { formatDurationMs, formatProgressValue } from "../../shared/utils.js";
import { scanTimingSummary } from "../../shared/metrics.js";

export function renderProgressPanelView({ dom, state, members = [] }) {
  const progress = progressSnapshotForState(state);
  const total = progress.total;
  const current = progress.current;
  const percentage = progress.percentage;
  const lastLog = state.lastWorkerMessage || state.scanLogs[state.scanLogs.length - 1] || "";
  const timing = scanTimingSummary({
    scanPerfSummary: state.scanPerfSummary,
    lastScanMetric: state.lastScanMetric,
    scanMetricRecords: state.scanMetricRecords,
    members,
  });

  dom.progressTitle.textContent = progress.title;

  if (progress.caption) {
    dom.progressCaption.textContent = progress.caption;
  } else if (state.progressFileName && state.progressStageLabel) {
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
  const progressTrack = dom.progressFill.parentElement;
  progressTrack?.setAttribute("aria-valuenow", String(percentage));
  progressTrack?.classList?.toggle("is-active", Boolean(state.isScanning));
  progressTrack?.classList?.toggle("is-complete", Boolean(!state.isScanning && percentage >= 100 && total > 0));
  renderAnimatedProgressView({ dom, state, total, current, percentage });

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
  if (dom.scanStatEta) {
    const remaining = Math.max((total || 0) - Math.floor(current || 0), 0);
    const avgMs = Number(timing.avgTotalMs || 0);
    dom.scanStatEta.textContent = state.isScanning && remaining > 0 && avgMs > 0
      ? formatDurationMs(remaining * avgMs)
      : "-";
  }

  if (dom.scanConsoleState) {
    const status = scanConsoleStatusDescriptor(state);
    dom.scanConsoleState.textContent = status.label;
    dom.scanConsoleState.className = `status-chip ${status.tone}`;
  }
}

function renderAnimatedProgressView({ dom, state, total, current, percentage }) {
  if (dom.progressPercent) {
    dom.progressPercent.textContent = `${percentage}%`;
  }
  if (dom.progressRing) {
    dom.progressRing.style.setProperty("--progress-angle", `${percentage * 3.6}deg`);
    dom.progressRing.classList.toggle("is-active", Boolean(state.isScanning));
    dom.progressRing.classList.toggle("is-complete", Boolean(!state.isScanning && percentage >= 100 && total > 0));
  }
  if (dom.progressStage) {
    dom.progressStage.textContent = state.isScanning
      ? state.progressStageLabel || "Memproses OCR"
      : percentage >= 100 && total > 0
        ? "Proses selesai"
        : "Menunggu OCR";
  }
  if (dom.progressFile) {
    if (state.progressFileName) {
      dom.progressFile.textContent = `${state.progressFileName} | ${formatProgressValue(current)}/${total || "?"}`;
    } else if (state.isScanning) {
      dom.progressFile.textContent = "Menyiapkan antrean file";
    } else {
      dom.progressFile.textContent = "Belum ada file aktif";
    }
  }
  if (dom.scanActivityDots) {
    dom.scanActivityDots.classList.toggle("is-active", Boolean(state.isScanning));
    dom.scanActivityDots.classList.toggle("is-complete", Boolean(!state.isScanning && percentage >= 100 && total > 0));
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
  const total = Math.max(0, Number(state.progressTotal || state.totalFiles || 0));
  const completed = Math.min(Math.max(Math.floor(Number(state.progressCurrent || 0)), 0), total || 0);
  const active = state.isScanning && state.progressFileName && state.progressStageLabel !== "Selesai" ? 1 : 0;
  const remaining = Math.max(total - completed - active, 0);
  const preparedCount = preparedItemCount(state);
  const editedCount = preparedEditedCount(state);
  const lines: string[] = [];

  if (state.isPreparingImages) {
    lines.push("Menyiapkan foto untuk preview...");
  } else if (state.isScanning && total > 0) {
    lines.push(`${completed} selesai | ${active} aktif | ${remaining} sisa`);
  } else if (state.isScanning) {
    lines.push("Menyiapkan scan...");
  } else if (!state.manifestPath && preparedCount > 0) {
    lines.push(`Preview siap | ${preparedCount} foto`);
    if (editedCount > 0) {
      lines.push(`${editedCount} foto sudah dirapikan`);
    }
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
  if (state.isPreparingImages) {
    return { label: "Menyiapkan", tone: "info" };
  }
  if (state.isScanning) {
    return { label: "Berjalan", tone: "info" };
  }
  if (state.manifestPath) {
    return { label: "Selesai", tone: "ready" };
  }
  if (preparedItemCount(state) > 0) {
    return { label: "Siap Preview", tone: "ready" };
  }
  return { label: "Menunggu", tone: "neutral" };
}

export function progressSnapshotForState(state) {
  const preparedCount = preparedItemCount(state);
  if (state.isPreparingImages) {
    const total = Math.max(0, Number(state.progressTotal || state.totalFiles || preparedCount || 0));
    const current = clampProgressValue(state.progressCurrent, total);
    return {
      total,
      current,
      percentage: total > 0 ? Math.round((current / total) * 100) : 0,
      title: "Menyiapkan foto",
      caption: "PDF sedang dikonversi dan daftar preview sedang dibuat.",
    };
  }

  if (!state.isScanning && !state.manifestPath && preparedCount > 0) {
    return {
      total: preparedCount,
      current: preparedCount,
      percentage: 100,
      title: "Preview foto siap",
      caption: `${preparedCount} foto siap dirapikan sebelum scan OCR.`,
    };
  }

  const total = Math.max(0, Number(state.progressTotal || state.totalFiles || 0));
  const current = clampProgressValue(state.progressCurrent, total);
  return {
    total,
    current,
    percentage: total > 0 ? Math.round((current / total) * 100) : 0,
    title: state.isScanning
      ? `Proses berjalan ${total > 0 ? Math.round((current / total) * 100) : 0}%`
      : state.manifestPath
        ? "Proses selesai"
        : "Belum ada proses aktif",
    caption: "",
  };
}

function clampProgressValue(value, total) {
  const numeric = Number(value || 0);
  const safeValue = Number.isFinite(numeric) ? numeric : 0;
  const safeTotal = Math.max(0, Number(total || 0));
  return Math.min(Math.max(safeValue, 0), safeTotal || 0);
}

function preparedItemCount(state) {
  const items = state.preparedSession?.items;
  return Array.isArray(items) ? items.length : 0;
}

function preparedEditedCount(state) {
  const items = state.preparedSession?.items;
  return Array.isArray(items) ? items.filter((item) => Boolean(item?.editedPath)).length : 0;
}
