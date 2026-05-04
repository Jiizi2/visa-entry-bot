(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};

  function createPanelBridge({
    state,
    panelShell,
    persistState,
    postPanelState,
    postToPanel,
    registerUploadFiles,
    getUploadFileCount,
    startAutofillFromPanel,
    pauseAutofillFromPanel,
    resetAutofillFromPanel,
    runAutomation,
    setTabAutoDiscardable,
  }) {
    let previousRuntimeAutoDiscardable = null;

    function bindWindowBridge() {
      window.addEventListener("message", (event) => {
        if (!panelShell.isPanelMessageEvent(event)) {
          return;
        }
        const message = event.data;
        if (!message || typeof message !== "object") {
          return;
        }

        if (message.type === "NUSUK_PANEL_READY") {
          panelShell.setReady(true);
          postPanelState();
          return;
        }

        if (message.type === "NUSUK_PANEL_UPLOAD_MANIFEST") {
          const manifest = message.payload?.manifest;
          if (!manifest || !Array.isArray(manifest.members)) {
            postToPanel("NUSUK_PANEL_STATUS", { tone: "error", message: "JSON yang diupload tidak valid." });
            return;
          }
          state.manifest = manifest;
          state.selectedMemberId = String(message.payload?.selectedMemberId || manifest.members[0]?.id || "");
          void persistState();
          postPanelState();
          postToPanel("NUSUK_PANEL_STATUS", {
            tone: "success",
            message: `${manifest.members.length} data jamaah berhasil dimuat.`,
          });
          return;
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
          return;
        }

        if (message.type === "NUSUK_PANEL_SELECT_MEMBER") {
          state.selectedMemberId = String(message.payload?.memberId || "");
          void persistState();
          postPanelState();
          return;
        }

        if (message.type === "NUSUK_PANEL_TOGGLE") {
          void panelShell.setCollapsed(Boolean(message.payload?.collapsed), true);
          return;
        }

        if (message.type === "NUSUK_PANEL_MINIMIZE") {
          void panelShell.setCollapsed(true, true);
          return;
        }

        if (message.type === "NUSUK_PANEL_CLOSE") {
          void panelShell.setPanelClosed(true, true);
          return;
        }

        if (message.type === "NUSUK_PANEL_START_AUTOFILL") {
          void startAutofillFromPanel();
          return;
        }

        if (message.type === "NUSUK_PANEL_PAUSE_AUTOFILL") {
          void pauseAutofillFromPanel();
          return;
        }

        if (message.type === "NUSUK_PANEL_RESET_AUTOFILL") {
          void resetAutofillFromPanel();
        }
      });
    }

    function bindRuntimeMessages() {
      chrome.runtime.onMessage.addListener(onRuntimeMessage);
    }

    function onRuntimeMessage(message, _sender, sendResponse) {
      if (message?.type === "NUSUK_OPEN_PANEL") {
        void panelShell.openFromExtensionAction();
        sendResponse({ ok: true });
        return false;
      }

      if (message?.type !== "NUSUK_AUTOFILL_MEMBER") {
        return false;
      }

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
