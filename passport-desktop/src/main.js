import {
  basenameFromPath,
  cloneJson,
} from "./main-utils.js";
import {
  activeCategoryPairForState,
  renderWorkspaceView,
} from "./main-review-workspace.js";
import {
  createReviewActions,
} from "./main-review-actions.js";
import {
  createReviewFlow,
} from "./main-review-flow.js";
import {
  requiredFieldBlockingIssueForBatch as requiredFieldBlockingIssueForMembers,
  reviewCompletionValidation as reviewCompletionValidationForMember,
} from "./main-review-validation.js";
import {
  setupScanEventBridge,
} from "./main-scan-events.js";
import {
  refreshCompactLogsForState,
  renderProgressPanelView,
  renderScanLogsView,
} from "./main-scan-render.js";
import {
  renderEntryPageView,
  renderReviewExportModalView,
} from "./main-entry-render.js";
import {
  createEntryFlow,
} from "./main-entry-flow.js";
import {
  createPageFlow,
} from "./main-page-flow.js";
import {
  createActionAvailabilityController,
} from "./main-action-availability.js";
import {
  createMemberStateController,
} from "./main-member-state.js";
import {
  bindDom,
} from "./main-dom.js";
import {
  bindActions as bindAppActions,
} from "./main-actions.js";
import {
  createInitialState,
  STORAGE_KEYS,
} from "./main-state.js";
import {
  ocrStatusDescriptor as ocrStatusDescriptorForState,
  renderImportPageView,
  renderMiniStatus,
  renderOcrModeSelectorView,
} from "./main-import-render.js";
import {
  createImportWorkflow,
} from "./main-import-flow.js";
import {
  createWorkspaceDatePickerController,
} from "./main-date-pickers.js";
import {
  createRuntimeController,
} from "./main-runtime.js";
import {
  buildRememberedRecentBatches,
  loadRecentBatches as loadRecentBatchesFromStorage,
  saveRecentBatches as saveRecentBatchesToStorage,
} from "./main-recent-batches.js";
import {
  createRecentBatchActions,
} from "./main-recent-actions.js";
import {
  createMainRenderer,
} from "./main-render-shell.js";
import {
  renderPassportListView,
} from "./main-passport-list-render.js";
import {
  createPassportDeleteActions,
} from "./main-passport-delete-actions.js";
import {
  createManifestPersistence,
} from "./main-manifest-persistence.js";
import {
  confirmedReviewIds,
  defaultSelectedIds,
} from "./main-export.js";
import {
  loadOcrMode,
  normalizeOcrMode,
  ocrModeLabel,
} from "./main-ocr.js";
import {
  createPassportPreviewController,
} from "./main-passport-preview.js";
import {
  errorMessage,
  startRendererHeartbeat,
  startRendererKeepAlive,
  tauriBindings,
} from "./main-system.js";

const state = createInitialState();
const dom = {};
let passportPreviewController = null;
let actionAvailabilityController = null;
const requestFrame = typeof window.requestAnimationFrame === "function"
  ? window.requestAnimationFrame.bind(window)
  : (callback) => window.setTimeout(callback, 16);
const cancelFrame = typeof window.cancelAnimationFrame === "function"
  ? window.cancelAnimationFrame.bind(window)
  : (handle) => window.clearTimeout(handle);
