import {
  basenameFromPath,
  parentPath,
  formatRecentStamp,
  formatConfidence,
  formatProgressValue,
  formatDurationMs,
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
  renderEmptyDetailPanel,
  renderReviewFlagsPanel,
  renderFieldConfidencePanel,
} from "./main-review-panels.js";
import {
  countMembersByStatus as countMembersByStatusFromMembers,
  isMemberReadyForEntry,
  memberReviewStatus,
  computeReviewCompletionState,
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
  if (!tauri?.core || !tauri?.event || !tauri?.dialog) {
    throw new Error("Binding Tauri belum tersedia di jendela aplikasi.");
  }

  return {
    invoke: tauri.core.invoke,
    listen: tauri.event.listen,
    open: tauri.dialog.open,
    convertFileSrc: typeof tauri.core.convertFileSrc === "function" ? tauri.core.convertFileSrc : null,
  };
}

function errorMessage(error) {
  if (error instanceof Error) {
    return error.message || error.name || "Terjadi error yang tidak diketahui.";
  }
  return String(error ?? "Terjadi error yang tidak diketahui.");
}

function runAction(action, label = "Aksi aplikasi") {
  try {
    const result = typeof action === "function" ? action() : action;
    if (result && typeof result.then === "function") {
      result.catch((error) => reportRuntimeError(error, label));
    }
  } catch (error) {
    reportRuntimeError(error, label);
  }
}

function closestFromEventTarget(target, selector) {
  const element = target instanceof Element ? target : target?.parentElement;
  return element?.closest?.(selector) ?? null;
}

const STORAGE_KEYS = {
  recentBatches: "passport-assistant-recent-batches-v1",
};
const OCR_MODE_VALUES = new Set(["speed", "balanced", "heavy"]);
const OCR_MODE_LABELS = {
  speed: "Speed",
  balanced: "Balanced",
  heavy: "Heavy",
};
const DEFAULT_OCR_MODE = "speed";

const CHILD_AGE_LIMIT = 18;
const COMPANION_RELATION_OPTIONS = [
  "Other",
  "Father",
  "Son",
  "Brother",
  "Grandfather",
  "Grandson",
  "Maternal Uncle",
  "Niece (Brother side)",
  "Mother",
  "Daughter",
  "Sister",
  "Grandmother",
  "Granddaughter",
  "Maternal Aunt",
  "Niece (Sister side)",
  "Nephew (Brother side)",
  "Nephew (Sister side)",
  "Mother in law",
  "Women Set",
  "Daughter in law",
  "Son in law",
  "Step Mother",
  "Step Father",
  "Father in law",
  "Paternal Aunt",
  "Paternal Uncle",
  "Wife",
  "Husband",
  "Wife's father",
  "Husband's mother",
  "Husband's father",
  "Brother in law (Wife's brother)",
  "Brother in law (Husband's brother)",
];
const DEFAULT_COMPANION_RELATION = "Mother";
const OPTIONAL_EMPTY_REVIEW_FIELDS = new Set([
  "fatherName",
  "grandfatherName",
  "arabic.fatherName",
  "arabic.grandfatherName",
]);
const PASSPORT_PREVIEW_ZOOM_DEFAULT = 1;
const PASSPORT_PREVIEW_ZOOM_MIN = 0.85;
const PASSPORT_PREVIEW_ZOOM_MAX = 2.5;
const PASSPORT_PREVIEW_ZOOM_STEP = 0.15;
const PASSPORT_PREVIEW_WHEEL_STEP = 0.1;
const PASSPORT_PREVIEW_WHEEL_THRESHOLD = 120;

const state = {
  currentPage: "import",
  validationFilter: "all",
  selectedDir: "",
  ocrMode: DEFAULT_OCR_MODE,
  recentBatches: [],
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
  reviewCount: 0,
  progressCurrent: 0,
  progressTotal: 0,
  progressFileName: "",
  progressStageLabel: "",
  isEntryRunning: false,
  exportedBatchPath: "",
  exportError: "",
  entryLogs: [],
  lastWorkerMessage: "",
  scanLogs: [],
  scanPerfSummary: null,
  scanMetricRecords: [],
  lastScanMetric: null,
  showFullScanLog: false,
  activeFieldCategory: "identity",
  passportImageCache: new Map(),
  passportPreviewZoom: PASSPORT_PREVIEW_ZOOM_DEFAULT,
  reviewBlock: null,
  statusHeadline: "",
  statusDetail: "",
  isScanning: false,
  isStoppingScan: false,
  isStartingScan: false,
  isChoosingFolder: false,
};

const dom = {};
let rescanConfirmResolver = null;
let recentDeletePath = "";
let recentEditPath = "";
let passportDeleteMemberId = "";
let passportImageRequestId = 0;
let passportPreviewWheelDelta = 0;
const requestFrame = typeof window.requestAnimationFrame === "function"
  ? window.requestAnimationFrame.bind(window)
  : (callback) => window.setTimeout(callback, 16);
const cancelFrame = typeof window.cancelAnimationFrame === "function"
  ? window.cancelAnimationFrame.bind(window)
  : (handle) => window.clearTimeout(handle);
let renderAllHandle = null;
let renderAllQueued = false;
let manifestSaveTimer = null;
let manifestSaveSequence = 0;
let hasCompletedStartup = false;
const MANIFEST_SAVE_DELAY_MS = 350;

window.addEventListener("error", (event) => {
  const message = errorMessage(event.error ?? event.message ?? "Terjadi error yang tidak diketahui.");
  if (hasCompletedStartup) {
    event.preventDefault();
    reportRuntimeError(message, "Aksi aplikasi");
    return;
  }
  showFatalScreen(message);
});

window.addEventListener("unhandledrejection", (event) => {
  const message = errorMessage(event.reason ?? "Promise ditolak tanpa pesan.");
  if (hasCompletedStartup) {
    event.preventDefault();
    reportRuntimeError(message, "Aksi aplikasi");
    return;
  }
  showFatalScreen(message);
});

