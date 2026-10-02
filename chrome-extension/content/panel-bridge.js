(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const { validateManifestForEntry, formatManifestUploadMessage } = root.manifestValidator || {};

  function createPanelBridge({
    state,
    persistState,
    postPanelState,
    postToPanel,
    registerUploadFiles,
    getUploadFileCount,
    startAutofillFromPanel,
    pauseAutofillFromPanel,
    resetAutofillFromPanel,
    restartFailedFromPanel,
    runAutomation,
    setTabAutoDiscardable,
  }) {
    let previousRuntimeAutoDiscardable = null;

    // Konsolidasi seluruh pesan runtime & window ke dalam 1 listener tunggal yang stabil
    function bindWindowBridge() {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message || typeof message !== "object" || !message.type) {
          return false;
        }

        console.log(`[Bridge] Menerima pesan tipe: ${message.type}`, message.payload);
        if (message.type === 'NUSUK_QUERY_CONTEXT') {
          sendResponse({
            ...root.pageContext.readPageContext(),
            contentReady: state.handoffReady !== false,
            executionState: state.executionState,
            hasManifest: Boolean(state.manifest?.members?.length),
          });
          return false;
        }

        // --- NUSUK_PANEL_ Messages ---
        if (message.type === "NUSUK_PANEL_READY") {
          postPanelState();
          return false;
        }

        if (message.type === "NUSUK_PANEL_UPLOAD_MANIFEST") {
          const manifest = message.payload?.manifest;
          let validation = null;
          try {
            if (!validateManifestForEntry) {
              throw new Error("Validator manifest extension belum dimuat.");
            }
            validation = validateManifestForEntry(manifest);
          } catch (error) {
            postToPanel("NUSUK_PANEL_STATUS", {
              tone: "error",
              message: error instanceof Error ? error.message : String(error),
            });
            return false;
          }
          state.manifest = manifest;
          state.selectedMemberId = String(message.payload?.selectedMemberId || manifest.members[0]?.id || "");
          void persistState();
          postPanelState();
          postToPanel("NUSUK_PANEL_STATUS", {
            tone: validation.warnings.length ? "warning" : "success",
            message: formatManifestUploadMessage(manifest.members.length, validation),
          });
          return false;
        }

        if (message.type === "NUSUK_PANEL_UPLOAD_FILES") {
          const files = Array.isArray(message.payload?.files) ? message.payload.files : [];
          registerUploadFiles(files);
          const uploadFileCount = getUploadFileCount();
          postPanelState();
          postToPanel("NUSUK_PANEL_STATUS", {
            tone: uploadFileCount ? "success" : "error",
            message: uploadFileCount
              ? `${uploadFileCount} file passport siap dipakai.`
              : "Tidak ada file passport yang bisa dipakai.",
          });
          return false;
        }

        if (message.type === "NUSUK_PANEL_SELECT_MEMBER") {
          state.selectedMemberId = String(message.payload?.memberId || "");
          void persistState();
          postPanelState();
          return false;
        }

        if (message.type === "NUSUK_PANEL_START_AUTOFILL") {
          void startAutofillFromPanel();
          return false;
        }

        if (message.type === "NUSUK_PANEL_PAUSE_AUTOFILL") {
          void pauseAutofillFromPanel();
          return false;
        }

        if (message.type === "NUSUK_PANEL_RESET_AUTOFILL") {
          void resetAutofillFromPanel();
          return false;
        }

        if (message.type === "NUSUK_PANEL_RESTART_FAILED") {
          if (typeof restartFailedFromPanel === "function") {
            void restartFailedFromPanel();
          }
          return false;
        }

        if (message.type === "NUSUK_PANEL_MINIMIZE") {
          console.log("[Bridge] Menerima pesan NUSUK_PANEL_MINIMIZE. Menampilkan widget.");
          if (root.widgetInstance) {
            root.widgetInstance.showWidget();
            sessionStorage.setItem("entrymate_widget_minimized", "true");
          }
          return false;
        }

        // --- NUSUK_WS_ & Other Background Messages ---
        if (message.type === "NUSUK_WS_CONNECTION_CHANGE") {
          postToPanel("NUSUK_WS_CONNECTION_STATE", { isConnected: message.payload.isConnected });
          sendResponse({ ok: true });
          return false;
        }

        if (message.type === "NUSUK_WS_LOAD_BATCH") {
          const manifest = { schemaVersion: 'nusuk-entry-batch-v1', manifestPath: message.payload.manifestPath, members: message.payload.members };
          try {
            validateManifestForEntry(manifest);
          } catch (error) {
            sendResponse({ ok: false, error: error.message });
            return false;
          }
          if (['running', 'paused'].includes(state.executionState)) {
            sendResponse({ ok: false, error: 'Pekerjaan masih berjalan. Akhiri pekerjaan dari extension sebelum mengganti batch.' });
            return false;
          }
          state.activeSessionId = message.payload.sessionId || "";
          state.revision = 0;
          state.lastDesktopRevision = 0;
          state.progressCurrent = 0;
          state.progressTotal = message.payload.members?.length || 0;
          state.currentRunPayload = null;
          state.autofillFailures = [];
          state.autofillAttemptFailures = [];
          state.completedMemberIds = [];
          state.executionState = "idle";
          state.manifest = manifest;
          state.selectedMemberId = state.manifest.members[0]?.id || "";
          persistState().then(() => {
            postPanelState(); root.widgetInstance?.showWidget(); sendResponse({ ok: true });
          }).catch(error => sendResponse({ ok: false, error: `Data belum dapat disimpan di extension: ${error.message}` }));
          return true;
        }

        if (message.type === "NUSUK_WS_SESSION_SNAPSHOT") {
          console.log("[Bridge] Menerima SESSION_SNAPSHOT dari Desktop. Revision:", message.payload.revision);
          
          if (state.activeSessionId === message.payload.sessionId && message.payload.revision < (state.lastDesktopRevision || 0)) {
            console.log(`[Bridge] Mengabaikan snapshot usang. Local revision: ${state.revision}, snapshot: ${message.payload.revision}`);
            sendResponse({ ok: false, error: "Outdated revision" });
            return false;
          }
          
          state.revision = message.payload.revision;
          state.lastDesktopRevision = message.payload.revision;
          state.activeSessionId = message.payload.sessionId;
          state.progressCurrent = message.payload.progressCurrent || 0;
          state.progressTotal = message.payload.progressTotal || message.payload.manifestMembers?.length || 0;
          state.completedMemberIds = message.payload.completedMemberIds || [];
          state.autofillFailures = message.payload.failures || [];
          if (Array.isArray(message.payload.manifestMembers)) {
            state.manifest = { manifestPath: message.payload.manifestPath, members: message.payload.manifestMembers };
          }
          state.selectedMemberId = message.payload.currentMemberId || state.selectedMemberId || state.manifest?.members[0]?.id || "";
          
          if (message.payload.status === "RUNNING" && (!root.pageContext || root.pageContext.readPageContext().pageStatus === 'ready')) {
            const manifestMembers = Array.isArray(state.manifest?.members) ? state.manifest.members : [];
            const activeMembers = message.payload.manifestMembers || manifestMembers;
            
            if (state.executionState !== "running") {
              console.log("[Bridge] Menyinkronkan status RUNNING dan memulihkan eksekusi...");
              state.executionState = "running";
              
              const currentId = message.payload.currentMemberId;
              const currentIdx = activeMembers.findIndex(m => String(m.id) === String(currentId));
              const finishedIds = new Set([
                ...(message.payload.completedMemberIds || []),
                ...(message.payload.failures || []).map(failure => failure.memberId),
              ].map(String));
              const pendingIdx = activeMembers.findIndex(member => !finishedIds.has(String(member.id)));
              const startIdx = currentIdx >= 0 ? currentIdx : Math.max(0, pendingIdx);
              const remainingMembers = activeMembers.slice(startIdx).filter(member => !finishedIds.has(String(member.id)));
              
              if (remainingMembers.length > 0) {
                state.currentRunPayload = {
                  manifestPath: message.payload.manifestPath,
                  members: remainingMembers,
                  startMemberIndex: startIdx,
                  totalMembers: activeMembers.length
                };
                
                state.runToken = (state.runToken || 0) + 1;
                void lockTabForRuntimeRun();
                runAutomation(state.currentRunPayload, state.runToken)
                  .catch((err) => console.error("[Bridge] Gagal me-resume otomatisasi setelah reload:", err))
                  .finally(() => {
                    void unlockTabAfterRuntimeRun();
                    if (state.executionState !== "paused") {
                      state.executionState = "idle";
                    }
                    postPanelState();
                  });
              }
            }
          } else if (message.payload.status === "PAUSED" || message.payload.status === 'RUNNING') {
            state.executionState = "paused";
            const finished = new Set([...(message.payload.completedMemberIds || []), ...(message.payload.failures || []).map(f => f.memberId)].map(String));
            state.currentRunPayload = { members: (state.manifest?.members || []).filter(m => !finished.has(String(m.id))), totalMembers: state.manifest?.members?.length || 0, manifestPath: message.payload.manifestPath };
          } else if (message.payload.status === "COMPLETED") {
            state.executionState = "completed";
          } else if (message.payload.status === "IDLE") {
            state.executionState = "idle";
          } else if (['CREATED', 'BATCH_LOADED'].includes(message.payload.status)) {
            state.executionState = 'idle';
          }
          
          void persistState();
          postPanelState();
          sendResponse({ ok: true });
          return false;
        }

        if (message.type === "NUSUK_WS_START") {
          console.log("[Bridge] Menjalankan startAutofillFromPanel dipicu oleh NUSUK_WS_START.");
          void startAutofillFromPanel();
          sendResponse({ ok: true });
          return false;
        }

        if (message.type === "NUSUK_AUTOFILL_MEMBER") {
          if (state.executionState === "running" || state.executionState === "paused") {
            sendResponse({ ok: false, error: "Autofill sedang berjalan di tab ini." });
            return false;
          }

          state.executionState = "running";
          state.runToken += 1;
          void lockTabForRuntimeRun();
          runAutomation({
            member: message.payload?.member,
            memberIndex: Number(message.payload?.memberIndex || 0),
            totalMembers: Number(message.payload?.totalMembers || 1),
          }, state.runToken)
            .then(() => {
              sendResponse({ ok: true, message: "Autofill selesai." });
            })
            .catch((error) => {
              sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
            })
            .finally(() => {
              void unlockTabAfterRuntimeRun();
              if (state.executionState !== "paused") {
                state.executionState = "idle";
              }
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
