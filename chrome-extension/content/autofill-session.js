(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const { AUTOFILL_MODE_LABEL, SLOW_MODE_ENABLED } = root.constants || {};

  function createAutofillSession({
    state,
    isControlError,
    clearActiveHighlight,
    resetProgress,
    appendLog,
    postPanelState,
    postToPanel,
    persistState,
    getUploadState,
    runAutomation,
    getSelectedMember,
    setTabAutoDiscardable,
  }) {
    let activeRunPromise = null;
    let previousTabAutoDiscardable = null;

    async function startAutofillFromPanel() {
      const member = getSelectedMember();
      if (!member) {
        postToPanel("NUSUK_PANEL_STATUS", { tone: "error", message: "Pilih data jamaah sebelum menjalankan autofill." });
        return;
      }
      if (state.executionState === "running") {
        postToPanel("NUSUK_PANEL_STATUS", { tone: "warning", message: "Autofill sedang berjalan." });
        return;
      }
      if (state.executionState === "paused") {
        state.executionState = "running";
        await persistState();
        appendLog("success", "Autofill dilanjutkan.");
        postToPanel("NUSUK_PANEL_STATUS", { tone: "success", message: "Autofill dilanjutkan." });
        postPanelState();
        if (!activeRunPromise && isRunnablePayload(state.currentRunPayload)) {
          await runCurrentPayload(countRunPayloadMembers(state.currentRunPayload));
        }
        return;
      }
      if (!getUploadState().uploadFileCount) {
        postToPanel("NUSUK_PANEL_STATUS", {
          tone: "error",
          message: "Pilih folder/file passport sebelum mulai.",
        });
        return;
      }

      const membersToRun = getMembersToRun();
      if (!membersToRun.length) {
        postToPanel("NUSUK_PANEL_STATUS", { tone: "error", message: "Tidak ada data jamaah untuk diproses." });
        return;
      }
      const startMemberIndex = getSelectedMemberIndex();
      state.currentRunPayload = {
        members: membersToRun,
        startMemberIndex,
        totalMembers: membersToRun.length,
        manifestPath: String(state.manifest?.manifestPath || ""),
      };
      state.runToken += 1;
      state.executionState = "running";
      resetProgress();
      appendLog("info", `Memulai autofill ${membersToRun.length} jamaah mulai dari pilihan saat ini...`);
      if (SLOW_MODE_ENABLED) {
        appendLog("info", `Mode ${AUTOFILL_MODE_LABEL || "stabil"} aktif: jeda lebih ringkas dengan variasi natural.`);
      }
      await lockTabForBackgroundRun();
      await persistState();
      postPanelState();

      await runCurrentPayload(membersToRun.length);
    }

    async function resumeAutofillAfterReload() {
      if (state.executionState !== "running" || !isRunnablePayload(state.currentRunPayload) || activeRunPromise) {
        return false;
      }
      const remainingCount = countRunPayloadMembers(state.currentRunPayload);
      state.runToken += 1;
      appendLog("warning", `Halaman Nusuk refresh. Melanjutkan otomatis ${remainingCount} jamaah tersisa...`);
      postToPanel("NUSUK_PANEL_STATUS", { tone: "warning", message: `Melanjutkan otomatis ${remainingCount} jamaah tersisa setelah refresh halaman.` });
      await persistState();
      postPanelState();
      await runCurrentPayload(remainingCount);
      return true;
    }

    async function runCurrentPayload(memberCount) {
      const payload = state.currentRunPayload;
      if (!isRunnablePayload(payload)) {
        state.executionState = "completed";
        await persistState();
        postPanelState();
        return;
      }

      activeRunPromise = (async () => {
        try {
          await runAutomation(payload, state.runToken);
          if (state.executionState === "running") {
            state.executionState = "completed";
            appendLog("success", `Autofill selesai untuk ${memberCount} jamaah.`);
            postToPanel("NUSUK_PANEL_STATUS", { tone: "success", message: `Autofill selesai untuk ${memberCount} jamaah.` });
          }
        } catch (error) {
          if (isControlError(error, "reset")) {
            return;
          }
          if (isControlError(error, "replaced")) {
            return;
          }
          state.executionState = "idle";
          postToPanel("NUSUK_PANEL_STATUS", {
            tone: "error",
            message: error instanceof Error ? error.message : String(error),
          });
          appendLog("error", error instanceof Error ? error.message : String(error));
        } finally {
          clearActiveHighlight();
          await unlockTabAfterBackgroundRun();
          state.currentRunPayload = null;
          activeRunPromise = null;
          await persistState();
          postPanelState();
        }
      })();

      await activeRunPromise;
    }

    function getMembersToRun() {
      const members = Array.isArray(state.manifest?.members) ? state.manifest.members : [];
      if (!members.length) {
        return [];
      }
      const selectedIndex = getSelectedMemberIndex();
      return selectedIndex >= 0 ? members.slice(selectedIndex) : members;
    }

    function getSelectedMemberIndex() {
      const members = Array.isArray(state.manifest?.members) ? state.manifest.members : [];
      return Math.max(0, members.findIndex((item) => String(item.id || "") === String(state.selectedMemberId || "")));
    }

    function isRunnablePayload(payload) {
      return Array.isArray(payload?.members) && payload.members.some((member) => member && typeof member === "object");
    }

    function countRunPayloadMembers(payload) {
      return Array.isArray(payload?.members) ? payload.members.length : 0;
    }

    async function pauseAutofillFromPanel() {
      if (state.executionState !== "running") {
        postToPanel("NUSUK_PANEL_STATUS", { tone: "warning", message: "Autofill belum berjalan." });
        return;
      }
      state.executionState = "paused";
      await unlockTabAfterBackgroundRun();
      clearActiveHighlight();
      appendLog("warning", "Autofill dijeda.");
      await persistState();
      postToPanel("NUSUK_PANEL_STATUS", { tone: "warning", message: "Autofill dijeda." });
      postPanelState();
    }

    async function resetAutofillFromPanel() {
      state.runToken += 1;
      state.currentRunPayload = null;
      state.executionState = "idle";
      await unlockTabAfterBackgroundRun();
      clearActiveHighlight();
      resetProgress();
      await persistState();
      postToPanel("NUSUK_PANEL_STATUS", { tone: "neutral", message: "Reset selesai." });
      postPanelState();
    }

    async function lockTabForBackgroundRun() {
      if (typeof setTabAutoDiscardable !== "function") {
        return;
      }
      try {
        const response = await setTabAutoDiscardable(false);
        if (typeof response?.previousAutoDiscardable === "boolean") {
          previousTabAutoDiscardable = response.previousAutoDiscardable;
        }
        appendLog("info", "Tab Nusuk dikunci agar tidak otomatis dibuang Chrome saat pindah tab.");
      } catch (error) {
        appendLog("warning", `Tab Nusuk tidak bisa dikunci: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    async function unlockTabAfterBackgroundRun() {
      if (typeof setTabAutoDiscardable !== "function") {
        return;
      }
      try {
        await setTabAutoDiscardable(previousTabAutoDiscardable ?? true);
      } catch {
        // Best effort: Chrome may already have unloaded the tab or extension worker.
      } finally {
        previousTabAutoDiscardable = null;
      }
    }

    return {
      startAutofillFromPanel,
      resumeAutofillAfterReload,
      pauseAutofillFromPanel,
      resetAutofillFromPanel,
    };
  }

  root.autofillSession = Object.freeze({
    createAutofillSession,
  });
})();
