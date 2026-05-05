import {
  basenameFromPath,
  parentPath,
  formatRecentStamp,
  formatConfidence,
  formatProgressValue,
  nestedArrayValue,
  nestedStringValue,
  nestedNumberValue,
  pathParts,
  valueByPath,
  setValueByPath,
  dateValueForInput,
  normalizeDateToNusuk,
  normalizeText,
  cloneJson,
  uniqueValues,
  escapeHtml,
} from "./main-utils.js";
import {
  REVIEW_FIELDS,
  FIELD_CATEGORY_DEFS,
  FIELD_CATEGORY_PAIRS,
  maxLengthForField,
  clampFieldValue,
  normalizeInputValueForField,
  isDateFieldKey,
} from "./main-fields.js";
import {
  humanizeFieldPath,
} from "./main-review-helpers.js";
import {
  fieldStateDescriptor,
  actionableIssuesForMember,
  splitNotes,
  renderEmptyDetailPanel,
  renderReviewFlagsPanel,
  renderFieldConfidencePanel,
} from "./main-review-panels.js";
import {
  countMembersByStatus as countMembersByStatusFromMembers,
  computeReviewCompletionState,
  computeTotalEntryTargetCount,
  buildEntryFlowSteps,
  renderEntryFlowSteps,
  entryStatusLabel,
  entryStatusTone,
  isEntryAccessible as isEntryAccessibleForState,
} from "./main-entry.js";
import {
  buildRememberedRecentBatches,
  loadRecentBatches as loadRecentBatchesFromStorage,
  saveRecentBatches as saveRecentBatchesToStorage,
} from "./main-recent-batches.js";

function tauriBindings() {
  const tauri = window.__TAURI__;
  if (!tauri?.core || !tauri?.event || !tauri?.dialog || !tauri?.opener) {
    throw new Error("Binding Tauri belum tersedia di jendela aplikasi.");
  }

  return {
    invoke: tauri.core.invoke,
    listen: tauri.event.listen,
    open: tauri.dialog.open,
    openPath: tauri.opener.openPath,
    openUrl: tauri.opener.openUrl,
  };
}

const STORAGE_KEYS = {
  recentBatches: "passport-assistant-recent-batches-v1",
};

const CHILD_AGE_LIMIT = 18;

const state = {
  currentPage: "import",
  validationFilter: "all",
  selectedDir: "",
  recentBatches: [],
  nusukUrl: "https://masar.nusuk.sa/umrah/mutamer/add-mutamer",
  manifest: null,
  originalManifest: null,
  manifestPath: "",
  resultDir: "",
  resultSourceDir: "",
  activeMemberId: "",
  selectedIds: new Set(),
  reviewedMemberIds: new Set(),
  passportListPage: 1,
  passportListPageSize: 8,
  totalFiles: 0,
  validCount: 0,
  errorCount: 0,
  progressCurrent: 0,
  progressTotal: 0,
  progressFileName: "",
  progressStageLabel: "",
  isEntryRunning: false,
  exportedBatchPath: "",
  entryLogs: [],
  lastWorkerMessage: "",
  scanLogs: [],
  scanPerfSummary: null,
  showFullScanLog: false,
  activeFieldCategory: "identity",
  statusHeadline: "Menunggu folder dipilih",
  statusDetail: "Belum ada proses scan yang berjalan.",
  isScanning: false,
};

const dom = {};
let rescanConfirmResolver = null;
const requestFrame = typeof window.requestAnimationFrame === "function"
  ? window.requestAnimationFrame.bind(window)
  : (callback) => window.setTimeout(callback, 16);
const cancelFrame = typeof window.cancelAnimationFrame === "function"
  ? window.cancelAnimationFrame.bind(window)
  : (handle) => window.clearTimeout(handle);
let renderAllHandle = null;
let renderAllQueued = false;

window.addEventListener("error", (event) => {
  showFatalScreen(event.error?.message || event.message || "Terjadi error yang tidak diketahui.");
});

window.addEventListener("unhandledrejection", (event) => {
  const message = event.reason instanceof Error
    ? event.reason.message
    : String(event.reason ?? "Promise ditolak tanpa pesan.");
  showFatalScreen(message);
});

window.addEventListener("DOMContentLoaded", async () => {
  try {
    state.recentBatches = loadRecentBatches();
    bindDom();
    bindActions();
    await setupEventBridge();
    renderAll();
  } catch (error) {
    showFatalScreen(error instanceof Error ? error.message : String(error));
  }
});

function bindDom() {
  dom.navButtons = [...document.querySelectorAll("button[data-page]")];
  dom.navConnectors = [...document.querySelectorAll("[data-step-connector]")];
  dom.pageImport = document.querySelector("#page-import");
  dom.pageValidation = document.querySelector("#page-validation");
  dom.pageEntry = document.querySelector("#page-entry");
  dom.topbarEyebrow = document.querySelector("#topbar-eyebrow");
  dom.topbarTitle = document.querySelector("#topbar-title");
  dom.topbarStatus = document.querySelector("#topbar-status");
  dom.globalNotice = document.querySelector("#global-notice");
  dom.globalNoticeTitle = document.querySelector("#global-notice-title");
  dom.globalNoticeDetail = document.querySelector("#global-notice-detail");

  dom.folderDropzone = document.querySelector("#folder-dropzone");
  dom.selectedFolderName = document.querySelector("#selected-folder-name");
  dom.selectedFolderCaption = document.querySelector("#selected-folder-caption");
  dom.importFooterText = document.querySelector("#import-footer-text");
  dom.folderPath = document.querySelector("#folder-path");
  dom.chooseFolderButton = document.querySelector("#choose-folder-button");
  dom.scanButton = document.querySelector("#scan-button");
  dom.importNextButton = document.querySelector("#import-next-button");
  dom.rescanConfirmModal = document.querySelector("#rescan-confirm-modal");
  dom.rescanModalTitle = document.querySelector("#rescan-modal-title");
  dom.rescanModalDesc = document.querySelector("#rescan-modal-desc");
  dom.rescanConfirmButton = document.querySelector("#rescan-confirm-button");
  dom.rescanCancelButton = document.querySelector("#rescan-cancel-button");
  dom.recentBatchesList = document.querySelector("#recent-batches-list");
  dom.systemOcrStatus = document.querySelector("#system-ocr-status");
  dom.systemValidationStatus = document.querySelector("#system-validation-status");
  dom.systemRuntimeStatus = document.querySelector("#system-runtime-status");

  dom.progressTitle = document.querySelector("#progress-title");
  dom.progressCaption = document.querySelector("#progress-caption");
  dom.progressFill = document.querySelector("#progress-fill");
  dom.scanLogBox = document.querySelector("#scan-log-box");
  dom.logCounter = document.querySelector("#log-counter");
  dom.scanConsoleState = document.querySelector("#scan-console-state");
  dom.scanLogToggle = document.querySelector("#scan-log-toggle");
  dom.scanStatTotal = document.querySelector("#scan-stat-total");
  dom.scanStatDone = document.querySelector("#scan-stat-done");
  dom.scanStatLeft = document.querySelector("#scan-stat-left");

  dom.batchBadge = document.querySelector("#batch-badge");
  dom.filterButtons = [...document.querySelectorAll("button[data-validation-filter]")];
  dom.filterAllCount = document.querySelector("#filter-all-count");
  dom.filterErrorCount = document.querySelector("#filter-error-count");
  dom.filterValidCount = document.querySelector("#filter-valid-count");
  dom.passportList = document.querySelector("#passport-list");
  dom.passportListSummary = document.querySelector("#passport-list-summary");
  dom.passportPagePrevButton = document.querySelector("#passport-page-prev-button");
  dom.passportPageNextButton = document.querySelector("#passport-page-next-button");
  dom.detailStatus = document.querySelector("#detail-status");
  dom.workspacePassportCode = document.querySelector("#workspace-passport-code");
  dom.detailTitle = document.querySelector("#detail-title");
  dom.detailSummary = document.querySelector("#detail-summary");
  dom.workspaceIssueBox = document.querySelector("#workspace-issue-box");
  dom.fieldCategoryTabs = document.querySelector("#field-category-tabs");
  dom.fieldReviewRows = document.querySelector("#field-review-rows");
  dom.reviewFlagsBox = document.querySelector("#review-flags-box");
  dom.fieldConfidenceBox = document.querySelector("#field-confidence-box");

  dom.resetFieldsButton = document.querySelector("#reset-fields-button");
  dom.nusukUrl = document.querySelector("#nusuk-url");
  dom.openNusukButton = document.querySelector("#open-nusuk-button");
  dom.prepareEntryButton = document.querySelector("#prepare-entry-button");
  dom.terminateEntryButton = document.querySelector("#terminate-entry-button");
  dom.entryProgressTitle = document.querySelector("#entry-progress-title");
  dom.entryProgressCount = document.querySelector("#entry-progress-count");
  dom.entryProgressFill = document.querySelector("#entry-progress-fill");
  dom.entryProgressCaption = document.querySelector("#entry-progress-caption");
  dom.entryFlowSteps = document.querySelector("#entry-flow-steps");
  dom.entryLogBox = document.querySelector("#entry-log-box");
  dom.entryLogCounter = document.querySelector("#entry-log-counter");
  dom.entryLogClearButton = document.querySelector("#entry-log-clear-button");
  dom.saveNextButton = document.querySelector("#save-next-button");
  dom.entryStatusPill = document.querySelector("#entry-status-pill");
  dom.entryBatchName = document.querySelector("#entry-batch-name");
  dom.entryValidCount = document.querySelector("#entry-valid-count");
  dom.entrySelectedCount = document.querySelector("#entry-selected-count");
  dom.workspacePrevButtons = [document.querySelector("#workspace-prev-button-top")].filter(Boolean);
  dom.workspaceNextButtons = [document.querySelector("#workspace-next-button-top")].filter(Boolean);
}