window.addEventListener("DOMContentLoaded", async () => {
  try {
    state.recentBatches = loadRecentBatches();
    state.ocrMode = loadOcrMode();
    bindDom();
    bindActions();
    renderAll();
    hasCompletedStartup = true;
  } catch (error) {
    showFatalScreen(error instanceof Error ? error.message : String(error));
    return;
  }

  try {
    await setupEventBridge();
  } catch (error) {
    reportRuntimeError(error, "Koneksi desktop");
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
  dom.folderDropzone = document.querySelector("#folder-dropzone");
  dom.selectedFolderName = document.querySelector("#selected-folder-name");
  dom.selectedFolderCaption = document.querySelector("#selected-folder-caption");
  dom.importFooterText = document.querySelector("#import-footer-text");
  dom.folderPath = document.querySelector("#folder-path");
  dom.chooseFolderButton = document.querySelector("#choose-folder-button");
  dom.ocrModeInputs = [...document.querySelectorAll("input[name='ocr-mode']")];
  dom.scanButton = document.querySelector("#scan-button");
  dom.stopScanButton = document.querySelector("#stop-scan-button");
  dom.importNextButton = document.querySelector("#import-next-button");
  dom.rescanConfirmModal = document.querySelector("#rescan-confirm-modal");
  dom.rescanModalTitle = document.querySelector("#rescan-modal-title");
  dom.rescanModalDesc = document.querySelector("#rescan-modal-desc");
  dom.rescanConfirmButton = document.querySelector("#rescan-confirm-button");
  dom.rescanCancelButton = document.querySelector("#rescan-cancel-button");
  dom.stopScanConfirmModal = document.querySelector("#stop-scan-confirm-modal");
  dom.stopScanConfirmButton = document.querySelector("#stop-scan-confirm-button");
  dom.stopScanCancelButton = document.querySelector("#stop-scan-cancel-button");
  dom.recentDeleteModal = document.querySelector("#recent-delete-modal");
  dom.recentDeleteModalDesc = document.querySelector("#recent-delete-modal-desc");
  dom.recentDeleteConfirmButton = document.querySelector("#recent-delete-confirm-button");
  dom.recentDeleteCancelButton = document.querySelector("#recent-delete-cancel-button");
  dom.recentEditModal = document.querySelector("#recent-edit-modal");
  dom.recentEditInput = document.querySelector("#recent-edit-input");
  dom.recentEditSaveButton = document.querySelector("#recent-edit-save-button");
  dom.recentEditCancelButton = document.querySelector("#recent-edit-cancel-button");
  dom.passportDeleteModal = document.querySelector("#passport-delete-modal");
  dom.passportDeleteModalDesc = document.querySelector("#passport-delete-modal-desc");
  dom.passportDeleteConfirmButton = document.querySelector("#passport-delete-confirm-button");
  dom.passportDeleteCancelButton = document.querySelector("#passport-delete-cancel-button");
  dom.reviewCompleteModal = document.querySelector("#review-complete-modal");
  dom.reviewCompleteModalDesc = document.querySelector("#review-complete-modal-desc");
  dom.reviewCompleteCancelButton = document.querySelector("#review-complete-cancel-button");
  dom.reviewCompleteExportButton = document.querySelector("#review-complete-export-button");
  dom.reviewPreviewExportButton = document.querySelector("#review-preview-export-button");
  dom.reviewExportStatus = document.querySelector("#review-export-status");
  dom.reviewExportSummary = document.querySelector("#review-export-summary");
  dom.reviewExportPreviewBody = document.querySelector("#review-export-preview-body");
  dom.reviewExportResult = document.querySelector("#review-export-result");
  dom.entryStatusPill = document.querySelector("#entry-status-pill");
  dom.entryExportDescription = document.querySelector("#entry-export-description");
  dom.entryExportSummary = document.querySelector("#entry-export-summary");
  dom.entryExportPreviewBody = document.querySelector("#entry-export-preview-body");
  dom.entryExportResult = document.querySelector("#entry-export-result");
  dom.entryBackReviewButton = document.querySelector("#entry-back-review-button");
  dom.prepareEntryButton = document.querySelector("#prepare-entry-button");
  dom.entryLogBox = document.querySelector("#entry-log-box");
  dom.entryLogCounter = document.querySelector("#entry-log-counter");
  dom.entryLogClearButton = document.querySelector("#entry-log-clear-button");
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
  dom.scanStatAverage = document.querySelector("#scan-stat-average");
  dom.scanStatLastTime = document.querySelector("#scan-stat-last-time");

  dom.batchBadge = document.querySelector("#batch-badge");
  dom.filterButtons = [...document.querySelectorAll("button[data-validation-filter]")];
  dom.filterAllCount = document.querySelector("#filter-all-count");
  dom.filterErrorCount = document.querySelector("#filter-error-count");
  dom.filterValidCount = document.querySelector("#filter-valid-count");
  dom.passportList = document.querySelector("#passport-list");
  dom.passportListSummary = document.querySelector("#passport-list-summary");
  dom.passportPagePrevButton = document.querySelector("#passport-page-prev-button");
  dom.passportPageNextButton = document.querySelector("#passport-page-next-button");
  dom.passportPreviewFrame = document.querySelector("#passport-preview-frame");
  dom.passportPreviewImage = document.querySelector("#passport-preview-image");
  dom.passportPreviewEmpty = document.querySelector("#passport-preview-empty");
  dom.passportPreviewName = document.querySelector("#passport-preview-name");
  dom.passportPreviewFile = document.querySelector("#passport-preview-file");
  dom.passportPreviewStatus = document.querySelector("#passport-preview-status");
  dom.passportZoomOutButton = document.querySelector("#passport-zoom-out-button");
  dom.passportZoomInButton = document.querySelector("#passport-zoom-in-button");
  dom.passportZoomResetButton = document.querySelector("#passport-zoom-reset-button");
  dom.passportZoomLabel = document.querySelector("#passport-zoom-label");
  dom.passportReviewProgress = document.querySelector("#passport-review-progress");
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
  dom.deletePassportButton = document.querySelector("#delete-passport-button");
  dom.saveNextButton = document.querySelector("#save-next-button");
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
    runAction(() => chooseFolder(), "Pilih folder");
  });

  dom.folderDropzone.addEventListener("click", (event) => {
    if (
      state.isScanning
      || state.isChoosingFolder
      || closestFromEventTarget(event.target, "button")
      || closestFromEventTarget(event.target, "input")
    ) {
      return;
    }
    runAction(() => chooseFolder(), "Pilih folder");
  });

  dom.folderDropzone.addEventListener("keydown", (event) => {
    if (state.isScanning || state.isChoosingFolder) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      runAction(() => chooseFolder(), "Pilih folder");
    }
  });

  dom.scanButton.addEventListener("click", () => {
    runAction(() => handleScanButtonClick(), "Mulai scan");
  });
  for (const input of dom.ocrModeInputs) {
    input.addEventListener("change", (event) => {
      runAction(() => handleOcrModeChange(event), "Ganti mode OCR");
    });
  }
  dom.stopScanButton?.addEventListener("click", openStopScanModal);
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
  dom.stopScanConfirmButton?.addEventListener("click", () => {
    runAction(() => confirmStopScan(), "Stop scan");
  });
  dom.stopScanCancelButton?.addEventListener("click", closeStopScanModal);
  dom.stopScanConfirmModal?.addEventListener("click", (event) => {
    if (event.target === dom.stopScanConfirmModal) {
      closeStopScanModal();
    }
  });
  dom.recentDeleteConfirmButton?.addEventListener("click", confirmRecentDelete);
  dom.recentDeleteCancelButton?.addEventListener("click", closeRecentDeleteModal);
  dom.recentDeleteModal?.addEventListener("click", (event) => {
    if (event.target === dom.recentDeleteModal) {
      closeRecentDeleteModal();
    }
  });
  dom.recentEditSaveButton?.addEventListener("click", confirmRecentEdit);
  dom.recentEditCancelButton?.addEventListener("click", closeRecentEditModal);
  dom.recentEditModal?.addEventListener("click", (event) => {
    if (event.target === dom.recentEditModal) {
      closeRecentEditModal();
    }
  });
  dom.recentEditInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      confirmRecentEdit();
    }
  });
  dom.passportDeleteConfirmButton?.addEventListener("click", confirmPassportDelete);
  dom.passportDeleteCancelButton?.addEventListener("click", closePassportDeleteModal);
  dom.passportDeleteModal?.addEventListener("click", (event) => {
    if (event.target === dom.passportDeleteModal) {
      closePassportDeleteModal();
    }
  });
  dom.reviewCompleteCancelButton?.addEventListener("click", closeReviewCompleteModal);
  dom.reviewCompleteExportButton?.addEventListener("click", () => {
    runAction(() => handlePrepareEntry(), "Export JSON");
  });
  dom.reviewPreviewExportButton?.addEventListener("click", () => {
    setPage("entry");
  });
  dom.reviewCompleteModal?.addEventListener("click", (event) => {
    if (event.target === dom.reviewCompleteModal) {
      closeReviewCompleteModal();
    }
  });
  dom.entryBackReviewButton?.addEventListener("click", () => {
    setPage("validation");
  });
  dom.prepareEntryButton?.addEventListener("click", () => {
    runAction(() => handlePrepareEntry(), "Export JSON");
  });
  dom.reviewExportPreviewBody?.addEventListener("click", handleExportPreviewMemberClick);
  dom.entryExportPreviewBody?.addEventListener("click", handleExportPreviewMemberClick);
  dom.entryLogClearButton?.addEventListener("click", () => {
    state.entryLogs = [];
    renderEntryLogs();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !dom.rescanConfirmModal?.classList.contains("is-hidden")) {
      resolveRescanConfirmation(false);
      return;
    }
    if (event.key === "Escape" && !dom.stopScanConfirmModal?.classList.contains("is-hidden")) {
      closeStopScanModal();
      return;
    }
    if (event.key === "Escape" && !dom.recentDeleteModal?.classList.contains("is-hidden")) {
      closeRecentDeleteModal();
      return;
    }
    if (event.key === "Escape" && !dom.recentEditModal?.classList.contains("is-hidden")) {
      closeRecentEditModal();
      return;
    }
    if (event.key === "Escape" && !dom.passportDeleteModal?.classList.contains("is-hidden")) {
      closePassportDeleteModal();
      return;
    }
    if (event.key === "Escape" && !dom.reviewCompleteModal?.classList.contains("is-hidden")) {
      closeReviewCompleteModal();
    }
  });
  dom.scanLogToggle?.addEventListener("click", () => {
    state.showFullScanLog = !state.showFullScanLog;
    renderScanLogs();
  });

  dom.recentBatchesList.addEventListener("click", (event) => {
    const editButton = closestFromEventTarget(event.target, "[data-recent-edit-path]");
    if (editButton) {
      event.preventDefault();
      event.stopPropagation();
      openRecentEditModal(editButton.dataset.recentEditPath ?? "");
      return;
    }

    const deleteButton = closestFromEventTarget(event.target, "[data-recent-delete-path]");
    if (deleteButton) {
      event.preventDefault();
      event.stopPropagation();
      openRecentDeleteModal(deleteButton.dataset.recentDeletePath ?? "");
      return;
    }

    const item = closestFromEventTarget(event.target, "[data-recent-path]");
    if (!item) {
      return;
    }
    const recentPath = String(item.dataset.recentPath ?? "").trim();
    if (!recentPath) {
      return;
    }
    runAction(() => openRecentBatch(recentPath), "Buka riwayat");
  });

  dom.recentBatchesList.addEventListener("keydown", (event) => {
    if (closestFromEventTarget(event.target, "button") || (event.key !== "Enter" && event.key !== " ")) {
      return;
    }
    const item = closestFromEventTarget(event.target, "[data-recent-path]");
    if (!item) {
      return;
    }
    event.preventDefault();
    runAction(() => openRecentBatch(item.dataset.recentPath ?? ""), "Buka riwayat");
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

  dom.passportList?.addEventListener("click", (event) => {
    const row = closestFromEventTarget(event.target, "[data-member-id]");
    if (!row) {
      return;
    }

    state.activeMemberId = row.dataset.memberId ?? "";
    syncPassportPageWithActiveMember();
    renderAll();
  });

  dom.fieldReviewRows.addEventListener("change", (event) => {
    const companionSelect = closestFromEventTarget(event.target, "select[data-companion-select]");
    if (companionSelect) {
      updateActiveMemberCompanion(companionSelect.value);
      scheduleRenderAll();
      return;
    }

    const companionRelationSelect = closestFromEventTarget(event.target, "select[data-companion-relation-select]");
    if (companionRelationSelect) {
      updateActiveMemberCompanionRelation(companionRelationSelect.value);
      scheduleRenderAll();
      return;
    }

    const input = closestFromEventTarget(event.target, "input[data-field-key]");
    if (!input) {
      return;
    }

    updateActiveMemberField(input.dataset.fieldKey, input.value);
    scheduleRenderAll();
  });

  dom.resetFieldsButton.addEventListener("click", resetActiveMemberFields);
  dom.deletePassportButton?.addEventListener("click", () => {
    openPassportDeleteModal();
  });
  dom.saveNextButton?.addEventListener("click", handleSaveAndNext);
  dom.fieldCategoryTabs?.addEventListener("click", (event) => {
    const button = closestFromEventTarget(event.target, "button[data-field-category]");
    if (!button) {
      return;
    }
    state.activeFieldCategory = button.dataset.fieldCategory ?? "identity";
    renderWorkspace();
  });
  dom.passportPagePrevButton?.addEventListener("click", () => {
    moveActiveMember(-1);
  });
  dom.passportPageNextButton?.addEventListener("click", () => {
    moveActiveMember(1);
  });
  dom.passportZoomOutButton?.addEventListener("click", () => {
    changePassportPreviewZoom(-PASSPORT_PREVIEW_ZOOM_STEP);
  });
  dom.passportZoomInButton?.addEventListener("click", () => {
    changePassportPreviewZoom(PASSPORT_PREVIEW_ZOOM_STEP);
  });
  dom.passportZoomResetButton?.addEventListener("click", resetPassportPreviewZoom);
  dom.passportPreviewFrame?.addEventListener("wheel", handlePassportPreviewWheel, { passive: false });
  dom.passportPreviewFrame?.addEventListener("keydown", handlePassportPreviewKeydown);

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
        state.isStartingScan = false;
        state.isStoppingScan = false;
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
  });

}

async function chooseFolder() {
  if (state.isScanning || state.isChoosingFolder) {
    return;
  }

  state.isChoosingFolder = true;
  state.statusHeadline = "Membuka pilihan folder";
  state.statusDetail = "Pilih folder passport yang ingin diproses.";
  renderAll();

  try {
    const { open } = tauriBindings();
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Pilih folder passport",
    });

    if (typeof selected === "string") {
      updateSelectedDir(selected);
    } else {
      state.statusHeadline = state.selectedDir ? "Folder tetap dipakai" : "Folder belum dipilih";
      state.statusDetail = state.selectedDir
        ? `Masih memakai folder ${basenameFromPath(state.selectedDir)}.`
        : "Pilih folder passport sebelum memulai proses.";
    }
  } finally {
    state.isChoosingFolder = false;
    renderAll();
  }
}

async function startScan() {
  state.selectedDir = dom.folderPath.value.trim();
  updateOcrMode(state.ocrMode);
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
  state.reviewCount = 0;
  state.progressCurrent = 0;
  state.progressTotal = 0;
  state.progressFileName = "";
  state.progressStageLabel = "";
  state.lastWorkerMessage = "";
  state.scanLogs = [];
  state.scanPerfSummary = null;
  state.scanMetricRecords = [];
  state.lastScanMetric = null;
  state.exportedBatchPath = "";
  state.exportError = "";
  state.validationFilter = "all";
  state.passportListPage = 1;
  state.isScanning = true;
  state.isStoppingScan = false;
  state.statusHeadline = "Memulai proses";
  state.statusDetail = "Sedang menyiapkan pembacaan data.";
  appendScanLog(`Memulai proses untuk folder ${state.selectedDir}`);
  appendScanLog(`Mode OCR: ${ocrModeLabel(state.ocrMode)}`);
  renderAll();

  try {
    const { invoke } = tauriBindings();
    await invoke("start_scan", { selectedDir: state.selectedDir, ocrMode: state.ocrMode });
  } catch (error) {
    state.isScanning = false;
    state.isStoppingScan = false;
    state.statusHeadline = "Scan gagal dimulai";
    state.statusDetail = String(error);
    renderAll();
  }
}

