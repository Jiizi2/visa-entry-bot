function elementFromTarget(target) {
  if (typeof Element !== "undefined" && target instanceof Element) {
    return target;
  }
  if (typeof target?.closest === "function") {
    return target;
  }
  return target?.parentElement || null;
}

function shouldStartTitlebarDrag(event) {
  if (event?.button !== 0 || event?.detail > 1) {
    return false;
  }
  return !elementFromTarget(event?.target)?.closest?.("button");
}

export function bindWindowControls({
  dom,
  appWindow = window,
  documentRef = document,
  invoke = appWindow.__TAURI__?.core?.invoke,
} = {}) {
  const isBrowserHost = Boolean(appWindow.__PASSPORT_BROWSER_BRIDGE__);
  documentRef.body?.classList.toggle("is-browser-host", isBrowserHost);

  if (isBrowserHost || typeof invoke !== "function") {
    dom?.windowTitlebar?.setAttribute?.("aria-hidden", "true");
    return { isBrowserHost, controlsEnabled: false };
  }

  dom?.windowTitlebar?.removeAttribute?.("aria-hidden");
  dom?.windowMinimizeButton?.addEventListener("click", () => {
    void invoke("window_minimize").catch(() => {});
  });
  dom?.windowMaximizeButton?.addEventListener("click", () => {
    void toggleMaximize({ dom, invoke });
  });
  dom?.windowCloseButton?.addEventListener("click", () => {
    void invoke("window_close").catch(() => {});
  });
  dom?.windowTitlebar?.addEventListener("mousedown", (event) => {
    if (!shouldStartTitlebarDrag(event)) {
      return;
    }
    void invoke("window_start_dragging").catch(() => {});
  });
  dom?.windowTitlebar?.addEventListener("dblclick", (event) => {
    if (elementFromTarget(event.target)?.closest?.("button")) {
      return;
    }
    void toggleMaximize({ dom, invoke });
  });

  return { isBrowserHost, controlsEnabled: true };
}

async function toggleMaximize({ dom, invoke }) {
  try {
    const isMaximized = await invoke("window_toggle_maximize");
    updateMaximizeButton(dom?.windowMaximizeButton, Boolean(isMaximized));
  } catch {
    updateMaximizeButton(dom?.windowMaximizeButton, false);
  }
}

export function updateMaximizeButton(button, isRestorable) {
  if (!button) {
    return;
  }
  button.classList.toggle("is-restorable", isRestorable);
  const label = isRestorable ? "Restore" : "Maximize";
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
}