function bindActions() {
  for (const button of dom.navButtons) {
    button.addEventListener("click", () => {
      setPage(button.dataset.page);
    });
  }

  dom.folderPath.addEventListener("input", (event) => {
    updateSelectedDir(event.target.value);
    renderImportPage();
    updateActionAvailability();
  });

  dom.chooseFolderButton.addEventListener("click", (event) => {
    event.stopPropagation();
    void chooseFolder();
  });

  dom.folderDropzone.addEventListener("click", (event) => {
    if (state.isScanning || event.target.closest("button") || event.target.closest("input")) {
      return;
    }
    void chooseFolder();
  });

  dom.folderDropzone.addEventListener("keydown", (event) => {
    if (state.isScanning) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void chooseFolder();
    }
  });

  dom.scanButton.addEventListener("click", () => {
    void handleScanButtonClick();
  });
  dom.importNextButton?.addEventListener("click", () => {
    setPage("validation");
  });
  dom.rescanConfirmButton?.addEventListener("click", () => {
    resolveRescanConfirmation(true);
  });
  dom.rescanCancelButton?.addEventListener("click", () => {
    resolveRescanConfirmation(false);
  });
  dom.rescanConfirmModal?.addEventListener("click", (event) => {
    if (event.target === dom.rescanConfirmModal) {
      resolveRescanConfirmation(false);
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !dom.rescanConfirmModal?.classList.contains("is-hidden")) {
      resolveRescanConfirmation(false);
    }
  });
  dom.scanLogToggle?.addEventListener("click", () => {
    state.showFullScanLog = !state.showFullScanLog;
    renderScanLogs();
  });

  dom.recentBatchesList.addEventListener("click", (event) => {
    const item = event.target.closest("[data-recent-path]");
    if (!item) {
      return;
    }
    const recentPath = String(item.dataset.recentPath ?? "").trim();
    if (!recentPath) {
      return;
    }
    void openRecentBatch(recentPath);
  });

  for (const button of dom.filterButtons) {
    button.addEventListener("click", () => {
      state.validationFilter = button.dataset.validationFilter ?? "all";
      state.passportListPage = 1;
      ensureVisibleActiveMember();
      renderAll();
      scrollPassportListToTop();
    });
  }

  dom.passportList.addEventListener("click", (event) => {
    const row = event.target.closest("[data-member-id]");
    if (!row) {
      return;
    }

    state.activeMemberId = row.dataset.memberId ?? "";
    syncPassportPageWithActiveMember();
    renderAll();
  });

  dom.fieldReviewRows.addEventListener("change", (event) => {
    const companionSelect = event.target.closest("select[data-companion-select]");
    if (companionSelect) {
      updateActiveMemberCompanion(companionSelect.value);
      scheduleRenderAll();
      return;
    }

    const input = event.target.closest("input[data-field-key]");
    if (!input) {
      return;
    }

    updateActiveMemberField(input.dataset.fieldKey, input.value);
    scheduleRenderAll();
  });

  dom.resetFieldsButton.addEventListener("click", resetActiveMemberFields);
  dom.saveNextButton?.addEventListener("click", handleSaveAndNext);
  dom.fieldCategoryTabs?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-field-category]");
    if (!button) {
      return;
    }
    state.activeFieldCategory = button.dataset.fieldCategory ?? "identity";
    renderWorkspace();
  });
  dom.passportPagePrevButton?.addEventListener("click", () => {
    changePassportListPage(-1);
  });
  dom.passportPageNextButton?.addEventListener("click", () => {
    changePassportListPage(1);
  });

  for (const button of dom.workspacePrevButtons) {
    button.addEventListener("click", () => {
      moveActiveMember(-1);
    });
  }

  for (const button of dom.workspaceNextButtons) {
    button.addEventListener("click", () => {
      moveActiveMember(1);
    });
  }

  dom.nusukUrl.addEventListener("input", (event) => {
    state.nusukUrl = event.target.value.trim();
    updateActionAvailability();
  });

  dom.openNusukButton.addEventListener("click", handleOpenNusuk);
  dom.prepareEntryButton.addEventListener("click", handlePrepareEntry);
  dom.terminateEntryButton?.addEventListener("click", () => {
    void handleTerminateEntry();
  });
  dom.entryLogClearButton?.addEventListener("click", () => {
    state.entryLogs = [];
    renderEntryLogs();
  });
}

async function setupEventBridge() {
  const { listen } = tauriBindings();
  await listen("scan-event", async (event) => {
    const payload = event.payload;
    if (!payload || typeof payload !== "object") {
      return;
    }

    switch (payload.event) {
      case "scan_started":
        state.isScanning = true;
        state.totalFiles = Number(payload.totalFiles ?? 0);
        state.progressTotal = Number(payload.totalFiles ?? 0);
        state.progressCurrent = 0;
        state.progressFileName = "";
        state.progressStageLabel = "Menyiapkan antrean scan";
        state.statusHeadline = "Scan sedang berjalan";
        state.statusDetail = `Menyiapkan ${payload.totalFiles ?? 0} dokumen dari ${payload.groupId ?? "-"}.`;
        appendScanLog(`Mulai proses ${payload.totalFiles ?? 0} dokumen | grup ${payload.groupId ?? "-"}`);
        rememberRecentBatch(state.selectedDir, payload.totalFiles);
        renderAll();
        break;
      case "scan_stage":
        state.isScanning = true;
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
      case "scan_complete":
        state.isScanning = false;
        state.manifestPath = payload.manifestPath ?? "";
        state.resultDir = payload.groupDir ?? "";
        state.resultSourceDir = state.selectedDir;
        state.totalFiles = Number(payload.totalFiles ?? 0);
        state.validCount = Number(payload.validCount ?? 0);
        state.errorCount = Number(payload.errorCount ?? 0);
        state.progressCurrent = state.totalFiles;
        state.progressTotal = state.totalFiles;
        state.progressStageLabel = "Semua file selesai";
        state.statusHeadline = "Scan selesai";
        state.statusDetail = `Manifest dibuat di ${state.resultDir || "-"}.`;
        appendScanLog(`Scan selesai | VALID ${payload.validCount ?? 0} | ERROR ${payload.errorCount ?? 0}`);
        rememberRecentBatch(state.selectedDir || state.resultDir, state.totalFiles, state.manifestPath);
        await loadManifest();
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
          state.progressStageLabel = "Gagal";
          state.statusHeadline = "Scan gagal";
          state.statusDetail = `[${code}] ${message}`;
          renderAll();
        } else {
          scheduleRenderAll();
        }
        break;
      }
      case "scan_metric": {
        const fileName = String(payload.fileName ?? "");
        const metrics = payload.metrics && typeof payload.metrics === "object" ? payload.metrics : null;
        const totalMs = Number(metrics?.totalMs ?? 0);
        if (fileName && totalMs > 0) {
          appendScanLog(`Metrik ${fileName} | total ${totalMs}ms`);
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
          appendScanLog(`Ringkasan performa | avg ${avg}ms | p95 ${p95}ms | max ${max}ms`);
        }
        scheduleRenderAll();
        break;
      }
      case "scan_failed":
        state.isScanning = false;
        state.progressStageLabel = "Gagal";
        state.statusHeadline = "Scan gagal";
        state.statusDetail = payload.message ?? "Worker Python berhenti sebelum selesai.";
        appendScanLog(`Scan gagal | ${payload.message ?? "Worker Python berhenti sebelum selesai."}`);
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
  });

}

async function chooseFolder() {
  const { open } = tauriBindings();
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Pilih folder passport",
  });

  if (typeof selected === "string") {
    updateSelectedDir(selected);
    renderAll();
  }
}

async function startScan() {
  state.selectedDir = dom.folderPath.value.trim();
  if (!state.selectedDir) {
    state.statusHeadline = "Folder belum dipilih";
    state.statusDetail = "Pilih folder passport atau folder grup sebelum memulai proses.";
    state.currentPage = "import";
    renderAll();
    return;
  }

  state.manifest = null;
  state.originalManifest = null;
  state.manifestPath = "";
  state.resultDir = "";
  state.resultSourceDir = "";
  state.activeMemberId = "";
  state.selectedIds = new Set();
  state.reviewedMemberIds = new Set();
  state.totalFiles = 0;
  state.validCount = 0;
  state.errorCount = 0;
  state.progressCurrent = 0;
  state.progressTotal = 0;
  state.progressFileName = "";
  state.progressStageLabel = "";
  state.lastWorkerMessage = "";
  state.scanLogs = [];
  state.scanPerfSummary = null;
  state.exportedBatchPath = "";
  state.validationFilter = "all";
  state.passportListPage = 1;
  state.isScanning = true;
  state.statusHeadline = "Memulai proses";
  state.statusDetail = "Sedang menyiapkan pembacaan data.";
  appendScanLog(`Memulai proses untuk folder ${state.selectedDir}`);
  renderAll();

  try {
    const { invoke } = tauriBindings();
    await invoke("start_scan", { selectedDir: state.selectedDir });
  } catch (error) {
    state.isScanning = false;
    state.statusHeadline = "Scan gagal dimulai";
    state.statusDetail = String(error);
    renderAll();
  }
}

async function handleScanButtonClick() {
  const hasAnyResult = hasAnyScanResult();
  const hasResultForSelected = hasScanResultForSelectedDir();
  if (hasAnyResult && !state.isScanning) {
    const mode = hasResultForSelected ? "rescan-same" : "replace-folder";
    const confirmed = await requestRescanConfirmation(mode);
    if (!confirmed) {
      return;
    }
  }
  await startScan();
}

function requestRescanConfirmation(mode = "rescan-same") {
  if (!dom.rescanConfirmModal || !dom.rescanConfirmButton || !dom.rescanCancelButton) {
    const fallbackCopy = mode === "replace-folder"
      ? "Folder baru akan mengganti data scan yang sedang aktif. Lanjut proses folder ini?"
      : "Hasil scan sebelumnya akan diganti. Lanjut scan ulang?";
    return Promise.resolve(window.confirm(fallbackCopy));
  }

  const currentFolder = basenameFromPath(state.selectedDir || "-");
  const previousFolder = basenameFromPath(state.resultSourceDir || state.resultDir || "-");
  if (dom.rescanModalTitle && dom.rescanModalDesc && dom.rescanConfirmButton) {
    if (mode === "replace-folder") {
      dom.rescanModalTitle.textContent = "Ganti folder aktif?";
      dom.rescanModalDesc.textContent = `Data aktif dari folder ${previousFolder} akan diganti dengan scan baru dari folder ${currentFolder}. Lanjutkan?`;
      dom.rescanConfirmButton.textContent = "Ya, Proses Folder Ini";
    } else {
      dom.rescanModalTitle.textContent = "Scan ulang folder ini?";
      dom.rescanModalDesc.textContent = `Hasil scan folder ${currentFolder} akan diganti dengan proses terbaru. Lanjutkan?`;
      dom.rescanConfirmButton.textContent = "Ya, Scan Ulang";
    }
  }

  dom.rescanConfirmModal.classList.remove("is-hidden");
  dom.rescanConfirmModal.setAttribute("aria-hidden", "false");
  dom.rescanConfirmButton.focus();

  return new Promise((resolve) => {
    rescanConfirmResolver = resolve;
  });
}

function resolveRescanConfirmation(confirmed) {
  if (!rescanConfirmResolver) {
    return;
  }
  const resolve = rescanConfirmResolver;
  rescanConfirmResolver = null;
  dom.rescanConfirmModal?.classList.add("is-hidden");
  dom.rescanConfirmModal?.setAttribute("aria-hidden", "true");
  resolve(Boolean(confirmed));
}

