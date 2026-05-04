chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) {
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: "NUSUK_OPEN_PANEL" }, () => {
    void chrome.runtime.lastError;
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "NUSUK_DEBUGGER_SET_FILE") {
    handleDebuggerSetFile(message, sender, sendResponse);
    return true;
  }

  if (message?.type === "NUSUK_SET_TAB_AUTO_DISCARDABLE") {
    handleSetTabAutoDiscardable(message, sender, sendResponse);
    return true;
  }

  return false;
});

function handleDebuggerSetFile(message, sender, sendResponse) {
  const tabId = sender?.tab?.id;
  const selector = String(message.payload?.selector || "").trim();
  const filePath = String(message.payload?.filePath || "").trim();
  if (!tabId || !selector || !filePath) {
    sendResponse({ ok: false, error: "Debugger upload membutuhkan tab, selector, dan file path." });
    return;
  }

  setFileInputFilesWithDebugger(tabId, selector, filePath)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
}

function handleSetTabAutoDiscardable(message, sender, sendResponse) {
  const tabId = sender?.tab?.id;
  const autoDiscardable = Boolean(message.payload?.autoDiscardable);
  if (!tabId) {
    sendResponse({ ok: false, error: "Tab Nusuk tidak terdeteksi." });
    return;
  }

  chrome.tabs.get(tabId, (tab) => {
    const error = chrome.runtime.lastError;
    if (error) {
      sendResponse({ ok: false, error: error.message });
      return;
    }
    const previousAutoDiscardable = typeof tab?.autoDiscardable === "boolean" ? tab.autoDiscardable : true;
    chrome.tabs.update(tabId, { autoDiscardable }, () => {
      const updateError = chrome.runtime.lastError;
      if (updateError) {
        sendResponse({ ok: false, error: updateError.message });
        return;
      }
      sendResponse({ ok: true, previousAutoDiscardable });
    });
  });
}

async function setFileInputFilesWithDebugger(tabId, selector, filePath) {
  const target = { tabId };
  let attached = false;
  try {
    await debuggerAttach(target);
    attached = true;
    const root = await debuggerSend(target, "DOM.getDocument", {
      depth: -1,
      pierce: true,
    });
    const node = await debuggerSend(target, "DOM.querySelector", {
      nodeId: root.root.nodeId,
      selector,
    });
    if (!node?.nodeId) {
      throw new Error("Input upload tidak ditemukan oleh debugger.");
    }
    await debuggerSend(target, "DOM.setFileInputFiles", {
      nodeId: node.nodeId,
      files: [filePath],
    });
  } finally {
    if (attached) {
      await debuggerDetach(target).catch(() => {});
    }
  }
}

function debuggerAttach(target) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(target, "1.3", () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

function debuggerDetach(target) {
  return new Promise((resolve, reject) => {
    chrome.debugger.detach(target, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

function debuggerSend(target, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(result);
    });
  });
}
