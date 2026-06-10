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
  const hasAnyResult = hasAnyScanResult();
  const hasResultForSelected = hasScanResultForSelectedDir();
  const hasPreparedForSelected = hasPreparedSessionForSelectedDir(state);

  // Render default entry input values
  if (dom.defaultProfession) dom.defaultProfession.value = state.defaultProfession || "";
  if (dom.defaultMaritalStatus) dom.defaultMaritalStatus.value = state.defaultMaritalStatus || "";
  if (dom.defaultPassportType) dom.defaultPassportType.value = state.defaultPassportType || "";
  if (dom.defaultEmail) dom.defaultEmail.value = state.defaultEmail || "";
  if (dom.defaultMobileNumber) dom.defaultMobileNumber.value = state.defaultMobileNumber || "";

  // Render active defaults count badge
  let activeCount = 0;
  if (state.defaultProfession) activeCount++;
  if (state.defaultMaritalStatus) activeCount++;
  if (state.defaultPassportType) activeCount++;
  if (state.defaultEmail) activeCount++;
  if (state.defaultMobileNumber) activeCount++;
  if (dom.activeDefaultsBadge) {
    dom.activeDefaultsBadge.textContent = `${activeCount} default aktif`;
  }

  // Update disabled states for defaults form
  const defaultsBusy = Boolean(state.isScanning || state.isPreparingImages);
  if (dom.defaultProfession) dom.defaultProfession.disabled = defaultsBusy;
  if (dom.defaultMaritalStatus) dom.defaultMaritalStatus.disabled = defaultsBusy;
  if (dom.defaultPassportType) dom.defaultPassportType.disabled = defaultsBusy;
  if (dom.defaultEmail) dom.defaultEmail.disabled = defaultsBusy;
  if (dom.defaultMobileNumber) dom.defaultMobileNumber.disabled = defaultsBusy;
  if (dom.applyDefaultButton) {
    const hasMembers = Boolean(state.manifest?.members?.length);
    dom.applyDefaultButton.disabled = defaultsBusy || !hasMembers;
  }

  if (state.selectedDir) {
    dom.selectedFolderName.textContent = basenameFromPath(state.selectedDir);
    dom.selectedFolderCaption.textContent = state.selectedDir;
  } else {
    dom.selectedFolderName.textContent = "Belum ada folder dipilih";
    dom.selectedFolderCaption.textContent = "Pilih folder berisi JPG, PNG, atau PDF passport untuk mulai memproses data.";
  }

  dom.importFooterText.textContent = importFooterMessage({
    state,
    hasAnyScanResult: () => hasAnyResult,
    hasScanResultForSelectedDir: () => hasResultForSelected,
  });
  renderImportPhaseView({
    dom,
    phases: importPhaseDescriptors({
      state,
      hasPreparedForSelected,
      hasResultForSelected,
    }),
  });
  dom.importNextButton?.classList.toggle("is-hidden", !hasResultForSelected);
  dom.scanButton.className = hasPreparedForSelected ? "secondary-button" : "primary-action";
  dom.scanButton.textContent = state.isStartingScan
    ? state.isPreparingImages
      ? "Menyiapkan Foto..."
      : "Menyiapkan..."
    : state.isPreparingImages
      ? "Menyiapkan Foto..."
    : !state.selectedDir
      ? "Pilih Folder Dulu"
      : hasPreparedForSelected
        ? "Buka Review Foto"
        : "Siapkan Foto";
  dom.scanButton.setAttribute("aria-busy", state.isStartingScan || state.isPreparingImages ? "true" : "false");
  if (dom.stopScanButton) {
    dom.stopScanButton.classList.toggle("is-hidden", !state.isScanning);
    dom.stopScanButton.textContent = state.isStoppingScan ? "Menghentikan..." : "Stop Scan";
    dom.stopScanButton.setAttribute("aria-busy", state.isStoppingScan ? "true" : "false");
  }

  renderMiniStatus(dom.systemOcrStatus, ocrStatusDescriptor({
    state,
    hasAnyScanResult: () => hasAnyResult,
    hasScanResultForSelectedDir: () => hasResultForSelected,
  }));
  renderMiniStatus(dom.systemValidationStatus, { label: "Siap", tone: "ready" });
  renderMiniStatus(dom.systemRuntimeStatus, { label: "Tersedia", tone: "ready" });
  renderLastScanSummary({ dom, state, hasAnyResult });
  renderRecentBatchesView({ dom, state });
}

