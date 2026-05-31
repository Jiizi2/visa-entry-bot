(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const {
    PANEL_FRAME_ID,
    PANEL_HOST_ID,
    PANEL_TOGGLE_ID,
    PANEL_RESIZE_HANDLE_ID,
    PANEL_ORIGIN,
    PANEL_WIDTH_MIN,
    PANEL_WIDTH_MAX,
    PANEL_WIDTH_DEFAULT,
  } = root.constants || {};
  if (!PANEL_FRAME_ID) {
    throw new Error("NusukAutofill constants were not loaded.");
  }

  function clampPanelWidth(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return PANEL_WIDTH_DEFAULT;
    }
    return Math.max(PANEL_WIDTH_MIN, Math.min(PANEL_WIDTH_MAX, Math.round(numeric)));
  }

  function createPanelShell({ state, persistState, postPanelState }) {
    let panelFrame = null;
    let panelHost = null;
    let panelToggle = null;
    let panelResizeHandle = null;
    let panelReady = false;
    let isResizingPanel = false;
    let resizeRafId = 0;
    let pendingPanelWidth = PANEL_WIDTH_DEFAULT;

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
      panelFrame.title = "Panel EntryMate By Ghaniya";
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
      await persistState();
      applyCollapsedState();
      if (announce) {
        postPanelState();
      }
    }

    async function openFromExtensionAction() {
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

    function isPanelMessageEvent(event) {
      return event.origin === PANEL_ORIGIN && event.source === panelFrame?.contentWindow;
    }

    function setReady(nextReady) {
      panelReady = Boolean(nextReady);
    }

    function isReady() {
      return Boolean(panelReady && panelFrame?.contentWindow);
    }

    function postToPanel(type, payload) {
      if (!panelFrame?.contentWindow) {
        return;
      }
      panelFrame.contentWindow.postMessage({ type, payload }, PANEL_ORIGIN);
    }

    return {
      injectPanelShell,
      setCollapsed,
      setPanelClosed,
      openFromExtensionAction,
      isPanelMessageEvent,
      setReady,
      isReady,
      postToPanel,
    };
  }

  root.panelShell = Object.freeze({
    createPanelShell,
    clampPanelWidth,
  });
})();
