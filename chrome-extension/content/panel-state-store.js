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
            type: "NUSUK_AUTOFILL_EVENT",
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
      const completed = new Set((state.completedMemberIds || []).map(String));
      const deferred = new Set((state.autofillFailures || []).filter(failure => failure.deferred).map(failure => String(failure.memberId)));
      const remaining = (state.currentRunPayload?.members || []).filter(member => member && !completed.has(String(member.id)) && !deferred.has(String(member.id)));
      const snapshot = {
        manifest: state.manifest,
        selectedMemberId: state.selectedMemberId,
        collapsed: state.collapsed,
        closed: state.closed,
        executionState: state.executionState,
        resumeAvailable: remaining.length > 0,
        remainingMemberCount: remaining.length,
        nextMemberId: String(remaining[0]?.id || ""),
        queuedMemberIds: remaining.map(member => String(member.id)),
        submissionResolutionInProgress: Boolean(state.submissionResolutionInProgress),
        queueUpdateInProgress: Boolean(state.queueUpdateInProgress),
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
        pageStatus: root.pageContext?.readPageContext().pageStatus || 'loading',
        canNavigateToEntry: root.pageContext?.readPageContext().canNavigateToEntry || false,
        completedMemberIds: state.completedMemberIds || [],
        pendingSubmission: state.pendingSubmission || null,
      };
      postToPanel("NUSUK_PANEL_STATE", snapshot);
      if (root.widgetInstance) {
        root.widgetInstance.updateWidgetUI();
      }
      return snapshot;
    }

    function postToPanel(type, payload) {
      try {
        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ type: 'NUSUK_CONTENT_PANEL_MESSAGE', payload: { type, payload } }).catch(() => {});
        }
      } catch (e) {
        console.warn("Failed to send message to side panel:", e);
      }
    }

    async function persistState({ required = false, submissionCheckpoint = false } = {}) {
      const storage = getStorageLocal();
      if (!storage?.set) {
        if (required) throw new Error("Penyimpanan checkpoint extension tidak tersedia.");
        return;
      }
      await storage.set({
        // Keep the irreversible-operation lock separate from panel/popup view-state writes.
        ...(submissionCheckpoint ? { [state.storageKey ? state.storageKey + ":pending" : "nusukPendingSubmission"]: state.pendingSubmission || null, ...(state.storageKey ? { nusukPendingSubmission: null } : {}) } : {}),
        [state.storageKey || STORAGE_KEY]: {
          browserSessionId: state.browserSessionId,
          manifest: state.manifest,
          selectedMemberId: state.selectedMemberId,
          collapsed: state.collapsed,
          closed: state.closed,
          panelWidth: state.panelWidth,
          executionState: state.executionState,
          progressCurrent: state.progressCurrent,
          progressTotal: state.progressTotal,
          logs: state.logs,
          autofillFailures: Array.isArray(state.autofillFailures) ? state.autofillFailures : [],
          freshEntryRequired: Boolean(state.freshEntryRequired),
          autofillAttemptFailures: Array.isArray(state.autofillAttemptFailures) ? state.autofillAttemptFailures.slice(-100) : [],
          autofillNameCorrections: state.autofillNameCorrections || [],
          autofillDataWarnings: state.autofillDataWarnings || [],
          autofillFailureScreenshots: Array.isArray(state.autofillFailureScreenshots) ? state.autofillFailureScreenshots.slice(-3) : [],
          currentRunPayload: state.currentRunPayload,
          revision: state.revision || 0,
          activeSessionId: state.activeSessionId || "",
          completedMemberIds: state.completedMemberIds || [],
          pendingSubmission: state.pendingSubmission || null,
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