export function renderOcrModeSelectorView({ dom, state }) {
  for (const input of dom.ocrModeInputs || []) {
    const mode = normalizeOcrMode(input.value);
    const checked = mode === normalizeOcrMode(state.ocrMode);
    input.checked = checked;
    input.disabled = Boolean(state.isScanning || state.isPreparingImages);
    const parentLabel = typeof input.closest === "function" ? input.closest(".ocr-radio-card") : null;
    if (parentLabel) {
      parentLabel.classList.toggle("is-active", checked);
    }
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
  if (state.isPreparingImages) {
    return "Sedang menyiapkan foto. Setelah preview tampil, crop atau rotate foto yang perlu dirapikan.";
  }
  if (state.isScanning) {
    return "Scan sedang berjalan di halaman Progress OCR.";
  }
  if (hasScanResultForSelectedDir()) {
    return `Proses terakhir sudah selesai. ${state.validCount} data siap dipakai, ${state.reviewCount} perlu review, dan ${state.errorCount} error.`;
  }
  if (state.preparedSession && hasPreparedSessionForSelectedDir(state)) {
    return "Preview foto sudah siap. Buka halaman persiapan untuk crop, rotate, hapus foto, lalu mulai scan.";
  }
  if (hasAnyScanResult() && !hasScanResultForSelectedDir() && state.selectedDir) {
    const activeFolder = basenameFromPath(state.resultSourceDir || state.resultDir || "-");
    const selectedFolder = basenameFromPath(state.selectedDir);
    return `Data aktif saat ini berasal dari folder ${activeFolder}. Jika lanjut, proses akan mengganti data dengan folder ${selectedFolder}.`;
  }
  if (state.selectedDir) {
    return "Siapkan foto terlebih dahulu agar PDF diubah ke gambar dan preview bisa dirapikan sebelum OCR.";
  }
  return "";
}

export function renderLastScanSummary({ dom, state, hasAnyResult }) {
  if (!dom.lastScanTitle || !dom.lastScanDetail || !dom.lastScanStatus || !dom.lastScanOpenButton) {
    return;
  }

  if (!hasAnyResult) {
    dom.lastScanTitle.textContent = "Belum ada hasil scan";
    dom.lastScanDetail.textContent = "Setelah scan selesai, ringkasan hasil terakhir akan tampil di sini.";
    dom.lastScanStatus.textContent = "Menunggu";
    dom.lastScanStatus.className = "status-chip neutral";
    dom.lastScanOpenButton.disabled = true;
    dom.lastScanOpenButton.setAttribute("aria-disabled", "true");
    return;
  }

  const valid = Number(state.validCount || 0);
  const review = Number(state.reviewCount || 0);
  const error = Number(state.errorCount || 0);
  dom.lastScanTitle.textContent = basenameFromPath(state.resultSourceDir || state.resultDir || state.selectedDir || "Scan terakhir");
  dom.lastScanDetail.textContent = `${valid} valid, ${review} perlu review, ${error} error. Manifest: ${state.manifestPath || "-"}`;
  dom.lastScanStatus.textContent = error > 0 || review > 0 ? "Perlu Review" : "Siap";
  dom.lastScanStatus.className = `status-chip ${error > 0 || review > 0 ? "warn" : "ready"}`;
  dom.lastScanOpenButton.disabled = false;
  dom.lastScanOpenButton.setAttribute("aria-disabled", "false");
}

export function ocrStatusDescriptor({
  state,
  hasAnyScanResult,
  hasScanResultForSelectedDir,
}) {
  if (state.isPreparingImages) {
    return { label: "Prepare Foto", tone: "info" };
  }
  if (state.isStoppingScan) {
    return { label: "Menghentikan", tone: "warn" };
  }
  if (state.isScanning) {
    return { label: "Sedang Jalan", tone: "info" };
  }
  if (hasAnyScanResult() && !hasScanResultForSelectedDir()) {
    return { label: "Data Lama Aktif", tone: "warn" };
  }
  if (state.preparedSession && hasPreparedSessionForSelectedDir(state)) {
    return { label: "Preview Siap", tone: "ready" };
  }
  if (state.selectedDir || state.manifestPath) {
    return { label: "Siap", tone: "ready" };
  }
  return { label: "Menunggu", tone: "idle" };
}

export function importPhaseDescriptors({
  state,
  hasPreparedForSelected = hasPreparedSessionForSelectedDir(state),
  hasResultForSelected = false,
}) {
  const preparedCount = preparedItemCount(state);
  const folderState = state.selectedDir ? "complete" : "active";
  const previewState = state.isPreparingImages
    ? "active"
    : hasPreparedForSelected && !hasResultForSelected
      ? "active"
      : hasPreparedForSelected
        ? "complete"
        : "pending";
  const scanState = state.isScanning
    ? "active"
    : hasResultForSelected
      ? "complete"
      : "pending";

  return [
    {
      id: "folder",
      state: folderState,
      caption: state.selectedDir ? "Folder dipilih" : "Menunggu folder",
    },
    {
      id: "preview",
      state: previewState,
      caption: state.isPreparingImages
        ? "Menyiapkan foto"
        : hasPreparedForSelected
          ? `${preparedCount} foto siap preview`
          : "Belum disiapkan",
    },
    {
      id: "scan",
      state: scanState,
      caption: state.isScanning
        ? "Sedang OCR"
        : hasResultForSelected
          ? "Scan selesai"
          : "Belum discan",
    },
  ];
}

export function renderImportPhaseView({ dom, phases }) {
  const phaseById = new Map((phases || []).map((phase) => [phase.id, phase]));
  for (const step of dom.importPhaseSteps || []) {
    const phase = phaseById.get(step.dataset?.importPhase || "");
    if (!phase) {
      continue;
    }
    step.classList.toggle("is-active", phase.state === "active");
    step.classList.toggle("is-complete", phase.state === "complete");
    step.classList.toggle("is-pending", phase.state === "pending");
    step.setAttribute("aria-current", phase.state === "active" ? "step" : "false");
    const caption = step.querySelector?.("[data-import-phase-caption]");
    if (caption) {
      caption.textContent = phase.caption;
    }
  }
}

function hasPreparedSessionForSelectedDir(state) {
  const preparedPath = normalizePathForCompare(state.preparedSession?.selectedDir || "");
  const selectedPath = normalizePathForCompare(state.selectedDir || "");
  return Boolean(preparedPath && selectedPath && preparedPath === selectedPath && state.preparedSession?.preparedManifestPath);
}

function normalizePathForCompare(path) {
  return String(path ?? "")
    .trim()
    .replace(/[\\/]+$/, "")
    .replace(/\//g, "\\")
    .toLowerCase();
}

function preparedItemCount(state) {
  const items = state.preparedSession?.items;
  return Array.isArray(items) ? items.length : 0;
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
