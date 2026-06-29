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
          state.manifest = {
            manifestVersion: "1.0.19",
            manifestPath: message.payload.manifestPath,
            members: message.payload.members
          };
          state.selectedMemberId = state.manifest.members[0]?.id || "";
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
