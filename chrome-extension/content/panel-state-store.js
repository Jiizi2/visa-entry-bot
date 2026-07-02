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
      try {
        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            type: "NUSUK_WS_EVENT",
            payload: {
              eventType: "PROGRESS",
              current: state.progressCurrent,
              total: state.progressTotal,
              status: state.executionState ? state.executionState.toUpperCase() : "IDLE",
              revision: state.revision || 0
            }
          });
        }
      } catch (e) {
        console.warn("Failed to send progress via runtime.sendMessage:", e);
      }
    }

    function postPanelState() {
      const { uploadFileCount, uploadFileNames } = getUploadState();
      postToPanel("NUSUK_PANEL_STATE", {
        manifest: state.manifest,
        selectedMemberId: state.selectedMemberId,
        collapsed: state.collapsed,
        closed: state.closed,
        executionState: state.executionState,
        resumeAvailable: isRunnablePayload(state.currentRunPayload),
        panelWidth: state.panelWidth,
        uploadFileCount,
        uploadFileNames,
        progress: {
          current: state.progressCurrent,
          total: state.progressTotal,
        },
        logs: state.logs,
        autofillFailures: state.autofillFailures || [],
        revision: state.revision || 0,
        activeSessionId: state.activeSessionId || "",
      });
      if (root.widgetInstance) {
        root.widgetInstance.updateWidgetUI();
      }
    }

    function isRunnablePayload(payload) {
      return Array.isArray(payload?.members) && payload.members.some((member) => member && typeof member === "object");
    }

    function postToPanel(type, payload) {
      try {
        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ type, payload });
        }
      } catch (e) {
        console.warn("Failed to send message to side panel:", e);
      }
    }

    async function persistState() {
      const storage = getStorageLocal();
      if (!storage?.set) {
        return;
      }
      await storage.set({
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
          autofillFailures: Array.isArray(state.autofillFailures) ? state.autofillFailures.slice(-100) : [],
          autofillAttemptFailures: Array.isArray(state.autofillAttemptFailures) ? state.autofillAttemptFailures.slice(-100) : [],
          autofillFailureScreenshots: Array.isArray(state.autofillFailureScreenshots) ? state.autofillFailureScreenshots.slice(-3) : [],
          currentRunPayload: state.currentRunPayload,
          revision: state.revision || 0,
          activeSessionId: state.activeSessionId || "",
        },
      });
    }

    function getStorageLocal() {
      try {
        if (typeof globalThis !== "undefined" && globalThis.chrome && globalThis.chrome.storage && globalThis.chrome.storage.local) {
          return globalThis.chrome.storage.local;
        }
      } catch (e) {
        console.warn("Chrome storage API not accessible:", e);
      }
      return null;
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
