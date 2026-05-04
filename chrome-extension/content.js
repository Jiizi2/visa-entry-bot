(function () {
  const { constants } = window.NusukAutofill || {};
  if (!constants) {
    throw new Error("NusukAutofill constants were not loaded.");
  }
  const {
    STORAGE_KEY,
    PANEL_WIDTH_DEFAULT,
  } = constants;
  const { createPanelShell, clampPanelWidth } = window.NusukAutofill.panelShell || {};
  if (!createPanelShell) {
    throw new Error("NusukAutofill panel shell was not loaded.");
  }
  const { createPanelBridge } = window.NusukAutofill.panelBridge || {};
  if (!createPanelBridge) {
    throw new Error("NusukAutofill panel bridge was not loaded.");
  }
  const { createExecutionControl } = window.NusukAutofill.executionControl || {};
  if (!createExecutionControl) {
    throw new Error("NusukAutofill execution control was not loaded.");
  }
  const { createPanelStateStore } = window.NusukAutofill.panelStateStore || {};
  if (!createPanelStateStore) {
    throw new Error("NusukAutofill panel state store was not loaded.");
  }
  const { createWaitUtils } = window.NusukAutofill.waitUtils || {};
  if (!createWaitUtils) {
    throw new Error("NusukAutofill wait utils were not loaded.");
  }
  const { deleteLabeledAttachment } = window.NusukAutofill.attachmentUtils || {};
  if (!deleteLabeledAttachment) {
    throw new Error("NusukAutofill attachment utils were not loaded.");
  }
  const { createUploadManager } = window.NusukAutofill.uploadManager || {};
  if (!createUploadManager) {
    throw new Error("NusukAutofill upload manager was not loaded.");
  }
  const { createActiveHighlight } = window.NusukAutofill.activeHighlight || {};
  if (!createActiveHighlight) {
    throw new Error("NusukAutofill active highlight was not loaded.");
  }
  const { createNusukNavigation } = window.NusukAutofill.nusukNavigation || {};
  if (!createNusukNavigation) {
    throw new Error("NusukAutofill navigation was not loaded.");
  }
  const { createDropdownActions } = window.NusukAutofill.dropdownActions || {};
  if (!createDropdownActions) {
    throw new Error("NusukAutofill dropdown actions were not loaded.");
  }
  const {
    createResidencyActions,
    isResidencyText,
  } = window.NusukAutofill.residencyActions || {};
  if (!createResidencyActions || !isResidencyText) {
    throw new Error("NusukAutofill residency actions were not loaded.");
  }
  const { createPhoneFields } = window.NusukAutofill.phoneFields || {};
  if (!createPhoneFields) {
    throw new Error("NusukAutofill phone fields were not loaded.");
  }
  const { createCalendarActions } = window.NusukAutofill.calendarActions || {};
  if (!createCalendarActions) {
    throw new Error("NusukAutofill calendar actions were not loaded.");
  }
  const { createStepRunner } = window.NusukAutofill.stepRunner || {};
  if (!createStepRunner) {
    throw new Error("NusukAutofill step runner was not loaded.");
  }
  const { createAutomationRunner } = window.NusukAutofill.automationRunner || {};
  if (!createAutomationRunner) {
    throw new Error("NusukAutofill automation runner was not loaded.");
  }
  const { createAutofillSession } = window.NusukAutofill.autofillSession || {};
  if (!createAutofillSession) {
    throw new Error("NusukAutofill autofill session was not loaded.");
  }

  const state = {
    manifest: null,
    selectedMemberId: "",
    collapsed: true,
    closed: true,
    panelWidth: PANEL_WIDTH_DEFAULT,
    executionState: "idle",
    progressCurrent: 0,
    progressTotal: 0,
    logs: [],
    currentRunPayload: null,
    runToken: 0,
  };
  let backgroundRunNoticeActive = false;
  const {
    checkpoint,
    isControlError,
    sleep,
  } = createExecutionControl({ state });
  const {
    waitForInput,
    waitForEnabled,
    waitForSelector,
    waitUntil,
    waitForPageReady,
    slowModeDelayBeforeStep,
    slowModeDelayAfterStep,
    humanDelayBeforeAction,
  } = createWaitUtils({ state, checkpoint, sleep });

  let panelShell = null;
  let panelBridge = null;
  let uploadManager = null;
  const {
    ensureHighlightStyle,
    markActiveElement,
    clearActiveHighlight,
  } = createActiveHighlight();
  const {
    waitForProceedOrPassportDetails,
    waitForNusukPageReady,
    clickProceedButtonRobust,
    waitForEnabledNextButton,
    clickNextButtonRobust,
    attemptFillRequiredFieldsForCurrentPage,
  } = createNusukNavigation({
    state,
    waitUntil,
    sleep,
    markActiveElement,
  });
  const {
    resetProgress,
    appendLog,
    postProgress,
    postPanelState,
    postToPanel,
    persistState,
  } = createPanelStateStore({
    state,
    getPanelShell: () => panelShell,
    getUploadState: () => uploadManager?.getUploadState() || { uploadFileCount: 0, uploadFileNames: [] },
  });
  const {
    selectPrimengDropdown,
    selectLabeledDropdown,
    findLabeledFieldRoot,
    clickLabeledDropdownTrigger,
    clickDropdownOption,
  } = createDropdownActions({
    state,
    checkpoint,
    waitForSelector,
    waitUntil,
    sleep,
    markActiveElement,
    appendLog,
  });
  const { setPhoneFields } = createPhoneFields({
    state,
    waitUntil,
    sleep,
    checkpoint,
    markActiveElement,
    appendLog,
    findLabeledFieldRoot,
    clickDropdownOption,
  });
  const { setCalendarDate } = createCalendarActions({
    state,
    waitForInput,
    waitForSelector,
    sleep,
    markActiveElement,
  });
  uploadManager = createUploadManager({
    state,
    appendLog,
    checkpoint,
    waitForSelector,
    isResidencyText,
  });
  const {
    registerUploadFiles,
    waitForFileInputForStep,
    resolveUploadFilePath,
    resolveSelectedUploadFile,
    buildUploadFailureMessage,
    isFileInputAlreadyUsing,
    prepareFileForWebsiteUpload,
    formatBytesAsKb,
    trySetFileInputWithDebugger,
    setFileInputFromFile,
    notifyUploadWidget,
  } = uploadManager;
  const {
    clearFields,
    clearResidencyInfo,
    confirmDeleteIfShown,
  } = createResidencyActions({
    state,
    sleep,
    markActiveElement,
    deleteLabeledAttachment,
    notifyUploadWidget,
    clickLabeledDropdownTrigger,
    clickDropdownOption,
  });
  const {
    runStep,
    countsForProgress,
  } = createStepRunner({
    state,
    checkpoint,
    sleep,
    waitForInput,
    waitForEnabled,
    waitForSelector,
    waitForPageReady,
    slowModeDelayBeforeStep,
    humanDelayBeforeAction,
    markActiveElement,
    clearActiveHighlight,
    appendLog,
    postProgress,
    postToPanel,
    waitForProceedOrPassportDetails,
    waitForNusukPageReady,
    clickProceedButtonRobust,
    waitForEnabledNextButton,
    clickNextButtonRobust,
    attemptFillRequiredFieldsForCurrentPage,
    clearFields,
    clearResidencyInfo,
    deleteLabeledAttachment,
    confirmDeleteIfShown,
    setPhoneFields,
    setCalendarDate,
    selectPrimengDropdown,
    selectLabeledDropdown,
    upload: {
      waitForFileInputForStep,
      resolveUploadFilePath,
      resolveSelectedUploadFile,
      buildUploadFailureMessage,
      isFileInputAlreadyUsing,
      prepareFileForWebsiteUpload,
      formatBytesAsKb,
      trySetFileInputWithDebugger,
      setFileInputFromFile,
      notifyUploadWidget,
    },
  });
  const {
    runAutomation,
    getSelectedMember,
  } = createAutomationRunner({
    state,
    checkpoint,
    slowModeDelayAfterStep,
    appendLog,
    postPanelState,
    persistState,
    runStep,
    countsForProgress,
  });
  const {
    startAutofillFromPanel,
    resumeAutofillAfterReload,
    pauseAutofillFromPanel,
    resetAutofillFromPanel,
  } = createAutofillSession({
    state,
    isControlError,
    clearActiveHighlight,
    resetProgress,
    appendLog,
    postPanelState,
    postToPanel,
    persistState,
    getUploadState: () => uploadManager.getUploadState(),
    runAutomation,
    getSelectedMember,
    setTabAutoDiscardable,
  });

  bootstrap().catch((error) => {
    console.error("Nusuk panel bootstrap failed:", error);
  });

  async function bootstrap() {
    panelShell = createPanelShell({ state, persistState, postPanelState });
    panelBridge = createPanelBridge({
      state,
      panelShell,
      persistState,
      postPanelState,
      postToPanel,
      registerUploadFiles,
      getUploadFileCount: () => uploadManager.getUploadState().uploadFileCount,
      startAutofillFromPanel,
      pauseAutofillFromPanel,
      resetAutofillFromPanel,
      runAutomation,
      setTabAutoDiscardable,
    });
    await hydrateState();
    ensureHighlightStyle();
    panelShell.injectPanelShell();
    panelBridge.bindWindowBridge();
    panelBridge.bindRuntimeMessages();
    bindVisibilityStatus();
    scheduleResumeAfterReload();
  }

  function bindVisibilityStatus() {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    handleVisibilityChange();
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      if (state.executionState !== "running") {
        backgroundRunNoticeActive = false;
        return;
      }
      if (!backgroundRunNoticeActive) {
        backgroundRunNoticeActive = true;
        postToPanel("NUSUK_PANEL_STATUS", {
          tone: "neutral",
          message: "Automation tetap berjalan di background.",
        });
      }
      return;
    }

    if (backgroundRunNoticeActive && state.executionState === "running") {
      backgroundRunNoticeActive = false;
      postToPanel("NUSUK_PANEL_STATUS", {
        tone: "neutral",
        message: "Tab Nusuk aktif lagi. Automation masih berjalan.",
      });
      return;
    }
    backgroundRunNoticeActive = false;
  }

  async function setTabAutoDiscardable(autoDiscardable) {
    const response = await chrome.runtime.sendMessage({
      type: "NUSUK_SET_TAB_AUTO_DISCARDABLE",
      payload: { autoDiscardable: Boolean(autoDiscardable) },
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Gagal mengubah status auto-discard tab Nusuk.");
    }
    return response;
  }

  async function hydrateState() {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const saved = stored?.[STORAGE_KEY];
    if (!saved || typeof saved !== "object") {
      return;
    }
    state.manifest = saved.manifest && Array.isArray(saved.manifest.members) ? saved.manifest : null;
    state.selectedMemberId = String(saved.selectedMemberId || "");
    state.collapsed = Boolean(saved.collapsed);
    state.closed = Object.prototype.hasOwnProperty.call(saved, "closed") ? Boolean(saved.closed) : true;
    state.panelWidth = clampPanelWidth(saved.panelWidth);
    state.progressCurrent = Number(saved.progressCurrent || 0);
    state.progressTotal = Number(saved.progressTotal || 0);
    state.logs = Array.isArray(saved.logs) ? saved.logs.slice(-50) : [];
    state.currentRunPayload = isRunnablePayload(saved.currentRunPayload) ? saved.currentRunPayload : null;
    state.executionState = normalizeHydratedExecutionState(saved.executionState, state.currentRunPayload);
    if (state.executionState === "running") {
      state.closed = false;
      state.collapsed = false;
    }
  }

  function scheduleResumeAfterReload() {
    if (state.executionState !== "running" || !isRunnablePayload(state.currentRunPayload)) {
      return;
    }
    window.setTimeout(() => {
      void resumeAutofillAfterReload();
    }, 1400);
  }

  function isRunnablePayload(payload) {
    return Array.isArray(payload?.members) && payload.members.some((member) => member && typeof member === "object");
  }

  function normalizeHydratedExecutionState(value, payload) {
    const text = String(value || "").trim().toLowerCase();
    if (text === "running") {
      return isRunnablePayload(payload) ? "running" : "completed";
    }
    if (text === "paused") {
      return isRunnablePayload(payload) ? "paused" : "idle";
    }
    return ["idle", "completed"].includes(text) ? text : "idle";
  }

})();
