const RENDERER_HEARTBEAT_INTERVAL_MS = 10000;

export function tauriBindings(appWindow = window) {
  const tauri = appWindow.__TAURI__;
  if (!tauri?.core || !tauri?.event || !tauri?.dialog) {
    throw new Error("Binding Tauri belum tersedia di jendela aplikasi.");
  }

  return {
    invoke: tauri.core.invoke,
    listen: tauri.event.listen,
    open: tauri.dialog.open,
    convertFileSrc: typeof tauri.core.convertFileSrc === "function" ? tauri.core.convertFileSrc : null,
  };
}

export function errorMessage(error) {
  if (error instanceof Error) {
    return error.message || error.name || "Terjadi error yang tidak diketahui.";
  }
  return String(error ?? "Terjadi error yang tidak diketahui.");
}

export function closestFromEventTarget(target, selector) {
  const element = target instanceof Element ? target : target?.parentElement;
  return element?.closest?.(selector) ?? null;
}

export function startRendererKeepAlive(appWindow = window) {
  if (appWindow.__PASSPORT_BROWSER_BRIDGE__) {
    return;
  }

  const lockRequest = appWindow.navigator?.locks?.request;
  if (typeof lockRequest !== "function") {
    return;
  }

  lockRequest.call(appWindow.navigator.locks, "passport-assistant-renderer-keepalive", () => new Promise(() => {}))
    .catch(() => {});
}

export function startRendererHeartbeat(
  appWindow = window,
  intervalMs = RENDERER_HEARTBEAT_INTERVAL_MS,
) {
  if (appWindow.__PASSPORT_BROWSER_BRIDGE__) {
    return;
  }

  const invoke = appWindow.__TAURI__?.core?.invoke;
  if (typeof invoke !== "function") {
    return;
  }

  const sendHeartbeat = () => {
    invoke("renderer_heartbeat").catch(() => {});
  };

  sendHeartbeat();
  appWindow.setInterval(sendHeartbeat, intervalMs);
}