async function handleScanButtonClick() {
  if (state.isScanning || state.isStartingScan) {
    return;
  }

  state.isStartingScan = true;
  renderAll();
  try {
    const hasAnyResult = hasAnyScanResult();
    const hasResultForSelected = hasScanResultForSelectedDir();
    if (hasAnyResult) {
      const mode = hasResultForSelected ? "rescan-same" : "replace-folder";
      const confirmed = await requestRescanConfirmation(mode);
      if (!confirmed) {
        return;
      }
    }
    await startScan();
  } finally {
    if (!state.isScanning) {
      state.isStartingScan = false;
      renderAll();
    }
  }
}

function openStopScanModal() {
  if (!state.isScanning || state.isStoppingScan) {
    return;
  }
  if (!dom.stopScanConfirmModal) {
    runAction(() => confirmStopScan(), "Stop scan");
    return;
  }

  dom.stopScanConfirmModal.classList.remove("is-hidden");
  dom.stopScanConfirmModal.setAttribute("aria-hidden", "false");
  requestFrame(() => dom.stopScanCancelButton?.focus());
}

function closeStopScanModal() {
  if (!dom.stopScanConfirmModal) {
    return;
  }
  dom.stopScanConfirmModal.classList.add("is-hidden");
  dom.stopScanConfirmModal.setAttribute("aria-hidden", "true");
}

async function confirmStopScan() {
  closeStopScanModal();
  if (!state.isScanning || state.isStoppingScan) {
    return;
  }

  state.isStoppingScan = true;
  state.statusHeadline = "Menghentikan scan";
  state.statusDetail = "Meminta worker OCR berhenti...";
  appendScanLog("Mengirim permintaan stop scan.");
  renderAll();

  try {
    const { invoke } = tauriBindings();
    await invoke("stop_scan");
  } catch (error) {
    state.isStoppingScan = false;
    state.statusHeadline = "Stop scan gagal";
    state.statusDetail = String(error || "Worker OCR tidak berhasil dihentikan.");
    appendScanLog(`Stop scan gagal | ${state.statusDetail}`);
    renderAll();
  }
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
  state.reviewedMemberIds = confirmedReviewIds(manifest);
  state.passportImageCache.clear();
  state.exportedBatchPath = "";
  state.exportError = "";
  recalculateMetrics();
  ensureVisibleActiveMember();
}

