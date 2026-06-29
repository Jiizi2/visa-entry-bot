(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const { AUTOFILL_MODE_LABEL, SLOW_MODE_ENABLED } = root.constants || {};
  const { ENTRY_BATCH_SCHEMA_VERSION, validateManifestForEntry } = root.manifestValidator || {};

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
      if (state.executionState === "running") {
        postToPanel("NUSUK_PANEL_STATUS", { tone: "warning", message: "Autofill sedang berjalan." });
        return;
      }
      if (state.executionState === "paused") {
        if (!isRunnablePayload(state.currentRunPayload)) {
          postToPanel("NUSUK_PANEL_STATUS", { tone: "error", message: "Tidak ada checkpoint resume yang bisa dilanjutkan." });
          return;
        }
        if (!validatePayloadReadyForEntry(state.currentRunPayload)) {
          return;
        }
        state.executionState = "running";
        await persistState();
        appendLog("success", "Autofill dilanjutkan.");
        postToPanel("NUSUK_PANEL_STATUS", { tone: "success", message: "Autofill dilanjutkan." });
        postPanelState();
        await lockTabForBackgroundRun();
        if (!activeRunPromise && isRunnablePayload(state.currentRunPayload)) {
          await runCurrentPayload(countRunPayloadMembers(state.currentRunPayload));
        }
        return;
      }
      const member = getSelectedMember();
      if (!member) {
        postToPanel("NUSUK_PANEL_STATUS", { tone: "error", message: "Pilih data jamaah sebelum menjalankan autofill." });
        return;
      }
      const membersToRun = getMembersToRun();
      if (!membersToRun.length) {
        postToPanel("NUSUK_PANEL_STATUS", { tone: "error", message: "Tidak ada data jamaah untuk diproses." });
        return;
      }
      if (!hasPassportDebuggerPathSource(state.manifest, membersToRun)) {
        postToPanel("NUSUK_PANEL_STATUS", {
          tone: "error",
          message: "JSON belum punya path lokal untuk upload debugger. Buat/export JSON dari PC ini, atau jangan pindahkan folder hasil scan sebelum entry.",
        });
        return;
      }
      if (!validateManifestReadyForEntry(state.manifest)) {
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
      if (!["running", "paused"].includes(state.executionState) || !isRunnablePayload(state.currentRunPayload) || activeRunPromise) {
        return false;
      }
      if (!validatePayloadReadyForEntry(state.currentRunPayload)) {
        state.executionState = "paused";
        await persistState();
        postPanelState();
        return false;
      }
      const remainingCount = countRunPayloadMembers(state.currentRunPayload);
      state.executionState = "running";
      appendLog("warning", `Halaman Nusuk refresh. Melanjutkan otomatis dari checkpoint: ${remainingCount} jamaah tersisa.`);
      postToPanel("NUSUK_PANEL_STATUS", { tone: "warning", message: `Halaman refresh. Autofill lanjut otomatis dengan ${remainingCount} jamaah tersisa.` });
      await persistState();
      postPanelState();
      await lockTabForBackgroundRun();
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
        let completedSuccessfully = false;
        let interruptedForResume = false;
        try {
          await runAutomation(payload, state.runToken);
          if (state.executionState === "running") {
            state.executionState = "completed";
            completedSuccessfully = true;
            appendLog("success", `Autofill selesai untuk ${memberCount} jamaah.`);
            postToPanel("NUSUK_PANEL_STATUS", { tone: "success", message: `Autofill selesai untuk ${memberCount} jamaah.` });
          }
        } catch (error) {
          if (isControlError(error, "reset")) {
            interruptedForResume = true;
            return;
          }
          if (isControlError(error, "replaced")) {
            interruptedForResume = true;
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
          if (completedSuccessfully || !isRunnablePayload(state.currentRunPayload)) {
            state.currentRunPayload = null;
          }
          if (interruptedForResume && isRunnablePayload(state.currentRunPayload)) {
            state.executionState = "paused";
          }
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
      const rawSlice = selectedIndex >= 0 ? members.slice(selectedIndex) : members;
      return sortMembersByDependency(rawSlice);
    }

    function sortMembersByDependency(membersList) {
      const dependents = [];
      const nonDependents = [];
      for (const m of membersList) {
        if (hasCompanionDependency(m)) {
          dependents.push(m);
        } else {
          nonDependents.push(m);
        }
      }
      return [...nonDependents, ...dependents];
    }

    function hasCompanionDependency(member) {
      if (isMinorMember(member)) {
        return true;
      }
      const companionObj = member?.companion || member?.companionProfile || member?.guardian || member?.mahram || member?.resolvedProfile?.companion;
      if (companionObj && typeof companionObj === "object" && Object.keys(companionObj).length > 0) {
        return true;
      }
      return false;
    }

    function isMinorMember(member) {
      const dob = String(member?.resolvedProfile?.dob || member?.passportExtracted?.dob || "").trim();
      const birthDate = parseIsoDate(dob);
      if (!birthDate) {
        return false;
      }
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const beforeBirthday = today.getMonth() < birthDate.getMonth()
        || (today.getMonth() === birthDate.getMonth() && today.getDate() < birthDate.getDate());
      if (beforeBirthday) {
        age -= 1;
      }
      return age < 18;
    }

    function parseIsoDate(value) {
      const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) {
        return null;
      }
      const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      return Number.isNaN(date.getTime()) ? null : date;
    }

    function getSelectedMemberIndex() {
      const members = Array.isArray(state.manifest?.members) ? state.manifest.members : [];
      return Math.max(0, members.findIndex((item) => String(item.id || "") === String(state.selectedMemberId || "")));
    }

    function isRunnablePayload(payload) {
      return Array.isArray(payload?.members) && payload.members.some((member) => member && typeof member === "object");
    }

    function validateManifestReadyForEntry(manifest) {
      if (!validateManifestForEntry) {
        postToPanel("NUSUK_PANEL_STATUS", { tone: "error", message: "Validator manifest extension belum dimuat." });
        return false;
      }
      try {
        validateManifestForEntry(manifest);
        return true;
      } catch (error) {
        postToPanel("NUSUK_PANEL_STATUS", {
          tone: "error",
          message: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    }

    function validatePayloadReadyForEntry(payload) {
      return validateManifestReadyForEntry({
        schemaVersion: ENTRY_BATCH_SCHEMA_VERSION || "nusuk-entry-batch-v1",
        contractVersion: String(state.manifest?.contractVersion || ""),
        members: Array.isArray(payload?.members) ? payload.members : [],
      });
    }

    function countRunPayloadMembers(payload) {
      return Array.isArray(payload?.members) ? payload.members.length : 0;
    }

    function hasPassportDebuggerPathSource(manifest, members) {
      const manifestPath = String(manifest?.manifestPath || "").trim();
      console.log("[EntryMate Debug] manifestPath:", manifestPath);
      return Array.isArray(members)
        && members.length > 0
        && members.every((member) => {
          const passportPath = String(member?.passportImagePath || "").trim();
          const isAbs = isAbsoluteWindowsPath(passportPath);
          console.log(`[EntryMate Debug] member ID: ${member.id}, passportImagePath: "${passportPath}", isAbsolute: ${isAbs}`);
          return Boolean(passportPath && (manifestPath || isAbs));
        });
    }

    function isAbsoluteWindowsPath(value) {
      const text = String(value || "").trim();
      return /^[a-zA-Z]:[\\/]/.test(text) || text.startsWith("\\\\");
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

    async function restartFailedFromPanel() {
      if (state.executionState === "running") {
        postToPanel("NUSUK_PANEL_STATUS", { tone: "warning", message: "Autofill sedang berjalan." });
        return;
      }
      const failures = state.autofillFailures || [];
      if (!failures.length) {
        postToPanel("NUSUK_PANEL_STATUS", { tone: "error", message: "Tidak ada jamaah gagal untuk diulang." });
        return;
      }
      const members = Array.isArray(state.manifest?.members) ? state.manifest.members : [];
      const failedMemberIds = new Set(failures.map((f) => String(f.memberId || "")));
      const membersToRun = members.filter((member) => failedMemberIds.has(String(member.id || "")));
      
      if (!membersToRun.length) {
        postToPanel("NUSUK_PANEL_STATUS", { tone: "error", message: "Data jamaah gagal tidak ditemukan di manifest." });
        return;
      }
      if (!hasPassportDebuggerPathSource(state.manifest, membersToRun)) {
        postToPanel("NUSUK_PANEL_STATUS", {
          tone: "error",
          message: "JSON belum punya path lokal untuk upload debugger. Buat/export JSON dari PC ini, atau jangan pindahkan folder hasil scan sebelum entry.",
        });
        return;
      }

      state.autofillFailures = [];
      state.autofillAttemptFailures = [];
      state.currentRunPayload = {
        members: membersToRun,
        startMemberIndex: 0,
        totalMembers: membersToRun.length,
        manifestPath: String(state.manifest?.manifestPath || ""),
      };
      state.runToken += 1;
      state.executionState = "running";
      resetProgress();
      appendLog("info", `Mengulang autofill untuk ${membersToRun.length} jamaah yang gagal...`);
      await lockTabForBackgroundRun();
      await persistState();
      postPanelState();

      await runCurrentPayload(membersToRun.length);
    }

    return {
      startAutofillFromPanel,
      resumeAutofillAfterReload,
      pauseAutofillFromPanel,
      resetAutofillFromPanel,
      restartFailedFromPanel,
    };
  }

  root.autofillSession = Object.freeze({
    createAutofillSession,
  });
})();
