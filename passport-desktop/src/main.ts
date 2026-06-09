import {
  basenameFromPath,
} from "./shared/utils.js";
import {
  createReviewActions,
} from "./features/review/actions.js";
import {
  createReviewFlow,
} from "./features/review/flow.js";
import {
  setupScanEventBridge,
} from "./features/scan/events.js";
import {
  createEntryFlow,
} from "./features/entry/flow.js";
import {
  createPageFlow,
} from "./core/page-flow.js";
import {
  createActionAvailabilityController,
} from "./core/action-availability.js";
import {
  createMemberStateController,
} from "./shared/member-state.js";
import {
  bindDom,
} from "./core/dom.js";
import {
  bindActions as bindAppActions,
} from "./core/actions.js";
import {
  createInitialState,
} from "./core/state.js";
import {
  createImportWorkflow,
} from "./features/import/flow.js";
import {
  createImportViewController,
} from "./features/import/view.js";
import {
  createManifestWorkflow,
} from "./shared/manifest-workflow.js";
import {
  createWorkspaceDatePickerController,
} from "./shared/date-pickers.js";
import {
  createRuntimeController,
} from "./core/runtime.js";
import {
  createSessionDataController,
} from "./shared/session-data.js";
import {
  createViewController,
} from "./core/view-controller.js";
import {
  bindWindowControls,
} from "./core/window-controls.js";
import {
  createRecentBatchActions,
} from "./features/recent/actions.js";
import {
  createMainRenderer,
} from "./core/render-shell.js";
import {
  createPassportDeleteActions,
} from "./features/passport/delete-actions.js";
import {
  createManifestPersistence,
} from "./shared/manifest-persistence.js";
import {
  loadOcrMode,
} from "./shared/ocr.js";
import {
  createPassportPreviewActions,
} from "./features/passport/preview-actions.js";
import {
  createPassportCropController,
} from "./features/passport/crop.js";
import {
  createPreparedPreviewController,
} from "./features/prepared/preview.js";
import {
  errorMessage,
  startRendererHeartbeat,
  startRendererKeepAlive,
  tauriBindings,
} from "./core/system.js";

