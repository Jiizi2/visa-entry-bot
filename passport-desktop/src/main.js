import {
  basenameFromPath,
  normalizeDateToNusuk,
  cloneJson,
  escapeHtml,
} from "./main-utils.js";
import {
  FIELD_CATEGORY_PAIRS,
  isDateFieldKey,
} from "./main-fields.js";
import {
  activeCategoryPairForState,
  renderWorkspaceView,
} from "./main-review-workspace.js";
import {
  createReviewActions,
} from "./main-review-actions.js";
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
  memberReviewStatus,
  computeReviewCompletionState,
  isEntryAccessible as isEntryAccessibleForState,
} from "./main-entry.js";
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
  passportListPaginationState,
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
  memberDisplayName,
  syncMemberChildMetadata,
} from "./main-members.js";
import {
  loadOcrMode,
  normalizeOcrMode,
  ocrModeLabel,
} from "./main-ocr.js";
import {
  createPassportPreviewController,
} from "./main-passport-preview.js";
import {
  closestFromEventTarget,
  errorMessage,
  startRendererHeartbeat,
  startRendererKeepAlive,
  tauriBindings,
} from "./main-system.js";

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

const state = createInitialState();
const dom = {};
let passportPreviewController = null;
const requestFrame = typeof window.requestAnimationFrame === "function"
  ? window.requestAnimationFrame.bind(window)
  : (callback) => window.setTimeout(callback, 16);
const cancelFrame = typeof window.cancelAnimationFrame === "function"
  ? window.cancelAnimationFrame.bind(window)
  : (handle) => window.clearTimeout(handle);
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

function showBatchReviewBlockingMessage(validation) {
  if (validation.memberId) {
    state.activeMemberId = validation.memberId;
    syncPassportPageWithActiveMember();
  }
  state.currentPage = "validation";
  showReviewBlockingMessage(validation);
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

function paginationState(totalItems) {
  return passportListPaginationState(state, totalItems);
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

function recalculateMetrics() {
  const members = manifestMembers();
  state.totalFiles = members.length;
  state.validCount = members.filter((member) => memberReviewStatus(member) === "VALID").length;
  state.errorCount = members.filter((member) => memberReviewStatus(member) === "ERROR").length;
  state.reviewCount = members.filter((member) => memberReviewStatus(member) === "NEEDS_REVIEW").length;
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

