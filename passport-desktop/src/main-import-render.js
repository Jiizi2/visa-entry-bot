import { basenameFromPath, escapeHtml, formatRecentStamp } from "./main-utils.js";
import { normalizeOcrMode } from "./main-ocr.js";

export function renderImportPageView({
  dom,
  state,
  hasAnyScanResult,
  hasScanResultForSelectedDir,
}) {
  dom.folderPath.value = state.selectedDir;
  renderOcrModeSelectorView({ dom, state });

  if (state.selectedDir) {
    dom.selectedFolderName.textContent = basenameFromPath(state.selectedDir);
    dom.selectedFolderCaption.textContent = state.selectedDir;
  } else {
    dom.selectedFolderName.textContent = "Belum ada folder dipilih";
    dom.selectedFolderCaption.textContent = "Pilih folder berisi JPG, PNG, atau PDF passport untuk mulai memproses data.";
  }

  dom.importFooterText.textContent = importFooterMessage({
    state,
    hasAnyScanResult,
    hasScanResultForSelectedDir,
  });
  const hasAnyResult = hasAnyScanResult();
  const hasResultForSelected = hasScanResultForSelectedDir();
  dom.importNextButton?.classList.toggle("is-hidden", !hasResultForSelected);
  dom.scanButton.className = hasAnyResult ? "secondary-button" : "primary-action";
  dom.scanButton.textContent = state.isStartingScan
    ? "Menyiapkan..."
    : state.isScanning
    ? state.isStoppingScan
      ? "Menghentikan..."
      : "Sedang Memproses..."
    : !state.selectedDir
      ? "Pilih Folder Dulu"
      : hasResultForSelected
        ? "Scan Ulang Folder Ini"
        : hasAnyResult
          ? "Proses Folder Ini"
          : "Mulai Proses";
  dom.scanButton.setAttribute("aria-busy", state.isScanning || state.isStartingScan ? "true" : "false");
  if (dom.stopScanButton) {
    dom.stopScanButton.classList.toggle("is-hidden", !state.isScanning);
    dom.stopScanButton.textContent = state.isStoppingScan ? "Menghentikan..." : "Stop Scan";
    dom.stopScanButton.setAttribute("aria-busy", state.isStoppingScan ? "true" : "false");
  }

  renderMiniStatus(dom.systemOcrStatus, ocrStatusDescriptor({
    state,
    hasAnyScanResult,
    hasScanResultForSelectedDir,
  }));
  renderMiniStatus(dom.systemValidationStatus, { label: "Siap", tone: "ready" });
  renderMiniStatus(dom.systemRuntimeStatus, { label: "Tersedia", tone: "ready" });
  renderRecentBatchesView({ dom, state });
}

export function renderOcrModeSelectorView({ dom, state }) {
  for (const input of dom.ocrModeInputs || []) {
    const mode = normalizeOcrMode(input.value);
    input.checked = mode === normalizeOcrMode(state.ocrMode);
    input.disabled = state.isScanning;
  }
}

export function importFooterMessage({
  state,
  hasAnyScanResult,
  hasScanResultForSelectedDir,
}) {
  if (state.isStoppingScan) {
    return "Worker OCR sedang dihentikan. Tunggu sampai status berubah sebelum memilih folder lain.";
  }
  if (state.isScanning) {
    return "";
  }
  if (hasAnyScanResult() && !hasScanResultForSelectedDir() && state.selectedDir) {
    const activeFolder = basenameFromPath(state.resultSourceDir || state.resultDir || "-");
    const selectedFolder = basenameFromPath(state.selectedDir);
    return `Data aktif saat ini berasal dari folder ${activeFolder}. Jika lanjut, proses akan mengganti data dengan folder ${selectedFolder}.`;
  }
  if (hasScanResultForSelectedDir()) {
    return `Proses terakhir sudah selesai. ${state.validCount} data siap dipakai, ${state.reviewCount} perlu review, dan ${state.errorCount} error.`;
  }
  return "";
}

export function ocrStatusDescriptor({
  state,
  hasAnyScanResult,
  hasScanResultForSelectedDir,
}) {
  if (state.isStoppingScan) {
    return { label: "Menghentikan", tone: "warn" };
  }
  if (state.isScanning) {
    return { label: "Sedang Jalan", tone: "info" };
  }
  if (hasAnyScanResult() && !hasScanResultForSelectedDir()) {
    return { label: "Data Lama Aktif", tone: "warn" };
  }
  if (state.selectedDir || state.manifestPath) {
    return { label: "Siap", tone: "ready" };
  }
  return { label: "Menunggu", tone: "idle" };
}

export function renderMiniStatus(node, descriptor) {
  if (!node) {
    return;
  }
  node.textContent = descriptor.label;
  node.className = `mini-status ${descriptor.tone}`;
}

export function renderRecentBatchesView({ dom, state }) {
  if (!state.recentBatches.length) {
    dom.recentBatchesList.innerHTML = `<div class="friendly-empty">Belum ada folder yang pernah dipilih.</div>`;
    return;
  }

  dom.recentBatchesList.innerHTML = state.recentBatches
    .map((entry) => {
      const countLabel = Number(entry.totalFiles) > 0 ? `${entry.totalFiles} file` : "folder";
      const label = entry.label || basenameFromPath(entry.path);
      return `
        <div class="recent-item" role="button" tabindex="0" data-recent-path="${escapeHtml(entry.path)}">
          <span class="recent-icon" aria-hidden="true"></span>
          <span class="recent-body">
            <strong>${escapeHtml(label)}</strong>
            <span class="recent-meta">${escapeHtml(formatRecentStamp(entry.usedAt))}</span>
          </span>
          <span class="recent-count">${escapeHtml(countLabel)}</span>
          <span class="recent-actions" aria-label="Aksi riwayat">
            <button
              class="recent-action-button"
              type="button"
              data-recent-edit-path="${escapeHtml(entry.path)}"
              aria-label="${escapeHtml(`Edit ${label}`)}"
              title="Edit nama"
            >
              ${renderRecentActionIcon("edit")}
            </button>
            <button
              class="recent-action-button danger"
              type="button"
              data-recent-delete-path="${escapeHtml(entry.path)}"
              aria-label="${escapeHtml(`Hapus ${label}`)}"
              title="Hapus dari riwayat"
            >
              ${renderRecentActionIcon("delete")}
            </button>
          </span>
        </div>
      `;
    })
    .join("");
}

export function renderRecentActionIcon(type) {
  if (type === "delete") {
    return `
      <svg class="recent-action-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 3h6l1 2h4v2H4V5h4l1-2Z"></path>
        <path d="M6 9h12l-1 11H7L6 9Z"></path>
      </svg>
    `;
  }
  return `
    <svg class="recent-action-svg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 17.5V20h2.5L18.2 9.3l-2.5-2.5L5 17.5Z"></path>
      <path d="m17 5.5 1.2-1.2a1.6 1.6 0 0 1 2.3 2.3L19.3 8 17 5.5Z"></path>
    </svg>
  `;
}