const state = createInitialState();
const dom = {};
let actionAvailabilityController: any = null;
let importViewController: any = null;
let manifestWorkflow: any = null;
let pageFlow: any = null;
let passportCropActions: any = null;
let passportPreviewActions: any = null;
let preparedPreviewController: any = null;
let viewController: any = null;
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
  renderPreparedPreview: () => preparedPreviewController?.render(),
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
  handleStartScanButtonClick,
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
  prepareImagesCommand: async ({ selectedDir }) => {
    const { invoke } = tauriBindings();
    return invoke("prepare_passport_images", { selectedDir });
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
  preparedPreviewController = createPreparedPreviewController({
  state,
  dom,
  requestFrame,
  renderAll,
  loadPreparedImageData: async ({ imagePath, fileName }) => {
    const { invoke } = tauriBindings();
    return invoke("load_passport_image_data", {
      manifestPath: "",
      imagePath,
      fileName,
    });
  },
  savePreparedPassportImage: async ({
    preparedManifestPath,
    itemId,
    sourceImagePath,
    dataUrl,
    crop,
    rotationDegrees,
  }) => {
    const { invoke } = tauriBindings();
    return invoke("save_prepared_passport_image", {
      preparedManifestPath,
      itemId,
      sourceImagePath,
      dataUrl,
      crop,
      rotationDegrees,
    });
  },
  removePreparedPassportImage: async ({ preparedManifestPath, itemId }) => {
    const { invoke } = tauriBindings();
    return invoke("remove_prepared_passport_image", {
      preparedManifestPath,
      itemId,
    });
  },
  openPreparedCropModal: (item) => passportCropActions?.openPreparedCropModal(item),
});
passportCropActions = createPassportCropController({
  state,
  dom,
  requestFrame,
  activeMember,
  activePreparedItem: () => preparedPreviewController?.activePreparedItem(),
  replaceMemberInManifest,
  scheduleManifestSave,
  renderAll,
  loadPassportImageData: async ({ manifestPath, imagePath, fileName }) => {
    const { invoke } = tauriBindings();
    return invoke("load_passport_image_data", {
      manifestPath,
      imagePath,
      fileName,
    });
  },
  saveCroppedPassportImage: async ({ manifestPath, memberId, fileName, sourceImagePath, dataUrl, crop }) => {
    const { invoke } = tauriBindings();
    return invoke("save_cropped_passport_image", {
      manifestPath,
      memberId,
      fileName,
      sourceImagePath,
      dataUrl,
      crop,
    });
  },
  loadPreparedImageData: async ({ imagePath, fileName }) => {
    const { invoke } = tauriBindings();
    return invoke("load_passport_image_data", {
      manifestPath: "",
      imagePath,
      fileName,
    });
  },
  savePreparedPassportImage: async ({
    preparedManifestPath,
    itemId,
    sourceImagePath,
    dataUrl,
    crop,
    rotationDegrees,
  }) => {
    const { invoke } = tauriBindings();
    return invoke("save_prepared_passport_image", {
      preparedManifestPath,
      itemId,
      sourceImagePath,
      dataUrl,
      crop,
      rotationDegrees,
    });
  },
  applyPreparedSession: (session, activeId) => preparedPreviewController?.applyPreparedSession(session, activeId),
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
  handleOpenJsonLocation,
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
  openJsonLocation: async (path) => {
    const { invoke } = tauriBindings();
    return invoke("open_path_location", { path });
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
    bindWindowControls({ dom, appWindow: window, documentRef: document });
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
    handleStartScanButtonClick,
    handleOcrModeChange: (event) => importViewController?.handleOcrModeChange(event),
    selectPreparedPassport: (itemId) => preparedPreviewController?.selectPreparedItem(itemId),
    rotatePreparedPassport: (direction) => preparedPreviewController?.rotateActivePreparedItem(direction),
    flipPreparedPassport: (axis) => preparedPreviewController?.flipActivePreparedItem(axis),
    changePreparedPreviewZoom: (delta) => preparedPreviewController?.changeZoom(delta),
    resetPreparedPreviewZoom: () => preparedPreviewController?.resetZoom(),
    openPreparedLargePreview: () => preparedPreviewController?.openLargePreview(),
    closePreparedLargePreview: () => preparedPreviewController?.closeLargePreview(),
    openPreparedCropModal: () => preparedPreviewController?.openCropActive(),
    openPreparedDeleteModal: () => preparedPreviewController?.openDeleteActive(),
    closePreparedDeleteModal: () => preparedPreviewController?.closeDeleteModal(),
    confirmPreparedDelete: () => preparedPreviewController?.confirmDeleteActive(),
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
    handleOpenJsonLocation,
    handleExportPreviewMemberClick,
    renderEntryLogs,
    renderScanLogs: () => viewController?.renderScanLogs(),
    syncPassportPageWithActiveMember,
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
    openPassportCropModal: () => passportCropActions?.openCropModal(),
    closePassportCropModal: () => passportCropActions?.closeCropModal(),
    resetPassportCropRect: () => passportCropActions?.resetCropRect(),
    savePassportCrop: () => passportCropActions?.saveCrop(),
    handlePassportCropPointerDown: (event) => passportCropActions?.handleCanvasPointerDown(event),
    handlePassportCropPointerMove: (event) => passportCropActions?.handleCanvasPointerMove(event),
    handlePassportCropPointerUp: (event) => passportCropActions?.handleCanvasPointerUp(event),
    handlePassportCropKeydown: (event) => passportCropActions?.handleCanvasKeydown(event),
    handlePassportCropZoomInput: (event) => passportCropActions?.handleZoomInput(event),
    handlePassportCropResize: () => passportCropActions?.handleResize(),
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