const {
  initializeWorkspaceDatePickers,
} = createWorkspaceDatePickerController({
  dom,
  appWindow: window,
  documentRef: document,
});
const {
  activeMember,
  activeNavigationState,
  changePassportListPage,
  ensureVisibleActiveMember,
  filteredMembers,
  firstMemberId,
  isEntryAccessible,
  manifestMembers,
  originalMemberById,
  paginationState,
  recalculateMetrics,
  replaceMemberInManifest,
  reviewCompletionState,
  scrollPassportListToTop,
  syncManifestChildMetadata,
  syncPassportPageWithActiveMember,
} = createMemberStateController({
  state,
  dom,
  requestFrame,
  renderAll: () => renderAll(),
});
const {
  renderAll,
  scheduleRenderAll,
} = createMainRenderer({
  dom,
  state,
  requestFrame,
  cancelFrame,
  documentRef: document,
  refreshCompactLogs,
  ensureVisibleActiveMember,
  renderImportPage,
  renderProgressPanel,
  renderScanLogs,
  renderPassportList,
  renderPassportPreview,
  renderWorkspace,
  renderReviewExportModal,
  renderEntryPage,
  updateActionAvailability,
  reviewCompletionState,
  isEntryAccessible,
});
const {
  scheduleManifestSave,
  flushManifestSave,
} = createManifestPersistence({
  state,
  renderAll,
  saveManifest: async ({ manifestPath, manifestData }) => {
    const { invoke } = tauriBindings();
    await invoke("save_manifest", {
      manifestPath,
      manifestData,
    });
  },
  windowRef: window,
});
const {
  reportRuntimeError,
  runAction,
  showFatalScreen,
} = createRuntimeController({
  state,
  appendScanLog,
  renderAll,
  documentRef: document,
});
const {
  clearReviewBlock,
  handleExportPreviewMemberClick,
  showBatchReviewBlockingMessage,
  showReviewBlockingMessage,
} = createReviewFlow({
  dom,
  state,
  requestFrame,
  manifestMembers,
  syncPassportPageWithActiveMember,
  renderAll,
});
const {
  chooseFolder,
  handleScanButtonClick,
  openStopScanModal,
  closeStopScanModal,
  confirmStopScan,
  resolveRescanConfirmation,
  hasAnyScanResult,
  hasScanResultForPath,
  hasScanResultForSelectedDir,
  updateSelectedDir,
  openRecentBatch,
} = createImportWorkflow({
  dom,
  state,
  windowRef: window,
  requestFrame,
  runAction,
  renderAll,
  setPage,
  appendScanLog,
  rememberRecentBatch,
  loadManifest,
  recalculateMetrics,
  manifestMembers,
  updateOcrMode,
  openFolderDialog: async (options) => {
    const { open } = tauriBindings();
    return open(options);
  },
  startScanCommand: async (payload) => {
    const { invoke } = tauriBindings();
    await invoke("start_scan", payload);
  },
  stopScanCommand: async () => {
    const { invoke } = tauriBindings();
    await invoke("stop_scan");
  },
  findManifestPath: async (basePath) => {
    const { invoke } = tauriBindings();
    return invoke("find_manifest_path", { basePath });
  },
});
const pageFlow = createPageFlow({
  dom,
  state,
  manifestMembers,
  reviewCompletionState,
  requiredFieldBlockingIssueForBatch,
  showBatchReviewBlockingMessage,
  hasFolderSelectionConflict,
  renderAll,
});
const {
  openReviewCompleteModal,
  closeReviewCompleteModal,
} = pageFlow;
const {
  clearMemberReviewConfirmation,
  handleSaveAndNext,
  isMemberReviewConfirmed,
  moveActiveMember,
  resetActiveMemberFields,
  reviewPrimaryActionLabel,
  updateActiveMemberCompanion,
  updateActiveMemberCompanionRelation,
  updateActiveMemberField,
} = createReviewActions({
  state,
  activeMember,
  manifestMembers,
  filteredMembers,
  activeNavigationState,
  activeCategoryPair,
  reviewCompletionState,
  reviewCompletionValidation,
  clearReviewBlock,
  showReviewBlockingMessage,
  openReviewCompleteModal,
  recalculateMetrics,
  scheduleManifestSave,
  renderAll,
  syncPassportPageWithActiveMember,
  scrollPassportListToTop,
  originalMemberById,
  replaceMemberInManifest,
});
const {
  openRecentDeleteModal,
  closeRecentDeleteModal,
  confirmRecentDelete,
  openRecentEditModal,
  closeRecentEditModal,
  confirmRecentEdit,
} = createRecentBatchActions({
  dom,
  state,
  basenameFromPath,
  recentEntryByPath,
  saveRecentBatches,
  renderAll,
  requestFrame,
});
const {
  openPassportDeleteModal,
  closePassportDeleteModal,
  confirmPassportDelete,
} = createPassportDeleteActions({
  dom,
  state,
  requestFrame,
  activeMember,
  manifestMembers,
  clearMemberReviewConfirmation,
  recalculateMetrics,
  filteredMembers,
  ensureVisibleActiveMember,
  syncPassportPageWithActiveMember,
  scheduleManifestSave,
  renderAll,
});
const {
  appendEntryLog,
  canExportReviewedJson,
  exportPreviewState,
  handlePrepareEntry,
  renderEntryLogs,
} = createEntryFlow({
  dom,
  state,
  manifestMembers,
  reviewCompletionState,
  requiredFieldBlockingIssueForBatch,
  showBatchReviewBlockingMessage,
  syncPassportPageWithActiveMember,
  isEntryAccessible,
  renderAll,
  renderReviewExportModal,
  flushManifestSave,
  createNusukBatch: async ({ manifestPath, selectedIds, manifestData }) => {
    const { invoke } = tauriBindings();
    return invoke("create_nusuk_batch", {
      manifestPath,
      selectedIds,
      manifestData,
    });
  },
});
actionAvailabilityController = createActionAvailabilityController({
  dom,
  state,
  activeMember,
  activeNavigationState,
  hasScanResultForSelectedDir,
  manifestMembers,
  reviewCompletionState,
  canExportReviewedJson,
  isMemberReviewConfirmed,
  reviewCompletionValidation,
});
let hasCompletedStartup = false;

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
    bindDom(dom);
    initializePassportPreviewController();
    bindActions();
    renderAll();
    hasCompletedStartup = true;
    startRendererKeepAlive();
    startRendererHeartbeat();
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

