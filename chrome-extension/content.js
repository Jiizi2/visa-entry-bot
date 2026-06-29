(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const { constants } = root;
  if (!constants) {
    throw new Error("NusukAutofill constants were not loaded.");
  }
  const {
    STORAGE_KEY,
    PANEL_WIDTH_DEFAULT,
  } = constants;
  function clampPanelWidth(width) {
    return Math.max(320, Math.min(600, Number(width || 420)));
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
  const { createWidgetManager } = window.NusukAutofill.widgetManager || {};
  if (!createWidgetManager) {
    throw new Error("NusukAutofill widget manager was not loaded.");
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
    autofillFailures: [],
    autofillAttemptFailures: [],
    autofillFailureScreenshots: [],
    resumeAvailableAfterReload: false,
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
    detectNusukStage,
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
    getPanelShell: () => null,
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
    sleep,
    waitUntil,
    detectNusukStage,
  });
  const {
    startAutofillFromPanel,
    resumeAutofillAfterReload,
    pauseAutofillFromPanel,
    resetAutofillFromPanel,
    restartFailedFromPanel,
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
    try {
      panelBridge = createPanelBridge({
        state,
        persistState,
        postPanelState,
        postToPanel,
        registerUploadFiles,
        getUploadFileCount: () => uploadManager.getUploadState().uploadFileCount,
        startAutofillFromPanel,
        pauseAutofillFromPanel,
        resetAutofillFromPanel,
        restartFailedFromPanel,
        runAutomation,
        setTabAutoDiscardable,
      });
      await hydrateState();
      ensureHighlightStyle();
      panelBridge.bindWindowBridge();
      panelBridge.bindRuntimeMessages();
      bindVisibilityStatus();
      resumeRunningAutofillAfterReload();

      // Instansiasi widget melayang
      root.widgetInstance = createWidgetManager({ state });

      // Dengarkan perubahan status minimize di storage secara reaktif
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, areaName) => {
          if (areaName === "local" && changes.entrymate_minimized) {
            const isMinimized = changes.entrymate_minimized.newValue;
            console.log("[Content] Status minimize berubah di storage:", isMinimized);
            
            const currentUrl = window.location.href;
            const isTargetPage = currentUrl.includes("/umrah/mutamer/add-mutamer") || currentUrl.includes("/umrah/mutamer/mutamer-list");
            
            if (isMinimized && isTargetPage) {
              root.widgetInstance?.showWidget();
            } else {
              root.widgetInstance?.hideWidget();
            }
          }
        });
      }

      // Pemantauan URL otomatis untuk halaman SPA Nusuk
      let lastUrl = "";
      let hasAutoOpenedThisSession = false;

      function checkUrlChange() {
        const currentUrl = window.location.href;
        if (currentUrl !== lastUrl) {
          lastUrl = currentUrl;
          onUrlChanged(currentUrl);
        }
      }

      function onUrlChanged(url) {
        console.log("[EntryMate] URL terdeteksi:", url);
        const isTargetPage = url.includes("/umrah/mutamer/add-mutamer") || url.includes("/umrah/mutamer/mutamer-list");
        if (isTargetPage) {
          if (chrome?.storage?.local) {
            chrome.storage.local.get(["entrymate_minimized"], (result) => {
              const isMinimized = result.entrymate_minimized === true;
              
              if (!hasAutoOpenedThisSession) {
                hasAutoOpenedThisSession = true;
                
                if (!isMinimized) {
                  // Coba buka SidePanel secara otomatis jika tidak dimimimize
                  chrome.runtime.sendMessage({ type: "NUSUK_OPEN_PANEL" }, (response) => {
                    // Jika gagal membuka (pembatasan user gesture Chrome), tampilkan widget melayang sebagai alternatif
                    if (!response || !response.ok) {
                      console.log("[EntryMate] Pembatasan user gesture terdeteksi. Menampilkan widget melayang.");
                      root.widgetInstance?.showWidget();
                    }
                  });
                } else {
                  root.widgetInstance?.showWidget();
                }
              } else if (isMinimized) {
                root.widgetInstance?.showWidget();
              }
            });
          }
        } else {
          hasAutoOpenedThisSession = false;
          // Sembunyikan widget jika keluar dari halaman target
          root.widgetInstance?.hideWidget();
        }
      }

      window.setInterval(checkUrlChange, 1000);
      checkUrlChange();
    } catch (bootstrapError) {
      console.error("[EntryMate] Bootstrap error:", bootstrapError);
    }
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
    const stored = await readStoredState();
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
    state.autofillFailures = Array.isArray(saved.autofillFailures) ? saved.autofillFailures.slice(-100) : [];
    state.autofillAttemptFailures = Array.isArray(saved.autofillAttemptFailures) ? saved.autofillAttemptFailures.slice(-100) : [];
    state.autofillFailureScreenshots = Array.isArray(saved.autofillFailureScreenshots) ? saved.autofillFailureScreenshots.slice(-3) : [];
    state.currentRunPayload = isRunnablePayload(saved.currentRunPayload) ? saved.currentRunPayload : null;
    state.resumeAvailableAfterReload = String(saved.executionState || "").trim().toLowerCase() === "running" && isRunnablePayload(state.currentRunPayload);
    state.executionState = normalizeHydratedExecutionState(saved.executionState, state.currentRunPayload);
    if (state.executionState === "running") {
      state.closed = false;
      state.collapsed = false;
    }
  }

  async function readStoredState() {
    const storage = getStorageLocal();
    if (!storage?.get) {
      return {};
    }
    return storage.get(STORAGE_KEY);
  }

  function getStorageLocal() {
    return globalThis.chrome?.storage?.local || null;
  }

  function resumeRunningAutofillAfterReload() {
    if (!state.resumeAvailableAfterReload || !isRunnablePayload(state.currentRunPayload)) {
      return;
    }
    state.resumeAvailableAfterReload = false;
    state.executionState = "running";
    state.closed = false;
    state.collapsed = false;
    void persistState();
    postPanelState();
    postToPanel("NUSUK_PANEL_STATUS", {
      tone: "warning",
      message: "Halaman Nusuk refresh. Autofill akan lanjut otomatis dari checkpoint.",
    });
    window.setTimeout(() => {
      void resumeAutofillAfterReload();
    }, 1200);
  }

  function isRunnablePayload(payload) {
    return Array.isArray(payload?.members) && payload.members.some((member) => member && typeof member === "object");
  }

  function normalizeHydratedExecutionState(value, payload) {
    const text = String(value || "").trim().toLowerCase();
    if (text === "running") {
      return isRunnablePayload(payload) ? "paused" : "completed";
    }
    if (text === "paused") {
      return isRunnablePayload(payload) ? "paused" : "idle";
    }
    return ["idle", "completed"].includes(text) ? text : "idle";
  }

})();