function normalizePathForCompare(path) {
  return String(path ?? "")
    .trim()
    .replace(/[\\/]+$/, "")
    .replace(/\//g, "\\")
    .toLowerCase();
}

function hasAnyScanResult() {
  return Boolean(state.manifestPath && state.manifest && manifestMembers().length);
}

function hasScanResultForPath(pathValue) {
  if (!hasAnyScanResult()) {
    return false;
  }
  const targetPath = normalizePathForCompare(pathValue);
  const activeSource = normalizePathForCompare(state.resultSourceDir || state.resultDir || "");
  if (!targetPath || !activeSource) {
    return false;
  }
  return targetPath === activeSource;
}

function hasScanResultForSelectedDir() {
  return hasScanResultForPath(state.selectedDir);
}

function updateSelectedDir(nextDir) {
  const nextValue = String(nextDir ?? "").trim();
  const previousValue = String(state.selectedDir ?? "").trim();
  if (nextValue === previousValue) {
    return;
  }

  state.selectedDir = nextValue;
  if (!nextValue || state.isScanning || !hasAnyScanResult()) {
    return;
  }

  if (!hasScanResultForPath(nextValue)) {
    const fromFolder = basenameFromPath(state.resultSourceDir || state.resultDir || "-");
    const toFolder = basenameFromPath(nextValue);
    state.statusHeadline = "Folder diubah";
    state.statusDetail = `Folder aktif berubah dari ${fromFolder} ke ${toFolder}. Klik Proses Folder Ini untuk mengganti data scan.`;
    state.currentPage = "import";
  }
}

async function loadManifest() {
  if (!state.manifestPath) {
    return;
  }

  const { invoke } = tauriBindings();
  const manifest = await invoke("load_manifest", { manifestPath: state.manifestPath });
  syncManifestChildMetadata(manifest);
  state.manifest = manifest;
  state.originalManifest = cloneJson(manifest);
  state.activeMemberId = firstMemberId(manifest);
  state.selectedIds = new Set(defaultSelectedIds(manifest));
  state.reviewedMemberIds = new Set();
  state.exportedBatchPath = "";
  ensureVisibleActiveMember();
}

async function openRecentBatch(path) {
  const normalizedPath = String(path ?? "").trim();
  if (!normalizedPath) {
    return;
  }

  state.selectedDir = normalizedPath;
  state.currentPage = "import";
  state.statusHeadline = "Memuat riwayat";
  state.statusDetail = `Mencari manifest dari ${basenameFromPath(normalizedPath)}.`;
  renderAll();

  try {
    let manifestPath = await resolveManifestPathForRecent(normalizedPath);
    if (!manifestPath) {
      state.manifestPath = "";
      state.manifest = null;
      state.originalManifest = null;
      state.activeMemberId = "";
      state.resultDir = "";
      state.resultSourceDir = "";
      state.statusHeadline = "Manifest belum ditemukan";
      state.statusDetail = "Folder dipilih. Jalankan scan jika folder ini belum punya manifest.json.";
      renderAll();
      return;
    }

    state.manifestPath = manifestPath;
    state.resultDir = parentPath(manifestPath);
    state.resultSourceDir = normalizedPath;

    try {
      await loadManifest();
    } catch (loadError) {
      const entry = state.recentBatches.find((item) => item.path === normalizedPath);
      const storedManifestPath = String(entry?.manifestPath ?? "").trim();
      const normalizedStored = normalizePathForCompare(storedManifestPath);
      const normalizedResolved = normalizePathForCompare(manifestPath);
      if (normalizedStored && normalizedStored === normalizedResolved) {
        const fallbackManifestPath = await detectManifestPathFromBasePath(normalizedPath);
        if (fallbackManifestPath && normalizePathForCompare(fallbackManifestPath) !== normalizedResolved) {
          manifestPath = fallbackManifestPath;
          state.manifestPath = manifestPath;
          state.resultDir = parentPath(manifestPath);
          state.resultSourceDir = normalizedPath;
          await loadManifest();
        } else {
          throw loadError;
        }
      } else {
        throw loadError;
      }
    }
    recalculateMetrics();
    state.passportListPage = 1;
    state.validationFilter = "all";
    state.activeFieldCategory = FIELD_CATEGORY_PAIRS[0]?.id ?? "identity";
    state.progressCurrent = state.totalFiles;
    state.progressTotal = state.totalFiles;
    state.progressFileName = "";
    state.progressStageLabel = "Data dimuat dari riwayat";
    state.statusHeadline = "Riwayat berhasil dimuat";
    state.statusDetail = `Manifest terbuka dari ${manifestPath}.`;
    rememberRecentBatch(normalizedPath, state.totalFiles, manifestPath);
    setPage("validation");
  } catch (error) {
    state.statusHeadline = "Gagal membuka riwayat";
    state.statusDetail = String(error);
    renderAll();
  }
}

async function resolveManifestPathForRecent(recentPath) {
  const entry = state.recentBatches.find((item) => item.path === recentPath);
  const storedManifestPath = String(entry?.manifestPath ?? "").trim();
  if (storedManifestPath) {
    return storedManifestPath;
  }

  return detectManifestPathFromBasePath(recentPath);
}

async function detectManifestPathFromBasePath(basePath) {
  const { invoke } = tauriBindings();
  const detectedPath = await invoke("find_manifest_path", { basePath });
  return typeof detectedPath === "string" ? detectedPath.trim() : "";
}

function validateNusukAddMutamerUrl(rawUrl) {
  const url = String(rawUrl ?? "").trim();
  if (!url) {
    return { ok: false, reason: "Isi URL Nusuk terlebih dahulu." };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "Format URL Nusuk tidak valid." };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "URL Nusuk harus menggunakan https://." };
  }
  if (parsed.hostname.toLowerCase() !== "masar.nusuk.sa") {
    return { ok: false, reason: "Gunakan domain resmi masar.nusuk.sa." };
  }
  if (!parsed.pathname.toLowerCase().startsWith("/umrah/mutamer/add-mutamer")) {
    return { ok: false, reason: "Gunakan halaman Add Mutamer: /umrah/mutamer/add-mutamer." };
  }

  return { ok: true, normalizedUrl: parsed.toString() };
}

async function handleOpenNusuk() {
  const { openUrl } = tauriBindings();
  const url = dom.nusukUrl.value.trim();
  state.nusukUrl = url;
  const validation = validateNusukAddMutamerUrl(url);
  if (!validation.ok) {
    state.statusHeadline = "URL Nusuk belum tepat";
    state.statusDetail = validation.reason;
    appendEntryLog(`URL tidak valid: ${validation.reason}`, "warn");
    renderAll();
    return;
  }

  await openUrl(validation.normalizedUrl);
  state.statusHeadline = "Halaman Nusuk dibuka";
  state.statusDetail = "Lanjut login sampai halaman Add Mutamer siap. Upload JSON hasil export ke extension untuk autofill.";
  appendEntryLog(`Membuka URL Nusuk: ${validation.normalizedUrl}`);
  renderAll();
}

async function handlePrepareEntry() {
  if (state.isEntryRunning) {
    appendEntryLog("Export JSON masih berjalan. Tunggu proses aktif selesai.", "warn");
    return;
  }

  appendEntryLog("Tombol Export JSON diklik.");
  if (!state.manifestPath || !state.manifest) {
    state.statusHeadline = "Belum ada hasil scan";
    state.statusDetail = "Jalankan proses terlebih dahulu sebelum membuat JSON untuk extension.";
    appendEntryLog("Gagal export: manifest belum tersedia.", "error");
    renderAll();
    return;
  }

  const review = reviewCompletionState();
  if (review.remaining > 0) {
    state.statusHeadline = "Review belum selesai";
    state.statusDetail = `Masih ada ${review.remaining} data yang belum ditandai siap sebelum membuat JSON untuk extension.`;
    state.currentPage = "validation";
    appendEntryLog(`Gagal export: review belum selesai (${review.remaining} data belum siap).`, "warn");
    renderAll();
    return;
  }

  const companionValidation = validateCompanionsBeforeExport();
  if (!companionValidation.ok) {
    state.statusHeadline = "Companion belum lengkap";
    state.statusDetail = companionValidation.message;
    state.currentPage = "validation";
    appendEntryLog(`Gagal export: ${companionValidation.message}`, "warn");
    if (companionValidation.firstMemberId) {
      state.activeMemberId = companionValidation.firstMemberId;
      syncPassportPageWithActiveMember();
    }
    renderAll();
    return;
  }

  try {
    const { invoke } = tauriBindings();
    state.isEntryRunning = true;
    state.statusHeadline = "Membuat JSON";
    state.statusDetail = "Menyiapkan file JSON untuk diupload ke extension.";
    appendEntryLog("Membuat batch data Nusuk untuk extension...");
    renderAll();
    const exportManifest = buildManifestForEntryExport();
    const batchPath = await invoke("create_nusuk_batch", {
      manifestPath: state.manifestPath,
      selectedIds: Array.from(state.selectedIds),
      manifestData: exportManifest,
    });
    state.exportedBatchPath = batchPath;
    appendEntryLog(`JSON untuk extension dibuat: ${batchPath}`, "success");
    appendEntryLog("Buka extension Nusuk Autofill, upload file JSON ini, lalu pilih folder/file passport di panel extension.");
    state.statusHeadline = "JSON siap diupload";
    state.statusDetail = `File dibuat di ${batchPath}. Upload file ini ke extension Nusuk Autofill.`;
    renderAll();
  } catch (error) {
    const rawError = String(error ?? "");
    state.statusHeadline = "Export JSON gagal";
    state.statusDetail = rawError || "Gagal membuat JSON untuk extension.";
    appendEntryLog(`Export JSON gagal: ${truncateForLog(rawError, 700)}`, "error");
    appendEntryLog(`Detail teknis: ${truncateForLog(rawError, 700)}`, "error");
  } finally {
    state.isEntryRunning = false;
    renderAll();
  }
}

function truncateForLog(value, maxLength = 500) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function validateCompanionsBeforeExport() {
  const selectedIds = effectiveSelectedIdsForExport();
  const members = manifestMembers();
  const missingChildren = members
    .filter((member) => selectedIds.has(String(member.id || "")))
    .filter((member) => childInfoForMember(member).isChild)
    .filter((member) => {
      const companionId = String(member.companionMemberId || "").trim();
      const companion = members.find((candidate) => String(candidate.id || "") === companionId);
      return !companion || childInfoForMember(companion).isChild;
    });

  if (!missingChildren.length) {
    return { ok: true, message: "", firstMemberId: "" };
  }

  const names = missingChildren.slice(0, 3).map(memberDisplayName).join(", ");
  const suffix = missingChildren.length > 3 ? ` dan ${missingChildren.length - 3} lainnya` : "";
  return {
    ok: false,
    message: `${missingChildren.length} jamaah anak belum memiliki companion dewasa: ${names}${suffix}.`,
    firstMemberId: String(missingChildren[0]?.id || ""),
  };
}

function buildManifestForEntryExport() {
  const selectedIds = effectiveSelectedIdsForExport();
  const source = cloneJson(state.manifest);
  const members = Array.isArray(source?.members) ? source.members : [];
  const enrichedMembers = members.map((member) => enrichMemberForEntry(member, members));
  enrichedMembers.sort((left, right) => {
    const leftChild = childInfoForMember(left).isChild ? 1 : 0;
    const rightChild = childInfoForMember(right).isChild ? 1 : 0;
    return leftChild - rightChild;
  });
  source.members = enrichedMembers;
  for (const member of enrichedMembers) {
    const companionId = String(member.companionMemberId || "").trim();
    if (companionId) {
      selectedIds.add(companionId);
    }
  }
  state.selectedIds = selectedIds;
  return source;
}

