import {
  basenameFromPath,
} from "./main-utils.js";
import {
  createReviewActions,
} from "./main-review-actions.js";
import {
  createReviewFlow,
} from "./main-review-flow.js";
import {
  setupScanEventBridge,
} from "./main-scan-events.js";
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
} from "./main-state.js";
import {
  createImportWorkflow,
} from "./main-import-flow.js";
import {
  createImportViewController,
} from "./main-import-view.js";
import {
  createManifestWorkflow,
} from "./main-manifest-workflow.js";
import {
  createWorkspaceDatePickerController,
} from "./main-date-pickers.js";
import {
  createRuntimeController,
} from "./main-runtime.js";
import {
  createSessionDataController,
} from "./main-session-data.js";
import {
  createViewController,
} from "./main-view-controller.js";
import {
  createRecentBatchActions,
} from "./main-recent-actions.js";
import {
  createMainRenderer,
} from "./main-render-shell.js";
import {
  createPassportDeleteActions,
} from "./main-passport-delete-actions.js";
import {
  createManifestPersistence,
} from "./main-manifest-persistence.js";
import {
  loadOcrMode,
} from "./main-ocr.js";
import {
  createPassportPreviewActions,
} from "./main-passport-preview-actions.js";
import {
  errorMessage,
  startRendererHeartbeat,
  startRendererKeepAlive,
  tauriBindings,
} from "./main-system.js";

const state = createInitialState();
const dom = {};
let actionAvailabilityController = null;
let importViewController = null;
let manifestWorkflow = null;
let pageFlow = null;
let passportPreviewActions = null;
let viewController = null;
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
  appendScanLog,
  loadRecentBatches,
  recentEntryByPath,
  refreshCompactLogs,
  rememberRecentBatch,
  saveRecentBatches,
  updateOcrMode,
} = createSessionDataController({
  state,
  manifestMembers,
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
  renderImportPage: () => importViewController?.renderImportPage(),
  renderProgressPanel: () => viewController?.renderProgressPanel(),
  renderScanLogs: () => viewController?.renderScanLogs(),
  renderPassportList: () => viewController?.renderPassportList(),
  renderPassportPreview: () => passportPreviewActions?.renderPassportPreview(),
  renderWorkspace: () => viewController?.renderWorkspace(),
  renderReviewExportModal: () => viewController?.renderReviewExportModal(),
  renderEntryPage: () => viewController?.renderEntryPage(),
  updateActionAvailability: () => actionAvailabilityController?.updateActionAvailability(),
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
  setPage: (page) => pageFlow?.setPage(page),
  appendScanLog,
  rememberRecentBatch,
  loadManifest: () => manifestWorkflow?.loadManifest(),
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
manifestWorkflow = createManifestWorkflow({
  state,
  manifestMembers,
  syncManifestChildMetadata,
  firstMemberId,
  recalculateMetrics,
  ensureVisibleActiveMember,
  renderAll,
  hasAnyScanResult,
  hasScanResultForSelectedDir,
  loadManifestCommand: async (manifestPath) => {
    const { invoke } = tauriBindings();
    return invoke("load_manifest", { manifestPath });
  },
});
importViewController = createImportViewController({
  dom,
  state,
  hasAnyScanResult,
  hasScanResultForSelectedDir,
  updateActionAvailability: () => actionAvailabilityController?.updateActionAvailability(),
  updateOcrMode,
});
pageFlow = createPageFlow({
  dom,
  state,
  manifestMembers,
  reviewCompletionState,
  requiredFieldBlockingIssueForBatch: () => manifestWorkflow?.requiredFieldBlockingIssueForBatch(),
  showBatchReviewBlockingMessage,
  hasFolderSelectionConflict: () => Boolean(manifestWorkflow?.hasFolderSelectionConflict()),
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
  activeCategoryPair: () => viewController?.activeCategoryPair(),
  reviewCompletionState,
  reviewCompletionValidation: (member) => manifestWorkflow?.reviewCompletionValidation(member),
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
passportPreviewActions = createPassportPreviewActions({
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
  requiredFieldBlockingIssueForBatch: () => manifestWorkflow?.requiredFieldBlockingIssueForBatch(),
  showBatchReviewBlockingMessage,
  syncPassportPageWithActiveMember,
  isEntryAccessible,
  renderAll,
  renderReviewExportModal: () => viewController?.renderReviewExportModal(),
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
viewController = createViewController({
  dom,
  state,
  documentRef: document,
  activeMember,
  activeNavigationState,
  canAdvanceToNextPassport: (navigation) => Boolean(actionAvailabilityController?.canAdvanceToNextPassport(navigation)),
  exportPreviewState,
  filteredMembers,
  initializeWorkspaceDatePickers,
  isMemberReviewConfirmed,
  manifestMembers,
  renderEntryLogs,
  reviewCompletionState,
  reviewPrimaryActionLabel,
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
  reviewCompletionValidation: (member) => manifestWorkflow?.reviewCompletionValidation(member),
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
    passportPreviewActions?.initializePassportPreviewController();
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

function bindActions() {
  bindAppActions({
    dom,
    state,
    runAction,
    setPage: (page) => pageFlow?.setPage(page),
    updateSelectedDir,
    renderImportPage: () => importViewController?.renderImportPage(),
    updateActionAvailability: () => actionAvailabilityController?.updateActionAvailability(),
    chooseFolder,
    handleScanButtonClick,
    handleOcrModeChange: (event) => importViewController?.handleOcrModeChange(event),
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
    renderWorkspace: () => viewController?.renderWorkspace(),
    moveActiveMember,
    changePassportPreviewZoom: (delta) => passportPreviewActions?.changePassportPreviewZoom(delta),
    resetPassportPreviewZoom: () => passportPreviewActions?.resetPassportPreviewZoom(),
    handlePassportPreviewWheel: (event) => passportPreviewActions?.handlePassportPreviewWheel(event),
    handlePassportPreviewKeydown: (event) => passportPreviewActions?.handlePassportPreviewKeydown(event),
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
    loadManifest: () => manifestWorkflow?.loadManifest(),
    closeStopScanModal,
  });
}

