importScripts('content/protocol-types.js');
importScripts('desktop-transport.js');
importScripts('nusuk-handoff.js');

const DESKTOP_STORAGE_KEY = 'entrymateDesktopTransport';
const RECONNECT_ALARM = 'entrymate-desktop-reconnect';
let desktopTransport = null;
let targetTabId = null;
let targetChosen = false;
const preparingStarts = new Map();
const handoff = createNusukHandoff({
  chrome, getTarget: () => targetChosen ? targetTabId : null,
  setTarget: tabId => { targetTabId = tabId; targetChosen = true; },
  hasSession: () => !!desktopTransport?.getState().activeSessionId,
});

function notifyPanel(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

async function getNusukTab() {
  const tabs = await chrome.tabs.query({ url: 'https://*.nusuk.sa/*' });
  if (desktopTransport?.getState().activeSessionId && !tabs.some(item => item.id === targetTabId)) return undefined;
  const tab = tabs.find(item => item.id === targetTabId) || tabs.find(item => item.active) || tabs[0];
  targetTabId = tab?.id ?? null;
  return tab;
}

async function sendToNusuk(type, payload = {}) {
  const tab = await getNusukTab();
  if (!tab) return false;
  if (['NUSUK_PANEL_START_AUTOFILL', 'NUSUK_PANEL_RESTART_FAILED', 'NUSUK_WS_START'].includes(type)) {
    const existing = preparingStarts.get(tab.id);
    if (existing) return existing.promise;
    const operation = { cancelled: false };
    operation.promise = (async () => {
      try {
        const context = await handoff.pageContext(tab);
        if (context.executionState === 'running') return true;
        if (context.hasManifest === false) throw new Error('Kirim data batch dari aplikasi sebelum memulai pengisian.');
        if (context.executionState === 'completed' && type !== 'NUSUK_PANEL_RESTART_FAILED') throw new Error('Batch selesai. Pilih Ulangi yang gagal jika masih ada jamaah gagal.');
        if (context.canNavigateToEntry) notifyPanel({ type: 'NUSUK_PANEL_STATUS', payload: { tone: 'neutral', message: 'Membuka Mu’tamer List. Pengisian dimulai setelah halaman siap.' } });
        await handoff.prepareEntry(tab, { isCancelled: () => operation.cancelled });
        if (operation.cancelled || targetTabId !== tab.id) throw new Error('Tab tujuan berubah. Pilih Mulai pengisian kembali pada tab yang digunakan.');
        const response = await chrome.tabs.sendMessage(tab.id, { type, payload });
        if (response?.ok === false) throw new Error(response.error || 'Pengisian belum dapat dimulai.');
        return true;
      } catch (error) {
        notifyPanel({ type: 'NUSUK_PANEL_STATUS', payload: { tone: 'error', message: error.message } });
        return false;
      } finally { preparingStarts.delete(tab.id); }
    })();
    preparingStarts.set(tab.id, operation);
    return operation.promise;
  }
  if (['NUSUK_PANEL_RESET_AUTOFILL', 'NUSUK_PANEL_PAUSE_AUTOFILL'].includes(type)) {
    const operation = preparingStarts.get(tab.id);
    if (operation) operation.cancelled = true;
  }
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type, payload });
    if (response?.ok === false) throw new Error(response.error || 'Perintah belum dapat dijalankan.');
    return true;
  } catch (error) {
    notifyPanel({ type: 'NUSUK_PANEL_STATUS', payload: { tone: 'error', message: error.message || 'Halaman Nusuk belum siap. Muat ulang tab Nusuk agar extension aktif.' } });
    return false;
  }
}