function enrichMemberForEntry(member, allMembers) {
  const nextMember = cloneJson(member);
  const info = childInfoForMember(nextMember);
  nextMember.isChild = info.isChild;
  nextMember.ageAtReview = Number.isFinite(info.age) ? info.age : null;
  const companionId = String(nextMember.companionMemberId || "").trim();
  if (info.isChild && companionId) {
    const companion = allMembers.find((candidate) => String(candidate.id || "") === companionId);
    if (companion) {
      nextMember.companion = buildCompanionSnapshot(companion);
    }
  } else {
    delete nextMember.companionMemberId;
    delete nextMember.companion;
  }
  return nextMember;
}

function effectiveSelectedIdsForExport() {
  const base = state.selectedIds.size
    ? new Set(Array.from(state.selectedIds).map((id) => String(id || "")).filter(Boolean))
    : new Set(defaultSelectedIds(state.manifest));
  const members = manifestMembers();
  for (const member of members) {
    if (!base.has(String(member.id || ""))) {
      continue;
    }
    const companionId = String(member.companionMemberId || "").trim();
    if (companionId) {
      base.add(companionId);
    }
  }
  return base;
}

async function handleTerminateEntry() {
  appendEntryLog("Tidak ada proses browser automation dari desktop app pada flow baru.", "warn");
  state.statusHeadline = "Automation desktop nonaktif";
  state.statusDetail = "Gunakan extension Nusuk Autofill untuk proses autofill setelah JSON diexport.";
  renderAll();
}

function toggleMemberSelection(memberId, checked) {
  if (!memberId) {
    return;
  }

  if (checked) {
    state.selectedIds.add(memberId);
  } else {
    state.selectedIds.delete(memberId);
  }
  renderAll();
}

function updateActiveMemberField(fieldKey, nextValue) {
  const member = activeMember();
  if (!member || !fieldKey) {
    return;
  }

  const resolved = ensureResolvedProfile(member);
  setValueByPath(resolved, fieldKey, normalizeInputValueForField(fieldKey, nextValue));
  syncMemberChildMetadata(member);
  state.reviewedMemberIds.delete(member.id);
  state.statusHeadline = "Perubahan lokal tersimpan";
  state.statusDetail = `${humanizeFieldPath(`resolvedProfile.${fieldKey}`)} diperbarui di sesi review.`;
}

function updateActiveMemberCompanion(companionMemberId) {
  const member = activeMember();
  if (!member) {
    return;
  }

  const normalizedId = String(companionMemberId || "").trim();
  syncMemberChildMetadata(member);
  if (normalizedId) {
    const companion = manifestMembers().find((item) => String(item.id || "") === normalizedId);
    if (!companion) {
      return;
    }
    member.companionMemberId = normalizedId;
    member.companion = buildCompanionSnapshot(companion);
    state.selectedIds.add(normalizedId);
    state.statusHeadline = "Companion dipilih";
    state.statusDetail = `${memberDisplayName(companion)} dipilih sebagai companion untuk ${memberDisplayName(member)}.`;
  } else {
    delete member.companionMemberId;
    delete member.companion;
    state.statusHeadline = "Companion dikosongkan";
    state.statusDetail = `${memberDisplayName(member)} belum memiliki companion.`;
  }
  state.reviewedMemberIds.delete(member.id);
}

function resetActiveMemberFields() {
  const member = activeMember();
  if (!member || !state.originalManifest) {
    return;
  }

  const originalMember = originalMemberById(member.id);
  if (!originalMember) {
    return;
  }

  replaceMemberInManifest(member.id, cloneJson(originalMember));
  state.reviewedMemberIds.delete(member.id);
  state.statusHeadline = "Field di-reset";
  state.statusDetail = "Perubahan untuk passport aktif dikembalikan ke hasil scan awal.";
  renderAll();
}

function markActiveMemberValid() {
  const member = activeMember();
  if (!member) {
    return;
  }

  member.status = "VALID";
  state.selectedIds.add(member.id);
  state.reviewedMemberIds.add(member.id);
  state.statusHeadline = "Passport ditandai valid";
  state.statusDetail = `${memberDisplayName(member)} ditandai siap untuk batch entry.`;
  recalculateMetrics();
  renderAll();
}

function handleSaveAndNext() {
  const member = activeMember();
  if (!member) {
    return;
  }

  const currentPair = activeCategoryPair();
  const currentPairIndex = FIELD_CATEGORY_PAIRS.findIndex((item) => item.id === currentPair.id);
  const nextPair = FIELD_CATEGORY_PAIRS[currentPairIndex + 1] || null;

  if (nextPair) {
    state.activeFieldCategory = nextPair.id;
    state.statusHeadline = "Lanjut kategori review";
    state.statusDetail = `${memberDisplayName(member)} lanjut ke ${nextPair.label}.`;
    renderAll();
    return;
  }

  member.status = "VALID";
  state.selectedIds.add(member.id);
  state.reviewedMemberIds.add(member.id);
  state.statusHeadline = "Review data selesai";
  state.statusDetail = `${memberDisplayName(member)} ditandai siap dan berpindah ke data berikutnya.`;
  recalculateMetrics();
  state.activeFieldCategory = FIELD_CATEGORY_PAIRS[0]?.id ?? "identity";
  moveActiveMember(1);
}

function moveActiveMember(step) {
  const members = filteredMembers();
  if (!members.length) {
    return;
  }

  const currentIndex = members.findIndex((member) => member.id === state.activeMemberId);
  const safeCurrentIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = Math.max(0, Math.min(members.length - 1, safeCurrentIndex + step));
  const previousPage = state.passportListPage;
  state.activeMemberId = members[nextIndex].id ?? "";
  syncPassportPageWithActiveMember();
  renderAll();
  if (state.passportListPage !== previousPage) {
    scrollPassportListToTop();
  }
}

function setPage(page) {
  if (!["import", "validation", "entry"].includes(page)) {
    return;
  }

  if (hasFolderSelectionConflict() && page !== "import") {
    const activeFolder = basenameFromPath(state.resultSourceDir || state.resultDir || "-");
    const selectedFolder = basenameFromPath(state.selectedDir || "-");
    state.statusHeadline = "Konfirmasi folder dulu";
    state.statusDetail = `Data aktif masih dari folder ${activeFolder}, sementara kamu memilih ${selectedFolder}. Proses folder yang dipilih dulu untuk melanjutkan.`;
    state.currentPage = "import";
    renderAll();
    return;
  }

  if (page === "entry") {
    if (!state.manifestPath || !state.manifest || !manifestMembers().length) {
      state.statusHeadline = "Belum ada data hasil scan";
      state.statusDetail = "Selesaikan proses scan terlebih dahulu sebelum lanjut ke tahap final entry.";
      state.currentPage = "import";
      renderAll();
      return;
    }

    const review = reviewCompletionState();
    if (review.remaining > 0) {
      state.statusHeadline = "Review belum selesai";
      state.statusDetail = `Masih ada ${review.remaining} data yang belum ditandai siap. Mohon review semua data dulu di halaman Periksa Data.`;
      state.currentPage = "validation";
      renderAll();
      return;
    }
  }

  state.currentPage = page;
  renderAll();
}

function renderAll() {
  clearScheduledRenderAll();
  refreshCompactLogs();
  ensureVisibleActiveMember();
  renderNavigation();
  renderPageVisibility();
  renderTopbar();
  renderGlobalNotice();
  renderImportPage();
  renderProgressPanel();
  renderScanLogs();
  renderPassportList();
  renderWorkspace();
  renderEntryPage();
  updateActionAvailability();
}

function scheduleRenderAll() {
  if (renderAllQueued) {
    return;
  }
  renderAllQueued = true;
  renderAllHandle = requestFrame(() => {
    renderAllQueued = false;
    renderAllHandle = null;
    renderAll();
  });
}

function clearScheduledRenderAll() {
  if (!renderAllQueued) {
    return;
  }
  if (renderAllHandle !== null) {
    cancelFrame(renderAllHandle);
  }
  renderAllQueued = false;
  renderAllHandle = null;
}

function renderNavigation() {
  const pageOrder = ["import", "validation", "entry"];
  const activeIndex = pageOrder.indexOf(state.currentPage);
  const review = reviewCompletionState();
  const entryReady = isEntryAccessible();
  const subtitleByPage = {
    import: state.manifestPath ? "Scan selesai, lanjut review" : "Pilih folder dan jalankan scan",
    validation: review.remaining > 0 ? `Sisa review: ${review.remaining} data` : "Semua data sudah siap",
    entry: entryReady ? "Siap export JSON" : "Belum tersedia, selesaikan review",
  };

  for (const button of dom.navButtons) {
    const page = button.dataset.page ?? "";
    const stepIndex = pageOrder.indexOf(page);
    const isActive = button.dataset.page === state.currentPage;
    const isComplete = stepIndex >= 0 && activeIndex >= 0 && stepIndex < activeIndex;
    const isUpcoming = stepIndex >= 0 && activeIndex >= 0 && stepIndex > activeIndex;

    button.classList.toggle("is-active", isActive);
    button.classList.toggle("is-complete", isComplete);
    button.classList.toggle("is-upcoming", isUpcoming);
    button.setAttribute("aria-current", isActive ? "page" : "false");

    const badge = button.querySelector("[data-step-badge]");
    if (badge) {
      badge.textContent = isComplete ? "OK" : String(stepIndex + 1);
    }

    const subtitle = button.querySelector("[data-step-subtitle]");
    if (subtitle) {
      subtitle.textContent = isComplete ? "Selesai" : (subtitleByPage[page] ?? "");
    }
  }

  dom.navConnectors?.forEach((connector, connectorIndex) => {
    const isComplete = activeIndex > connectorIndex;
    connector.classList.toggle("is-complete", isComplete);
  });
}

function renderGlobalNotice() {
  if (!dom.globalNotice || !dom.globalNoticeTitle || !dom.globalNoticeDetail) {
    return;
  }

  const review = reviewCompletionState();
  let title = String(state.statusHeadline || "").trim();
  let detail = String(state.statusDetail || "").trim();
  let tone = "info";

  if (!state.manifestPath) {
    title = title || "Mulai dari Tahap 1";
    detail = detail || "Pilih folder passport atau grup, lalu jalankan scan untuk melanjutkan proses.";
  } else if (hasFolderSelectionConflict()) {
    const activeFolder = basenameFromPath(state.resultSourceDir || state.resultDir || "-");
    const selectedFolder = basenameFromPath(state.selectedDir || "-");
    title = "Folder aktif berbeda";
    detail = `Data saat ini berasal dari ${activeFolder}, tetapi folder terpilih adalah ${selectedFolder}. Klik Proses Folder Ini untuk mengganti.`;
    tone = "warn";
  } else if (review.remaining > 0 && state.currentPage !== "entry") {
    title = "Tahap 3 Belum Bisa Dibuka";
    detail = `Masih ada ${review.remaining} data yang perlu ditandai siap di halaman Review Data.`;
    tone = "warn";
  }

  const sample = `${title} ${detail}`.toLowerCase();
  if (/(gagal|error|terminate gagal|belum tepat)/i.test(sample)) {
    tone = "danger";
  } else if (/(belum|perlu|review|menunggu)/i.test(sample)) {
    tone = tone === "danger" ? tone : "warn";
  } else if (/(selesai|berhasil|siap)/i.test(sample)) {
    tone = tone === "danger" ? tone : "success";
  }

  if (!title && !detail) {
    dom.globalNotice.classList.add("is-hidden");
    dom.globalNotice.className = "global-notice is-hidden";
    dom.globalNoticeTitle.textContent = "";
    dom.globalNoticeDetail.textContent = "";
    return;
  }

  dom.globalNotice.className = `global-notice is-${tone}`;
  dom.globalNotice.classList.remove("is-hidden");
  dom.globalNoticeTitle.textContent = title || "Informasi";
  dom.globalNoticeDetail.textContent = detail || "Status terbaru aplikasi akan tampil di sini.";
}

