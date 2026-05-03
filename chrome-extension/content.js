(function () {
  const STORAGE_KEY = "nusukAutofillState";
  const PANEL_FRAME_ID = "nusuk-autofill-panel-frame";
  const PANEL_HOST_ID = "nusuk-autofill-panel-host";
  const PANEL_TOGGLE_ID = "nusuk-autofill-panel-toggle";
  const PANEL_RESIZE_HANDLE_ID = "nusuk-autofill-panel-resize";
  const HIGHLIGHT_STYLE_ID = "nusuk-autofill-highlight-style";
  const ACTIVE_HIGHLIGHT_CLASS = "nusuk-autofill-active-field";
  const PANEL_ORIGIN = chrome.runtime.getURL("").replace(/\/$/, "");
  const PANEL_WIDTH_MIN = 300;
  const PANEL_WIDTH_MAX = 600;
  const PANEL_WIDTH_DEFAULT = 420;
  const DEFAULT_REPO_ROOT = "C:\\visa-entry-bot";
  const WINDOWS_ABSOLUTE_PATH_RE = /^[a-zA-Z]:[\\/]/;
  const FILE_URI_RE = /^file:\/\//i;

  const NEXT_BUTTON_CANDIDATE_SELECTORS = [
    ".d-flex.justify-content-end.align-items-center.gap-3 > button.btn.btn-primary:has-text('Next')",
    "action-btns.custom-action-buttons .d-flex.justify-content-end.align-items-center.gap-3 > button.btn.btn-primary:has-text('Next')",
    "action-btns.custom-action-buttons button.btn.btn-primary:has-text('Next')",
    "action-btns button.btn.btn-primary:has-text('Next')",
    ".action-buttons .navigation-buttons button:has-text('Next')",
  ];
  const NEXT_BUTTON_SELECTOR = NEXT_BUTTON_CANDIDATE_SELECTORS.join(", ");
  const VACCINATION_UPLOAD_SELECTOR = [
    "input[type='file'][formcontrolname='vaccinationPicture']",
    "input[type='file'][name='vaccinationPicture']",
    "input[type='file'][formcontrolname*='vaccin' i]",
    "input[type='file'][name*='vaccin' i]",
    "input[type='file'][id*='vaccin' i]",
    "input[type='file'][formcontrolname*='vaccine' i]",
    "input[type='file'][name*='vaccine' i]",
    "input[type='file'][id*='vaccine' i]",
    "input[type='file'][formcontrolname*='immun' i]",
    "input[type='file'][name*='immun' i]",
    "input[type='file'][id*='immun' i]",
  ].join(", ");

  const state = {
    manifest: null,
    selectedMemberId: "",
    collapsed: true,
    closed: true,
    panelWidth: PANEL_WIDTH_DEFAULT,
    executionState: "idle",
    progressCurrent: 0,
    progressTotal: 0,
    logs: [],
    currentRunPayload: null,
    runToken: 0,
  };

  const uploadFilesByKey = new Map();
  let uploadFileCount = 0;
  let uploadFileNames = [];

  let panelFrame = null;
  let panelHost = null;
  let panelToggle = null;
  let panelResizeHandle = null;
  let activeHighlightElement = null;
  let panelReady = false;
  let isResizingPanel = false;
  let resizeRafId = 0;
  let pendingPanelWidth = PANEL_WIDTH_DEFAULT;

  bootstrap().catch((error) => {
    console.error("Nusuk panel bootstrap failed:", error);
  });

  async function bootstrap() {
    await hydrateState();
    ensureHighlightStyle();
    injectPanelShell();
    bindWindowBridge();
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
  }

  async function hydrateState() {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const saved = stored?.[STORAGE_KEY];
    if (!saved || typeof saved !== "object") {
      return;
    }
    state.manifest = saved.manifest && Array.isArray(saved.manifest.members) ? saved.manifest : null;
    state.selectedMemberId = String(saved.selectedMemberId || "");
    state.collapsed = true;
    state.closed = true;
    state.panelWidth = clampPanelWidth(saved.panelWidth);
    state.executionState = "idle";
    state.progressCurrent = 0;
    state.progressTotal = 0;
    state.logs = [];
    state.currentRunPayload = null;
  }

  function injectPanelShell() {
    panelHost = document.getElementById(PANEL_HOST_ID);
    panelToggle = document.getElementById(PANEL_TOGGLE_ID);
    panelFrame = document.getElementById(PANEL_FRAME_ID);
    panelResizeHandle = document.getElementById(PANEL_RESIZE_HANDLE_ID);
    if (panelHost && panelToggle && panelFrame && panelResizeHandle) {
      applyCollapsedState();
      return;
    }

    panelHost = document.createElement("div");
    panelHost.id = PANEL_HOST_ID;
    Object.assign(panelHost.style, {
      position: "fixed",
      display: state.closed ? "none" : "block",
      top: "0",
      right: "0",
      width: state.collapsed ? "0" : `${state.panelWidth}px`,
      height: "100vh",
      zIndex: "2147483646",
      transition: "width 160ms ease, box-shadow 160ms ease",
      boxShadow: state.collapsed ? "none" : "-12px 0 28px rgba(15,23,42,0.12)",
      pointerEvents: "none",
      overflow: "visible",
    });

    panelResizeHandle = document.createElement("div");
    panelResizeHandle.id = PANEL_RESIZE_HANDLE_ID;
    Object.assign(panelResizeHandle.style, {
      position: "absolute",
      top: "0",
      left: "-10px",
      width: "20px",
      height: "100%",
      cursor: "col-resize",
      pointerEvents: "auto",
      background: "transparent",
      zIndex: "2",
      touchAction: "none",
    });
    panelResizeHandle.addEventListener("mousedown", beginResize);

    panelFrame = document.createElement("iframe");
    panelFrame.id = PANEL_FRAME_ID;
    panelFrame.src = chrome.runtime.getURL("panel.html");
    panelFrame.title = "Panel Nusuk Autofill";
    Object.assign(panelFrame.style, {
      width: "100%",
      height: "100%",
      border: "0",
      background: "transparent",
      pointerEvents: state.collapsed ? "none" : "auto",
      opacity: state.collapsed ? "0" : "1",
      transition: "opacity 160ms ease",
    });
    panelFrame.setAttribute("allowtransparency", "true");

    panelToggle = document.createElement("button");
    panelToggle.id = PANEL_TOGGLE_ID;
    panelToggle.type = "button";
    panelToggle.textContent = state.collapsed ? "<" : ">";
    panelToggle.setAttribute("aria-label", state.collapsed ? "Buka panel Nusuk" : "Minimize panel Nusuk");
    Object.assign(panelToggle.style, {
      position: "fixed",
      display: state.closed ? "none" : "block",
      top: "20px",
      right: state.collapsed ? "16px" : `${state.panelWidth}px`,
      width: "34px",
      height: "60px",
      border: "1px solid rgba(100,116,139,0.24)",
      borderRight: "0",
      borderRadius: "8px 0 0 8px",
      background: "rgba(255,255,255,0.96)",
      color: "#1d4ed8",
      cursor: "pointer",
      zIndex: "2147483647",
      boxShadow: "-8px 10px 22px rgba(15,23,42,0.14)",
      backdropFilter: "blur(10px)",
      transition: "right 160ms ease, background 160ms ease",
    });
    panelToggle.addEventListener("click", () => {
      void setCollapsed(!state.collapsed, true);
    });

    panelHost.appendChild(panelResizeHandle);
    panelHost.appendChild(panelFrame);
    document.documentElement.appendChild(panelHost);
    document.documentElement.appendChild(panelToggle);
    applyCollapsedState();
  }

  function bindWindowBridge() {
    window.addEventListener("message", (event) => {
      if (event.origin !== PANEL_ORIGIN || event.source !== panelFrame?.contentWindow) {
        return;
      }
      const message = event.data;
      if (!message || typeof message !== "object") {
        return;
      }

      if (message.type === "NUSUK_PANEL_READY") {
        panelReady = true;
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
        void setCollapsed(Boolean(message.payload?.collapsed), true);
        return;
      }

      if (message.type === "NUSUK_PANEL_MINIMIZE") {
        void setCollapsed(true, true);
        return;
      }

      if (message.type === "NUSUK_PANEL_CLOSE") {
        void setPanelClosed(true, true);
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

  function onRuntimeMessage(message, _sender, sendResponse) {
    if (message?.type === "NUSUK_OPEN_PANEL") {
      void openPanelFromExtensionAction();
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
        if (state.executionState !== "paused") {
          state.executionState = "idle";
        }
      });

    return true;
  }

  async function setCollapsed(nextCollapsed, announce) {
    state.closed = false;
    state.collapsed = Boolean(nextCollapsed);
    await persistState();
    applyCollapsedState();
    if (announce) {
      postPanelState();
    }
  }

  async function setPanelClosed(nextClosed, announce) {
    state.closed = Boolean(nextClosed);
    if (state.closed) {
      state.collapsed = true;
    }
    applyCollapsedState();
    if (announce) {
      postPanelState();
    }
  }

  async function openPanelFromExtensionAction() {
    state.closed = false;
    await setCollapsed(false, true);
  }

  function applyCollapsedState() {
    if (!panelHost || !panelToggle || !panelFrame || !panelResizeHandle) {
      return;
    }
    const hidden = state.closed;
    panelHost.style.display = hidden ? "none" : "block";
    panelToggle.style.display = hidden ? "none" : "block";
    if (hidden) {
      panelFrame.style.pointerEvents = "none";
      panelFrame.style.opacity = "0";
      panelResizeHandle.style.display = "none";
      return;
    }
    panelHost.style.width = state.collapsed ? "0" : `${state.panelWidth}px`;
    panelHost.style.boxShadow = state.collapsed
      ? "none"
      : "-12px 0 28px rgba(15,23,42,0.12)";
    panelHost.style.pointerEvents = state.collapsed ? "none" : "auto";
    panelFrame.style.pointerEvents = state.collapsed || isResizingPanel ? "none" : "auto";
    panelFrame.style.opacity = state.collapsed ? "0" : "1";
    panelResizeHandle.style.display = state.collapsed ? "none" : "block";
    panelToggle.style.right = state.collapsed ? "16px" : `${state.panelWidth}px`;
    panelHost.style.transition = isResizingPanel ? "none" : "width 160ms ease, box-shadow 160ms ease";
    panelToggle.style.transition = isResizingPanel ? "none" : "right 160ms ease, background 160ms ease";
    panelResizeHandle.style.background = isResizingPanel ? "rgba(37,99,235,0.14)" : "transparent";
    panelToggle.textContent = state.collapsed ? "<" : ">";
    panelToggle.setAttribute("aria-label", state.collapsed ? "Buka panel Nusuk" : "Minimize panel Nusuk");
  }

  function beginResize(event) {
    if (state.collapsed) {
      return;
    }
    event.preventDefault();
    isResizingPanel = true;
    pendingPanelWidth = state.panelWidth;
    document.documentElement.style.cursor = "col-resize";
    document.documentElement.style.userSelect = "none";
    applyCollapsedState();

    const flushResizeWidth = () => {
      resizeRafId = 0;
      state.panelWidth = clampPanelWidth(pendingPanelWidth);
      applyCollapsedState();
    };

    const onMove = (moveEvent) => {
      pendingPanelWidth = clampPanelWidth(window.innerWidth - moveEvent.clientX);
      if (!resizeRafId) {
        resizeRafId = window.requestAnimationFrame(flushResizeWidth);
      }
    };

    const finishResize = () => {
      if (resizeRafId) {
        window.cancelAnimationFrame(resizeRafId);
        resizeRafId = 0;
      }
      state.panelWidth = clampPanelWidth(pendingPanelWidth);
      isResizingPanel = false;
      document.documentElement.style.cursor = "";
      document.documentElement.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", finishResize);
      window.removeEventListener("mouseleave", finishResize);
      window.removeEventListener("blur", finishResize);
      applyCollapsedState();
      void persistState();
      postPanelState();
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", finishResize);
    window.addEventListener("mouseleave", finishResize);
    window.addEventListener("blur", finishResize);
  }

  function clampPanelWidth(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return PANEL_WIDTH_DEFAULT;
    }
    return Math.max(PANEL_WIDTH_MIN, Math.min(PANEL_WIDTH_MAX, Math.round(numeric)));
  }

  function ensureHighlightStyle() {
    if (document.getElementById(HIGHLIGHT_STYLE_ID)) {
      return;
    }
    const style = document.createElement("style");
    style.id = HIGHLIGHT_STYLE_ID;
    style.textContent = `
      .${ACTIVE_HIGHLIGHT_CLASS} {
        outline: 2px solid #2563eb !important;
        outline-offset: 2px !important;
        box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.18) !important;
        transition: outline 120ms ease, box-shadow 120ms ease !important;
      }
    `;
    document.head.appendChild(style);
  }

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
      return;
    }
    if (!uploadFileCount) {
      postToPanel("NUSUK_PANEL_STATUS", {
        tone: "error",
        message: "Pilih folder/file passport sebelum mulai.",
      });
      return;
    }

    state.currentRunPayload = {
      member,
      memberIndex: 0,
      totalMembers: 1,
      manifestPath: String(state.manifest?.manifestPath || ""),
    };
    state.runToken += 1;
    state.executionState = "running";
    resetProgress();
    appendLog("info", "Memulai autofill...");
    await persistState();
    postPanelState();

    try {
      await runAutomation(state.currentRunPayload, state.runToken);
      if (state.executionState === "running") {
        state.executionState = "completed";
        appendLog("success", "Autofill selesai.");
        postToPanel("NUSUK_PANEL_STATUS", { tone: "success", message: "Autofill selesai." });
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
      state.currentRunPayload = null;
      await persistState();
      postPanelState();
    }
  }

  async function pauseAutofillFromPanel() {
    if (state.executionState !== "running") {
      postToPanel("NUSUK_PANEL_STATUS", { tone: "warning", message: "Autofill belum berjalan." });
      return;
    }
    state.executionState = "paused";
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
    clearActiveHighlight();
    resetProgress();
    await persistState();
    postToPanel("NUSUK_PANEL_STATUS", { tone: "neutral", message: "Reset selesai." });
    postPanelState();
  }

  async function runAutomation(payload, runId = state.runToken) {
    const member = payload?.member;
    if (!member || typeof member !== "object") {
      throw new Error("Missing member payload.");
    }

    const context = {
      member,
      memberIndex: Number(payload?.memberIndex || 0),
      totalMembers: Number(payload?.totalMembers || 1),
      entryReleaseDate: resolvePreferredReleaseDate(member),
      manifestPath: String(payload?.manifestPath || state.manifest?.manifestPath || ""),
      runId,
    };

    const globalSteps = [
      {
        action: "wait_for_selector",
        selector: ".card .title",
        timeout_ms: 10000,
      },
      {
        action: "wait_for_selector",
        selector: ".container__notes__upload__button input[type='file']",
        timeout_ms: 15000,
        wait_state: "attached",
      },
    ];

    const perMemberSteps = buildPerMemberSteps(NEXT_BUTTON_SELECTOR);
    const progressSteps = [...globalSteps, ...perMemberSteps].filter(countsForProgress);
    state.progressCurrent = 0;
    state.progressTotal = progressSteps.length;
    postPanelState();

    for (let index = 0; index < globalSteps.length; index += 1) {
      await checkpoint(runId);
      await runStep(globalSteps[index], { ...context, index });
    }

    for (let index = 0; index < perMemberSteps.length; index += 1) {
      await checkpoint(runId);
      await runStep(perMemberSteps[index], { ...context, index });
    }
  }

  function buildPerMemberSteps(nextButtonSelector) {
    return [
      {
        action: "set_files",
        selector: ".container__notes__upload__button input[type='file']",
        value: "{{member.passportImagePath}}",
      },
      {
        action: "wait_for_selector",
        selector: ".popup .popup-actions button:has-text('Proceed'):visible",
        timeout_ms: 120000,
      },
      {
        action: "click",
        selector: ".popup .popup-actions button:has-text('Proceed'):visible",
        timeout_ms: 30000,
      },
      {
        action: "select_primeng_dropdown",
        selector: "p-dropdown[formcontrolname='previousNationalityId'] .p-dropdown:not(.p-disabled)",
        option_text: "{{member.resolvedProfile.previousNationality}}",
        skip_when_empty: true,
      },
      {
        action: "select_primeng_dropdown",
        selector: "p-dropdown[formcontrolname='passportTypeId'] .p-dropdown:not(.p-disabled)",
        option_text: "{{member.resolvedProfile.passportType}}",
        option_kind: "passport_type",
      },
      {
        action: "set_calendar_date",
        selector: "p-calendar[formcontrolname='passportIssueDate'] input[type='text']",
        popup_selector: ".p-datepicker",
        value: "{{entryReleaseDate}}",
      },
      {
        action: "fill",
        selector: "input[formcontrolname='issueCityName']",
        value: "{{member.resolvedProfile.cityOfIssued}}",
      },
      {
        action: "wait_for_enabled",
        selector: nextButtonSelector,
        timeout_ms: 30000,
      },
      {
        action: "click",
        selector: nextButtonSelector,
        timeout_ms: 10000,
      },
      {
        action: "wait_for_selector",
        selector: "div[formgroupname='firstName'] input[formcontrolname='ar'], input[placeholder*='Arabic'][placeholder*='First'], input[formcontrolname='profession'], input[placeholder='Profession']",
        timeout_ms: 120000,
      },
      {
        action: "fill_arabic_minimal",
        first_value: "{{member.resolvedProfile.arabic.firstName}}",
        family_value: "{{member.resolvedProfile.arabic.familyName}}",
      },
      {
        action: "fill",
        selector: "div[formgroupname='firstName'] input[formcontrolname='ar'], input[formcontrolname='firstName.ar'], input[name='firstName.ar'], input[placeholder='First Name (Arabic)'], input[placeholder='First name (Arabic)'], input[placeholder*='Arabic'][placeholder*='First']",
        value: "{{member.resolvedProfile.arabic.firstName}}",
      },
      {
        action: "fill",
        selector: "div[formgroupname='secondName'] input[formcontrolname='ar'], input[placeholder=\"Father's Name (Arabic)\"], input[placeholder='Father Name (Arabic)'], input[placeholder*='Arabic'][placeholder*='Father']",
        value: "{{member.resolvedProfile.arabic.fatherName}}",
        skip_when_empty: true,
      },
      {
        action: "fill",
        selector: "div[formgroupname='thirdName'] input[formcontrolname='ar'], input[placeholder='Grandfather Name (Arabic)'], input[placeholder*='Arabic'][placeholder*='Grand']",
        value: "{{member.resolvedProfile.arabic.grandfatherName}}",
        skip_when_empty: true,
      },
      {
        action: "fill",
        selector: "div[formgroupname='familyName'] input[formcontrolname='ar'], input[formcontrolname='familyName.ar'], input[name='familyName.ar'], input[placeholder='Family Name (Arabic)'], input[placeholder*='Arabic'][placeholder*='Family']",
        value: "{{member.resolvedProfile.arabic.familyName}}",
      },
      {
        action: "fill",
        selector: "div[formgroupname='firstName'] input[formcontrolname='en'], input[formcontrolname='firstName.en'], input[name='firstName.en'], input[placeholder='First name'], input[placeholder='First Name'], input[placeholder*='First'][placeholder]:not([placeholder*='Arabic'])",
        value: "{{member.resolvedProfile.firstName}}",
      },
      {
        action: "fill",
        selector: "div[formgroupname='secondName'] input[formcontrolname='en'], input[placeholder='Father name'], input[placeholder='Father Name'], input[placeholder*='Father'][placeholder]:not([placeholder*='Arabic'])",
        value: "{{member.resolvedProfile.fatherName}}",
        skip_when_empty: true,
      },
      {
        action: "fill",
        selector: "div[formgroupname='thirdName'] input[formcontrolname='en'], input[placeholder='Grand father'], input[placeholder='Grandfather Name'], input[placeholder*='Grand'][placeholder]:not([placeholder*='Arabic'])",
        value: "{{member.resolvedProfile.grandfatherName}}",
        skip_when_empty: true,
      },
      {
        action: "fill",
        selector: "div[formgroupname='familyName'] input[formcontrolname='en'], input[formcontrolname='familyName.en'], input[name='familyName.en'], input[placeholder='Family Name'], input[placeholder*='Family'][placeholder]:not([placeholder*='Arabic'])",
        value: "{{member.resolvedProfile.familyName}}",
      },
      {
        action: "fill",
        selector: "input[formcontrolname='profession'], input[name='profession'], input[placeholder='Profession']",
        value: "{{member.resolvedProfile.profession}}",
      },
      {
        action: "select_primeng_dropdown",
        selector: "select[formcontrolname='birthCountryId'], p-dropdown[formcontrolname='birthCountryId'] .p-dropdown:not(.p-disabled), p-dropdown[formcontrolname='birthCountryId'] .p-dropdown",
        option_text: "{{member.resolvedProfile.birthCountry}}",
        option_kind: "birth_country",
      },
      {
        action: "fill",
        selector: "input[formcontrolname='birthCityName'], input[name='birthCityName'], input[placeholder='Birth City']",
        value: "{{member.resolvedProfile.birthCity}}",
      },
      {
        action: "select_primeng_dropdown",
        selector: "select[formcontrolname='martialStatusId'], select[formcontrolname='maritalStatusId'], p-dropdown[formcontrolname='martialStatusId'] .p-dropdown:not(.p-disabled), p-dropdown[formcontrolname='maritalStatusId'] .p-dropdown:not(.p-disabled), p-dropdown[formcontrolname='martialStatusId'] .p-dropdown, p-dropdown[formcontrolname='maritalStatusId'] .p-dropdown",
        option_text: "{{member.resolvedProfile.maritalStatus}}",
        option_kind: "marital_status",
      },
      {
        action: "set_files",
        selector: VACCINATION_UPLOAD_SELECTOR,
        value: "{{member.passportImagePath}}",
      },
      {
        action: "fill",
        selector: "input[formcontrolname='email'], input[name='email'], input[placeholder='Email'], input[type='email'][placeholder='Email']",
        value: "{{member.resolvedProfile.email}}",
      },
      {
        action: "set_phone_fields",
        selector: "input[formcontrolname='phone'], input[name='phone'], input[formcontrolname='mobileNumber'], input[name='mobileNumber'], input[placeholder='Mobile Number'], input[placeholder='Phone Number'], input[placeholder*='Phone'], input[placeholder*='Mobile'], input[type='tel'], ngx-intl-tel-input input",
        value: "{{member.resolvedProfile.mobileNumber}}",
      },
      {
        action: "wait_for_enabled",
        selector: nextButtonSelector,
        timeout_ms: 30000,
      },
      {
        action: "click",
        selector: nextButtonSelector,
        timeout_ms: 10000,
      },
      {
        action: "wait_for_selector",
        selector: ".card .title:has-text('Disclosure Form')",
        timeout_ms: 30000,
      },
      {
        action: "set_disclosure_all_no",
        selector: ".card",
      },
      {
        action: "wait_for_enabled",
        selector: nextButtonSelector,
        timeout_ms: 30000,
      },
      {
        action: "click",
        selector: nextButtonSelector,
        timeout_ms: 10000,
      },
      {
        action: "wait_for_enabled",
        selector: nextButtonSelector,
        timeout_ms: 30000,
      },
      {
        action: "click",
        selector: nextButtonSelector,
        timeout_ms: 10000,
      },
      {
        action: "wait_for_selector",
        selector: ".popup h3:has-text('Mutamer has been added successfully')",
        timeout_ms: 30000,
      },
      {
        action: "click_success_popup_action",
        timeout_ms: 15000,
      },
    ];
  }

  async function runStep(step, context) {
    const action = String(step?.action || "").trim().toLowerCase();
    const selector = interpolate(step?.selector || "", context);
    const timeoutMs = Number(step?.timeout_ms || 30000);
    const skipWhenEmpty = Boolean(step?.skip_when_empty);
    const runId = Number(context?.runId || state.runToken);

    await checkpoint(runId);

    if (action === "wait_for_selector") {
      appendLog("info", `Waiting for ${selector}`);
      await waitForSelector(selector, {
        timeoutMs,
        state: String(step?.wait_state || "").trim().toLowerCase() || "visible",
      }, runId);
      await waitForPageReady(Math.min(timeoutMs, 6000), runId);
      finishStep(step, selector);
      return;
    }

    if (action === "wait_for_enabled") {
      appendLog("info", `Checking enabled state for ${selector}`);
      if (isLikelyNextSelector(selector)) {
        await attemptFillRequiredFieldsForCurrentPage(context);
        await waitForEnabledNextButton(timeoutMs, runId);
      } else {
        await waitForEnabled(selector, timeoutMs, runId);
      }
      finishStep(step, selector);
      return;
    }

    if (action === "wait") {
      await sleep(Number(step?.ms || 500), runId);
      finishStep(step, selector);
      return;
    }

    await waitForPageReady(Math.min(timeoutMs, 5000), runId);
    await humanDelayBeforeAction(action, runId);

    if (action === "click") {
      appendLog("info", `Clicking ${selector}`);
      if (isLikelyNextSelector(selector)) {
        await attemptFillRequiredFieldsForCurrentPage(context);
        const clicked = await clickNextButtonRobust(timeoutMs);
        if (!clicked) {
          throw new Error("Failed to click Next.");
        }
      } else if (isLikelyProceedSelector(selector)) {
        const clicked = await clickProceedButtonRobust(timeoutMs);
        if (!clicked) {
          throw new Error("Failed to click Proceed.");
        }
      } else {
        const element = await waitForSelector(selector, { timeoutMs, state: "visible" }, runId);
        markActiveElement(element);
        await clickElement(element);
      }
      finishStep(step, selector);
      return;
    }

    if (action === "fill") {
      let value = interpolate(step?.value || "", context).trim();
      if (!value && skipWhenEmpty) {
        appendLog("warning", `Skipping empty field for ${selector}`);
        finishStep(step, selector);
        return;
      }
      if (!value) {
        throw new Error(`Missing fill value for selector: ${selector}`);
      }
      const input = await waitForInput(selector, timeoutMs, runId);
      markActiveElement(input);
      setInputValue(input, value);
      appendLog("success", `Filled ${selector} with ${value}`);
      finishStep(step, selector);
      return;
    }

    if (action === "fill_arabic_minimal") {
      const firstValue = interpolate(step?.first_value || "", context).trim();
      const familyValue = interpolate(step?.family_value || "", context).trim();
      if (!firstValue || !familyValue) {
        throw new Error("fill_arabic_minimal requires first and family Arabic values.");
      }
      const firstInput = findFirstVisible([
        "div[formgroupname='firstName'] input[formcontrolname='ar']",
        "input[formcontrolname='firstName.ar']",
        "input[name='firstName.ar']",
        "input[placeholder='First Name (Arabic)']",
        "input[placeholder='First name (Arabic)']",
      ].join(", "));
      const familyInput = findFirstVisible([
        "div[formgroupname='familyName'] input[formcontrolname='ar']",
        "input[formcontrolname='familyName.ar']",
        "input[name='familyName.ar']",
        "input[placeholder='Family Name (Arabic)']",
      ].join(", "));
      if (!firstInput || !familyInput) {
        throw new Error("Arabic inputs are not visible.");
      }
      markActiveElement(firstInput);
      setInputValue(firstInput, firstValue);
      markActiveElement(familyInput);
      setInputValue(familyInput, familyValue);
      appendLog("success", "Filled minimal Arabic fields.");
      finishStep(step, selector);
      return;
    }

    if (action === "set_phone_fields") {
      let value = interpolate(step?.value || "", context).trim();
      if (!value && skipWhenEmpty) {
        appendLog("warning", "Skipping empty phone field.");
        finishStep(step, selector);
        return;
      }
      if (!value) {
        throw new Error("Phone number is empty.");
      }
      await setPhoneFields(selector, value, timeoutMs, runId);
      appendLog("success", "Phone number updated.");
      finishStep(step, selector);
      return;
    }

    if (action === "set_calendar_date") {
      const value = interpolate(step?.value || "", context).trim();
      await setCalendarDate({
        selector,
        rawValue: value,
        popupSelector: String(step?.popup_selector || ".p-datepicker").trim() || ".p-datepicker",
        timeoutMs,
        skipWhenEmpty,
        runId,
      });
      appendLog("success", `Date set for ${selector}.`);
      finishStep(step, selector);
      return;
    }

    if (action === "select_primeng_dropdown") {
      let optionText = interpolate(step?.option_text || "", context).trim();
      if (!optionText && skipWhenEmpty) {
        appendLog("warning", `Skipping empty dropdown ${selector}`);
        finishStep(step, selector);
        return;
      }
      if (!optionText) {
        throw new Error(`Dropdown option is empty for selector: ${selector}`);
      }
      await selectPrimengDropdown(selector, optionText, String(step?.option_kind || ""), timeoutMs, runId);
      appendLog("success", `Dropdown selected: ${optionText}`);
      finishStep(step, selector);
      return;
    }

    if (action === "set_files") {
      const fileInput = await waitForSelector(selector, { timeoutMs, state: "attached" }, runId);
      markActiveElement(fileInput);
      const input = fileInput instanceof HTMLInputElement ? fileInput : null;
      const existingFiles = input?.files ? input.files.length : 0;
      if (existingFiles > 0) {
        appendLog("success", `Using already-selected file for ${selector}`);
        finishStep(step, selector);
        return;
      }
      let rawValue = interpolate(step?.value || "", context).trim();
      if (!rawValue && skipWhenEmpty) {
        appendLog("warning", `Skipping empty upload field ${selector}`);
        finishStep(step, selector);
        return;
      }
      if (!rawValue) {
        throw new Error(`Upload path is empty for selector: ${selector}`);
      }

      const resolvedFilePath = resolveUploadFilePath(rawValue, context);
      const uploadFile = resolveSelectedUploadFile(rawValue, context);
      if (!uploadFile) {
        const message = buildUploadFailureMessage(rawValue, resolvedFilePath);
        appendLog("error", message);
        throw new Error(message);
      }
      appendLog("info", `Memilih file upload ${uploadFile.name}`);
      setFileInputFromFile(input, uploadFile);
      await waitUntil(() => {
        const refreshedInput = findFirstVisible(selector);
        const refreshedFileCount = refreshedInput instanceof HTMLInputElement && refreshedInput.files
          ? refreshedInput.files.length
          : 0;
        if (refreshedFileCount > 0) {
          return refreshedInput;
        }
        if (input?.files?.length) {
          return input;
        }
        if (findByText(".popup .popup-actions button", "Proceed")) {
          return true;
        }
        if (detectNusukStage() >= 1 && findFirstVisible("p-dropdown[formcontrolname='passportTypeId'], input[formcontrolname='issueCityName']")) {
          return true;
        }
        return null;
      }, Math.min(timeoutMs, 12000), "", runId);
      appendLog("success", `File selected for ${selector}`);
      finishStep(step, selector);
      return;
    }

    if (action === "set_disclosure_all_no") {
      const ok = setDisclosureAllNo(selector || ".card");
      if (!ok) {
        throw new Error("Failed to set Disclosure Form to No.");
      }
      appendLog("success", "Disclosure form set to No.");
      finishStep(step, selector);
      return;
    }

    if (action === "click_success_popup_action") {
      const button = await waitForSelector(".popup .popup-actions button:has-text('Go To Mutamer List'), .popup .popup-actions button:has-text('Add Another Mutamer')", {
        timeoutMs,
        state: "visible",
      }, runId);
      markActiveElement(button);
      await clickElement(button);
      appendLog("success", "Success popup confirmed.");
      finishStep(step, selector);
      return;
    }

    throw new Error(`Unsupported action: ${action}`);
  }

  function finishStep(step, selector) {
    if (countsForProgress(step)) {
      state.progressCurrent = Math.min(state.progressCurrent + 1, state.progressTotal);
      postProgress();
    }
    clearActiveHighlight();
    if (selector) {
      postToPanel("NUSUK_PANEL_STEP", { selector, action: String(step?.action || "") });
    }
  }

  function countsForProgress(step) {
    const action = String(step?.action || "").trim().toLowerCase();
    return [
      "wait_for_selector",
      "wait_for_enabled",
      "click",
      "fill",
      "fill_arabic_minimal",
      "set_phone_fields",
      "set_calendar_date",
      "select_primeng_dropdown",
      "set_files",
      "set_disclosure_all_no",
      "click_success_popup_action",
    ].includes(action);
  }

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
    if (!panelReady || !panelFrame?.contentWindow) {
      return;
    }
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
    if (!panelFrame?.contentWindow) {
      return;
    }
    panelFrame.contentWindow.postMessage({ type, payload }, PANEL_ORIGIN);
  }

  async function persistState() {
    await chrome.storage.local.set({
      [STORAGE_KEY]: {
        manifest: state.manifest,
        selectedMemberId: state.selectedMemberId,
        collapsed: state.collapsed,
        panelWidth: state.panelWidth,
        executionState: state.executionState,
      },
    });
  }

  function registerUploadFiles(files) {
    uploadFilesByKey.clear();
    const validFiles = Array.from(files || []).filter((file) => file instanceof File);
    uploadFileCount = validFiles.length;
    uploadFileNames = validFiles.slice(0, 5).map((file) => file.webkitRelativePath || file.name);
    for (const file of validFiles) {
      for (const key of fileLookupKeys(file)) {
        uploadFilesByKey.set(key, file);
      }
    }
  }

  function resolveSelectedUploadFile(rawPath, context) {
    const candidates = [
      rawPath,
      resolveUploadFilePath(rawPath, context),
      context?.member?.fileName,
      context?.member?.passportImagePath,
    ].filter(Boolean);

    for (const candidate of candidates) {
      for (const key of pathLookupKeys(candidate)) {
        const file = uploadFilesByKey.get(key);
        if (file) {
          return file;
        }
      }
    }
    return null;
  }

  function setFileInputFromFile(input, file) {
    if (!(input instanceof HTMLInputElement) || input.type !== "file") {
      throw new Error("Selector upload tidak mengarah ke input file.");
    }
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    input.files = dataTransfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function fileLookupKeys(file) {
    return uniqueFileKeys([
      file.name,
      file.webkitRelativePath,
      basenameFromAnyPath(file.webkitRelativePath || file.name),
    ]);
  }

  function pathLookupKeys(pathValue) {
    const text = String(pathValue || "").trim();
    return uniqueFileKeys([
      text,
      normalizeUploadKey(text),
      basenameFromAnyPath(text),
    ]);
  }

  function uniqueFileKeys(values) {
    const out = [];
    const seen = new Set();
    for (const value of values) {
      const key = normalizeUploadKey(value);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(key);
    }
    return out;
  }

  function normalizeUploadKey(value) {
    return String(value || "")
      .trim()
      .replace(/^file:\/\//i, "")
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .toLowerCase();
  }

  function basenameFromAnyPath(value) {
    const normalized = String(value || "").replace(/\\/g, "/");
    return normalized.split("/").filter(Boolean).pop() || normalized;
  }

  function getSelectedMember() {
    const members = Array.isArray(state.manifest?.members) ? state.manifest.members : [];
    return members.find((member) => String(member.id || "") === String(state.selectedMemberId || "")) || null;
  }

  function markActiveElement(element) {
    clearActiveHighlight();
    if (!(element instanceof HTMLElement)) {
      return;
    }
    activeHighlightElement = element;
    activeHighlightElement.classList.add(ACTIVE_HIGHLIGHT_CLASS);
  }

  function clearActiveHighlight() {
    if (activeHighlightElement instanceof HTMLElement) {
      activeHighlightElement.classList.remove(ACTIVE_HIGHLIGHT_CLASS);
    }
    activeHighlightElement = null;
  }

  async function setPhoneFields(selector, rawValue, timeoutMs, runId = state.runToken) {
    const input = await waitForInput(selector, timeoutMs, runId);
    markActiveElement(input);
    const normalized = String(rawValue || "").replace(/\s+/g, "");
    const localNumber = normalized.startsWith("+62")
      ? normalized.slice(3)
      : normalized.startsWith("62")
        ? normalized.slice(2)
        : normalized;

    const countryTrigger = findClosestPhoneCountryTrigger(input);
    if (countryTrigger && /\+?62/.test(normalized)) {
      await selectPhoneCountry(countryTrigger, "Indonesia", timeoutMs, runId).catch(() => {});
    }

    setInputValue(input, localNumber || normalized);
  }

  function resolveUploadFilePath(rawValue, context) {
    const trimmed = String(rawValue || "").trim();
    if (!trimmed) {
      return "";
    }

    if (FILE_URI_RE.test(trimmed)) {
      return decodeURIComponent(trimmed.replace(FILE_URI_RE, "").replace(/\//g, "\\"));
    }

    if (isAbsoluteFilePath(trimmed)) {
      return normalizeWindowsSlashes(trimmed);
    }

    const normalizedRelative = trimmed.replace(/^\.?[\\/]+/, "");
    const manifestPath = String(context?.manifestPath || state.manifest?.manifestPath || "").trim();
    const candidates = [];
    const firstSegment = normalizedRelative.split(/[\\/]+/).filter(Boolean)[0] || "";

    if (manifestPath && isAbsoluteFilePath(manifestPath)) {
      const manifestDir = parentDirectory(manifestPath);
      if (manifestDir) {
        candidates.push(joinWindowsPath(manifestDir, normalizedRelative));
      }

      if (firstSegment) {
        const rootBeforeSegment = rootPathBeforeSegment(manifestPath, firstSegment);
        if (rootBeforeSegment) {
          candidates.push(joinWindowsPath(rootBeforeSegment, normalizedRelative));
        }
      }
    }

    if (firstSegment && DEFAULT_REPO_ROOT) {
      candidates.push(joinWindowsPath(DEFAULT_REPO_ROOT, normalizedRelative));
      if (firstSegment.toLowerCase() !== "data" && /^(passports?|images?|files?)$/i.test(firstSegment)) {
        candidates.push(joinWindowsPath(DEFAULT_REPO_ROOT, joinWindowsPath("data", normalizedRelative)));
      }
    }

    candidates.push(normalizeWindowsSlashes(trimmed));
    return candidates.find(Boolean) || normalizeWindowsSlashes(trimmed);
  }

  function buildUploadFailureMessage(rawPath, resolvedPath, rawError) {
    const detail = String(rawError || "").trim();
    const base = detail || "File passport belum dipilih di panel extension.";
    if (rawPath !== resolvedPath) {
      return `${base} Path JSON: ${rawPath}. Dicari sebagai: ${resolvedPath}. Pilih folder/file passport yang sesuai.`;
    }
    return `${base} Path: ${resolvedPath}. Pilih folder/file passport yang sesuai.`;
  }

  function isAbsoluteFilePath(value) {
    return WINDOWS_ABSOLUTE_PATH_RE.test(String(value || "").trim()) || String(value || "").startsWith("\\\\");
  }

  function normalizeWindowsSlashes(value) {
    return String(value || "").replace(/\//g, "\\");
  }

  function parentDirectory(filePath) {
    const normalized = normalizeWindowsSlashes(filePath).replace(/[\\]+$/, "");
    const index = normalized.lastIndexOf("\\");
    return index > 1 ? normalized.slice(0, index) : "";
  }

  function joinWindowsPath(basePath, suffixPath) {
    const safeBase = normalizeWindowsSlashes(basePath).replace(/[\\]+$/, "");
    const safeSuffix = normalizeWindowsSlashes(suffixPath).replace(/^[\\]+/, "");
    return safeBase && safeSuffix ? `${safeBase}\\${safeSuffix}` : safeBase || safeSuffix;
  }

  function rootPathBeforeSegment(fullPath, segment) {
    const normalizedPath = normalizeWindowsSlashes(fullPath).toLowerCase();
    const normalizedSegment = `\\${String(segment || "").toLowerCase()}\\`;
    const index = normalizedPath.indexOf(normalizedSegment);
    if (index <= 0) {
      return "";
    }
    return normalizeWindowsSlashes(fullPath).slice(0, index);
  }

  function findClosestPhoneCountryTrigger(input) {
    const scope = input.closest("ngx-intl-tel-input, .iti, .form-group, div");
    if (!scope) {
      return null;
    }
    return scope.querySelector(".iti__selected-flag, .iti__flag-container, .selected-dial-code, .dropdown-toggle");
  }

  async function selectPhoneCountry(trigger, label, timeoutMs, runId = state.runToken) {
    await clickElement(trigger);
    await waitUntil(() => {
      const option = findByText(".iti__country-list li, .country-dropdown li, [role='option']", label);
      return option || null;
    }, timeoutMs, "", runId);
    const option = findByText(".iti__country-list li, .country-dropdown li, [role='option']", label);
    if (option) {
      await clickElement(option);
    }
  }

  async function setCalendarDate({ selector, rawValue, popupSelector, timeoutMs, skipWhenEmpty, runId = state.runToken }) {
    if (!rawValue && skipWhenEmpty) {
      return;
    }
    const isoDate = normalizeDateToIso(rawValue);
    if (!isoDate) {
      throw new Error(`Unrecognized date format: ${rawValue}`);
    }

    const input = await waitForInput(selector, timeoutMs, runId);
    markActiveElement(input);
    const preferredValues = [isoToSlashDate(isoDate), isoDate, isoToDisplayDMY(isoDate)].filter(Boolean);
    for (const candidate of preferredValues) {
      setInputValue(input, candidate);
      dispatchBlur(input);
      await sleep(120, runId);
      if (isPickedDateMatch(input.value, isoDateParts(isoDate))) {
        return;
      }
    }

    await clickElement(input);
    await waitForSelector(popupSelector, { timeoutMs, state: "attached" }, runId);
    await navigateCalendarToDate(popupSelector, isoDate, timeoutMs, runId);
    const day = locateEnabledCalendarDay(popupSelector, isoDate);
    if (day) {
      markActiveElement(day);
      await clickElement(day);
      await sleep(180, runId);
      if (isPickedDateMatch(input.value, isoDateParts(isoDate))) {
        return;
      }
    }

    setInputValue(input, preferredValues[0] || isoDate);
    dispatchBlur(input);
    await sleep(120, runId);
    if (!isPickedDateMatch(input.value, isoDateParts(isoDate))) {
      throw new Error(`Failed to set calendar date ${isoDate}.`);
    }
  }

  async function navigateCalendarToDate(popupSelector, isoDate, timeoutMs, runId = state.runToken) {
    const target = new Date(`${isoDate}T00:00:00`);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (locateEnabledCalendarDay(popupSelector, isoDate)) {
        return;
      }

      const monthNode = document.querySelector(`${popupSelector} .p-datepicker-month`);
      const yearNode = document.querySelector(`${popupSelector} .p-datepicker-year`);
      const currentMonth = monthNameToIndex(monthNode?.textContent || "");
      const currentYear = Number(String(yearNode?.textContent || "").trim());
      if (currentMonth < 0 || !Number.isFinite(currentYear)) {
        break;
      }

      const targetIndex = target.getFullYear() * 12 + target.getMonth();
      const currentIndex = currentYear * 12 + currentMonth;
      const navSelector = targetIndex > currentIndex
        ? `${popupSelector} .p-datepicker-next:not([disabled])`
        : `${popupSelector} .p-datepicker-prev:not([disabled])`;
      const nav = document.querySelector(navSelector);
      if (!nav) {
        break;
      }
      await clickElement(nav);
      await sleep(220, runId);
    }
  }

  function locateEnabledCalendarDay(popupSelector, isoDate) {
    const candidates = isoDateCandidates(isoDate);
    for (const candidate of candidates) {
      const day = findFirstVisible(
        `${popupSelector} td:not(.p-datepicker-other-month) span[data-date='${candidate}']:not(.p-disabled), ${popupSelector} td:not(.disabled) [data-date='${candidate}']:not(.disabled)`
      );
      if (day) {
        return day;
      }
    }
    return null;
  }

  async function selectPrimengDropdown(selector, optionText, optionKind, timeoutMs, runId = state.runToken) {
    const nativeSelect = findFirstVisible(selector);
    if (nativeSelect && nativeSelect.tagName.toLowerCase() === "select") {
      markActiveElement(nativeSelect);
      if (selectNativeByText(nativeSelect, optionText, optionKind)) {
        return;
      }
    }

    const trigger = await waitForSelector(selector, { timeoutMs, state: "visible" }, runId);
    markActiveElement(trigger);
    const currentLabel = String(trigger.querySelector(".p-dropdown-label")?.textContent || "").trim();
    if (currentLabel && normalizeOption(currentLabel) === normalizeOption(optionText)) {
      return;
    }

    await clickElement(trigger);
    await waitForSelector(".p-dropdown-panel", { timeoutMs, state: "visible" }, runId);
    await sleep(160, runId);

    const option = findPrimeNgDropdownOption(optionText, optionKind);
    if (!option) {
      if (String(optionKind || "") === "passport_type") {
        throw new Error(`Dropdown option not found: ${optionText}`);
      }
      return;
    }
    markActiveElement(option);
    await clickElement(option);
    await sleep(160, runId);
  }

  function findPrimeNgDropdownOption(optionText, optionKind) {
    const expected = normalizeOption(optionText);
    const aliases = buildOptionAliases(expected, optionKind);
    const items = queryAll(".p-dropdown-panel .p-dropdown-items .p-dropdown-item, .p-dropdown-panel [role='option']")
      .filter(isVisible);

    let partial = null;
    for (const item of items) {
      const label = normalizeOption(item.textContent || "");
      if (aliases.includes(label)) {
        return item;
      }
      if (!partial && aliases.some((candidate) => label.includes(candidate) || candidate.includes(label))) {
        partial = item;
      }
    }
    return partial;
  }

  function buildOptionAliases(normalizedValue, optionKind) {
    const aliases = new Set([normalizedValue]);
    const compact = normalizedValue.replace(/\s+/g, "");

    if (optionKind === "passport_type") {
      const map = {
        normal: ["normal"],
        diplomatic: ["diplomatic"],
        other: ["other"],
        traveldocuments: ["travel documents", "travel document", "traveldocuments"],
        unpassport: ["un passport", "unpassport"],
        privatepassport: ["private passport", "privatepassport"],
      };
      for (const value of map[compact] || []) {
        aliases.add(normalizeOption(value));
      }
    }

    if (optionKind === "birth_country") {
      const map = {
        indonesia: ["indonesia", "republic of indonesia"],
        chinaprc: ["china prc", "china (prc)", "prc", "china"],
      };
      for (const value of map[compact] || []) {
        aliases.add(normalizeOption(value));
      }
    }

    if (optionKind === "marital_status") {
      const map = {
        single: ["single", "unmarried", "belum menikah", "lajang"],
        married: ["married", "menikah", "kawin"],
        divorced: ["divorced", "cerai", "divorce"],
        widowed: ["widowed", "janda", "duda"],
      };
      for (const value of map[compact] || []) {
        aliases.add(normalizeOption(value));
      }
    }

    return Array.from(aliases);
  }

  function selectNativeByText(select, optionText, optionKind) {
    const expectedAliases = buildOptionAliases(normalizeOption(optionText), optionKind);
    for (const option of Array.from(select.options || [])) {
      const label = normalizeOption(option.textContent || "");
      const value = normalizeOption(option.value || "");
      if (
        expectedAliases.includes(label)
        || expectedAliases.includes(value)
        || expectedAliases.some((candidate) => label.includes(candidate) || value.includes(candidate))
      ) {
        select.value = option.value;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
    return false;
  }

  function setDisclosureAllNo(baseSelector) {
    const cards = queryAll(baseSelector);
    const targetCard = cards.find((card) => String(card.querySelector(".title")?.textContent || "").toLowerCase().includes("disclosure form"));
    if (!targetCard) {
      return false;
    }

    const groups = new Map();
    for (const radio of Array.from(targetCard.querySelectorAll("input[type='radio'][name]"))) {
      const name = String(radio.getAttribute("name") || "").trim();
      if (!name) {
        continue;
      }
      const current = groups.get(name) || [];
      current.push(radio);
      groups.set(name, current);
    }

    let changed = false;
    for (const radios of groups.values()) {
      let picked = radios.find((radio) => String(radio.closest("label")?.textContent || "").trim().toLowerCase() === "no");
      if (!picked && radios.length > 1) {
        picked = radios[1];
      }
      if (picked) {
        picked.click();
        changed = true;
      }
    }
    return changed;
  }

  async function clickProceedButtonRobust(timeoutMs, runId = state.runToken) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const button = findByText(".popup .popup-actions button", "Proceed");
      if (button && isVisible(button) && isEnabled(button)) {
        markActiveElement(button);
        await clickElement(button);
        await sleep(200, runId);
        const stillVisible = findByText(".popup .popup-actions button", "Proceed");
        if (!stillVisible || !isVisible(stillVisible)) {
          return true;
        }
      }
      await sleep(140, runId);
    }
    return false;
  }

  async function waitForEnabledNextButton(timeoutMs, runId = state.runToken) {
    const button = await waitUntil(() => findUsableNextButton(), timeoutMs, "", runId);
    if (!button) {
      throw new Error("Next button is not enabled.");
    }
    markActiveElement(button);
    return button;
  }

  function findUsableNextButton() {
    for (const selector of NEXT_BUTTON_CANDIDATE_SELECTORS) {
      const button = findFirstVisible(selector);
      if (!button) {
        continue;
      }
      const text = String(button.textContent || "").trim().toLowerCase();
      if (text !== "next") {
        continue;
      }
      if (isEnabled(button)) {
        return button;
      }
    }
    return null;
  }

  async function clickNextButtonRobust(timeoutMs, runId = state.runToken) {
    const deadline = Date.now() + timeoutMs;
    const beforeStage = detectNusukStage();

    while (Date.now() < deadline) {
      const button = findUsableNextButton();
      if (!button) {
        await sleep(160, runId);
        continue;
      }
      markActiveElement(button);
      await clickElement(button);
      await sleep(260, runId);
      const changed = await waitUntil(() => detectNusukStage() !== beforeStage, 4000, "", runId).catch(() => false);
      if (changed || beforeStage === 0) {
        return true;
      }
    }

    return false;
  }

  function detectNusukStage() {
    if (findFirstVisible(".popup h3:has-text('Mutamer has been added successfully')")) {
      return 4;
    }
    if (findFirstVisible(".card .title:has-text('Disclosure Form')")) {
      return 3;
    }
    if (findFirstVisible("div[formgroupname='firstName'] input[formcontrolname='ar'], input[placeholder='First Name (Arabic)'], input[placeholder='Profession'], input[formcontrolname='email']")) {
      return 2;
    }
    if (findFirstVisible(".container__notes__upload__button input[type='file'], p-dropdown[formcontrolname='passportTypeId'], input[formcontrolname='issueCityName']")) {
      return 1;
    }
    return 0;
  }

  async function attemptFillRequiredFieldsForCurrentPage(context) {
    if (detectNusukStage() !== 2) {
      return;
    }

    const member = context.member || {};
    const rs = member.resolvedProfile || {};
    const pe = member.passportExtracted || {};

    setFirstVisibleInputIfEmpty([
      "div[formgroupname='firstName'] input[formcontrolname='ar']",
      "input[formcontrolname='firstName.ar']",
      "input[name='firstName.ar']",
      "input[placeholder='First Name (Arabic)']",
    ], pickFirstNonEmpty(rs?.arabic?.firstName, rs?.firstName, pe?.firstName));

    setFirstVisibleInputIfEmpty([
      "div[formgroupname='familyName'] input[formcontrolname='ar']",
      "input[formcontrolname='familyName.ar']",
      "input[name='familyName.ar']",
      "input[placeholder='Family Name (Arabic)']",
    ], pickFirstNonEmpty(rs?.arabic?.familyName, rs?.familyName, pe?.familyName));

    setFirstVisibleInputIfEmpty([
      "input[formcontrolname='profession']",
      "input[name='profession']",
      "input[placeholder='Profession']",
    ], pickFirstNonEmpty(rs?.profession, "BUSINESS"));

    setFirstVisibleInputIfEmpty([
      "input[formcontrolname='birthCityName']",
      "input[name='birthCityName']",
      "input[placeholder='Birth City']",
    ], pickFirstNonEmpty(rs?.birthCity, pe?.birthCity, pe?.cityOfIssued, rs?.cityOfIssued));

    setFirstVisibleInputIfEmpty([
      "input[formcontrolname='email']",
      "input[name='email']",
      "input[placeholder='Email']",
      "input[type='email'][placeholder='Email']",
    ], pickFirstNonEmpty(rs?.email, "example@gmail.com"));
  }

  function setFirstVisibleInputIfEmpty(selectors, value) {
    if (!value) {
      return;
    }
    const input = findFirstVisible(selectors.join(", "));
    if (!input) {
      return;
    }
    const currentValue = "value" in input ? String(input.value || "").trim() : "";
    if (currentValue) {
      return;
    }
    markActiveElement(input);
    setInputValue(input, value);
  }

  async function waitForInput(selector, timeoutMs, runId = state.runToken) {
    const element = await waitForSelector(selector, { timeoutMs, state: "visible" }, runId);
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
      throw new Error(`Selector is not an input: ${selector}`);
    }
    return element;
  }

  async function waitForEnabled(selector, timeoutMs, runId = state.runToken) {
    return waitUntil(() => {
      const element = findFirstVisible(selector);
      return element && isEnabled(element) ? element : null;
    }, timeoutMs, "", runId);
  }

  async function waitForSelector(selector, options = {}, runId = state.runToken) {
    const timeoutMs = Number(options.timeoutMs || 10000);
    const state = String(options.state || "visible").toLowerCase();

    return waitUntil(() => {
      if (state === "attached") {
        const attached = queryAll(selector);
        return attached[0] || null;
      }
      return findFirstVisible(selector);
    }, timeoutMs, `Timed out waiting for selector: ${selector}`, runId);
  }

  async function waitUntil(check, timeoutMs, errorMessage, runId = state.runToken) {
    const deadline = Date.now() + Math.max(300, Number(timeoutMs || 0));
    while (Date.now() < deadline) {
      await checkpoint(runId);
      const value = await Promise.resolve(check());
      if (value) {
        return value;
      }
      await sleep(120, runId);
    }
    throw new Error(errorMessage || "Timed out waiting for condition.");
  }

  async function waitForPageReady(timeoutMs, runId = state.runToken) {
    const deadline = Date.now() + Math.max(500, Number(timeoutMs || 0));
    while (Date.now() < deadline) {
      await checkpoint(runId);
      const ready = document.readyState === "interactive" || document.readyState === "complete";
      const busy = queryAll(".p-component-overlay, .loading, .spinner, .ngx-spinner-overlay, [aria-busy='true']")
        .some((node) => isVisible(node));
      if (ready && !busy) {
        return;
      }
      await sleep(120, runId);
    }
  }

  async function humanDelayBeforeAction(action, runId = state.runToken) {
    let base = 120;
    if (["click", "select_primeng_dropdown", "set_calendar_date"].includes(action)) {
      base = 220;
    }
    await sleep(base + Math.floor(Math.random() * 120), runId);
  }

  async function clickElement(element) {
    if (!element) {
      throw new Error("Cannot click a missing element.");
    }
    if (element instanceof HTMLElement) {
      element.scrollIntoView({ block: "center", inline: "nearest" });
    }
    try {
      element.click();
    } catch {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    }
  }

  function setInputValue(element, value) {
    const prototype = Object.getPrototypeOf(element);
    const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, "value") : null;
    if (descriptor?.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function dispatchBlur(element) {
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function queryAll(selector) {
    const results = [];
    for (const part of splitSelectorList(selector)) {
      const parsed = parseSelectorPart(part);
      if (!parsed.css) {
        continue;
      }
      let nodes = [];
      try {
        nodes = Array.from(document.querySelectorAll(parsed.css));
      } catch {
        continue;
      }
      for (const node of nodes) {
        if (parsed.visible && !isVisible(node)) {
          continue;
        }
        if (parsed.hasText && !String(node.textContent || "").includes(parsed.hasText)) {
          continue;
        }
        if (!results.includes(node)) {
          results.push(node);
        }
      }
    }
    return results;
  }

  function findFirstVisible(selector) {
    return queryAll(selector).find((node) => isVisible(node)) || null;
  }

  function findByText(selector, text) {
    const normalizedTarget = normalizeOption(text);
    return queryAll(selector).find((node) => normalizeOption(node.textContent || "").includes(normalizedTarget)) || null;
  }

  function splitSelectorList(selector) {
    return String(selector || "")
      .split(/\s*,\s*/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function parseSelectorPart(part) {
    let css = String(part || "").trim();
    let hasText = "";
    const hasTextMatch = css.match(/:has-text\((['"])(.*?)\1\)/i);
    if (hasTextMatch) {
      hasText = hasTextMatch[2] || "";
      css = css.replace(hasTextMatch[0], "");
    }
    const visible = /:visible\b/i.test(css);
    css = css.replace(/:visible\b/gi, "").trim();
    return { css, hasText, visible };
  }

  function isVisible(node) {
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function isEnabled(node) {
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    if ("disabled" in node && node.disabled) {
      return false;
    }
    if (node.getAttribute("disabled") !== null) {
      return false;
    }
    if (String(node.getAttribute("aria-disabled") || "").toLowerCase() === "true") {
      return false;
    }
    const className = String(node.className || "").toLowerCase();
    if (className.includes("disabled") || className.includes("p-disabled")) {
      return false;
    }
    return true;
  }

  function isLikelyNextSelector(selector) {
    const text = String(selector || "").toLowerCase();
    return text.includes("next") && (text.includes("btn-primary") || text.includes("navigation-buttons") || text.includes("action-btns"));
  }

  function isLikelyProceedSelector(selector) {
    const text = String(selector || "").toLowerCase();
    return text.includes("proceed") || (text.includes("popup-actions") && text.includes("button"));
  }

  function interpolate(template, context) {
    return String(template || "").replace(/\{\{([^}]+)\}\}/g, (_full, exprRaw) => {
      const expr = String(exprRaw || "").trim();
      if (!expr) {
        return "";
      }
      if (expr === "index") {
        return String(context.index ?? "");
      }
      if (expr === "memberIndex") {
        return String(context.memberIndex ?? "");
      }
      if (expr === "totalMembers") {
        return String(context.totalMembers ?? "");
      }
      if (expr.startsWith("member.")) {
        return String(deepValue(context.member, expr.slice("member.".length)) ?? "");
      }
      return String(deepValue(context, expr) ?? "");
    });
  }

  function deepValue(node, rawPath) {
    const parts = String(rawPath || "").split(".").filter(Boolean);
    let current = node;
    for (const part of parts) {
      if (!current || typeof current !== "object" || !(part in current)) {
        return "";
      }
      current = current[part];
    }
    return current ?? "";
  }

  function pickFirstNonEmpty(...values) {
    for (const value of values) {
      const text = String(value ?? "").trim();
      if (text) {
        return text;
      }
    }
    return "";
  }

  function normalizeOption(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase()
      .replace(/[().,-]/g, " ")
      .replace(/\s+/g, " ");
  }

  function normalizeDateToIso(rawValue) {
    const value = String(rawValue || "").trim();
    let match = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (match) {
      return toIsoDate(match[1], match[2], match[3]);
    }
    match = value.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (match) {
      return toIsoDate(match[3], match[2], match[1]);
    }
    return "";
  }

  function toIsoDate(yearValue, monthValue, dayValue) {
    const year = Number(yearValue);
    const month = Number(monthValue);
    const day = Number(dayValue);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      !Number.isInteger(year)
      || !Number.isInteger(month)
      || !Number.isInteger(day)
      || date.getUTCFullYear() !== year
      || date.getUTCMonth() !== month - 1
      || date.getUTCDate() !== day
    ) {
      return "";
    }
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function resolvePreferredReleaseDate(member) {
    const passportIssueDate = String(deepValue(member, "passportExtracted.issueDate") || "").trim();
    const releaseDate = String(deepValue(member, "resolvedProfile.releaseDate") || "").trim();
    const issueDate = String(deepValue(member, "resolvedProfile.issueDate") || "").trim();
    const normalizedPassportIssue = normalizeDateToIso(passportIssueDate);
    const normalizedRelease = normalizeDateToIso(releaseDate);
    const normalizedIssue = normalizeDateToIso(issueDate);

    if (normalizedPassportIssue) {
      return passportIssueDate;
    }
    if (normalizedRelease && normalizedIssue && normalizedRelease !== normalizedIssue) {
      return issueDate;
    }
    return releaseDate || issueDate || "";
  }

  function isoDateParts(isoDate) {
    const match = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      return null;
    }
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
    };
  }

  function isoDateCandidates(isoDate) {
    const parts = isoDateParts(isoDate);
    if (!parts) {
      return [String(isoDate || "")];
    }
    return [
      `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
      `${parts.year}-${parts.month}-${parts.day}`,
    ];
  }

  function isoToSlashDate(isoDate) {
    const parts = isoDateParts(isoDate);
    if (!parts) {
      return "";
    }
    return `${parts.year}/${String(parts.month).padStart(2, "0")}/${String(parts.day).padStart(2, "0")}`;
  }

  function isoToDisplayDMY(isoDate) {
    const parts = isoDateParts(isoDate);
    if (!parts) {
      return "";
    }
    return `${String(parts.day).padStart(2, "0")}/${String(parts.month).padStart(2, "0")}/${parts.year}`;
  }

  function isPickedDateMatch(value, targetParts) {
    if (!targetParts) {
      return false;
    }
    const text = String(value || "").replace(/\s+/g, "");
    const y = String(targetParts.year);
    const m = String(targetParts.month);
    const d = String(targetParts.day);
    const mm = String(targetParts.month).padStart(2, "0");
    const dd = String(targetParts.day).padStart(2, "0");
    const candidates = [
      `${y}-${m}-${d}`,
      `${y}-${mm}-${dd}`,
      `${y}/${m}/${d}`,
      `${y}/${mm}/${dd}`,
      `${d}-${m}-${y}`,
      `${dd}-${mm}-${y}`,
      `${d}/${m}/${y}`,
      `${dd}/${mm}/${y}`,
    ];
    return candidates.some((candidate) => text.includes(candidate));
  }

  function monthNameToIndex(value) {
    const map = {
      january: 0, jan: 0,
      february: 1, feb: 1,
      march: 2, mar: 2,
      april: 3, apr: 3,
      may: 4,
      june: 5, jun: 5,
      july: 6, jul: 6,
      august: 7, aug: 7,
      september: 8, sep: 8,
      october: 9, oct: 9,
      november: 10, nov: 10,
      december: 11, dec: 11,
    };
    const key = String(value || "").trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : -1;
  }

  async function checkpoint(runId = state.runToken) {
    if (runId !== state.runToken) {
      throw createControlError("reset");
    }
    while (state.executionState === "paused") {
      await sleepRaw(100);
      if (runId !== state.runToken) {
        throw createControlError("reset");
      }
    }
    if (state.executionState === "idle" && state.currentRunPayload) {
      throw createControlError("reset");
    }
  }

  function createControlError(reason) {
    const error = new Error(`Execution interrupted: ${reason}`);
    error.name = "NusukControlError";
    error.controlReason = reason;
    return error;
  }

  function isControlError(error, reason) {
    return Boolean(error && typeof error === "object" && error.name === "NusukControlError" && (!reason || error.controlReason === reason));
  }

  function sleepRaw(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  async function sleep(ms, runId = state.runToken) {
    let remaining = Math.max(0, Number(ms) || 0);
    while (remaining > 0) {
      await checkpoint(runId);
      const chunk = Math.min(120, remaining);
      await sleepRaw(chunk);
      remaining -= chunk;
    }
  }
})();
