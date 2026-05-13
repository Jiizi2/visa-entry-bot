(() => {
  if (window.__TAURI__) {
    return;
  }

  const listeners = new Map();

  async function requestJson(path, payload) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok === false) {
      throw new Error(body?.error || `Request gagal: ${response.status}`);
    }
    return body.result ?? null;
  }

  function addListener(eventName, callback) {
    const callbacks = listeners.get(eventName) || new Set();
    callbacks.add(callback);
    listeners.set(eventName, callbacks);
    return () => {
      callbacks.delete(callback);
      if (!callbacks.size) {
        listeners.delete(eventName);
      }
    };
  }

  function dispatchEvent(eventName, payload) {
    const callbacks = listeners.get(eventName);
    if (!callbacks?.size) {
      return;
    }
    for (const callback of callbacks) {
      callback({ event: eventName, payload });
    }
  }

  const events = new EventSource("/api/events");
  events.addEventListener("scan-event", (event) => {
    try {
      dispatchEvent("scan-event", JSON.parse(event.data));
    } catch {
      dispatchEvent("scan-event", {
        event: "scan_error",
        code: "BROWSER_BRIDGE_EVENT_PARSE_FAILED",
        message: "Event scan dari backend lokal tidak bisa dibaca.",
        stage: "browser_bridge",
        fatal: false,
      });
    }
  });
  events.addEventListener("error", () => {
    dispatchEvent("scan-event", {
      event: "scan_log",
      message: "Koneksi backend lokal belum siap atau terputus. Jalankan ulang npm run browser jika perlu.",
    });
  });

  window.__TAURI__ = {
    core: {
      invoke(command, args = {}) {
        return requestJson("/api/invoke", { command, args });
      },
      convertFileSrc(filePath) {
        return `/api/file?path=${encodeURIComponent(String(filePath ?? ""))}`;
      },
    },
    dialog: {
      open(options = {}) {
        return requestJson("/api/open-directory", { options });
      },
    },
    event: {
      async listen(eventName, callback) {
        return addListener(eventName, callback);
      },
    },
  };
})();