function renderPageVisibility() {
  dom.pageImport.classList.toggle("is-hidden", state.currentPage !== "import");
  dom.pageValidation.classList.toggle("is-hidden", state.currentPage !== "validation");
  dom.pageEntry.classList.toggle("is-hidden", state.currentPage !== "entry");
  const topbarNode = document.querySelector(".topbar");
  if (topbarNode) {
    topbarNode.style.display = state.currentPage === "entry" ? "none" : "flex";
  }
}

function renderTopbar() {
  const topbar = topbarDescriptor();
  const topbarNode = document.querySelector(".topbar");
  dom.topbarEyebrow.textContent = topbar.eyebrow;
  dom.topbarTitle.textContent = topbar.title;
  dom.topbarEyebrow.classList.toggle("is-hidden", !topbar.eyebrow);
  dom.topbarStatus.textContent = topbar.statusLabel;
  dom.topbarStatus.className = `status-chip ${topbar.statusTone}`;
  topbarNode?.classList.toggle("is-compact", Boolean(topbar.compact));
  topbarNode?.classList.toggle("is-hidden", Boolean(topbar.hidden));
}

function topbarDescriptor() {
  const status = currentTopbarStatus();
  if (state.currentPage === "import") {
    return {
      eyebrow: "",
      title: "Pilih Dokumen",
      statusLabel: status.label,
      statusTone: status.tone,
      compact: true,
    };
  }

  if (state.currentPage === "entry") {
    return {
      eyebrow: "Tahap 3",
      title: "Lanjutkan ke Nusuk",
      statusLabel: status.label,
      statusTone: status.tone,
      compact: true,
      hidden: true,
    };
  }

  return {
    eyebrow: "",
    title: "Periksa Data",
    statusLabel: status.label,
    statusTone: status.tone,
    compact: true,
    hidden: false,
  };
}

function currentTopbarStatus() {
  if (state.isScanning) {
    return { label: "Sedang Diproses", tone: "info" };
  }
  if (/gagal/i.test(state.statusHeadline)) {
    return { label: "Perlu Perhatian", tone: "danger" };
  }
  if (state.manifestPath && state.errorCount > 0) {
    return { label: "Perlu Dicek", tone: "warn" };
  }
  if (state.manifestPath) {
    return { label: "Siap", tone: "ready" };
  }
  if (state.selectedDir) {
    return { label: "Sudah Dipilih", tone: "neutral" };
  }
  return { label: "Menunggu", tone: "neutral" };
}

function renderImportPage() {
  dom.folderPath.value = state.selectedDir;

  if (state.selectedDir) {
    dom.selectedFolderName.textContent = basenameFromPath(state.selectedDir);
    dom.selectedFolderCaption.textContent = state.selectedDir;
  } else {
    dom.selectedFolderName.textContent = "Belum ada folder dipilih";
    dom.selectedFolderCaption.textContent = "Pilih folder passport atau folder grup untuk mulai memproses data.";
  }

  dom.importFooterText.textContent = importFooterMessage();
  const hasAnyResult = hasAnyScanResult();
  const hasResultForSelected = hasScanResultForSelectedDir();
  dom.importNextButton?.classList.toggle("is-hidden", !hasResultForSelected);
  dom.scanButton.className = hasAnyResult ? "secondary-button" : "primary-action";
  dom.scanButton.textContent = state.isScanning
    ? "Sedang Memproses..."
    : !state.selectedDir
      ? "Pilih Folder Dulu"
      : hasResultForSelected
        ? "Scan Ulang Folder Ini"
        : hasAnyResult
          ? "Proses Folder Ini"
          : "Mulai Proses";
  dom.scanButton.setAttribute("aria-busy", state.isScanning ? "true" : "false");

  renderMiniStatus(dom.systemOcrStatus, ocrStatusDescriptor());
  renderMiniStatus(dom.systemValidationStatus, { label: "Siap", tone: "ready" });
  renderMiniStatus(dom.systemRuntimeStatus, { label: "Tersedia", tone: "ready" });
  renderRecentBatches();
}

function importFooterMessage() {
  if (state.isScanning) {
    return "";
  }
  if (hasAnyScanResult() && !hasScanResultForSelectedDir() && state.selectedDir) {
    const activeFolder = basenameFromPath(state.resultSourceDir || state.resultDir || "-");
    const selectedFolder = basenameFromPath(state.selectedDir);
    return `Data aktif saat ini berasal dari folder ${activeFolder}. Jika lanjut, proses akan mengganti data dengan folder ${selectedFolder}.`;
  }
  if (hasScanResultForSelectedDir()) {
    return `Proses terakhir sudah selesai. ${state.validCount} data siap dipakai dan ${state.errorCount} perlu dicek.`;
  }
  return "";
}

