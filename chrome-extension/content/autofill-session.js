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
      if (!submissionReady()) return;
      if (!pageReady()) return;
      if (state.executionState === 'completed') {
        postToPanel('NUSUK_PANEL_STATUS', { tone: 'warning', message: 'Batch selesai. Gunakan “Ulangi yang gagal” jika masih ada jamaah gagal.' });
        return;
      }
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
        state.currentRunPayload = remainingPayload(state.currentRunPayload);
        if (!state.currentRunPayload) {
          state.executionState = "completed";
          await persistState({ required: true });
          postPanelState();
          return;
        }
        state.executionState = "running";
        await announceRun();
        await persistRunCheckpoint();
        const remainingCount = countRunPayloadMembers(state.currentRunPayload);
        appendLog("success", `Melanjutkan ${remainingCount} jamaah tersisa. Jamaah yang sudah tersimpan tidak diulang.`);
        postToPanel("NUSUK_PANEL_STATUS", { tone: "success", message: `Melanjutkan ${remainingCount} jamaah tersisa.` });
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
      await announceRun();
      if (!(state.completedMemberIds || []).length) resetProgress();
      appendLog("info", `Memulai autofill ${membersToRun.length} jamaah mulai dari pilihan saat ini...`);
      if (SLOW_MODE_ENABLED) {
        appendLog("info", `Mode ${AUTOFILL_MODE_LABEL || "stabil"} aktif: jeda lebih ringkas dengan variasi natural.`);
      }
      await lockTabForBackgroundRun();
      await persistRunCheckpoint();
      postPanelState();

      await runCurrentPayload(membersToRun.length);
    }

    async function resumeAutofillAfterReload() {
      if (!submissionReady()) {
        state.executionState = "paused";
        await persistState();
        postPanelState();
        return false;
      }
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
      await persistRunCheckpoint();
      postPanelState();
      await lockTabForBackgroundRun();
      await runCurrentPayload(remainingCount);
      return true;
    }

    async function runCurrentPayload(memberCount) {
      const payload = remainingPayload(state.currentRunPayload);
      state.currentRunPayload = payload;
      if (!isRunnablePayload(payload)) {
        state.executionState = "completed";
        await persistState({ required: true });
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
            const correctionCount = (state.autofillNameCorrections || []).filter(note => (state.completedMemberIds || []).map(String).includes(note.memberId)).length;
            const message = `Autofill selesai untuk ${memberCount} jamaah.${correctionCount ? ` Nama OCR Nusuk pada ${correctionCount} jamaah dikoreksi mengikuti data review; rincian di log.` : ""}`;
            appendLog("success", message);
            postToPanel("NUSUK_PANEL_STATUS", { tone: "success", message });
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
          state.executionState = isRunnablePayload(state.currentRunPayload) || state.pendingSubmission ? 'paused' : 'completed';
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
      const completed = new Set((state.completedMemberIds || []).map(String));
      const rawSlice = (selectedIndex >= 0 ? members.slice(selectedIndex) : members)
        .filter(member => !completed.has(String(member.id)));
      return sortMembersByDependency(rawSlice);
    }

    function remainingPayload(payload) {
      if (!isRunnablePayload(payload)) return null;
      const completed = new Set((state.completedMemberIds || []).map(String));
      const members = payload.members.filter(member => member && !completed.has(String(member.id)));
      return members.length ? { ...payload, members, totalMembers: members.length } : null;
    }

    async function persistRunCheckpoint() {
      try {
        await persistState({ required: true });
      } catch (error) {
        state.executionState = "paused";
        postPanelState();
        throw error;
      }
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
      if (state.submissionResolutionInProgress) throw new Error("Tunggu hasil pemeriksaan simpan selesai dicatat.");
      if (state.pendingSubmission && !window.confirm(root.submissionGuard.submissionError(
        `hasil simpan paspor ${state.pendingSubmission.passportNumber} belum terkonfirmasi. Reset membuka blokir pengiriman ulang. Lanjutkan hanya setelah memeriksa daftar Nusuk; jangan entry ulang jamaah yang sudah tersimpan. Apakah hasilnya sudah diperiksa?`
      ).message)) return;
      state.runToken += 1;
      const stoppingRun = activeRunPromise;
      state.executionState = "idle";
      if (stoppingRun) await stoppingRun;
      // Clear checkpoints after the old run has unwound, including delayed failure reporting.
      state.currentRunPayload = null;
      state.executionState = "idle";
      state.pendingSubmission = null;
      state.manifest = null;
      state.activeSessionId = '';
      state.completedMemberIds = [];
      state.selectedMemberId = "";
      state.autofillFailures = [];
      state.autofillAttemptFailures = [];
      state.autofillNameCorrections = [];
      state.autofillFailureScreenshots = [];
      state.revision = 0;
      state.activeSessionId = "";
      await unlockTabAfterBackgroundRun();
      clearActiveHighlight();
      resetProgress();
      await persistState({ required: true, submissionCheckpoint: true });
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
      if (!submissionReady()) return;
      if (!pageReady()) return;
      if (state.executionState === "running" || activeRunPromise) {
        postToPanel("NUSUK_PANEL_STATUS", { tone: "warning", message: "Autofill sedang berjalan." });
        return;
      }
      // A stopped batch still includes members after the failure. Keep that queue intact.
      if (state.executionState === "paused" && isRunnablePayload(state.currentRunPayload)) {
        await startAutofillFromPanel();
        return;
      }
      const failures = state.autofillFailures || [];
      if (!failures.length) {
        postToPanel("NUSUK_PANEL_STATUS", { tone: "error", message: "Tidak ada jamaah gagal untuk diulang." });
        return;
      }
      const members = Array.isArray(state.manifest?.members) ? state.manifest.members : [];
      const failedMemberIds = new Set(failures.map((f) => String(f.memberId || "")));
      const completed = new Set((state.completedMemberIds || []).map(String));
      const membersToRun = sortMembersByDependency(members.filter((member) => failedMemberIds.has(String(member.id || "")) && !completed.has(String(member.id))));
      
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
      if (!validatePayloadReadyForEntry({ members: membersToRun })) return;

      state.autofillAttemptFailures = [];
      state.currentRunPayload = {
        members: membersToRun,
        startMemberIndex: 0,
        totalMembers: membersToRun.length,
        manifestPath: String(state.manifest?.manifestPath || ""),
      };
      state.runToken += 1;
      state.executionState = "running";
      await announceRun(true);
      appendLog("info", `Mengulang autofill untuk ${membersToRun.length} jamaah yang gagal...`);
      await lockTabForBackgroundRun();
      await persistRunCheckpoint();
      postPanelState();

      await runCurrentPayload(membersToRun.length);
    }

    async function resolvePendingSubmissionFromPanel({ outcome, memberId, passportNumber, startedAt } = {}) {
      if (state.submissionResolutionInProgress || state.executionState === "running") {
        throw new Error("Jeda pengisian sebelum mencatat hasil pemeriksaan simpan.");
      }
      if (!["saved", "not_saved"].includes(outcome)) throw new Error("Pilih hasil pemeriksaan simpan di Nusuk.");
      function assertCurrentSubmission() {
        const pending = state.pendingSubmission;
        if (!pending || !memberId || !passportNumber || !startedAt
          || pending.memberId !== memberId || pending.passportNumber !== passportNumber || pending.startedAt !== startedAt) {
          throw new Error("Pengiriman yang diperiksa sudah berubah. Periksa kembali paspor yang ditampilkan di panel.");
        }
      }
      assertCurrentSubmission();
      const member = state.manifest?.members?.find(item => String(item.id) === memberId);
      if (!member) throw new Error("Data paspor yang diperiksa tidak ditemukan di batch aktif.");
      root.submissionGuard.assertPendingMember(state, { member });

      state.submissionResolutionInProgress = true;
      postPanelState();
      try {
        // Cancel any paused attempt before changing its checkpoint or clearing the save lock.
        state.runToken += 1;
        if (activeRunPromise) await activeRunPromise;
        assertCurrentSubmission();
        root.submissionGuard.assertPendingMember(state, { member });
        const previous = {
          completedMemberIds: state.completedMemberIds,
          currentRunPayload: state.currentRunPayload,
          pendingSubmission: state.pendingSubmission,
          selectedMemberId: state.selectedMemberId,
          autofillFailures: state.autofillFailures,
          executionState: state.executionState,
          progressCurrent: state.progressCurrent,
          progressTotal: state.progressTotal,
          revision: state.revision,
        };
        const completed = new Set((state.completedMemberIds || []).map(String));
        if (outcome === "saved") completed.add(memberId);
        else completed.delete(memberId);
        const payload = state.currentRunPayload || { members: [member], manifestPath: state.manifest.manifestPath || "" };
        let remaining = payload.members.filter(item => !completed.has(String(item.id)) && String(item.id) !== memberId);
        if (outcome === "not_saved") remaining = [member, ...remaining];
        state.completedMemberIds = [...completed];
        const nextOffset = payload.members.findIndex(item => String(item.id) === String(remaining[0]?.id));
        state.currentRunPayload = remaining.length ? {
          ...payload, members: remaining, totalMembers: remaining.length,
          startMemberIndex: Number(payload.startMemberIndex || 0) + Math.max(0, nextOffset),
        } : null;
        state.pendingSubmission = null;
        state.selectedMemberId = String(remaining[0]?.id || memberId);
        if (outcome === "saved") state.autofillFailures = (state.autofillFailures || []).filter(item => String(item.memberId) !== memberId);
        state.progressCurrent = state.manifest.members.filter(item => completed.has(String(item.id))).length;
        state.progressTotal = state.manifest.members.length;
        state.executionState = remaining.length ? "paused" : "completed";
        state.revision = (state.revision || 0) + 1;
        try {
          await persistState({ required: true, submissionCheckpoint: true });
        } catch (error) {
          Object.assign(state, previous);
          throw new Error(`Hasil pemeriksaan belum dapat disimpan. Progres sebelumnya tetap dipertahankan: ${error.message || error}`);
        }
        const message = outcome === "saved"
          ? `Paspor ${passportNumber} ditandai sudah tersimpan setelah pemeriksaan Anda di Nusuk dan tidak akan diulang.`
          : `Paspor ${passportNumber} ditandai belum tersimpan setelah pemeriksaan Anda di Nusuk dan akan dicoba lagi saat dilanjutkan.`;
        appendLog("info", message);
        postToPanel("NUSUK_PANEL_STATUS", { tone: "success", message });
      } finally {
        state.submissionResolutionInProgress = false;
        postPanelState();
      }
    }

    function pageReady() {
      if (!root.pageContext || root.pageContext.readPageContext().pageStatus === 'ready') return true;
      postToPanel('NUSUK_PANEL_STATUS', { tone: 'warning', message: 'Login ke Nusuk dan buka halaman Daftar atau Tambah Jamaah sebelum memulai.' });
      return false;
    }

    function submissionReady() {
      if (state.submissionResolutionInProgress) {
        postToPanel("NUSUK_PANEL_STATUS", { tone: "warning", message: "Tunggu hasil pemeriksaan simpan selesai dicatat." });
        return false;
      }
      try {
        root.submissionGuard.assertNoPending(state);
        return true;
      } catch (error) {
        postToPanel("NUSUK_PANEL_STATUS", { tone: "error", message: error.message });
        return false;
      }
    }

    async function announceRun(retryFailed = false) {
      if (state.activeSessionId) {
        await chrome.runtime.sendMessage({ type: 'NUSUK_AUTOFILL_EVENT', payload: { eventType: 'RUNNING', retryFailed } });
      }
    }

    return {
      startAutofillFromPanel,
      resumeAutofillAfterReload,
      pauseAutofillFromPanel,
      resetAutofillFromPanel,
      restartFailedFromPanel,
      resolvePendingSubmissionFromPanel,
    };
  }

  root.autofillSession = Object.freeze({
    createAutofillSession,
  });
})();
