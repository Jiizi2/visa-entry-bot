const NATIVE_HOST_NAME = "com.visaentry.nusuk_bridge";
const POLL_INTERVAL_MS = 1200;
const TARGET_ORIGIN = "https://masar.nusuk.sa";
const CLIENT_ID_KEY = "nusukBridgeClientId";

async function getClientId() {
  const fromStorage = await chrome.storage.local.get([CLIENT_ID_KEY]);
  const existing = String(fromStorage[CLIENT_ID_KEY] || "").trim();
  if (existing) {
    return existing;
  }
  const next = `ext-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  await chrome.storage.local.set({ [CLIENT_ID_KEY]: next });
  return next;
}

function sendNativeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message || "Native messaging error"));
        return;
      }
      resolve(response || {});
    });
  });
}

async function findNusukTabs() {
  return chrome.tabs.query({ url: `${TARGET_ORIGIN}/*` });
}

async function registerToHost() {
  const clientId = await getClientId();
  const tabs = await findNusukTabs();
  await sendNativeMessage({
    type: "register_client",
    clientId,
    source: "extension_background",
    tabs: tabs.map((tab) => ({
      id: tab.id,
      title: tab.title || "",
      url: tab.url || "",
    })),
  });
}

async function publishEvent(eventType, payload = {}) {
  const clientId = await getClientId();
  await sendNativeMessage({
    type: "push_event",
    clientId,
    eventType,
    payload,
    source: "extension_background",
  });
}

async function dispatchCommandToTab(command) {
  const tabs = await findNusukTabs();
  if (!tabs.length) {
    await publishEvent("command_skipped_no_tab", { command });
    return;
  }
  const targetTab = tabs[0];
  const delivered = await sendBridgeCommandToTab(targetTab.id, command);
  if (!delivered) {
    await publishEvent("command_skipped_no_receiver", {
      commandId: command?.id || null,
      commandType: command?.type || null,
      tabId: targetTab.id,
    });
  }
}

function sendMessageWithAck(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        resolve({ ok: false, error: err.message || "sendMessage failed", response: null });
        return;
      }
      resolve({ ok: true, error: "", response: response || null });
    });
  });
}

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    return true;
  } catch (_error) {
    return false;
  }
}

async function sendBridgeCommandToTab(tabId, command) {
  const firstTry = await sendMessageWithAck(tabId, {
    type: "bridge_command",
    command,
  });
  if (firstTry.ok) {
    return true;
  }
  if (!/receiving end does not exist/i.test(String(firstTry.error || ""))) {
    await publishEvent("command_delivery_error", {
      commandId: command?.id || null,
      commandType: command?.type || null,
      tabId,
      message: firstTry.error,
    });
    return false;
  }

  const injected = await ensureContentScript(tabId);
  if (!injected) {
    return false;
  }

  const secondTry = await sendMessageWithAck(tabId, {
    type: "bridge_command",
    command,
  });
  if (!secondTry.ok) {
    await publishEvent("command_delivery_error", {
      commandId: command?.id || null,
      commandType: command?.type || null,
      tabId,
      message: secondTry.error,
    });
    return false;
  }
  return true;
}

async function pollCommandLoop() {
  try {
    const clientId = await getClientId();
    const response = await sendNativeMessage({
      type: "pull_command",
      clientId,
      source: "extension_background",
    });
    if (!response?.ok || !response.command) {
      return;
    }
    await publishEvent("command_received", { id: response.command.id, commandType: response.command.type });
    await dispatchCommandToTab(response.command);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await publishEvent("native_host_error", { message });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void registerToHost();
});

chrome.runtime.onStartup.addListener(() => {
  void registerToHost();
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && String(tab.url || "").startsWith(TARGET_ORIGIN)) {
    void registerToHost();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return;
  }
  if (message.type === "content_event") {
    void publishEvent(message.eventType || "content_event", message.payload || {});
    sendResponse({ ok: true });
  }
});

setInterval(() => {
  void pollCommandLoop();
}, POLL_INTERVAL_MS);

void registerToHost();