function ocrStatusDescriptor() {
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

function renderMiniStatus(node, descriptor) {
  node.textContent = descriptor.label;
  node.className = `mini-status ${descriptor.tone}`;
}

function renderRecentBatches() {
  if (!state.recentBatches.length) {
    dom.recentBatchesList.innerHTML = `<div class="friendly-empty">Belum ada folder yang pernah dipilih.</div>`;
    return;
  }

  dom.recentBatchesList.innerHTML = state.recentBatches
    .map((entry) => {
      const countLabel = Number(entry.totalFiles) > 0 ? `${entry.totalFiles} file` : "folder";
      return `
        <button class="recent-item" type="button" data-recent-path="${escapeHtml(entry.path)}">
          <span class="recent-icon">DIR</span>
          <span class="recent-body">
            <strong>${escapeHtml(entry.label || basenameFromPath(entry.path))}</strong>
            <span class="recent-meta">${escapeHtml(formatRecentStamp(entry.usedAt))}</span>
          </span>
          <span class="recent-count">${escapeHtml(countLabel)}</span>
        </button>
      `;
    })
    .join("");
}

function renderProgressPanel() {
  const total = state.progressTotal || state.totalFiles || 0;
  const current = Math.min(state.progressCurrent || 0, total || 0);
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
  const lastLog = state.lastWorkerMessage || state.scanLogs[state.scanLogs.length - 1] || "";

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

  if (dom.scanConsoleState) {
    if (state.isScanning) {
      dom.scanConsoleState.textContent = "Berjalan";
      dom.scanConsoleState.className = "status-chip info";
    } else if (state.manifestPath) {
      dom.scanConsoleState.textContent = "Selesai";
      dom.scanConsoleState.className = "status-chip ready";
    } else {
      dom.scanConsoleState.textContent = "Menunggu";
      dom.scanConsoleState.className = "status-chip neutral";
    }
  }
}

function renderScanLogs() {
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

function renderPassportList() {
  const allMembers = manifestMembers();
  const visibleMembers = filteredMembers();
  const pagination = paginationState(visibleMembers.length);
  const pagedMembers = paginateMembers(visibleMembers);

  dom.filterAllCount.textContent = String(allMembers.length);
  dom.filterErrorCount.textContent = String(allMembers.filter((member) => member.status === "ERROR").length);
  dom.filterValidCount.textContent = String(allMembers.filter((member) => member.status === "VALID").length);

  for (const button of dom.filterButtons) {
    button.classList.toggle("is-active", button.dataset.validationFilter === state.validationFilter);
  }

  dom.batchBadge.textContent = state.resultDir
    ? `Kelompok ${basenameFromPath(state.resultDir)}`
    : state.selectedDir
      ? `Kelompok ${basenameFromPath(state.selectedDir)}`
      : "Siap diperiksa";

  dom.passportListSummary.textContent = passportListSummaryText(pagination, allMembers.length);

  if (!allMembers.length) {
    dom.passportList.innerHTML = `<div class="friendly-empty">Belum ada data passport. Mulai proses dulu dari halaman Pilih Dokumen.</div>`;
    renderPassportPagination(pagination);
    return;
  }

  if (!visibleMembers.length) {
    dom.passportList.innerHTML = `<div class="friendly-empty">Tidak ada data yang cocok untuk tampilan ini.</div>`;
    renderPassportPagination(pagination);
    return;
  }

  dom.passportList.innerHTML = pagedMembers
    .map((member) => renderPassportListItem(member))
    .join("");
  renderPassportPagination(pagination);
}

function renderPassportListItem(member) {
  const resolved = resolvedProfileOf(member);
  const active = state.activeMemberId === member.id ? " is-active" : "";
  const reviewed = state.reviewedMemberIds.has(member.id);
  const tone = memberTone(member);
  const passportNumber = valueFrom(resolved, "passportNumber");
  const childInfo = childInfoForMember(member);
  const companionMissing = childInfo.isChild && !String(member.companionMemberId || "").trim();
  const groupLabel = childInfo.isChild ? "Child" : "Adult";
  const groupClass = childInfo.isChild ? "child" : "adult";

  return `
    <div class="passport-item${active}${reviewed ? " is-reviewed" : ""}" data-member-id="${escapeHtml(member.id ?? "")}">
      <div class="passport-item-main">
        <div class="passport-item-title">
          <span class="passport-status-dot ${tone}${reviewed ? " reviewed" : ""}"></span>
          <span class="passport-name">${escapeHtml(memberDisplayName(member))}</span>
        </div>
        <div class="passport-meta">
          <span class="mono">${escapeHtml(passportNumber)}</span>
          ${childInfo.isChild ? `<span class="mini-pill ${companionMissing ? "warn" : "info"}">${companionMissing ? "Butuh companion" : "Anak"}</span>` : ""}
        </div>
      </div>
      <div class="passport-item-confidence passport-item-group">
        <span class="member-group-pill ${groupClass}">${escapeHtml(groupLabel)}</span>
      </div>
    </div>
  `;
}

function renderWorkspace() {
  const member = activeMember();
  if (!member) {
    dom.fieldReviewRows.classList.add("is-empty");
    dom.workspaceIssueBox.classList.add("is-hidden");
    document.querySelector(".field-review-head")?.classList.add("is-hidden");
    document.querySelector(".workspace-panel")?.classList.add("is-empty");
    dom.detailStatus.textContent = "Menunggu";
    dom.detailStatus.className = "status-pill neutral";
    dom.workspacePassportCode.textContent = "-";
    dom.detailTitle.textContent = "Belum ada data dipilih";
    dom.detailSummary.classList.add("is-hidden");
    dom.detailSummary.textContent = "";
    dom.workspaceIssueBox.className = "issue-box issue-box-neutral is-hidden";
    dom.workspaceIssueBox.textContent = "Belum ada catatan pemeriksaan.";
    dom.fieldReviewRows.innerHTML = `<div class="workspace-empty-state">Belum ada data untuk ditampilkan.</div>`;
    if (dom.fieldCategoryTabs) {
      dom.fieldCategoryTabs.innerHTML = "";
    }
    if (dom.saveNextButton) {
      dom.saveNextButton.textContent = "Lanjut";
    }
    dom.reviewFlagsBox.innerHTML = renderEmptyDetailPanel("Belum ada catatan untuk ditampilkan.");
    dom.fieldConfidenceBox.innerHTML = renderEmptyDetailPanel("Belum ada nilai keyakinan untuk ditampilkan.");
    return;
  }

  dom.fieldReviewRows.classList.remove("is-empty");
  dom.workspaceIssueBox.classList.remove("is-hidden");
  document.querySelector(".field-review-head")?.classList.remove("is-hidden");
  document.querySelector(".workspace-panel")?.classList.remove("is-empty");
  const resolved = ensureResolvedProfile(member);
  dom.detailStatus.textContent = workspaceStatusLabel(member);
  dom.detailStatus.className = `status-pill ${workspaceStatusTone(member)}`;
  dom.workspacePassportCode.textContent = valueFrom(resolved, "passportNumber");
  dom.detailTitle.textContent = memberDisplayName(member);
  dom.detailSummary.classList.add("is-hidden");
  dom.detailSummary.textContent = "";

  const issueSummary = buildIssueSummary(member);
  dom.workspaceIssueBox.className = `issue-box ${issueSummary.toneClass}`;
  dom.workspaceIssueBox.innerHTML = issueSummary.html;
  renderFieldCategoryTabs(member);
  dom.fieldReviewRows.innerHTML = renderFieldReviewRows(member);
  initializeWorkspaceDatePickers();
  dom.reviewFlagsBox.innerHTML = renderReviewFlagsPanel(member.reviewFlags ?? {});
  dom.fieldConfidenceBox.innerHTML = renderFieldConfidencePanel(
    member.fieldConfidence ?? {},
    member.confidenceLevel ?? {},
    member.confidence,
  );
  const currentPair = activeCategoryPair();
  const currentPairIndex = FIELD_CATEGORY_PAIRS.findIndex((item) => item.id === currentPair.id);
  const nextPair = FIELD_CATEGORY_PAIRS[currentPairIndex + 1] || null;
  if (dom.saveNextButton) {
    dom.saveNextButton.textContent = nextPair
      ? `Lanjut ke ${nextPair.label}`
      : "Siap & Lanjut";
  }
}

function renderEntryPage() {
  if (!dom.entryStatusPill) {
    return;
  }

  const batchName = state.resultDir
    ? basenameFromPath(state.resultDir)
    : state.selectedDir
      ? basenameFromPath(state.selectedDir)
      : "Belum ada data";
  const validCount = state.validCount || countMembersByStatus("VALID");
  const selectedCount = effectiveSelectedIdsForExport().size;
  const totalEntryCount = totalEntryTargetCount();
  const flowSteps = buildEntryFlowSteps({
    url: String(dom.nusukUrl?.value ?? state.nusukUrl ?? "").trim().toLowerCase(),
    isReviewDone: reviewCompletionState().remaining === 0 && manifestMembers().length > 0,
    isExported: Boolean(state.exportedBatchPath),
  });
  const entryStatusInput = {
    isEntryRunning: state.isEntryRunning,
    isScanning: state.isScanning,
    manifestPath: state.manifestPath,
    selectedIdsSize: state.selectedIds.size,
  };

  dom.entryStatusPill.textContent = entryStatusLabel(entryStatusInput);
  dom.entryStatusPill.className = `status-pill ${entryStatusTone(entryStatusInput)}`;
  dom.entryBatchName.textContent = batchName;
  dom.entryValidCount.textContent = `${validCount} data`;
  dom.entrySelectedCount.textContent = `${selectedCount} data`;
  dom.nusukUrl.value = state.nusukUrl;
  if (dom.entryProgressTitle) {
    dom.entryProgressTitle.textContent = state.exportedBatchPath
      ? "JSON siap untuk extension"
      : "Belum ada export JSON";
  }
  if (dom.entryProgressCount) {
    dom.entryProgressCount.textContent = state.exportedBatchPath ? "Ready" : "0 file";
    dom.entryProgressCount.className = `status-chip ${state.exportedBatchPath ? "valid" : "neutral"}`;
  }
  if (dom.entryProgressFill) {
    const exportPercent = state.exportedBatchPath ? 100 : 0;
    dom.entryProgressFill.style.width = `${exportPercent}%`;
    dom.entryProgressFill.parentElement?.setAttribute("aria-valuenow", String(exportPercent));
  }
  if (dom.entryProgressCaption) {
    dom.entryProgressCaption.textContent = state.exportedBatchPath
      ? `Upload JSON ini ke extension: ${state.exportedBatchPath}`
      : totalEntryCount > 0
        ? `${totalEntryCount} passport siap diexport ke JSON.`
        : "Tidak ada data target untuk export.";
  }
  if (dom.entryFlowSteps) {
    dom.entryFlowSteps.innerHTML = renderEntryFlowSteps(flowSteps);
  }
  renderEntryLogs();
}

function activeCategoryPair() {
  return FIELD_CATEGORY_PAIRS.find((item) => item.id === state.activeFieldCategory) || FIELD_CATEGORY_PAIRS[0];
}

function renderFieldReviewRows(member) {
  const resolved = ensureResolvedProfile(member);
  syncMemberChildMetadata(member);
  const extracted = passportExtractedOf(member);
  const pair = activeCategoryPair();
  const visibleFields = pair.categoryIds
    .map((categoryId) => FIELD_CATEGORY_DEFS.find((item) => item.id === categoryId))
    .filter(Boolean)
    .flatMap((category) => REVIEW_FIELDS.filter(([key]) => category.keys.includes(key)));

  if (!visibleFields.length) {
    return `<div class="workspace-empty-state">Kategori ini belum punya field.</div>`;
  }

  const cells = visibleFields.map(([key, label]) => {
      const ocrValue = rawValueFrom(extracted, key);
      const storedFinalValue = rawValueFrom(resolved, key);
      const fieldMaxLength = maxLengthForField(key);
      const finalValue = clampFieldValue(key, storedFinalValue);
      const dateField = isDateFieldKey(key);
      const inputValue = dateField ? dateValueForInput(finalValue) : finalValue;
      if (storedFinalValue !== finalValue) {
        setValueByPath(resolved, key, finalValue);
      }
      const flags = fieldFlagsForMember(member, key);
      const level = confidenceLevelForMember(member, key);
      const confidenceValue = confidenceValueForMember(member, key);
      const confidencePercent = Math.round(Math.max(0, Math.min(Number(confidenceValue ?? 0), 1)) * 100);
      const charCount = String(finalValue).length;
      const descriptor = fieldStateDescriptor(ocrValue, finalValue, flags, level, confidenceValue);
      const normalizedOcr = normalizeText(ocrValue);
      const normalizedFinal = normalizeText(finalValue);
      const hasScanSource = Boolean(normalizedOcr);
      const changedFromScan = Boolean(normalizedOcr && normalizedFinal && normalizedOcr !== normalizedFinal);
      const sourceText = ocrValue || "Belum terbaca";
      const sourceBadge = hasScanSource
        ? (changedFromScan ? "Diubah" : "Asli")
        : "Manual";
      const sourceBadgeTone = hasScanSource
        ? (changedFromScan ? "changed" : "original")
        : "manual";

      return `
        <div class="field-pair-cell${descriptor.rowAlert ? " is-alert" : ""}">
          <div class="field-pair-label">${escapeHtml(label)}</div>
          <div class="field-final-cell is-editable${descriptor.rowAlert ? " is-alert" : ""}">
            <div class="field-final-stack">
              <input
                class="field-final-input${descriptor.rowAlert ? " is-alert" : ""}${dateField ? " js-date-input" : ""}"
                data-field-key="${escapeHtml(key)}"
                type="text"
                value="${escapeHtml(inputValue)}"
                ${fieldMaxLength ? `maxlength="${fieldMaxLength}"` : ""}
                placeholder="${escapeHtml(dateField ? "YYYY/MM/DD" : label)}"
                aria-label="${escapeHtml(`Ubah ${label}`)}"
                ${dateField ? 'autocomplete="off" spellcheck="false" inputmode="none"' : ""}
              />
              <div class="field-source-line" title="${escapeHtml(`Sumber scan: ${sourceText}`)}">
                <span class="field-source-main">
                  <span class="field-source-label">Sumber scan:</span>
                  <span class="field-source-value">${escapeHtml(sourceText)}</span>
                  <span class="field-source-badge ${sourceBadgeTone}">${escapeHtml(sourceBadge)}</span>
                </span>
                <span class="field-source-meta">
                  <span class="field-confidence-mini">Akurasi ${escapeHtml(String(confidencePercent))}%</span>
                  <span class="field-char-count">${
                    fieldMaxLength
                      ? `${escapeHtml(String(charCount))}/${fieldMaxLength}`
                      : escapeHtml(String(charCount))
                  }</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      `;
    });

  const rows = [];
  const companionPanel = renderCompanionReviewPanel(member);
  if (companionPanel) {
    rows.push(companionPanel);
  }
  for (let index = 0; index < cells.length; index += 2) {
    const left = cells[index];
    const right = cells[index + 1] ?? `<div class="field-pair-cell is-empty" aria-hidden="true"></div>`;
    rows.push(`<div class="field-review-row">${left}${right}</div>`);
  }
  return rows.join("");
}

function renderCompanionReviewPanel(member) {
  const childInfo = childInfoForMember(member);
  if (!childInfo.isChild) {
    return "";
  }

  const candidates = companionCandidatesFor(member);
  const selectedId = String(member.companionMemberId || "");
  const selectedCompanion = candidates.find((candidate) => String(candidate.id || "") === selectedId) || null;
  const ageLabel = Number.isFinite(childInfo.age)
    ? `${childInfo.age} tahun`
    : "umur belum terbaca";
  const options = [
    `<option value="">Pilih companion...</option>`,
    ...candidates.map((candidate) => {
      const passport = memberPassport(candidate);
      const label = `${memberDisplayName(candidate)}${passport ? ` | ${passport}` : ""}`;
      const selected = String(candidate.id || "") === selectedId ? " selected" : "";
      return `<option value="${escapeHtml(candidate.id || "")}"${selected}>${escapeHtml(label)}</option>`;
    }),
  ].join("");

  return `
    <div class="field-review-row companion-review-row">
      <div class="companion-review-card${selectedCompanion ? " is-complete" : " is-missing"}">
        <div class="companion-review-copy">
          <span class="companion-pill">Anak - ${escapeHtml(ageLabel)}</span>
          <strong>Companion wajib dipilih sebelum export</strong>
          <small>${
            selectedCompanion
              ? `Companion: ${escapeHtml(memberDisplayName(selectedCompanion))} (${escapeHtml(memberPassport(selectedCompanion) || "-")})`
              : "Pilih jamaah dewasa yang akan menjadi companion di Nusuk."
          }</small>
        </div>
        <label class="companion-select-wrap">
          <span>Companion</span>
          <select data-companion-select aria-label="Pilih companion">
            ${options}
          </select>
        </label>
      </div>
    </div>
  `;
}

function renderFieldCategoryTabs(member) {
  if (!dom.fieldCategoryTabs) {
    return;
  }

  const resolved = ensureResolvedProfile(member);
  const extracted = passportExtractedOf(member);
  const availableKeys = new Set(REVIEW_FIELDS
    .filter(([key]) => rawValueFrom(resolved, key) || rawValueFrom(extracted, key))
    .map(([key]) => key));

  if (!FIELD_CATEGORY_PAIRS.some((item) => item.id === state.activeFieldCategory)) {
    state.activeFieldCategory = FIELD_CATEGORY_PAIRS[0].id;
  }

  dom.fieldCategoryTabs.innerHTML = FIELD_CATEGORY_PAIRS.map((pair) => {
    const categories = pair.categoryIds
      .map((categoryId) => FIELD_CATEGORY_DEFS.find((item) => item.id === categoryId))
      .filter(Boolean);
    const keys = categories.flatMap((category) => category.keys);
    const total = keys.length;
    const filled = keys.filter((key) => availableKeys.has(key)).length;
    const active = pair.id === state.activeFieldCategory ? " is-active" : "";
    return `
      <button class="field-category-tab${active}" type="button" data-field-category="${escapeHtml(pair.id)}">
        <span>${escapeHtml(pair.label)}</span>
        <small>${filled}/${total}</small>
      </button>
    `;
  }).join("");
}

function workspaceStatusLabel(member) {
  if (member.status === "ERROR") {
    return "Perlu perhatian";
  }
  if (Number(member.confidence ?? 0) < 0.85) {
    return "Perlu dicek";
  }
  return "Siap digunakan";
}

function workspaceStatusTone(member) {
  if (member.status === "ERROR") {
    return "error";
  }
  if (Number(member.confidence ?? 0) < 0.85) {
    return "warn";
  }
  return "valid";
}

function buildIssueSummary(member) {
  const issues = actionableIssuesForMember(member);
  if (issues.length) {
    const visible = issues.slice(0, 2);
    const hiddenCount = Math.max(issues.length - visible.length, 0);
    return {
      toneClass: "issue-box-danger",
      html: `
        <strong>Perlu dicek (${issues.length})</strong>
        <ul>${visible.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>
        ${hiddenCount ? `<p class="issue-more">+${hiddenCount} catatan lainnya</p>` : ""}
      `,
    };
  }

  const notes = splitNotes(member.notes).slice(0, 2);
  if (notes.length) {
    return {
      toneClass: "issue-box-warn",
      html: `
        <strong>Catatan</strong>
        <ul>${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
      `,
    };
  }

  return {
    toneClass: "issue-box-ok",
    html: "<strong>Data utama terlihat siap digunakan.</strong>",
  };
}

function updateActionAvailability() {
  const hasSelectedDir = Boolean(state.selectedDir.trim());
  const hasActiveMember = Boolean(activeMember());
  const navigation = activeNavigationState();

  dom.scanButton.disabled = state.isScanning || !hasSelectedDir;
  if (dom.importNextButton) {
    const canGoNext = !state.isScanning && hasScanResultForSelectedDir();
    dom.importNextButton.disabled = !canGoNext;
    dom.importNextButton.setAttribute("aria-disabled", dom.importNextButton.disabled ? "true" : "false");
  }
  dom.chooseFolderButton.disabled = state.isScanning;
  dom.folderPath.disabled = state.isScanning;
  dom.folderDropzone.classList.toggle("is-busy", state.isScanning);
  dom.folderDropzone.setAttribute("aria-disabled", state.isScanning ? "true" : "false");
  dom.folderDropzone.setAttribute("aria-busy", state.isScanning ? "true" : "false");

  dom.openNusukButton.disabled = !dom.nusukUrl.value.trim() || state.isEntryRunning;
  dom.prepareEntryButton.disabled = state.isEntryRunning || !isEntryAccessible();
  if (dom.terminateEntryButton) {
    dom.terminateEntryButton.disabled = true;
  }
  dom.resetFieldsButton.disabled = !hasActiveMember;
  dom.saveNextButton.disabled = !hasActiveMember;
  dom.scanButton.setAttribute("aria-disabled", dom.scanButton.disabled ? "true" : "false");
  dom.chooseFolderButton.setAttribute("aria-disabled", dom.chooseFolderButton.disabled ? "true" : "false");
  dom.openNusukButton.setAttribute("aria-disabled", dom.openNusukButton.disabled ? "true" : "false");
  dom.prepareEntryButton.setAttribute("aria-disabled", dom.prepareEntryButton.disabled ? "true" : "false");
  if (dom.terminateEntryButton) {
    dom.terminateEntryButton.setAttribute("aria-disabled", dom.terminateEntryButton.disabled ? "true" : "false");
  }
  dom.resetFieldsButton.setAttribute("aria-disabled", dom.resetFieldsButton.disabled ? "true" : "false");
  dom.saveNextButton.setAttribute("aria-disabled", dom.saveNextButton.disabled ? "true" : "false");

  for (const button of dom.navButtons) {
    button.disabled = false;
    button.setAttribute("aria-disabled", button.disabled ? "true" : "false");
  }

  for (const button of dom.workspacePrevButtons) {
    button.disabled = !navigation.canMovePrev;
    button.setAttribute("aria-disabled", button.disabled ? "true" : "false");
  }
  for (const button of dom.workspaceNextButtons) {
    button.disabled = !navigation.canMoveNext;
    button.setAttribute("aria-disabled", button.disabled ? "true" : "false");
  }

  if (dom.passportPagePrevButton && dom.passportPageNextButton) {
    const pagination = paginationState(filteredMembers().length);
    dom.passportPagePrevButton.disabled = !pagination.canMovePrev;
    dom.passportPageNextButton.disabled = !pagination.canMoveNext;
    dom.passportPagePrevButton.setAttribute("aria-disabled", dom.passportPagePrevButton.disabled ? "true" : "false");
    dom.passportPageNextButton.setAttribute("aria-disabled", dom.passportPageNextButton.disabled ? "true" : "false");
  }
}

function hasFolderSelectionConflict() {
  return Boolean(state.selectedDir && hasAnyScanResult() && !hasScanResultForSelectedDir());
}

function manifestMembers() {
  return Array.isArray(state.manifest?.members) ? state.manifest.members : [];
}

function syncManifestChildMetadata(manifest = state.manifest) {
  const members = Array.isArray(manifest?.members) ? manifest.members : [];
  for (const member of members) {
    syncMemberChildMetadata(member);
  }
}

function reviewCompletionState() {
  return computeReviewCompletionState(manifestMembers(), state.reviewedMemberIds);
}

function totalEntryTargetCount() {
  return computeTotalEntryTargetCount(effectiveSelectedIdsForExport().size, countMembersByStatus("VALID"));
}

function appendEntryLog(message, level = "info") {
  const text = String(message ?? "").trim();
  if (!text) {
    return;
  }
  const timestamp = new Date().toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const tag = String(level || "info").toUpperCase();
  state.entryLogs.push(`[${timestamp}] [${tag}] ${text}`);
  if (state.entryLogs.length > 120) {
    state.entryLogs = state.entryLogs.slice(-120);
  }
  renderEntryLogs();
}

function renderEntryLogs() {
  if (!dom.entryLogBox || !dom.entryLogCounter) {
    return;
  }
  const lines = state.entryLogs.length
    ? state.entryLogs
    : ["Belum ada aktivitas export."];
  dom.entryLogBox.textContent = lines.join("\n");
  dom.entryLogCounter.textContent = `${state.entryLogs.length} log`;
}

function isEntryAccessible() {
  const review = reviewCompletionState();
  return isEntryAccessibleForState({
    manifestPath: state.manifestPath,
    hasManifest: Boolean(state.manifest),
    reviewTotal: review.total,
    reviewRemaining: review.remaining,
    isScanning: state.isScanning,
  });
}

function filteredMembers() {
  const members = manifestMembers();
  if (state.validationFilter === "error") {
    return members.filter((member) => member.status === "ERROR");
  }
  if (state.validationFilter === "valid") {
    return members.filter((member) => member.status === "VALID");
  }
  return members;
}

function ensureVisibleActiveMember() {
  const members = filteredMembers();
  if (!members.length) {
    state.activeMemberId = "";
    state.passportListPage = 1;
    return;
  }

  const isActiveVisible = members.some((member) => member.id === state.activeMemberId);
  if (!isActiveVisible) {
    state.activeMemberId = members[0].id ?? "";
    state.passportListPage = 1;
  }
  const totalPages = Math.max(1, Math.ceil(members.length / state.passportListPageSize));
  state.passportListPage = Math.min(state.passportListPage, totalPages);
}

function syncPassportPageWithActiveMember() {
  const members = filteredMembers();
  const activeIndex = members.findIndex((member) => member.id === state.activeMemberId);
  if (activeIndex < 0) {
    return;
  }
  state.passportListPage = Math.max(1, Math.floor(activeIndex / state.passportListPageSize) + 1);
}

function paginateMembers(members) {
  const pagination = paginationState(members.length);
  return members.slice(pagination.offset, pagination.offset + state.passportListPageSize);
}

function paginationState(totalItems) {
  const pageSize = state.passportListPageSize;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(1, state.passportListPage), totalPages);
  state.passportListPage = currentPage;
  const offset = (currentPage - 1) * pageSize;
  const startIndex = totalItems ? offset + 1 : 0;
  const endIndex = Math.min(offset + pageSize, totalItems);
  return {
    totalItems,
    pageSize,
    totalPages,
    currentPage,
    offset,
    startIndex,
    endIndex,
    canMovePrev: currentPage > 1,
    canMoveNext: currentPage < totalPages,
  };
}

function changePassportListPage(step) {
  const members = filteredMembers();
  const pagination = paginationState(members.length);
  const nextPage = Math.min(Math.max(1, pagination.currentPage + step), pagination.totalPages);
  if (nextPage === state.passportListPage) {
    return;
  }
  state.passportListPage = nextPage;
  const nextOffset = (nextPage - 1) * state.passportListPageSize;
  state.activeMemberId = members[nextOffset]?.id ?? state.activeMemberId;
  renderAll();
  scrollPassportListToTop();
}

function renderPassportPagination(pagination) {
  if (!dom.passportPagePrevButton || !dom.passportPageNextButton) {
    return;
  }
  dom.passportPagePrevButton.disabled = !pagination.canMovePrev;
  dom.passportPageNextButton.disabled = !pagination.canMoveNext;
  dom.passportPagePrevButton.setAttribute("aria-disabled", dom.passportPagePrevButton.disabled ? "true" : "false");
  dom.passportPageNextButton.setAttribute("aria-disabled", dom.passportPageNextButton.disabled ? "true" : "false");
}

function passportListSummaryText(pagination, totalMembers) {
  const pageText = pagination.totalPages > 1
    ? ` | Halaman ${pagination.currentPage}/${pagination.totalPages}`
    : "";
  if (!pagination.totalItems) {
    return totalMembers ? `0 dari ${totalMembers} data${pageText}` : "0 dari 0 data";
  }
  const rangeText = `${pagination.startIndex}-${pagination.endIndex}`;
  if (pagination.totalItems === totalMembers) {
    return `${rangeText} dari ${totalMembers} data${pageText}`;
  }
  return `${rangeText} dari ${pagination.totalItems} data terfilter (${totalMembers} total)${pageText}`;
}

function scrollPassportListToTop() {
  if (!dom.passportList) {
    return;
  }
  requestFrame(() => {
    dom.passportList.scrollTop = 0;
  });
}

function activeMember() {
  const members = manifestMembers();
  return members.find((member) => member.id === state.activeMemberId) || null;
}

function activeNavigationState() {
  const members = filteredMembers();
  const index = members.findIndex((member) => member.id === state.activeMemberId);
  return {
    canMovePrev: index > 0,
    canMoveNext: index >= 0 && index < members.length - 1,
  };
}

function firstMemberId(manifest) {
  return Array.isArray(manifest?.members) && manifest.members.length ? manifest.members[0].id ?? "" : "";
}

function defaultSelectedIds(manifest) {
  if (!Array.isArray(manifest?.members)) {
    return [];
  }
  return manifest.members
    .filter((member) => member.status === "VALID" && member.id)
    .map((member) => member.id);
}

function countMembersByStatus(status) {
  return countMembersByStatusFromMembers(manifestMembers(), status);
}

function memberDisplayName(member) {
  const resolved = resolvedProfileOf(member);
  const parts = [
    resolved.firstName,
    resolved.fatherName,
    resolved.grandfatherName,
    resolved.familyName,
  ].filter(Boolean);

  if (parts.length) {
    return parts.join(" ");
  }

  const extracted = passportExtractedOf(member);
  return [extracted.firstName, extracted.familyName].filter(Boolean).join(" ") || member.fileName || "-";
}

function memberPassport(member) {
  const resolved = resolvedProfileOf(member);
  return resolved.passportNumber || passportExtractedOf(member).passportNumber || "";
}

function syncMemberChildMetadata(member) {
  if (!member || typeof member !== "object") {
    return { isChild: false, age: null };
  }
  const info = childInfoForMember(member);
  member.isChild = info.isChild;
  member.ageAtReview = Number.isFinite(info.age) ? info.age : null;
  if (!info.isChild) {
    delete member.companionMemberId;
    delete member.companion;
  }
  return info;
}

function childInfoForMember(member) {
  const resolved = resolvedProfileOf(member);
  const dob = resolved.dob || passportExtractedOf(member).dob || "";
  const age = ageFromDateValue(dob);
  return {
    age,
    isChild: Number.isFinite(age) && age < CHILD_AGE_LIMIT,
  };
}

function ageFromDateValue(value, now = new Date()) {
  const normalized = normalizeDateToNusuk(value);
  if (!normalized) {
    return null;
  }
  const [year, month, day] = normalized.split("/").map((part) => Number(part));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  let age = now.getFullYear() - year;
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();
  if (currentMonth < month || (currentMonth === month && currentDay < day)) {
    age -= 1;
  }
  return age >= 0 && age < 130 ? age : null;
}

function companionCandidatesFor(member) {
  const activeId = String(member?.id || "");
  return manifestMembers()
    .filter((candidate) => String(candidate.id || "") !== activeId)
    .filter((candidate) => !childInfoForMember(candidate).isChild)
    .filter((candidate) => memberPassport(candidate) || memberDisplayName(candidate) !== "-");
}

function buildCompanionSnapshot(member) {
  return {
    id: String(member?.id || ""),
    name: memberDisplayName(member),
    passportNumber: memberPassport(member),
  };
}

function resolvedProfileOf(member) {
  if (member?.resolvedProfile && typeof member.resolvedProfile === "object") {
    return member.resolvedProfile;
  }

  return {
    firstName: member?.firstName ?? "",
    fatherName: member?.fatherName ?? "",
    grandfatherName: member?.grandfatherName ?? "",
    familyName: member?.familyName ?? "",
    passportNumber: member?.passportNumber ?? "",
    nationality: member?.nationality ?? "",
    dob: member?.dob ?? "",
    issueDate: member?.issueDate ?? "",
    releaseDate: member?.releaseDate ?? "",
    expiryDate: member?.expiryDate ?? "",
    gender: member?.gender ?? "",
    passportType: member?.passportType ?? "",
    countryOfIssued: member?.countryOfIssued ?? "",
    cityOfIssued: member?.cityOfIssued ?? "",
    birthCountry: member?.birthCountry ?? "",
    birthCity: member?.birthCity ?? "",
    profession: member?.profession ?? "",
    maritalStatus: member?.maritalStatus ?? "",
    vaccinationCertificate: member?.vaccinationCertificate ?? "",
    vaccinationCertificatePath: member?.vaccinationCertificatePath ?? "",
    email: member?.email ?? "",
    mobileNumber: member?.mobileNumber ?? "",
    arabic: {
      firstName: member?.arabic?.firstName ?? "",
      fatherName: member?.arabic?.fatherName ?? "",
      grandfatherName: member?.arabic?.grandfatherName ?? "",
      familyName: member?.arabic?.familyName ?? "",
    },
  };
}

function ensureResolvedProfile(member) {
  if (!member.resolvedProfile || typeof member.resolvedProfile !== "object") {
    member.resolvedProfile = cloneJson(resolvedProfileOf(member));
  }
  return member.resolvedProfile;
}

function passportExtractedOf(member) {
  if (member?.passportExtracted && typeof member.passportExtracted === "object") {
    return member.passportExtracted;
  }

  return resolvedProfileOf(member);
}

function rawValueFrom(section, key) {
  if (!section || typeof section !== "object") {
    return "";
  }
  return String(valueByPath(section, key) ?? "").trim();
}

function valueFrom(section, key) {
  const value = rawValueFrom(section, key);
  return value || "-";
}

function memberTone(member) {
  if (member.status === "ERROR") {
    return "error";
  }
  if (Number(member.confidence ?? 0) < 0.9) {
    return "warn";
  }
  return "valid";
}

function fieldFlagsForMember(member, key) {
  const parts = pathParts(key);
  return [
    ...uniqueValues(nestedArrayValue(member.reviewFlags, ["resolvedProfile", ...parts])),
    ...uniqueValues(nestedArrayValue(member.reviewFlags, ["passportExtracted", ...parts])),
  ];
}

function confidenceLevelForMember(member, key) {
  const parts = pathParts(key);
  return nestedStringValue(member.confidenceLevel, ["resolvedProfile", ...parts])
    || nestedStringValue(member.confidenceLevel, ["passportExtracted", ...parts])
    || "NONE";
}

function confidenceValueForMember(member, key) {
  const parts = pathParts(key);
  return nestedNumberValue(member.fieldConfidence, ["resolvedProfile", ...parts])
    ?? nestedNumberValue(member.fieldConfidence, ["passportExtracted", ...parts])
    ?? 0;
}

function recalculateMetrics() {
  const members = manifestMembers();
  state.totalFiles = members.length;
  state.validCount = members.filter((member) => member.status === "VALID").length;
  state.errorCount = members.filter((member) => member.status === "ERROR").length;
}

function originalMemberById(memberId) {
  const members = Array.isArray(state.originalManifest?.members) ? state.originalManifest.members : [];
  return members.find((member) => member.id === memberId) || null;
}

function replaceMemberInManifest(memberId, nextMember) {
  const members = manifestMembers();
  const index = members.findIndex((member) => member.id === memberId);
  if (index < 0) {
    return;
  }
  members[index] = nextMember;
  recalculateMetrics();
}

function appendScanLog(message) {
  const trimmed = String(message ?? "").trim();
  if (!trimmed) {
    return;
  }

  state.lastWorkerMessage = trimmed;
  refreshCompactLogs();
}

function refreshCompactLogs() {
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
    lines.push(`Hasil akhir | VALID ${state.validCount} | ERROR ${state.errorCount}`);
  }

  state.scanLogs = lines.slice(-3);
}

