function emitToBackground(eventType, payload = {}) {
  try {
    chrome.runtime.sendMessage({
      type: "content_event",
      eventType,
      payload,
    });
  } catch (_error) {
    // Ignore transient bridge failures.
  }
}

async function runCommand(command) {
  const commandType = String(command?.type || "").trim();
  const payload = command?.payload && typeof command.payload === "object" ? command.payload : {};

  if (!commandType) {
    emitToBackground("command_invalid", { reason: "empty_type" });
    return;
  }

  if (commandType === "ping") {
    emitToBackground("pong", {
      href: window.location.href,
      title: document.title,
    });
    return;
  }

  if (commandType === "navigate") {
    const targetUrl = String(payload.url || "").trim();
    if (!targetUrl) {
      emitToBackground("command_invalid", { reason: "missing_url" });
      return;
    }
    window.location.href = targetUrl;
    return;
  }

  if (commandType === "fill_member_stub") {
    const fields = Array.isArray(payload.fields) ? payload.fields : [];
    let filled = 0;
    for (const field of fields) {
      const selector = String(field?.selector || "").trim();
      const value = String(field?.value || "");
      if (!selector) {
        continue;
      }
      const element = document.querySelector(selector);
      if (!element || !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
        continue;
      }
      element.focus();
      element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      filled += 1;
    }
    emitToBackground("fill_member_stub_done", { filled });
    return;
  }

  emitToBackground("command_unknown", { commandType });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object" || message.type !== "bridge_command") {
    return;
  }

  void runCommand(message.command)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      const messageText = error instanceof Error ? error.message : String(error);
      emitToBackground("command_error", { message: messageText });
      sendResponse({ ok: false, error: messageText });
    });

  return true;
});

emitToBackground("content_ready", {
  href: window.location.href,
  title: document.title,
});
