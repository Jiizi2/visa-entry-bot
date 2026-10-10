importScripts('nusuk-handoff.js');

const FILE_TARGET_KEY = 'entrymateFileTarget';
const FILE_SESSION_KEY = 'entrymateFileSession';
// Tab IDs are unique only within a browser session. Keep the worker's session
// identity in storage.session so a browser restart cannot recover another batch.
const fileSessionReady = (async () => {
  const saved = await chrome.storage.session.get(FILE_SESSION_KEY);
  const id = saved[FILE_SESSION_KEY] || crypto.randomUUID();
  if (!saved[FILE_SESSION_KEY]) await chrome.storage.session.set({ [FILE_SESSION_KEY]: id });
  return id;
})();
let targetTabId = null;
const preparingStarts = new Map();
const targetReady = chrome.storage.local.get(FILE_TARGET_KEY).then(stored => { targetTabId = stored[FILE_TARGET_KEY]?.tabId ?? null; });
const handoff = createNusukHandoff({ chrome, getTarget: () => targetTabId, setTarget: tabId => { targetTabId = tabId; }, hasSession: () => targetTabId !== null });

function notifyPanel(message, tabId = targetTabId) {
  chrome.runtime.sendMessage({ ...message, tabId }).catch(() => {});
}

async function getNusukTab(requestedId) {
  await targetReady;
  const tabs = await chrome.tabs.query({ url: 'https://*.nusuk.sa/*', ...(requestedId == null ? { currentWindow: true } : {}) });
  const tab = requestedId != null ? tabs.find(item => item.id === requestedId)
    : tabs.find(item => item.active) || tabs.find(item => item.id === targetTabId) || tabs[0];
  if (!tab) throw new Error('Buka Nusuk di browser ini, lalu buka panel EntryMate.');
  targetTabId = tab.id;
  await chrome.storage.local.set({ [FILE_TARGET_KEY]: { tabId: tab.id } });
  return tab;
}

async function sendNusukMessage(tabId, message) {
  // Only the readiness probe is safe to repeat while the content script boots.
  // Commands may already have changed a form when their response is lost.
  const retries = message.type === 'NUSUK_PANEL_READY' ? 8 : 0;
  for (let attempt = 0; ; attempt++) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      if (!/Receiving end does not exist/i.test(String(error?.message || error))) throw error;
      if (attempt >= retries) {
        throw new Error('EntryMate belum tersambung ke tab Nusuk. Muat ulang tab Nusuk, lalu buka kembali panel.');
      }
      await sleep(250);
    }
  }
}

async function sendToNusuk(type, payload = {}, requestedId) {
  const tab = await getNusukTab(requestedId);
  if (['NUSUK_PANEL_START_AUTOFILL', 'NUSUK_PANEL_RESTART_FAILED'].includes(type)) {
    const existing = preparingStarts.get(tab.id);
    if (existing) return existing.promise;
    const operation = { cancelled: false };
    operation.promise = (async () => {
      try {
        const context = await handoff.pageContext(tab);
        if (context.executionState === 'running') return { ok: true, tabId: tab.id };
        if (context.hasManifest === false) throw new Error('Seret file JSON dari halaman Entry sebelum memulai pengisian.');
        if (context.executionState === 'completed' && type !== 'NUSUK_PANEL_RESTART_FAILED') throw new Error('Batch selesai. Pilih Ulangi yang gagal jika masih ada jamaah gagal.');
        if (context.canNavigateToEntry) notifyPanel({ type: 'NUSUK_PANEL_STATUS', payload: { tone: 'neutral', message: 'Membuka Mu?tamer List. Pengisian dimulai setelah halaman siap.' } }, tab.id);
        await handoff.prepareEntry(tab, { isCancelled: () => operation.cancelled });
        if (operation.cancelled || targetTabId !== tab.id) throw new Error('Tab tujuan berubah. Pilih Mulai pengisian kembali pada tab yang digunakan.');
        const response = await sendNusukMessage(tab.id, { type, payload });
        if (response?.ok !== true) throw new Error(response?.error || 'Pengisian belum dapat dimulai.');
        return { ...response, tabId: tab.id };
      } finally { preparingStarts.delete(tab.id); }
    })();
    preparingStarts.set(tab.id, operation);
    return operation.promise;
  }
  if (['NUSUK_PANEL_RESET_AUTOFILL', 'NUSUK_PANEL_PAUSE_AUTOFILL'].includes(type)) {
    const operation = preparingStarts.get(tab.id);
    if (operation) operation.cancelled = true;
  }
  const response = await sendNusukMessage(tab.id, { type, payload });
  if (response?.ok !== true) throw new Error(response?.error || 'Halaman Nusuk belum siap. Muat ulang tab agar extension aktif.');
  return { ...response, tabId: tab.id };
}

chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId === targetTabId) { targetTabId = null; void chrome.storage.local.remove(FILE_TARGET_KEY); }
  const operation = preparingStarts.get(tabId);
  if (operation) operation.cancelled = true;
  // Each tab owns its batch and checkpoint. Closing it prevents recovery into another tab.
  void chrome.storage.local.remove(['nusukAutofillState:' + tabId, 'nusukAutofillState:' + tabId + ':pending']);
});
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(error => console.error(error));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'NUSUK_CONTENT_READY') {
    const tabId = sender.tab?.id;
    if (tabId == null) { sendResponse({ ok: false }); return false; }
    fileSessionReady.then(browserSessionId => sendResponse({ ok: true, tabId, storageKey: 'nusukAutofillState:' + tabId, browserSessionId }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'NUSUK_CONTENT_PANEL_MESSAGE') {
    const tabId = sender.tab?.id;
    if (tabId != null) notifyPanel(message.payload, tabId);
    sendResponse({ ok: tabId != null });
    return false;
  }
  if (message?.type === 'NUSUK_PANEL_COMMAND') {
    sendToNusuk(message.payload.type, message.payload.payload, message.payload.tabId)
      .then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'NUSUK_AUTOFILL_EVENT') {
    // Progress stays in this browser; it never selects or replaces a batch.
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === 'NUSUK_DEBUGGER_SET_FILE') { handleDebuggerSetFile(message, sender, sendResponse); return true; }
  if (message?.type === 'NUSUK_SET_TAB_AUTO_DISCARDABLE') { handleSetTabAutoDiscardable(message, sender, sendResponse); return true; }
  if (message?.type === 'NUSUK_CAPTURE_FAILURE_SCREENSHOT') { handleCaptureFailureScreenshot(sender, sendResponse); return true; }
  if (message?.type === 'NUSUK_OPEN_PANEL') {
    const tabId = sender.tab?.id;
    if (tabId && chrome.sidePanel?.open) {
      chrome.sidePanel.open({ tabId }).then(() => sendResponse({ ok: true })).catch(error => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    sendResponse({ ok: false, error: 'Side panel tidak tersedia.' });
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

function showTemporaryBadge(tabId, text, color) {
  chrome.action.setBadgeBackgroundColor({ tabId, color }, () => {
    void chrome.runtime.lastError;
  });
  chrome.action.setBadgeText({ tabId, text }, () => {
    void chrome.runtime.lastError;
  });
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: "" }, () => {
      void chrome.runtime.lastError;
    });
  }, 2200);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function handleCaptureFailureScreenshot(sender, sendResponse) {
  const windowId = sender?.tab?.windowId;
  if (!windowId) {
    sendResponse({ ok: false, error: "Window Nusuk tidak terdeteksi." });
    return;
  }
  chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 55 }, (dataUrl) => {
    const error = chrome.runtime.lastError;
    if (error) {
      sendResponse({ ok: false, error: error.message });
      return;
    }
    sendResponse({ ok: true, dataUrl });
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

// Keep other debugger helper functions
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