function formatStageLog(payload) {
  const fileName = payload.fileName ?? "passport";
  const label = payload.message ?? "Sedang bekerja";
  return `${fileName} | ${label}`;
}

function rememberRecentBatch(path, totalFiles = 0, manifestPath = "") {
  state.recentBatches = buildRememberedRecentBatches(
    state.recentBatches,
    path,
    totalFiles,
    manifestPath,
    basenameFromPath,
  );
  saveRecentBatches(state.recentBatches);
}

function loadRecentBatches() {
  return loadRecentBatchesFromStorage(STORAGE_KEYS.recentBatches, basenameFromPath);
}

function saveRecentBatches(entries) {
  saveRecentBatchesToStorage(STORAGE_KEYS.recentBatches, entries);
}

function initializeWorkspaceDatePickers() {
  const factory = window.flatpickr;
  if (typeof factory !== "function" || !dom.fieldReviewRows) {
    return;
  }

  const dateInputs = [...dom.fieldReviewRows.querySelectorAll("input.js-date-input[data-field-key]")];
  for (const input of dateInputs) {
    const fieldKey = String(input.dataset.fieldKey ?? "");
    if (!isDateFieldKey(fieldKey)) {
      continue;
    }

    const normalized = normalizeDateToNusuk(input.value);
    input.value = normalized;

    if (input._flatpickr) {
      input._flatpickr.destroy();
    }

    factory(input, {
      locale: factory?.l10ns?.id || "default",
      dateFormat: "Y/m/d",
      altInput: false,
      allowInput: true,
      disableMobile: true,
      defaultDate: normalized || null,
      appendTo: document.body,
      positionElement: input,
      position: "below left",
      monthSelectorType: "static",
      onValueUpdate: (_selectedDates, dateStr, instance) => {
        syncDatePickerValue(instance, dateStr);
      },
    });
  }
}

