(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const { STORAGE_KEY } = root.constants || {};
  if (!STORAGE_KEY) {
    throw new Error("NusukAutofill constants were not loaded.");
  }

  function createPanelStateStore({ state, getPanelShell, getUploadState }) {
    function resetProgress() {
      state.progressCurrent = 0;
      state.progressTotal = 0;
      state.logs = [];
      postToPanel("NUSUK_PANEL_LOG_RESET", {});
      postPanelState();
    }

    function appendLog(level, message) {
      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        level,
        message: String(message || ""),
        timestamp: new Date().toISOString(),
      };
      state.logs = [...state.logs, entry].slice(-50);
      postToPanel("NUSUK_PANEL_LOG_APPEND", { entry });
    }

    function postProgress() {
      postToPanel("NUSUK_PANEL_PROGRESS", {
        current: state.progressCurrent,
        total: state.progressTotal,
      });
    }

    function postPanelState() {
      const panelShell = getPanelShell();
      if (!panelShell?.isReady()) {
        return;
      }
      const { uploadFileCount, uploadFileNames } = getUploadState();
      postToPanel("NUSUK_PANEL_STATE", {
        manifest: state.manifest,
        selectedMemberId: state.selectedMemberId,
        collapsed: state.collapsed,
        closed: state.closed,
        executionState: state.executionState,
        panelWidth: state.panelWidth,
        uploadFileCount,
        uploadFileNames,
        progress: {
          current: state.progressCurrent,
          total: state.progressTotal,
        },
        logs: state.logs,
      });
    }

    function postToPanel(type, payload) {
      getPanelShell()?.postToPanel(type, payload);
    }

    async function persistState() {
      await chrome.storage.local.set({
        [STORAGE_KEY]: {
          manifest: state.manifest,
          selectedMemberId: state.selectedMemberId,
          collapsed: state.collapsed,
          closed: state.closed,
          panelWidth: state.panelWidth,
          executionState: state.executionState,
          progressCurrent: state.progressCurrent,
          progressTotal: state.progressTotal,
          logs: state.logs,
          currentRunPayload: state.currentRunPayload,
        },
      });
    }

    return {
      resetProgress,
      appendLog,
      postProgress,
      postPanelState,
      postToPanel,
      persistState,
    };
  }

  root.panelStateStore = Object.freeze({
    createPanelStateStore,
  });
})();