const desktopReady = chrome.storage.local.get(DESKTOP_STORAGE_KEY).then(async stored => {
  const initial = stored[DESKTOP_STORAGE_KEY] || {};
  targetTabId = initial.targetTabId ?? null;
  targetChosen = initial.targetChosen === true || !!initial.activeSessionId;
  desktopTransport = createDesktopTransport({
    WebSocket,
    version: chrome.runtime.getManifest().version,
    initial,
    getUrl: async () => (await getNusukTab())?.url || 'https://masar.nusuk.sa/',
    save: value => chrome.storage.local.set({ [DESKTOP_STORAGE_KEY]: { ...value, targetTabId, targetChosen } }),
    notify: payload => notifyPanel({ type: 'NUSUK_DESKTOP_STATE', payload }),
    deliver: async envelope => {
      if (envelope.type !== 'LOAD_BATCH') notifyPanel({ type: 'NUSUK_DESKTOP_MESSAGE', payload: envelope });
      if (['GET_NUSUK_CONTEXT', 'OPEN_NUSUK'].includes(envelope.type)) {
        try {
          const context = envelope.type === 'OPEN_NUSUK' ? await handoff.open(envelope.payload.tabId, envelope.payload.preserveSession !== false) : await handoff.list();
          desktopTransport.reply('NUSUK_CONTEXT', { ...context, sessionId: desktopTransport.getState().activeSessionId }, envelope.messageId, envelope.correlationId);
        } catch (error) {
          desktopTransport.reply('ERROR', { code: 'ERR_NUSUK_TAB', message: error.message, recoverable: true }, envelope.messageId, envelope.correlationId);
        }
        return true;
      }
      if (envelope.type === 'LOAD_BATCH') {
        // A newly opened tab may still be loading its content scripts.
        const deadline = Date.now() + 16000;
        do {
          const tab = await getNusukTab();
          if (!tab) break;
          try {
            const response = await chrome.tabs.sendMessage(tab.id, { type: 'NUSUK_WS_LOAD_BATCH', payload: { ...envelope.payload, sessionId: envelope.sessionId } });
            if (response?.ok) { targetChosen = true; notifyPanel({ type: 'NUSUK_DESKTOP_MESSAGE', payload: envelope }); return true; }
            if (response?.ok === false) {
              desktopTransport.reply('ERROR', { code: 'ERR_BATCH_NOT_ACCEPTED', message: response.error || 'Data batch belum siap untuk pengisian.', recoverable: true }, envelope.messageId, envelope.correlationId);
              return false;
            }
          } catch (_) { /* Wait for CONTENT_READY without reloading the tab. */ }
          await sleep(400);
        } while (Date.now() < deadline);
        desktopTransport.reply('ERROR', { code: 'ERR_BATCH_NOT_ACCEPTED', message: 'Tab Nusuk belum menerima data. Tunggu halaman selesai dimuat atau muat ulang tab untuk mengaktifkan extension, lalu coba lagi.', recoverable: true }, envelope.messageId, envelope.correlationId);
        return false;
      }
      const commands = {
        SESSION_SNAPSHOT: 'NUSUK_WS_SESSION_SNAPSHOT',
        LOAD_BATCH: 'NUSUK_WS_LOAD_BATCH',
        START: 'NUSUK_WS_START', NEXT: 'NUSUK_WS_START',
        PAUSE: 'NUSUK_PANEL_PAUSE_AUTOFILL', STOP: 'NUSUK_PANEL_RESET_AUTOFILL',
      };
      return commands[envelope.type] ? sendToNusuk(commands[envelope.type], { ...envelope.payload, sessionId: envelope.sessionId || envelope.payload.sessionId }) : true;
    },
  });
  // Alarms wake the worker again if Chrome suspends it while desktop is closed.
  await chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 1 });
  desktopTransport.connect();
  return desktopTransport;
}).catch(error => console.error('[Transport] Gagal memulai koneksi desktop:', error));

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === RECONNECT_ALARM) void desktopReady.then(transport => transport?.connect());
});
chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId === targetTabId) { targetTabId = null; targetChosen = false; }
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (['NUSUK_DESKTOP_GET_STATE', 'NUSUK_DESKTOP_RECONNECT', 'NUSUK_CONTENT_READY', 'NUSUK_CONTENT_PANEL_MESSAGE', 'NUSUK_WS_EVENT', 'NUSUK_PANEL_STATE', 'NUSUK_PANEL_COMMAND'].includes(message?.type)) {
    desktopReady.then(async transport => {
      if (!transport) throw new Error('Koneksi desktop belum dapat dimulai.');
      const senderTabId = sender?.tab?.id;
      if (message.type === 'NUSUK_CONTENT_PANEL_MESSAGE') {
        if (senderTabId !== targetTabId) { sendResponse({ ok: false }); return; }
        message = message.payload;
        notifyPanel(message);
      }
      if (message.type === 'NUSUK_CONTENT_READY') {
        if ((!targetChosen && !transport.getState().activeSessionId) || targetTabId === senderTabId) targetTabId = senderTabId;
        if (targetTabId === senderTabId && transport.getSnapshot()) {
          await chrome.tabs.sendMessage(senderTabId, { type: 'NUSUK_WS_SESSION_SNAPSHOT', payload: transport.getSnapshot() });
        }
      } else if (message.type === 'NUSUK_WS_EVENT') {
        // Events from another Nusuk tab must not change the active entry session.
        if (senderTabId !== undefined && targetTabId !== null && senderTabId !== targetTabId) {
          sendResponse({ ok: false });
          return;
        }
        transport.sendEvent(message.payload);
      } else if (message.type === 'NUSUK_PANEL_STATE') {
        const status = message.payload?.executionState?.toUpperCase();
        const snapshot = transport.getSnapshot();
        if (senderTabId === targetTabId && snapshot && ['RUNNING', 'PAUSED'].includes(status) && snapshot.status !== status) {
          transport.sendEvent({ eventType: 'PROGRESS', current: message.payload.progress?.current || 0, total: message.payload.progress?.total || 0, revision: message.payload.revision || 0, status });
        }
      } else if (message.type === 'NUSUK_PANEL_COMMAND') {
        if (!await sendToNusuk(message.payload.type, message.payload.payload)) throw new Error('Periksa halaman Nusuk dan coba lagi.');
      }
      transport.connect();
      sendResponse({ ok: true, isTarget: senderTabId === targetTabId, payload: transport.getState(), snapshot: transport.getSnapshot() });
    }).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "NUSUK_DEBUGGER_SET_FILE") {
    handleDebuggerSetFile(message, sender, sendResponse);
    return true;
  }

  if (message?.type === "NUSUK_SET_TAB_AUTO_DISCARDABLE") {
    handleSetTabAutoDiscardable(message, sender, sendResponse);
    return true;
  }

  if (message?.type === "NUSUK_CAPTURE_FAILURE_SCREENSHOT") {
    handleCaptureFailureScreenshot(sender, sendResponse);
    return true;
  }

  if (message?.type === "NUSUK_OPEN_PANEL") {
    const tabId = sender?.tab?.id;
    if (tabId && chrome.sidePanel && chrome.sidePanel.open) {
      chrome.sidePanel.open({ tabId })
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }
    sendResponse({ ok: false, error: "SidePanel API not supported or tabId missing." });
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