function syncDatePickerValue(instance, dateStr) {
  if (!instance?.input) {
    return;
  }

  const nextValue = normalizeDateToNusuk(dateStr || instance.input.value || "");
  const currentValue = String(instance.input.value ?? "").trim();
  if (nextValue === currentValue) {
    return;
  }

  instance.input.value = nextValue;
  instance.input.dispatchEvent(new Event("change", { bubbles: true }));
}

function showFatalScreen(message) {
  if (!document?.body) {
    return;
  }

  document.body.innerHTML = `
    <main style="min-height:100vh;display:grid;place-items:center;padding:32px;background:#f9f9fd;color:#191c1e;font-family:Inter,Segoe UI,sans-serif;">
      <section style="width:min(720px,100%);padding:28px;border-radius:14px;background:#ffffff;box-shadow:0 16px 40px rgba(25,28,30,.06);">
        <p style="margin:0 0 8px;color:#626875;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;">Frontend Error</p>
        <h1 style="margin:0 0 12px;font-size:32px;line-height:1.1;">Halaman gagal dimuat</h1>
        <p style="margin:0 0 16px;color:#626875;">Frontend mengalami error saat startup. Pesan yang terbaca:</p>
        <pre style="margin:0;padding:16px;border-radius:10px;background:#f3f3f7;color:#191c1e;white-space:pre-wrap;word-break:break-word;">${escapeHtml(message)}</pre>
      </section>
    </main>
  `;
}

