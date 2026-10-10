(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const { validateManifestForEntry, formatManifestUploadMessage } = root.manifestValidator || {};

  function createPanelBridge({ state, persistState, postPanelState, postToPanel, registerUploadFiles, getUploadFileCount,
    startAutofillFromPanel, pauseAutofillFromPanel, resetAutofillFromPanel, restartFailedFromPanel, resolvePendingSubmissionFromPanel, runAutomation, setTabAutoDiscardable }) {
    let previousRuntimeAutoDiscardable = null;
    let importing = false;
    function bindWindowBridge() {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message || typeof message !== 'object' || !message.type) return false;
        if (message.type === 'NUSUK_QUERY_CONTEXT') {
          sendResponse({ ...root.pageContext.readPageContext(), contentReady: state.handoffReady !== false, executionState: state.executionState, hasManifest: Boolean(state.manifest?.members?.length) });
          return false;
        }
        if (message.type === 'NUSUK_PANEL_READY') { sendResponse({ ok: true, panelState: postPanelState() }); return false; }
        if (message.type === 'NUSUK_PANEL_UPLOAD_MANIFEST') {
          if (importing || state.submissionResolutionInProgress || ['running', 'paused'].includes(state.executionState) || state.pendingSubmission) {
            sendResponse({ ok: false, error: 'Batch tidak boleh diganti selama pekerjaan aktif atau hasil simpan belum diperiksa. Periksa form Nusuk, lalu reset sebelum mengganti batch.' });
            return false;
          }
          const manifest = message.payload?.manifest;
          let validation;
          try { validation = validateManifestForEntry(manifest); }
          catch (error) { sendResponse({ ok: false, error: error.message }); return false; }
          const previous = { manifest: state.manifest, selectedMemberId: state.selectedMemberId, currentRunPayload: state.currentRunPayload,
            activeSessionId: state.activeSessionId, completedMemberIds: state.completedMemberIds, executionState: state.executionState,
            progressCurrent: state.progressCurrent, progressTotal: state.progressTotal, autofillFailures: state.autofillFailures,
            autofillAttemptFailures: state.autofillAttemptFailures, autofillNameCorrections: state.autofillNameCorrections,
            autofillFailureScreenshots: state.autofillFailureScreenshots, revision: state.revision };
          importing = true;
          Object.assign(state, { manifest, selectedMemberId: manifest.members[0]?.id || '', currentRunPayload: null,
            activeSessionId: '', completedMemberIds: [], executionState: 'idle', progressCurrent: 0, progressTotal: manifest.members.length,
            autofillFailures: [], autofillAttemptFailures: [], autofillNameCorrections: [], autofillFailureScreenshots: [], revision: 0 });
          persistState({ required: true }).then(() => {
            registerUploadFiles?.([]);
            postPanelState();
            postToPanel('NUSUK_PANEL_STATUS', { tone: validation.warnings.length ? 'warning' : 'success', message: formatManifestUploadMessage(manifest.members.length, validation) });
            sendResponse({ ok: true, memberCount: manifest.members.length });
          }).catch(error => {
            Object.assign(state, previous);
            postPanelState();
            sendResponse({ ok: false, error: 'Data belum dapat disimpan di extension: ' + error.message });
          }).finally(() => { importing = false; });
          return true;
        }
        if (message.type === 'NUSUK_PANEL_UPLOAD_FILES') {
          if (importing || state.submissionResolutionInProgress || ['running', 'paused'].includes(state.executionState) || state.pendingSubmission) { sendResponse({ ok: false, error: 'Reset pekerjaan sebelum mengganti file passport.' }); return false; }
          registerUploadFiles(Array.isArray(message.payload?.files) ? message.payload.files : []);
          const count = getUploadFileCount();
          postPanelState();
          sendResponse({ ok: count > 0, error: count ? undefined : 'Tidak ada file passport yang dapat dipakai.' });
          return false;
        }
        if (message.type === 'NUSUK_PANEL_SELECT_MEMBER') {
          if (importing || state.submissionResolutionInProgress || ['running', 'paused'].includes(state.executionState) || state.pendingSubmission) { sendResponse({ ok: false, error: 'Pilihan jamaah tidak boleh diganti selama pekerjaan aktif.' }); return false; }
          const id = String(message.payload?.memberId || '');
          if (!state.manifest?.members?.some(member => String(member.id) === id)) { sendResponse({ ok: false, error: 'Jamaah tidak ditemukan di batch aktif.' }); return false; }
          state.selectedMemberId = id;
          persistState().then(() => { postPanelState(); sendResponse({ ok: true }); }).catch(error => sendResponse({ ok: false, error: error.message }));
          return true;
        }
        const commands = { NUSUK_PANEL_START_AUTOFILL: startAutofillFromPanel, NUSUK_PANEL_PAUSE_AUTOFILL: pauseAutofillFromPanel,
          NUSUK_PANEL_RESET_AUTOFILL: resetAutofillFromPanel, NUSUK_PANEL_RESTART_FAILED: restartFailedFromPanel,
          NUSUK_PANEL_RESOLVE_SUBMISSION: resolvePendingSubmissionFromPanel };
        if (commands[message.type]) {
          if (importing) { sendResponse({ ok: false, error: 'Tunggu file JSON selesai dimuat.' }); return false; }
          if (message.type === 'NUSUK_PANEL_START_AUTOFILL' || message.type === 'NUSUK_PANEL_RESTART_FAILED') {
            void commands[message.type]().catch(error => postToPanel('NUSUK_PANEL_STATUS', { tone: 'error', message: error.message }));
            sendResponse({ ok: true });
            return false;
          }
          commands[message.type](message.payload).then(() => { sendResponse({ ok: true, panelState: postPanelState() }); }).catch(error => sendResponse({ ok: false, error: error.message }));
          return true;
        }
        if (message.type === 'NUSUK_PANEL_MINIMIZE') { root.widgetInstance?.showWidget(); sendResponse({ ok: true }); return false; }

        if (message.type === "NUSUK_AUTOFILL_MEMBER") {
          if (importing || state.submissionResolutionInProgress || state.executionState === "running" || state.executionState === "paused" || state.pendingSubmission) {
            sendResponse({ ok: false, error: "Autofill sedang berjalan di tab ini." });
            return false;
          }
          try {
            validateManifestForEntry({ schemaVersion: 'nusuk-entry-batch-v1', members: [message.payload?.member] });
          } catch (error) {
            sendResponse({ ok: false, error: error.message });
            return false;
          }

          state.executionState = "running";
          state.runToken += 1;
          const runtimeRunId = state.runToken;
          void lockTabForRuntimeRun();
          runAutomation({
            member: message.payload?.member,
            memberIndex: Number(message.payload?.memberIndex || 0),
            totalMembers: Number(message.payload?.totalMembers || 1),
          }, runtimeRunId)
            .then(() => {
              sendResponse({ ok: true, message: "Autofill selesai." });
            })
            .catch((error) => {
              if (state.runToken === runtimeRunId) state.executionState = "paused";
              sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
            })
            .finally(() => {
              if (state.runToken !== runtimeRunId) return;
              void unlockTabAfterRuntimeRun();
              if (state.executionState !== "paused") {
                state.executionState = "idle";
              }
              void persistState();
            });

          return true;
        }

        return false;
      });
    }

    function bindRuntimeMessages() {
      // Didelegasikan seluruhnya ke bindWindowBridge
    }

    async function lockTabForRuntimeRun() {
      if (typeof setTabAutoDiscardable !== "function") {
        return;
      }
      const response = await setTabAutoDiscardable(false).catch(() => null);
      if (typeof response?.previousAutoDiscardable === "boolean") {
        previousRuntimeAutoDiscardable = response.previousAutoDiscardable;
      }
    }

    async function unlockTabAfterRuntimeRun() {
      if (typeof setTabAutoDiscardable !== "function") {
        return;
      }
      await setTabAutoDiscardable(previousRuntimeAutoDiscardable ?? true).catch(() => {});
      previousRuntimeAutoDiscardable = null;
    }

    return {
      bindWindowBridge,
      bindRuntimeMessages,
    };
  }

  root.panelBridge = Object.freeze({
    createPanelBridge,
  });
})();