async function openRecentBatch(path) {
  const normalizedPath = String(path ?? "").trim();
  if (!normalizedPath) {
    return;
  }

  state.selectedDir = normalizedPath;
  state.currentPage = "import";
  state.scanPerfSummary = null;
  state.scanMetricRecords = [];
  state.lastScanMetric = null;
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

async function handlePrepareEntry() {
  if (state.isEntryRunning) {
    appendEntryLog("Export JSON masih berjalan. Tunggu proses aktif selesai.", "warn");
    return;
  }

  appendEntryLog("Tombol Export JSON diklik.");
  state.exportError = "";
  if (!state.manifestPath || !state.manifest) {
    state.statusHeadline = "Belum ada hasil scan";
    state.statusDetail = "Jalankan proses terlebih dahulu sebelum membuat JSON untuk extension.";
    appendEntryLog("Gagal export: manifest belum tersedia.", "error");
    renderAll();
    return;
  }

  const review = reviewCompletionState();
  if (review.remaining > 0) {
    state.exportError = `Masih ada ${review.remaining} data yang belum ditandai siap.`;
    state.statusHeadline = "Review belum selesai";
    state.statusDetail = `Masih ada ${review.remaining} data yang belum ditandai siap sebelum membuat JSON untuk extension.`;
    state.currentPage = "validation";
    appendEntryLog(`Gagal export: review belum selesai (${review.remaining} data belum siap).`, "warn");
    renderAll();
    return;
  }

  const requiredFieldsIssue = requiredFieldBlockingIssueForBatch();
  if (!requiredFieldsIssue.ok) {
    state.exportError = requiredFieldsIssue.message;
    appendEntryLog(`Gagal export: ${requiredFieldsIssue.message}`, "warn");
    showBatchReviewBlockingMessage(requiredFieldsIssue);
    return;
  }

  const companionValidation = validateCompanionsBeforeExport();
  if (!companionValidation.ok) {
    state.exportError = companionValidation.message;
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

  if (!canExportReviewedJson()) {
    state.exportError = "Tidak ada passport valid yang sudah direview untuk diexport.";
    state.statusHeadline = "Tidak ada data export";
    state.statusDetail = state.exportError;
    appendEntryLog(`Gagal export: ${state.exportError}`, "warn");
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
    await flushManifestSave();
    const exportManifest = buildManifestForEntryExport();
    const selectedIds = Array.from(state.selectedIds);
    const batchPath = await invoke("create_nusuk_batch", {
      manifestPath: state.manifestPath,
      selectedIds,
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
    state.exportError = rawError || "Gagal membuat JSON untuk extension.";
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
      const relation = normalizeCompanionRelation(nextMember.companionRelation || nextMember.companion?.relation || inferDefaultCompanionRelation(nextMember, companion));
      nextMember.companionRelation = relation;
      nextMember.companion = buildCompanionSnapshot(companion, relation);
    }
  } else {
    delete nextMember.companionMemberId;
    delete nextMember.companionRelation;
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

function reviewCompletionValidation(member) {
  if (!member) {
    return { ok: false, message: "Belum ada passport aktif untuk direview.", categoryId: "", fieldKey: "" };
  }

  const companionIssue = companionBlockingIssue(member);
  if (companionIssue) {
    return companionIssue;
  }

  const missingFields = missingRequiredReviewFields(member);
  if (missingFields.length) {
    const visibleLabels = missingFields.slice(0, 3).map((item) => item.label).join(", ");
    const suffix = missingFields.length > 3 ? ` dan ${missingFields.length - 3} lainnya` : "";
    return {
      ok: false,
      target: "field",
      message: `${missingFields.length} data wajib belum diisi: ${visibleLabels}${suffix}.`,
      categoryId: missingFields[0].categoryId,
      fieldKey: missingFields[0].key,
    };
  }

  return { ok: true, message: "", categoryId: "", fieldKey: "" };
}

function requiredFieldBlockingIssueForBatch() {
  for (const member of manifestMembers()) {
    if (memberReviewStatus(member) === "ERROR") {
      continue;
    }

    const missingFields = missingRequiredReviewFields(member);
    if (!missingFields.length) {
      continue;
    }

    const visibleLabels = missingFields.slice(0, 3).map((item) => item.label).join(", ");
    const suffix = missingFields.length > 3 ? ` dan ${missingFields.length - 3} lainnya` : "";
    return {
      ok: false,
      target: "field",
      memberId: String(member.id || ""),
      message: `${memberDisplayName(member)} belum lengkap: ${visibleLabels}${suffix}.`,
      categoryId: missingFields[0].categoryId,
      fieldKey: missingFields[0].key,
    };
  }

  return { ok: true, message: "", categoryId: "", fieldKey: "", memberId: "" };
}

function showBatchReviewBlockingMessage(validation) {
  if (validation.memberId) {
    state.activeMemberId = validation.memberId;
    syncPassportPageWithActiveMember();
  }
  state.currentPage = "validation";
  showReviewBlockingMessage(validation);
}

function companionBlockingIssue(member) {
  const childInfo = childInfoForMember(member);
  if (!childInfo.isChild) {
    return null;
  }

  const companionId = String(member.companionMemberId || "").trim();
  const companion = manifestMembers().find((candidate) => String(candidate.id || "") === companionId);
  if (companion && !childInfoForMember(companion).isChild) {
    return null;
  }

  return {
    ok: false,
    target: "companion",
    message: "Companion dewasa wajib dipilih sebelum lanjut ke passport berikutnya.",
    categoryId: FIELD_CATEGORY_PAIRS[0]?.id ?? "identity",
    fieldKey: "",
  };
}

function missingRequiredReviewFields(member) {
  const resolved = ensureResolvedProfile(member);
  return REVIEW_FIELDS
    .filter(([key]) => !rawValueFrom(resolved, key))
    .filter(([key]) => !isReviewFieldAllowedEmpty(member, key))
    .map(([key, label]) => ({
      key,
      label,
      categoryId: fieldCategoryPairIdForKey(key),
    }));
}

function isReviewFieldAllowedEmpty(member, key) {
  if (OPTIONAL_EMPTY_REVIEW_FIELDS.has(key)) {
    return true;
  }
  return fieldFlagsForMember(member, key).includes("INTENTIONAL_EMPTY");
}

function fieldCategoryPairIdForKey(key) {
  for (const pair of FIELD_CATEGORY_PAIRS) {
    const categoryKeys = pair.categoryIds
      .map((categoryId) => FIELD_CATEGORY_DEFS.find((item) => item.id === categoryId))
      .filter(Boolean)
      .flatMap((category) => category.keys);
    if (categoryKeys.includes(key)) {
      return pair.id;
    }
  }
  return FIELD_CATEGORY_PAIRS[0]?.id ?? "identity";
}

function showReviewBlockingMessage(validation) {
  state.reviewBlock = {
    target: validation.target || (validation.fieldKey ? "field" : ""),
    fieldKey: validation.fieldKey || "",
    token: Date.now(),
  };
  if (validation.categoryId) {
    state.activeFieldCategory = validation.categoryId;
  }
  state.statusHeadline = "Review belum lengkap";
  state.statusDetail = validation.message || "Lengkapi data yang masih perlu dicek sebelum lanjut.";
  renderAll();
  if (validation.fieldKey) {
    focusReviewField(validation.fieldKey);
  } else if (validation.target === "companion") {
    focusCompanionSelect();
  }
}

function clearReviewBlock() {
  state.reviewBlock = null;
}

function focusReviewField(fieldKey) {
  requestFrame(() => {
    const input = [...dom.fieldReviewRows.querySelectorAll("[data-field-key]")]
      .find((node) => node.dataset.fieldKey === fieldKey);
    input?.focus();
    input?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

function focusCompanionSelect() {
  requestFrame(() => {
    const select = dom.fieldReviewRows.querySelector("[data-companion-select]");
    select?.focus();
    select?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

function isMemberReviewConfirmed(member) {
  return Boolean(member?.reviewConfirmed === true || state.reviewedMemberIds.has(member?.id));
}

function confirmMemberReview(member) {
  if (!member?.id) {
    return;
  }
  member.reviewConfirmed = true;
  state.reviewedMemberIds.add(member.id);
}

function clearMemberReviewConfirmation(member) {
  if (!member?.id) {
    return;
  }
  delete member.reviewConfirmed;
  state.reviewedMemberIds.delete(member.id);
}

function updateActiveMemberField(fieldKey, nextValue) {
  const member = activeMember();
  if (!member || !fieldKey) {
    return;
  }

  clearReviewBlock();
  const resolved = ensureResolvedProfile(member);
  setValueByPath(resolved, fieldKey, normalizeInputValueForField(fieldKey, nextValue));
  syncMemberChildMetadata(member);
  clearMemberReviewConfirmation(member);
  scheduleManifestSave();
  state.statusHeadline = "Perubahan lokal tersimpan";
  state.statusDetail = `${humanizeFieldPath(`resolvedProfile.${fieldKey}`)} diperbarui di sesi review.`;
}

function updateActiveMemberCompanion(companionMemberId) {
  const member = activeMember();
  if (!member) {
    return;
  }

  clearReviewBlock();
  const normalizedId = String(companionMemberId || "").trim();
  syncMemberChildMetadata(member);
  if (normalizedId) {
    const companion = manifestMembers().find((item) => String(item.id || "") === normalizedId);
    if (!companion) {
      return;
    }
    member.companionMemberId = normalizedId;
    const relation = normalizeCompanionRelation(member.companionRelation || member.companion?.relation || inferDefaultCompanionRelation(member, companion));
    member.companionRelation = relation;
    member.companion = buildCompanionSnapshot(companion, relation);
    state.selectedIds.add(normalizedId);
    state.statusHeadline = "Companion dipilih";
    state.statusDetail = `${memberDisplayName(companion)} dipilih sebagai companion untuk ${memberDisplayName(member)} dengan relation ${relation}.`;
  } else {
    delete member.companionMemberId;
    delete member.companionRelation;
    delete member.companion;
    state.statusHeadline = "Companion dikosongkan";
    state.statusDetail = `${memberDisplayName(member)} belum memiliki companion.`;
  }
  clearMemberReviewConfirmation(member);
  scheduleManifestSave();
}

function updateActiveMemberCompanionRelation(value) {
  const member = activeMember();
  if (!member) {
    return;
  }
  clearReviewBlock();
  const companionId = String(member.companionMemberId || "").trim();
  const companion = manifestMembers().find((item) => String(item.id || "") === companionId);
  if (!companion) {
    return;
  }
  const relation = normalizeCompanionRelation(value);
  member.companionRelation = relation;
  member.companion = buildCompanionSnapshot(companion, relation);
  state.statusHeadline = "Relation companion diperbarui";
  state.statusDetail = `${relation} dipilih sebagai relation untuk companion ${memberDisplayName(companion)}.`;
  clearMemberReviewConfirmation(member);
  scheduleManifestSave();
}

function resetActiveMemberFields() {
  const member = activeMember();
  if (!member || !state.originalManifest) {
    return;
  }

  clearReviewBlock();
  const originalMember = originalMemberById(member.id);
  if (!originalMember) {
    return;
  }

  const resetMember = cloneJson(originalMember);
  delete resetMember.reviewConfirmed;
  replaceMemberInManifest(member.id, resetMember);
  state.reviewedMemberIds.delete(member.id);
  state.statusHeadline = "Field di-reset";
  state.statusDetail = "Perubahan untuk passport aktif dikembalikan ke hasil scan awal.";
  scheduleManifestSave(0);
  renderAll();
}

function markActiveMemberValid() {
  const member = activeMember();
  if (!member) {
    return;
  }

  member.status = "VALID";
  member.reviewStatus = "VALID";
  member.requiresReview = false;
  member.reviewReasons = [];
  state.selectedIds.add(member.id);
  confirmMemberReview(member);
  state.statusHeadline = "Passport ditandai valid";
  state.statusDetail = `${memberDisplayName(member)} ditandai siap untuk batch entry.`;
  recalculateMetrics();
  scheduleManifestSave(0);
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

  if (isFinalReviewCompleteAction(member)) {
    const validation = reviewCompletionValidation(member);
    if (!validation.ok) {
      showReviewBlockingMessage(validation);
      return;
    }
    openReviewCompleteModal();
    return;
  }

  if (nextPair) {
    state.activeFieldCategory = nextPair.id;
    state.statusHeadline = "Lanjut kategori review";
    state.statusDetail = `${memberDisplayName(member)} lanjut ke ${nextPair.label}.`;
    renderAll();
    return;
  }

  const validation = reviewCompletionValidation(member);
  if (!validation.ok) {
    showReviewBlockingMessage(validation);
    return;
  }

  member.status = "VALID";
  member.reviewStatus = "VALID";
  member.requiresReview = false;
  member.reviewReasons = [];
  clearReviewBlock();
  state.selectedIds.add(member.id);
  confirmMemberReview(member);
  state.statusHeadline = "Review data selesai";
  const canMoveNext = activeNavigationState().canMoveNext;
  const review = reviewCompletionState();
  const isAllReviewDone = review.total > 0 && review.remaining === 0;
  state.statusDetail = isAllReviewDone
      ? `${review.reviewed}/${review.total} passport sudah direview. Preview export JSON siap dibuka.`
      : canMoveNext
        ? `${memberDisplayName(member)} ditandai siap dan berpindah ke data berikutnya.`
        : `${memberDisplayName(member)} ditandai siap. Tidak ada passport berikutnya di antrean ini.`;
  recalculateMetrics();
  scheduleManifestSave(0);
  if (canMoveNext && !isAllReviewDone) {
    state.activeFieldCategory = FIELD_CATEGORY_PAIRS[0]?.id ?? "identity";
    moveActiveMember(1);
  } else {
    renderAll();
    if (isAllReviewDone) {
      openReviewCompleteModal();
    }
  }
}

function reviewPrimaryActionLabel(member, nextPair) {
  if (isFinalReviewCompleteAction(member)) {
    return "Konfirmasi Review Selesai";
  }
  if (nextPair) {
    return `Lanjut ke ${nextPair.label}`;
  }
  return activeNavigationState().canMoveNext
    ? "Tandai Dicek & Lanjut"
    : "Tandai Dicek & Selesai";
}

function isFinalReviewCompleteAction(member = activeMember()) {
  const review = reviewCompletionState();
  return Boolean(
    member
    && review.total > 0
    && review.remaining === 0
    && isMemberReviewConfirmed(member)
    && !activeNavigationState().canMoveNext
  );
}

function moveActiveMember(step) {
  const members = filteredMembers();
  if (!members.length) {
    return;
  }

  if (step > 0) {
    const member = activeMember();
    if (member && memberReviewStatus(member) !== "ERROR") {
      const validation = reviewCompletionValidation(member);
      if (!validation.ok) {
        showReviewBlockingMessage(validation);
        return;
      }
      if (!isMemberReviewConfirmed(member)) {
        showReviewBlockingMessage({
          ok: false,
          message: "Tandai passport ini sebagai sudah dicek sebelum lanjut ke passport berikutnya.",
          categoryId: state.activeFieldCategory,
          fieldKey: "",
        });
        return;
      }
    }
  }

  const currentIndex = members.findIndex((member) => member.id === state.activeMemberId);
  const safeCurrentIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = Math.max(0, Math.min(members.length - 1, safeCurrentIndex + step));
  const previousPage = state.passportListPage;
  clearReviewBlock();
  state.activeMemberId = members[nextIndex].id ?? "";
  syncPassportPageWithActiveMember();
  renderAll();
  if (state.passportListPage !== previousPage) {
    scrollPassportListToTop();
  }
}

function handleExportPreviewMemberClick(event) {
  const button = closestFromEventTarget(event.target, "[data-review-member-id]");
  if (!button) {
    return;
  }

  event.preventDefault();
  jumpToReviewMember(button.dataset.reviewMemberId ?? "");
}

function jumpToReviewMember(memberId) {
  const targetId = String(memberId || "").trim();
  const member = manifestMembers().find((candidate) => String(candidate.id || "") === targetId);
  if (!member) {
    return;
  }

  clearReviewBlock();
  state.validationFilter = "all";
  state.activeMemberId = member.id ?? targetId;
  state.activeFieldCategory = FIELD_CATEGORY_PAIRS[0]?.id ?? "identity";
  state.currentPage = "validation";
  syncPassportPageWithActiveMember();
  state.statusHeadline = "Kembali ke review";
  state.statusDetail = `${memberDisplayName(member)} dibuka dari preview export JSON.`;
  renderAll();
  focusActivePassportListItem();
}

function focusActivePassportListItem() {
  requestFrame(() => {
    const row = dom.passportList?.querySelector(".passport-item.is-active");
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
    row?.focus?.();
  });
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
      state.statusDetail = "Selesaikan proses scan terlebih dahulu sebelum membuka preview export JSON.";
      state.currentPage = "import";
      renderAll();
      return;
    }

    const review = reviewCompletionState();
    if (review.remaining > 0) {
      state.statusHeadline = "Review belum selesai";
      state.statusDetail = `Masih ada ${review.remaining} passport yang perlu ditandai dicek sebelum preview/export JSON.`;
      state.currentPage = "validation";
      renderAll();
      return;
    }

    const requiredFieldsIssue = requiredFieldBlockingIssueForBatch();
    if (!requiredFieldsIssue.ok) {
      showBatchReviewBlockingMessage(requiredFieldsIssue);
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
  renderImportPage();
  renderProgressPanel();
  renderScanLogs();
  renderPassportList();
  renderPassportPreview();
  renderWorkspace();
  renderReviewExportModal();
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

function scheduleManifestSave(delayMs = MANIFEST_SAVE_DELAY_MS) {
  if (!state.manifestPath || !state.manifest) {
    return;
  }

  manifestSaveSequence += 1;
  if (manifestSaveTimer !== null) {
    window.clearTimeout(manifestSaveTimer);
  }

  const sequence = manifestSaveSequence;
  manifestSaveTimer = window.setTimeout(() => {
    manifestSaveTimer = null;
    void persistManifestSnapshot(sequence);
  }, Math.max(0, Number(delayMs) || 0));
}

async function flushManifestSave() {
  if (!state.manifestPath || !state.manifest) {
    return;
  }

  if (manifestSaveTimer !== null) {
    window.clearTimeout(manifestSaveTimer);
    manifestSaveTimer = null;
  }

  manifestSaveSequence += 1;
  await persistManifestSnapshot(manifestSaveSequence);
}

async function persistManifestSnapshot(sequence) {
  if (!state.manifestPath || !state.manifest) {
    return;
  }

  const snapshot = cloneJson(state.manifest);
  try {
    const { invoke } = tauriBindings();
    await invoke("save_manifest", {
      manifestPath: state.manifestPath,
      manifestData: snapshot,
    });
  } catch (error) {
    if (sequence === manifestSaveSequence) {
      state.statusHeadline = "Gagal menyimpan review";
      state.statusDetail = String(error || "Manifest tidak berhasil disimpan.");
      renderAll();
    }
  }
}

function renderNavigation() {
  const pageOrder = ["import", "validation", "entry"];
  const activeIndex = pageOrder.indexOf(state.currentPage);
  const review = reviewCompletionState();
  const entryReady = isEntryAccessible();
  const subtitleByPage = {
    import: state.manifestPath ? "Scan selesai, lanjut review" : "Pilih folder dan jalankan scan",
    validation: review.remaining > 0 ? `Sisa review: ${review.remaining} data` : "Semua data sudah dicek",
    entry: entryReady ? "Siap preview/export JSON" : "Selesaikan review dulu",
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

function renderPageVisibility() {
  dom.pageImport.classList.toggle("is-hidden", state.currentPage !== "import");
  dom.pageValidation.classList.toggle("is-hidden", state.currentPage !== "validation");
  dom.pageEntry?.classList.toggle("is-hidden", state.currentPage !== "entry");
  const topbarNode = document.querySelector(".topbar");
  if (topbarNode) {
    topbarNode.style.display = "flex";
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
      eyebrow: "",
      title: "Preview & Export JSON",
      statusLabel: status.label,
      statusTone: status.tone,
      compact: true,
      hidden: false,
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
  if (state.isStoppingScan) {
    return { label: "Menghentikan", tone: "warn" };
  }
  if (state.isScanning) {
    return { label: "Sedang Diproses", tone: "info" };
  }
  if (/gagal/i.test(state.statusHeadline)) {
    return { label: "Perlu Perhatian", tone: "danger" };
  }
  if (state.manifestPath && (state.errorCount > 0 || state.reviewCount > 0)) {
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
  renderOcrModeSelector();

  if (state.selectedDir) {
    dom.selectedFolderName.textContent = basenameFromPath(state.selectedDir);
    dom.selectedFolderCaption.textContent = state.selectedDir;
  } else {
    dom.selectedFolderName.textContent = "Belum ada folder dipilih";
    dom.selectedFolderCaption.textContent = "Pilih folder berisi JPG, PNG, atau PDF passport untuk mulai memproses data.";
  }

  dom.importFooterText.textContent = importFooterMessage();
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

  renderMiniStatus(dom.systemOcrStatus, ocrStatusDescriptor());
  renderMiniStatus(dom.systemValidationStatus, { label: "Siap", tone: "ready" });
  renderMiniStatus(dom.systemRuntimeStatus, { label: "Tersedia", tone: "ready" });
  renderRecentBatches();
}

function renderOcrModeSelector() {
  for (const input of dom.ocrModeInputs || []) {
    const mode = normalizeOcrMode(input.value);
    input.checked = mode === normalizeOcrMode(state.ocrMode);
    input.disabled = state.isScanning;
  }
}

function handleOcrModeChange(event) {
  const target = event.target;
  if (state.isScanning || !(target instanceof HTMLInputElement) || !target.checked) {
    renderOcrModeSelector();
    return;
  }

  const nextMode = normalizeOcrMode(target.value);
  updateOcrMode(nextMode);
  state.statusHeadline = `Mode OCR: ${ocrModeLabel(nextMode)}`;
  state.statusDetail = "Mode akan dipakai saat scan berikutnya dimulai.";

  renderOcrModeSelector();
  renderMiniStatus(dom.systemOcrStatus, ocrStatusDescriptor());
  updateActionAvailability();
}

function importFooterMessage() {
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

function ocrStatusDescriptor() {
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

function renderMiniStatus(node, descriptor) {
  if (!node) {
    return;
  }
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

function renderRecentActionIcon(type) {
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

function openRecentDeleteModal(path) {
  const entry = recentEntryByPath(path);
  if (!entry || !dom.recentDeleteModal) {
    return;
  }

  recentDeletePath = entry.path;
  if (dom.recentDeleteModalDesc) {
    const label = entry.label || basenameFromPath(entry.path);
    dom.recentDeleteModalDesc.textContent =
      `Hapus "${label}" dari Riwayat Pilihan? File scan dan manifest tidak ikut dihapus.`;
  }
  dom.recentDeleteModal.classList.remove("is-hidden");
  dom.recentDeleteModal.setAttribute("aria-hidden", "false");
  requestFrame(() => dom.recentDeleteCancelButton?.focus());
}

function closeRecentDeleteModal() {
  recentDeletePath = "";
  if (!dom.recentDeleteModal) {
    return;
  }
  dom.recentDeleteModal.classList.add("is-hidden");
  dom.recentDeleteModal.setAttribute("aria-hidden", "true");
}

function confirmRecentDelete() {
  const targetPath = recentDeletePath;
  if (!targetPath) {
    closeRecentDeleteModal();
    return;
  }

  const removedEntry = recentEntryByPath(targetPath);
  state.recentBatches = state.recentBatches.filter((entry) => entry.path !== targetPath);
  saveRecentBatches(state.recentBatches);
  closeRecentDeleteModal();
  state.statusHeadline = "Riwayat dihapus";
  state.statusDetail = `${removedEntry?.label || basenameFromPath(targetPath)} dihapus dari Riwayat Pilihan.`;
  renderAll();
}

function openRecentEditModal(path) {
  const entry = recentEntryByPath(path);
  if (!entry || !dom.recentEditModal || !dom.recentEditInput) {
    return;
  }

  recentEditPath = entry.path;
  dom.recentEditInput.value = entry.label || basenameFromPath(entry.path);
  dom.recentEditModal.classList.remove("is-hidden");
  dom.recentEditModal.setAttribute("aria-hidden", "false");
  requestFrame(() => {
    dom.recentEditInput.focus();
    dom.recentEditInput.select();
  });
}

function closeRecentEditModal() {
  recentEditPath = "";
  if (!dom.recentEditModal) {
    return;
  }
  dom.recentEditModal.classList.add("is-hidden");
  dom.recentEditModal.setAttribute("aria-hidden", "true");
}

function confirmRecentEdit() {
  const targetPath = recentEditPath;
  if (!targetPath || !dom.recentEditInput) {
    closeRecentEditModal();
    return;
  }

  const entry = recentEntryByPath(targetPath);
  if (!entry) {
    closeRecentEditModal();
    return;
  }

  const nextLabel = dom.recentEditInput.value.trim() || basenameFromPath(targetPath);
  state.recentBatches = state.recentBatches.map((item) =>
    item.path === targetPath
      ? { ...item, label: nextLabel }
      : item,
  );
  saveRecentBatches(state.recentBatches);
  closeRecentEditModal();
  state.statusHeadline = "Riwayat diperbarui";
  state.statusDetail = `Nama riwayat diubah menjadi ${nextLabel}.`;
  renderAll();
}

function openPassportDeleteModal(memberId = activeMember()?.id ?? "") {
  const member = manifestMembers().find((item) => String(item.id || "") === String(memberId || ""));
  if (!member || !dom.passportDeleteModal) {
    return;
  }

  passportDeleteMemberId = String(member.id || "");
  if (dom.passportDeleteModalDesc) {
    const passport = memberPassport(member) || member.fileName || "-";
    dom.passportDeleteModalDesc.textContent =
      `Hapus ${memberDisplayName(member)} (${passport}) dari manifest review? File gambar asli tidak ikut dihapus dan data ini tidak akan masuk export JSON.`;
  }
  dom.passportDeleteModal.classList.remove("is-hidden");
  dom.passportDeleteModal.setAttribute("aria-hidden", "false");
  requestFrame(() => dom.passportDeleteCancelButton?.focus());
}

function closePassportDeleteModal() {
  passportDeleteMemberId = "";
  if (!dom.passportDeleteModal) {
    return;
  }
  dom.passportDeleteModal.classList.add("is-hidden");
  dom.passportDeleteModal.setAttribute("aria-hidden", "true");
}

function confirmPassportDelete() {
  const memberId = String(passportDeleteMemberId || "");
  const members = manifestMembers();
  const index = members.findIndex((member) => String(member.id || "") === memberId);
  if (!memberId || index < 0 || !Array.isArray(state.manifest?.members)) {
    closePassportDeleteModal();
    return;
  }

  const removedMember = members[index];
  state.manifest.members = members.filter((member) => String(member.id || "") !== memberId);
  state.selectedIds.delete(memberId);
  state.reviewedMemberIds.delete(memberId);
  state.passportImageCache.delete(memberId);
  clearDeletedCompanionReferences(memberId);
  closePassportDeleteModal();

  recalculateMetrics();
  const nextMembers = filteredMembers();
  state.activeMemberId = nextMembers[Math.min(index, Math.max(nextMembers.length - 1, 0))]?.id ?? "";
  ensureVisibleActiveMember();
  syncPassportPageWithActiveMember();
  scheduleManifestSave(0);
  state.statusHeadline = "Passport dihapus dari review";
  state.statusDetail = `${memberDisplayName(removedMember)} dihapus dari manifest review. File asli tetap aman di folder sumber.`;
  renderAll();
}

function clearDeletedCompanionReferences(deletedMemberId) {
  for (const member of manifestMembers()) {
    if (String(member.companionMemberId || "") !== String(deletedMemberId || "")) {
      continue;
    }
    delete member.companionMemberId;
    delete member.companionRelation;
    delete member.companion;
    clearMemberReviewConfirmation(member);
  }
}

function openReviewCompleteModal() {
  setPage("entry");
}

function closeReviewCompleteModal() {
  if (!dom.reviewCompleteModal) {
    return;
  }
  dom.reviewCompleteModal.classList.add("is-hidden");
  dom.reviewCompleteModal.setAttribute("aria-hidden", "true");
}

function renderReviewExportModal() {
  if (!dom.reviewCompleteModal) {
    return;
  }

  const preview = exportPreviewState();

  if (dom.reviewCompleteModalDesc) {
    dom.reviewCompleteModalDesc.textContent = preview.description;
  }

  if (dom.reviewExportStatus) {
    const statusText = state.isEntryRunning
      ? "Export berjalan"
      : state.exportedBatchPath
        ? "JSON siap"
        : preview.canExport
          ? "Siap export"
          : "Belum siap";
    const statusTone = state.isEntryRunning
      ? "warn"
      : state.exportedBatchPath
        ? "valid"
        : preview.canExport
          ? "ready"
          : "neutral";
    dom.reviewExportStatus.textContent = statusText;
    dom.reviewExportStatus.className = `status-chip ${statusTone}`;
  }

  if (dom.reviewExportSummary) {
    dom.reviewExportSummary.innerHTML = renderExportSummaryCards(preview);
  }

  if (dom.reviewExportPreviewBody) {
    dom.reviewExportPreviewBody.innerHTML = preview.members.length
      ? preview.members.map((member) => renderReviewExportPreviewRow(member, preview.selectedIds)).join("")
      : `<tr><td colspan="4">Belum ada data untuk dipreview.</td></tr>`;
  }

  if (dom.reviewExportResult) {
    dom.reviewExportResult.className = `review-export-result${state.exportError ? " is-error" : state.exportedBatchPath ? " is-success" : ""}`;
    dom.reviewExportResult.textContent = state.exportError
      ? state.exportError
      : state.exportedBatchPath
        ? `JSON dibuat: ${state.exportedBatchPath}`
        : "Export akan membuat file nusuk-entry-batch.json dari data valid yang sudah direview.";
  }

  if (dom.reviewCompleteExportButton) {
    dom.reviewCompleteExportButton.disabled = !preview.canExport;
    dom.reviewCompleteExportButton.textContent = state.isEntryRunning ? "Membuat JSON..." : "Export to JSON";
    dom.reviewCompleteExportButton.setAttribute("aria-disabled", dom.reviewCompleteExportButton.disabled ? "true" : "false");
  }
}

function renderEntryPage() {
  if (!dom.entryStatusPill) {
    return;
  }

  const preview = exportPreviewState();
  const statusInput = {
    isEntryRunning: state.isEntryRunning,
    isScanning: state.isScanning,
    manifestPath: state.manifestPath,
    selectedIdsSize: preview.selectedIds.size,
  };
  dom.entryStatusPill.textContent = state.exportedBatchPath ? "JSON siap" : entryStatusLabel(statusInput);
  dom.entryStatusPill.className = `status-pill ${state.exportedBatchPath ? "valid" : entryStatusTone(statusInput)}`;

  if (dom.entryExportDescription) {
    dom.entryExportDescription.textContent = preview.description;
  }
  if (dom.entryExportSummary) {
    dom.entryExportSummary.innerHTML = renderExportSummaryCards(preview);
  }
  if (dom.entryExportPreviewBody) {
    dom.entryExportPreviewBody.innerHTML = preview.members.length
      ? preview.members.map((member) => renderReviewExportPreviewRow(member, preview.selectedIds)).join("")
      : `<tr><td colspan="4">Belum ada data untuk dipreview.</td></tr>`;
  }
  if (dom.entryExportResult) {
    dom.entryExportResult.className = `review-export-result${state.exportError ? " is-error" : state.exportedBatchPath ? " is-success" : ""}`;
    dom.entryExportResult.textContent = state.exportError
      ? state.exportError
      : state.exportedBatchPath
        ? `JSON dibuat: ${state.exportedBatchPath}`
        : "Export akan membuat file nusuk-entry-batch.json dari data valid yang sudah direview.";
  }
  if (dom.prepareEntryButton) {
    dom.prepareEntryButton.disabled = !preview.canExport;
    dom.prepareEntryButton.textContent = state.isEntryRunning ? "Membuat JSON..." : "Export to JSON";
    dom.prepareEntryButton.setAttribute("aria-disabled", dom.prepareEntryButton.disabled ? "true" : "false");
  }
  renderEntryLogs();
}

function exportPreviewState() {
  const members = manifestMembers();
  const selectedIds = effectiveSelectedIdsForExport();
  const review = reviewCompletionState();
  const readyMembers = members.filter((member) => selectedIds.has(String(member.id || "")) && isMemberReadyForJson(member));
  const failedMembers = members.filter((member) => memberReviewStatus(member) === "ERROR");
  const skippedMembers = members.filter((member) => !readyMembers.includes(member) && memberReviewStatus(member) !== "ERROR");
  const reviewedMembers = members.filter((member) =>
    memberReviewStatus(member) === "ERROR" || isMemberReviewConfirmed(member)
  );
  const canExport = canExportReviewedJson() && !state.isEntryRunning;
  const description = review.remaining > 0
    ? `${review.reviewed}/${review.total} passport sudah ditandai dicek. Selesaikan review sebelum export JSON.`
    : `${readyMembers.length} passport valid siap diexport. Data gagal atau skipped tetap tampil di preview dan tidak masuk JSON.`;

  return {
    members: review.remaining > 0 ? reviewedMembers : members,
    selectedIds,
    review,
    readyMembers,
    failedMembers,
    skippedMembers,
    reviewedMembers,
    canExport,
    description,
  };
}

function renderExportSummaryCards(preview) {
  return [
    ["Total", preview.members.length],
    ["Sudah Review", preview.reviewedMembers.length],
    ["Siap JSON", preview.readyMembers.length],
    ["Gagal/Skip", preview.failedMembers.length + preview.skippedMembers.length],
  ].map(([label, value]) => `
    <article class="review-export-summary-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
    </article>
  `).join("");
}

function renderReviewExportPreviewRow(member, selectedIds) {
  const status = memberReviewStatus(member) || "-";
  const ready = selectedIds.has(String(member.id || "")) && isMemberReadyForJson(member);
  const passport = memberPassport(member) || "-";
  const name = memberDisplayName(member);
  const fileName = member.fileName || "-";
  const exportLabel = ready ? "Masuk JSON" : "Tidak diexport";
  return `
    <tr>
      <td>
        <strong>${escapeHtml(passport)}</strong>
        <small>${escapeHtml(fileName)}</small>
      </td>
      <td>
        <button class="review-export-member-link" type="button" data-review-member-id="${escapeHtml(member.id ?? "")}">
          ${escapeHtml(name)}
        </button>
      </td>
      <td><span class="review-export-row-status ${escapeHtml(status.toLowerCase())}">${escapeHtml(status)}</span></td>
      <td>${escapeHtml(exportLabel)}</td>
    </tr>
  `;
}

function isMemberReadyForJson(member) {
  return isMemberReadyForEntry(member) && isMemberReviewConfirmed(member);
}

function canExportReviewedJson() {
  if (!isEntryAccessible()) {
    return false;
  }
  const selectedIds = effectiveSelectedIdsForExport();
  return manifestMembers().some((member) => selectedIds.has(String(member.id || "")) && isMemberReadyForJson(member));
}

function recentEntryByPath(path) {
  const targetPath = String(path || "").trim();
  return state.recentBatches.find((entry) => entry.path === targetPath) || null;
}

function renderProgressPanel() {
  const total = state.progressTotal || state.totalFiles || 0;
  const current = Math.min(state.progressCurrent || 0, total || 0);
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
  const lastLog = state.lastWorkerMessage || state.scanLogs[state.scanLogs.length - 1] || "";
  const timing = scanTimingSummary();

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

  if (dom.filterAllCount) {
    dom.filterAllCount.textContent = String(allMembers.length);
  }
  if (dom.filterErrorCount) {
    dom.filterErrorCount.textContent = String(allMembers.filter((member) => memberReviewStatus(member) === "ERROR").length);
  }
  if (dom.filterValidCount) {
    dom.filterValidCount.textContent = String(allMembers.filter((member) => memberReviewStatus(member) === "VALID").length);
  }

  for (const button of dom.filterButtons) {
    button.classList.toggle("is-active", button.dataset.validationFilter === state.validationFilter);
  }

  renderReviewProgress();

  if (!dom.passportList) {
    if (dom.passportListSummary) {
      dom.passportListSummary.textContent = reviewPaginationSummaryText(visibleMembers.length);
    }
    renderPassportPagination({ totalItems: visibleMembers.length });
    return;
  }

  const pagination = paginationState(visibleMembers.length);
  const pagedMembers = paginateMembers(visibleMembers);

  if (dom.passportListSummary) {
    dom.passportListSummary.textContent = passportListSummaryText(pagination, allMembers.length);
  }

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

function renderReviewProgress() {
  const review = reviewCompletionState();
  const remainingText = review.remaining
    ? `${review.remaining} belum dicek`
    : "Semua sudah dicek";
  const progressText = `${review.reviewed}/${review.total} direview`;

  if (dom.batchBadge) {
    dom.batchBadge.textContent = state.resultDir
      ? `Kelompok ${basenameFromPath(state.resultDir)}`
      : state.selectedDir
        ? `Kelompok ${basenameFromPath(state.selectedDir)}`
        : "Siap diperiksa";
  }
  if (dom.passportReviewProgress) {
    dom.passportReviewProgress.textContent = `${progressText} | ${remainingText}`;
  }
}

function renderPassportListItem(member) {
  const resolved = resolvedProfileOf(member);
  const active = state.activeMemberId === member.id ? " is-active" : "";
  const reviewed = isMemberReviewConfirmed(member);
  const tone = memberTone(member);
  const passportNumber = valueFrom(resolved, "passportNumber");
  const childInfo = childInfoForMember(member);
  const companionMissing = childInfo.isChild && !String(member.companionMemberId || "").trim();
  const groupLabel = childInfo.isChild ? "Child" : "Adult";
  const groupClass = childInfo.isChild ? "child" : "adult";
  const scanDurationMs = memberScanTotalMs(member);
  const scanTimePill = scanDurationMs > 0
    ? `<span class="mini-pill muted scan-time-pill">Scan ${escapeHtml(formatDurationMs(scanDurationMs))}</span>`
    : "";

  return `
    <div class="passport-item${active}${reviewed ? " is-reviewed" : ""}" data-member-id="${escapeHtml(member.id ?? "")}" tabindex="0">
      <div class="passport-item-main">
        <div class="passport-item-title">
          <span class="passport-status-dot ${tone}${reviewed ? " reviewed" : ""}"></span>
          <span class="passport-name">${escapeHtml(memberDisplayName(member))}</span>
        </div>
        <div class="passport-meta">
          <span class="mono">${escapeHtml(passportNumber)}</span>
          ${scanTimePill}
          ${childInfo.isChild ? `<span class="mini-pill ${companionMissing ? "warn" : "info"}">${companionMissing ? "Butuh companion" : "Anak"}</span>` : ""}
        </div>
      </div>
      <div class="passport-item-confidence passport-item-group">
        <span class="member-group-pill ${groupClass}">${escapeHtml(groupLabel)}</span>
      </div>
    </div>
  `;
}

function renderPassportPreview() {
  if (!dom.passportPreviewImage || !dom.passportPreviewEmpty) {
    return;
  }

  const member = activeMember();
  if (!member) {
    dom.passportPreviewImage.removeAttribute("src");
    dom.passportPreviewImage.classList.add("is-hidden");
    dom.passportPreviewEmpty.classList.remove("is-hidden");
    dom.passportPreviewEmpty.textContent = "Belum ada passport dipilih.";
    if (dom.passportPreviewName) {
      dom.passportPreviewName.textContent = "Belum ada data";
    }
    if (dom.passportPreviewFile) {
      dom.passportPreviewFile.textContent = "Jalankan scan atau buka riwayat terlebih dahulu.";
    }
    if (dom.passportPreviewStatus) {
      dom.passportPreviewStatus.textContent = "Menunggu";
      dom.passportPreviewStatus.className = "passport-preview-status neutral";
    }
    resetPassportPreviewZoomState();
    return;
  }

  if (dom.passportPreviewName) {
    dom.passportPreviewName.textContent = memberDisplayName(member);
  }
  if (dom.passportPreviewFile) {
    const fileLabel = member.fileName || basenameFromPath(member.passportImagePath || "");
    const scanDurationMs = memberScanTotalMs(member);
    dom.passportPreviewFile.textContent = scanDurationMs > 0
      ? `${fileLabel} | Scan ${formatDurationMs(scanDurationMs)}`
      : fileLabel;
  }
  if (dom.passportPreviewStatus) {
    const reviewed = isMemberReviewConfirmed(member);
    dom.passportPreviewStatus.textContent = reviewed ? "Sudah direview" : "Belum direview";
    dom.passportPreviewStatus.className = `passport-preview-status ${reviewed ? "valid" : "warn"}`;
  }

  void ensurePassportImageForMember(member);
}

async function ensurePassportImageForMember(member) {
  const memberId = String(member?.id || "");
  if (!memberId || !dom.passportPreviewImage || !dom.passportPreviewEmpty) {
    return;
  }

  const cached = state.passportImageCache.get(memberId);
  if (cached) {
    applyPassportImageResult(memberId, cached);
    return;
  }

  const requestId = ++passportImageRequestId;
  applyPassportImageResult(memberId, {
    status: "loading",
    message: "Memuat foto passport...",
    src: "",
    path: "",
  });

  try {
    const { invoke } = tauriBindings();
    const imageData = await invoke("load_passport_image_data", {
      manifestPath: state.manifestPath,
      imagePath: String(member.passportImagePath || ""),
      fileName: String(member.fileName || ""),
    });
    const result = imageData?.dataUrl
      ? {
          status: "ready",
          message: "",
          src: imageData.dataUrl,
          path: imageData.path || "",
        }
      : {
          status: "missing",
          message: "File gambar passport tidak ditemukan.",
          src: "",
          path: "",
        };
    state.passportImageCache.set(memberId, result);
    if (requestId === passportImageRequestId && String(activeMember()?.id || "") === memberId) {
      applyPassportImageResult(memberId, result);
    }
  } catch (error) {
    const result = {
      status: "error",
      message: `Gagal memuat foto passport: ${String(error)}`,
      src: "",
      path: "",
    };
    state.passportImageCache.set(memberId, result);
    if (requestId === passportImageRequestId && String(activeMember()?.id || "") === memberId) {
      applyPassportImageResult(memberId, result);
    }
  }
}

function applyPassportImageResult(memberId, result) {
  if (!dom.passportPreviewImage || !dom.passportPreviewEmpty || String(activeMember()?.id || "") !== memberId) {
    return;
  }

  if (result.status === "ready" && result.src) {
    dom.passportPreviewEmpty.classList.add("is-hidden");
    dom.passportPreviewImage.classList.remove("is-hidden");
    const sourceChanged = dom.passportPreviewImage.getAttribute("src") !== result.src;
    if (sourceChanged) {
      dom.passportPreviewImage.src = result.src;
    }
    dom.passportPreviewImage.alt = activeMember()?.fileName
      ? `Foto passport ${activeMember().fileName}`
      : "Foto passport";
    applyPassportPreviewZoom({ centerRatio: sourceChanged ? { x: 0.5, y: 0.5 } : null });
    return;
  }

  dom.passportPreviewImage.removeAttribute("src");
  dom.passportPreviewImage.classList.add("is-hidden");
  dom.passportPreviewEmpty.classList.remove("is-hidden");
  dom.passportPreviewEmpty.textContent = result.message || "Foto passport belum tersedia.";
  renderPassportPreviewZoomControls();
}

function changePassportPreviewZoom(delta) {
  if (!isPassportPreviewImageReady()) {
    return;
  }
  setPassportPreviewZoom(state.passportPreviewZoom + delta, { keepViewportCenter: true });
}

function resetPassportPreviewZoom() {
  if (!isPassportPreviewImageReady()) {
    return;
  }
  setPassportPreviewZoom(PASSPORT_PREVIEW_ZOOM_DEFAULT, { centerRatio: { x: 0.5, y: 0.5 } });
}

function resetPassportPreviewZoomState() {
  state.passportPreviewZoom = PASSPORT_PREVIEW_ZOOM_DEFAULT;
  passportPreviewWheelDelta = 0;
  applyPassportPreviewZoom();
}

function setPassportPreviewZoom(nextZoom, options = {}) {
  const zoom = clampPassportPreviewZoom(nextZoom);
  const previousZoom = state.passportPreviewZoom;
  const centerRatio = options.centerRatio
    || (options.keepViewportCenter ? passportPreviewScrollCenterRatio() : null);

  if (Math.abs(zoom - previousZoom) < 0.001) {
    renderPassportPreviewZoomControls();
    return;
  }

  state.passportPreviewZoom = zoom;
  applyPassportPreviewZoom({ centerRatio });
}

function applyPassportPreviewZoom(options = {}) {
  state.passportPreviewZoom = clampPassportPreviewZoom(state.passportPreviewZoom);
  const zoom = state.passportPreviewZoom;
  const hasImage = isPassportPreviewImageReady();

  if (dom.passportPreviewFrame) {
    dom.passportPreviewFrame.style.setProperty("--passport-preview-zoom", zoom.toFixed(2));
    dom.passportPreviewFrame.classList.toggle("is-zoomed", hasImage && zoom > PASSPORT_PREVIEW_ZOOM_DEFAULT + 0.001);
  }

  renderPassportPreviewZoomControls();

  if (options.centerRatio && dom.passportPreviewFrame) {
    requestFrame(() => {
      restorePassportPreviewScrollCenter(options.centerRatio);
    });
  }
}

function handlePassportPreviewWheel(event) {
  if (!event.ctrlKey || !isPassportPreviewImageReady()) {
    return;
  }

  event.preventDefault();
  passportPreviewWheelDelta += event.deltaY;
  if (Math.abs(passportPreviewWheelDelta) < PASSPORT_PREVIEW_WHEEL_THRESHOLD) {
    return;
  }

  const direction = passportPreviewWheelDelta > 0 ? -1 : 1;
  passportPreviewWheelDelta = 0;
  changePassportPreviewZoom(direction * PASSPORT_PREVIEW_WHEEL_STEP);
}

function handlePassportPreviewKeydown(event) {
  if (!isPassportPreviewImageReady()) {
    return;
  }

  if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    changePassportPreviewZoom(PASSPORT_PREVIEW_ZOOM_STEP);
    return;
  }
  if (event.key === "-" || event.key === "_") {
    event.preventDefault();
    changePassportPreviewZoom(-PASSPORT_PREVIEW_ZOOM_STEP);
    return;
  }
  if (event.key === "0") {
    event.preventDefault();
    resetPassportPreviewZoom();
  }
}

function renderPassportPreviewZoomControls() {
  const hasImage = isPassportPreviewImageReady();
  const zoom = clampPassportPreviewZoom(state.passportPreviewZoom);

  if (dom.passportZoomLabel) {
    dom.passportZoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }
  if (dom.passportZoomOutButton) {
    dom.passportZoomOutButton.disabled = !hasImage || zoom <= PASSPORT_PREVIEW_ZOOM_MIN + 0.001;
  }
  if (dom.passportZoomInButton) {
    dom.passportZoomInButton.disabled = !hasImage || zoom >= PASSPORT_PREVIEW_ZOOM_MAX - 0.001;
  }
  if (dom.passportZoomResetButton) {
    dom.passportZoomResetButton.disabled = !hasImage || Math.abs(zoom - PASSPORT_PREVIEW_ZOOM_DEFAULT) < 0.001;
  }
}

function passportPreviewScrollCenterRatio() {
  const frame = dom.passportPreviewFrame;
  if (!frame) {
    return { x: 0.5, y: 0.5 };
  }

  const scrollWidth = Math.max(1, frame.scrollWidth);
  const scrollHeight = Math.max(1, frame.scrollHeight);
  return {
    x: (frame.scrollLeft + (frame.clientWidth / 2)) / scrollWidth,
    y: (frame.scrollTop + (frame.clientHeight / 2)) / scrollHeight,
  };
}

function restorePassportPreviewScrollCenter(centerRatio) {
  const frame = dom.passportPreviewFrame;
  if (!frame) {
    return;
  }

  const maxLeft = Math.max(0, frame.scrollWidth - frame.clientWidth);
  const maxTop = Math.max(0, frame.scrollHeight - frame.clientHeight);
  frame.scrollLeft = Math.min(maxLeft, Math.max(0, (frame.scrollWidth * centerRatio.x) - (frame.clientWidth / 2)));
  frame.scrollTop = Math.min(maxTop, Math.max(0, (frame.scrollHeight * centerRatio.y) - (frame.clientHeight / 2)));
}

function isPassportPreviewImageReady() {
  return Boolean(
    dom.passportPreviewImage
    && !dom.passportPreviewImage.classList.contains("is-hidden")
    && dom.passportPreviewImage.getAttribute("src")
  );
}

function clampPassportPreviewZoom(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return PASSPORT_PREVIEW_ZOOM_DEFAULT;
  }
  const clamped = Math.min(PASSPORT_PREVIEW_ZOOM_MAX, Math.max(PASSPORT_PREVIEW_ZOOM_MIN, numeric));
  return Math.round(clamped * 100) / 100;
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
  dom.workspaceIssueBox.className = "issue-box issue-box-neutral is-hidden";
  dom.workspaceIssueBox.textContent = "";
  document.querySelector(".field-review-head")?.classList.remove("is-hidden");
  document.querySelector(".workspace-panel")?.classList.remove("is-empty");
  const resolved = ensureResolvedProfile(member);
  dom.detailStatus.textContent = workspaceStatusLabel(member);
  dom.detailStatus.className = `status-pill ${workspaceStatusTone(member)}`;
  dom.workspacePassportCode.textContent = valueFrom(resolved, "passportNumber");
  dom.detailTitle.textContent = memberDisplayName(member);
  dom.detailSummary.classList.add("is-hidden");
  dom.detailSummary.textContent = "";

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
    dom.saveNextButton.textContent = reviewPrimaryActionLabel(member, nextPair);
  }
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
      const blocked = state.reviewBlock?.target === "field" && state.reviewBlock?.fieldKey === key;
      const sourceBadge = hasScanSource
        ? (changedFromScan ? "Diubah" : "Asli")
        : "Manual";
      const sourceBadgeTone = hasScanSource
        ? (changedFromScan ? "changed" : "original")
        : "manual";

      return `
        <div class="field-pair-cell${descriptor.rowAlert ? " is-alert" : ""}${blocked ? " is-blocked" : ""}">
          <div class="field-pair-label">${escapeHtml(label)}</div>
          <div class="field-final-cell is-editable${descriptor.rowAlert ? " is-alert" : ""}${blocked ? " is-blocked" : ""}">
            <div class="field-final-stack">
              <input
                class="field-final-input${descriptor.rowAlert ? " is-alert" : ""}${blocked ? " is-blocked" : ""}${dateField ? " js-date-input" : ""}"
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
  const selectedRelation = normalizeCompanionRelation(member.companionRelation || member.companion?.relation || (selectedCompanion ? inferDefaultCompanionRelation(member, selectedCompanion) : ""));
  const blocked = state.reviewBlock?.target === "companion";
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
  const relationOptions = COMPANION_RELATION_OPTIONS
    .map((relation) => `<option value="${escapeHtml(relation)}"${relation === selectedRelation ? " selected" : ""}>${escapeHtml(relation)}</option>`)
    .join("");

  return `
    <div class="field-review-row companion-review-row">
      <div class="companion-review-card${selectedCompanion ? " is-complete" : " is-missing"}${blocked ? " is-blocked" : ""}">
        <div class="companion-review-copy">
          <span class="companion-pill">Anak - ${escapeHtml(ageLabel)}</span>
          <strong>Companion wajib</strong>
          <small>${selectedCompanion ? "Siap export" : "Pilih jamaah dewasa"}</small>
        </div>
        <label class="companion-select-wrap">
          <span>Companion</span>
          <select data-companion-select aria-label="Pilih companion">
            ${options}
          </select>
        </label>
        <label class="companion-select-wrap">
          <span>Relation</span>
          <select data-companion-relation-select aria-label="Pilih relation companion"${selectedCompanion ? "" : " disabled"}>
            ${relationOptions}
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
  const status = memberReviewStatus(member);
  if (status === "ERROR") {
    return "Perlu perhatian";
  }
  if (status === "NEEDS_REVIEW") {
    return "Perlu review";
  }
  if (Number(member.confidence ?? 0) < 0.85) {
    return "Perlu dicek";
  }
  return "Siap digunakan";
}

function workspaceStatusTone(member) {
  const status = memberReviewStatus(member);
  if (status === "ERROR") {
    return "error";
  }
  if (status === "NEEDS_REVIEW") {
    return "warn";
  }
  if (Number(member.confidence ?? 0) < 0.85) {
    return "warn";
  }
  return "valid";
}

function updateActionAvailability() {
  const hasSelectedDir = Boolean(state.selectedDir.trim());
  const hasActiveMember = Boolean(activeMember());
  const navigation = activeNavigationState();

  dom.scanButton.disabled = state.isScanning || state.isStartingScan || !hasSelectedDir;
  if (dom.stopScanButton) {
    dom.stopScanButton.disabled = !state.isScanning || state.isStoppingScan;
    dom.stopScanButton.classList.toggle("is-hidden", !state.isScanning);
    dom.stopScanButton.setAttribute("aria-disabled", dom.stopScanButton.disabled ? "true" : "false");
  }
  if (dom.importNextButton) {
    const canGoNext = !state.isScanning && hasScanResultForSelectedDir();
    dom.importNextButton.disabled = !canGoNext;
    dom.importNextButton.setAttribute("aria-disabled", dom.importNextButton.disabled ? "true" : "false");
  }
  dom.chooseFolderButton.disabled = state.isScanning || state.isChoosingFolder;
  dom.folderPath.disabled = state.isScanning;
  for (const input of dom.ocrModeInputs || []) {
    input.disabled = state.isScanning;
  }
  dom.folderDropzone.classList.toggle("is-busy", state.isScanning || state.isChoosingFolder);
  dom.folderDropzone.setAttribute("aria-disabled", state.isScanning || state.isChoosingFolder ? "true" : "false");
  dom.folderDropzone.setAttribute("aria-busy", state.isScanning || state.isChoosingFolder ? "true" : "false");

  if (dom.reviewPreviewExportButton) {
    const hasManifest = Boolean(state.manifestPath && state.manifest && manifestMembers().length);
    const canPreviewExport = hasManifest && reviewCompletionState().remaining === 0 && !state.isScanning;
    dom.reviewPreviewExportButton.classList.toggle("is-hidden", !hasManifest);
    dom.reviewPreviewExportButton.disabled = !canPreviewExport;
    dom.reviewPreviewExportButton.setAttribute("aria-disabled", dom.reviewPreviewExportButton.disabled ? "true" : "false");
  }
  if (dom.reviewCompleteExportButton) {
    dom.reviewCompleteExportButton.disabled = state.isEntryRunning || !canExportReviewedJson();
    dom.reviewCompleteExportButton.setAttribute("aria-disabled", dom.reviewCompleteExportButton.disabled ? "true" : "false");
  }
  if (dom.prepareEntryButton) {
    dom.prepareEntryButton.disabled = state.isEntryRunning || !canExportReviewedJson();
    dom.prepareEntryButton.setAttribute("aria-disabled", dom.prepareEntryButton.disabled ? "true" : "false");
  }
  if (dom.entryBackReviewButton) {
    dom.entryBackReviewButton.disabled = state.isEntryRunning;
    dom.entryBackReviewButton.setAttribute("aria-disabled", dom.entryBackReviewButton.disabled ? "true" : "false");
  }
  if (dom.deletePassportButton) {
    dom.deletePassportButton.disabled = !hasActiveMember || state.isScanning;
    dom.deletePassportButton.setAttribute("aria-disabled", dom.deletePassportButton.disabled ? "true" : "false");
  }
  dom.resetFieldsButton.disabled = !hasActiveMember;
  dom.saveNextButton.disabled = !hasActiveMember;
  dom.scanButton.setAttribute("aria-disabled", dom.scanButton.disabled ? "true" : "false");
  dom.chooseFolderButton.setAttribute("aria-disabled", dom.chooseFolderButton.disabled ? "true" : "false");
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
    button.disabled = !canAdvanceToNextPassport(navigation);
    button.setAttribute("aria-disabled", button.disabled ? "true" : "false");
  }

  if (dom.passportPagePrevButton && dom.passportPageNextButton) {
    dom.passportPagePrevButton.disabled = !navigation.canMovePrev;
    dom.passportPageNextButton.disabled = !canAdvanceToNextPassport(navigation);
    dom.passportPagePrevButton.setAttribute("aria-disabled", dom.passportPagePrevButton.disabled ? "true" : "false");
    dom.passportPageNextButton.setAttribute("aria-disabled", dom.passportPageNextButton.disabled ? "true" : "false");
  }
}

function canAdvanceToNextPassport(navigation = activeNavigationState()) {
  const member = activeMember();
  if (navigation.canMoveNext && memberReviewStatus(member) === "ERROR") {
    return true;
  }
  return Boolean(
    navigation.canMoveNext
    && member
    && isMemberReviewConfirmed(member)
    && reviewCompletionValidation(member).ok
  );
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
  renderReviewExportModal();
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
    return members.filter((member) => memberReviewStatus(member) === "ERROR" || memberReviewStatus(member) === "NEEDS_REVIEW");
  }
  if (state.validationFilter === "valid") {
    return members.filter((member) => memberReviewStatus(member) === "VALID");
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
  const navigation = activeNavigationState();
  dom.passportPagePrevButton.disabled = !navigation.canMovePrev;
  dom.passportPageNextButton.disabled = !canAdvanceToNextPassport(navigation);
  dom.passportPagePrevButton.setAttribute("aria-disabled", dom.passportPagePrevButton.disabled ? "true" : "false");
  dom.passportPageNextButton.setAttribute("aria-disabled", dom.passportPageNextButton.disabled ? "true" : "false");
  if (dom.passportListSummary && !dom.passportList) {
    dom.passportListSummary.textContent = reviewPaginationSummaryText(pagination.totalItems);
  }
}

function reviewPaginationSummaryText(totalItems) {
  const members = filteredMembers();
  const index = members.findIndex((member) => member.id === state.activeMemberId);
  const safeIndex = index >= 0 ? index + 1 : 0;
  const review = reviewCompletionState();
  if (!totalItems) {
    return "0 dari 0 passport";
  }
  return `Passport ${safeIndex} dari ${totalItems} | ${review.reviewed}/${review.total} direview`;
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
    .filter((member) => isMemberReadyForEntry(member) && member.id)
    .map((member) => member.id);
}

function confirmedReviewIds(manifest) {
  if (!Array.isArray(manifest?.members)) {
    return new Set();
  }

  return new Set(
    manifest.members
      .filter((member) => member?.reviewConfirmed === true && member.id)
      .map((member) => member.id),
  );
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
    delete member.companionRelation;
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

function buildCompanionSnapshot(member, relation = "") {
  return {
    id: String(member?.id || ""),
    name: memberDisplayName(member),
    passportNumber: memberPassport(member),
    relation: normalizeCompanionRelation(relation),
  };
}

function inferDefaultCompanionRelation(_childMember, companionMember) {
  const gender = normalizeText(resolvedProfileOf(companionMember).gender || passportExtractedOf(companionMember).gender || "");
  if (gender === "female" || gender === "f") {
    return DEFAULT_COMPANION_RELATION;
  }
  return DEFAULT_COMPANION_RELATION;
}

function normalizeCompanionRelation(value) {
  const normalized = normalizeText(value);
  return COMPANION_RELATION_OPTIONS.find((option) => normalizeText(option) === normalized)
    || COMPANION_RELATION_OPTIONS.find((option) => normalizeText(option).includes(normalized) || normalized.includes(normalizeText(option)))
    || DEFAULT_COMPANION_RELATION;
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
  const status = memberReviewStatus(member);
  if (status === "ERROR") {
    return "error";
  }
  if (status === "NEEDS_REVIEW") {
    return "warn";
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
  state.validCount = members.filter((member) => memberReviewStatus(member) === "VALID").length;
  state.errorCount = members.filter((member) => memberReviewStatus(member) === "ERROR").length;
  state.reviewCount = members.filter((member) => memberReviewStatus(member) === "NEEDS_REVIEW").length;
}

function normalizeDurationMs(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : 0;
}

function memberScanTotalMs(member) {
  const metrics = member?.processingMetrics;
  if (!metrics || typeof metrics !== "object") {
    return 0;
  }
  return normalizeDurationMs(metrics.totalMs);
}

function scanTimingSummary() {
  const summary = scanTimingSummaryFromPerformance(state.scanPerfSummary);
  const latest = state.lastScanMetric || latestScanMetricFromManifest();
  if (summary.filesWithMetrics > 0) {
    return { ...summary, latest };
  }

  const liveSummary = scanTimingSummaryFromValues(
    state.scanMetricRecords.map((entry) => entry.totalMs),
  );
  if (liveSummary.filesWithMetrics > 0) {
    return { ...liveSummary, latest };
  }

  return { ...scanTimingSummaryFromValues(manifestMembers().map(memberScanTotalMs)), latest };
}

function scanTimingSummaryFromPerformance(summary) {
  if (!summary || typeof summary !== "object") {
    return emptyScanTimingSummary();
  }

  const filesWithMetrics = normalizeDurationMs(summary.filesWithMetrics);
  const avgTotalMs = normalizeDurationMs(summary.avgTotalMs);
  if (filesWithMetrics <= 0 || avgTotalMs <= 0) {
    return emptyScanTimingSummary();
  }

  return {
    filesWithMetrics,
    avgTotalMs,
    p95TotalMs: normalizeDurationMs(summary.p95TotalMs),
    maxTotalMs: normalizeDurationMs(summary.maxTotalMs),
  };
}

function scanTimingSummaryFromValues(values) {
  const durations = values
    .map(normalizeDurationMs)
    .filter((value) => value > 0);
  if (!durations.length) {
    return emptyScanTimingSummary();
  }

  const sorted = [...durations].sort((left, right) => left - right);
  const p95Index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  const total = durations.reduce((sum, value) => sum + value, 0);
  return {
    filesWithMetrics: durations.length,
    avgTotalMs: Math.round(total / durations.length),
    p95TotalMs: sorted[p95Index],
    maxTotalMs: sorted[sorted.length - 1],
  };
}

function emptyScanTimingSummary() {
  return {
    filesWithMetrics: 0,
    avgTotalMs: 0,
    p95TotalMs: 0,
    maxTotalMs: 0,
  };
}

function latestScanMetricFromManifest() {
  const members = manifestMembers();
  for (let index = members.length - 1; index >= 0; index -= 1) {
    const totalMs = memberScanTotalMs(members[index]);
    if (totalMs > 0) {
      return {
        fileName: String(members[index].fileName || ""),
        totalMs,
        metrics: members[index].processingMetrics,
      };
    }
  }
  return null;
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
    const timing = scanTimingSummary();
    const timingText = timing.filesWithMetrics > 0 ? ` | avg ${formatDurationMs(timing.avgTotalMs)}` : "";
    lines.push(`Hasil akhir | VALID ${state.validCount} | REVIEW ${state.reviewCount} | ERROR ${state.errorCount}${timingText}`);
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

function normalizeOcrMode(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return OCR_MODE_VALUES.has(normalized) ? normalized : DEFAULT_OCR_MODE;
}

function ocrModeLabel(value) {
  return OCR_MODE_LABELS[normalizeOcrMode(value)];
}

function loadOcrMode() {
  return DEFAULT_OCR_MODE;
}

function updateOcrMode(value) {
  state.ocrMode = normalizeOcrMode(value);
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

function reportRuntimeError(error, label = "Aksi aplikasi") {
  const message = errorMessage(error);
  state.statusHeadline = `${label} gagal`;
  state.statusDetail = message;
  state.isChoosingFolder = false;
  state.isStartingScan = false;
  appendScanLog(`[APP] ${label} gagal | ${message}`);

  try {
    renderAll();
  } catch (renderError) {
    showFatalScreen(`${label}: ${message}\n\nRender: ${errorMessage(renderError)}`);
  }
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