function initializePassportPreviewController() {
  passportPreviewController = createPassportPreviewController({
    state,
    dom,
    requestFrame,
    activeMember,
    isMemberReviewConfirmed,
    loadPassportImageData: async ({ manifestPath, imagePath, fileName }) => {
      const { invoke } = tauriBindings();
      return invoke("load_passport_image_data", {
        manifestPath,
        imagePath,
        fileName,
      });
    },
  });
}

function bindActions() {
  bindAppActions({
    dom,
    state,
    runAction,
    setPage,
    updateSelectedDir,
    renderImportPage,
    updateActionAvailability,
    chooseFolder,
    handleScanButtonClick,
    handleOcrModeChange,
    openStopScanModal,
    resolveRescanConfirmation,
    confirmStopScan,
    closeStopScanModal,
    confirmRecentDelete,
    closeRecentDeleteModal,
    confirmRecentEdit,
    closeRecentEditModal,
    confirmPassportDelete,
    closePassportDeleteModal,
    closeReviewCompleteModal,
    handlePrepareEntry,
    handleExportPreviewMemberClick,
    renderEntryLogs,
    openRecentBatch,
    openRecentEditModal,
    openRecentDeleteModal,
    ensureVisibleActiveMember,
    renderAll,
    scrollPassportListToTop,
    updateActiveMemberCompanion,
    scheduleRenderAll,
    updateActiveMemberCompanionRelation,
    updateActiveMemberField,
    resetActiveMemberFields,
    openPassportDeleteModal,
    handleSaveAndNext,
    renderWorkspace,
    moveActiveMember,
    changePassportPreviewZoom,
    resetPassportPreviewZoom,
    handlePassportPreviewWheel,
    handlePassportPreviewKeydown,
  });
}

async function setupEventBridge() {
  const { listen } = tauriBindings();
  await setupScanEventBridge({
    listen,
    state,
    appendScanLog,
    rememberRecentBatch,
    renderAll,
    scheduleRenderAll,
    loadManifest,
    closeStopScanModal,
  });
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
  return reviewCompletionValidationForMember(member, manifestMembers());
}

function requiredFieldBlockingIssueForBatch() {
  return requiredFieldBlockingIssueForMembers(manifestMembers());
}

function setPage(page) {
  pageFlow.setPage(page);
}

function renderImportPage() {
  renderImportPageView({
    dom,
    state,
    hasAnyScanResult,
    hasScanResultForSelectedDir,
  });
}

function renderOcrModeSelector() {
  renderOcrModeSelectorView({ dom, state });
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

function ocrStatusDescriptor() {
  return ocrStatusDescriptorForState({
    state,
    hasAnyScanResult,
    hasScanResultForSelectedDir,
  });
}

function renderReviewExportModal() {
  renderReviewExportModalView({ dom, state, preview: exportPreviewState() });
}

function renderEntryPage() {
  renderEntryPageView({ dom, state, preview: exportPreviewState() });
  renderEntryLogs();
}

function recentEntryByPath(path) {
  const targetPath = String(path || "").trim();
  return state.recentBatches.find((entry) => entry.path === targetPath) || null;
}

function renderProgressPanel() {
  renderProgressPanelView({ dom, state, members: manifestMembers() });
}

function renderScanLogs() {
  renderScanLogsView({ dom, state });
}

function renderPassportList() {
  renderPassportListView({
    dom,
    state,
    allMembers: manifestMembers(),
    visibleMembers: filteredMembers(),
    review: reviewCompletionState(),
    isMemberReviewConfirmed,
    activeNavigationState,
    canAdvanceToNextPassport,
  });
}

function renderPassportPreview() {
  passportPreviewController?.render();
}

function changePassportPreviewZoom(delta) {
  passportPreviewController?.changeZoom(delta);
}

function resetPassportPreviewZoom() {
  passportPreviewController?.resetZoom();
}

function resetPassportPreviewZoomState() {
  passportPreviewController?.resetZoomState();
}

function handlePassportPreviewWheel(event) {
  passportPreviewController?.handleWheel(event);
}

function handlePassportPreviewKeydown(event) {
  passportPreviewController?.handleKeydown(event);
}

function renderPassportPreviewZoomControls() {
  passportPreviewController?.renderZoomControls();
}

function isPassportPreviewImageReady() {
  return Boolean(passportPreviewController?.isImageReady());
}

function renderWorkspace() {
  renderWorkspaceView({
    dom,
    state,
    documentRef: document,
    activeMember,
    manifestMembers,
    initializeWorkspaceDatePickers,
    reviewPrimaryActionLabel,
  });
}

function activeCategoryPair() {
  return activeCategoryPairForState(state);
}

function updateActionAvailability() {
  actionAvailabilityController?.updateActionAvailability();
}

function canAdvanceToNextPassport(navigation) {
  return Boolean(actionAvailabilityController?.canAdvanceToNextPassport(navigation));
}

function hasFolderSelectionConflict() {
  return Boolean(state.selectedDir && hasAnyScanResult() && !hasScanResultForSelectedDir());
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
  refreshCompactLogsForState(state, manifestMembers());
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

function updateOcrMode(value) {
  state.ocrMode = normalizeOcrMode(value);
}

