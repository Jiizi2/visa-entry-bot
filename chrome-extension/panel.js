const STORAGE_KEY = "nusukAutofillState";

const dom = {
  uploadBtn: document.getElementById("upload-btn"),
  jsonInput: document.getElementById("json-input"),
  passportFolderBtn: document.getElementById("passport-folder-btn"),
  passportFolderInput: document.getElementById("passport-folder-input"),
  passportFilesBtn: document.getElementById("passport-files-btn"),
  passportFilesInput: document.getElementById("passport-files-input"),
  passportFilesSummary: document.getElementById("passport-files-summary"),
  memberSelect: document.getElementById("member-select"),
  startBtn: document.getElementById("start-btn"),
  pauseBtn: document.getElementById("pause-btn"),
  resetBtn: document.getElementById("reset-btn"),
  statePill: document.getElementById("state-pill"),
  progressBar: document.getElementById("progress-bar"),
  progressText: document.getElementById("progress-text"),
  statusBanner: document.getElementById("status-banner"),
  previewEmpty: document.getElementById("preview-empty"),
  previewGrid: document.getElementById("preview-grid"),
  previewIdentity: document.getElementById("preview-identity"),
  previewPassport: document.getElementById("preview-passport"),
  previewTravel: document.getElementById("preview-travel"),
  previewContact: document.getElementById("preview-contact"),
  failuresCard: document.getElementById("failures-card"),
  failuresList: document.getElementById("failures-list"),
  restartFailedBtn: document.getElementById("restart-failed-btn"),
  wsIndicator: document.getElementById("ws-indicator"),
  wsStatusTitle: document.getElementById("ws-status-title"),
  wsStatusDesc: document.getElementById("ws-status-desc"),
  wsNoticeBanner: document.getElementById("ws-notice-banner"),
  modeToggleBtn: document.getElementById("mode-toggle-btn"),
  activeMutamerName: document.getElementById("active-mutamer-name"),
  minimizeBtn: document.getElementById("minimize-btn"),
  
  // NEW DOM ELEMENTS FOR UX REDESIGN
  logList: document.getElementById("log-list"),
  clearLogsBtn: document.getElementById("clear-logs-btn"),
  copyLogsBtn: document.getElementById("copy-logs-btn"),
  failuresCountBadge: document.getElementById("failures-count-badge"),
  wsLatencyWrapper: document.getElementById("ws-latency-wrapper"),
  wsLatencyValue: document.getElementById("ws-latency-value"),
  metaPassport: document.getElementById("meta-passport"),
  metaNationality: document.getElementById("meta-nationality"),
  actionFeedbackWrap: document.getElementById("action-feedback-wrap"),
  actionStepTitle: document.getElementById("action-step-title"),
  actionStepSelector: document.getElementById("action-step-selector"),
  retryConnectBtn: document.getElementById("retry-connect-btn"),
  completedResetBtn: document.getElementById("completed-reset-btn"),
};

const state = {
  manifest: null,
  selectedMemberId: "",
  collapsed: true,
  executionState: "idle",
  panelWidth: 420,
  progress: {
    current: 0,
    total: 0,
  },
  logs: [],
  uploadFileCount: 0,
  uploadFileNames: [],
  resumeAvailable: false,
  autofillFailures: [],
  viewMode: "compact",
  revision: 0,
  connectionState: "disconnected",
  
  // STATS TRACKING FOR PREMIUM SUCCESS PAGE
  stats: {
    startTime: null,
    endTime: null,
    passengerStartTime: null,
    passengerDurations: [],
  }
};

const EXECUTION_LABELS = {
  idle: "Menunggu",
  running: "Berjalan",
  paused: "Dijeda",
  completed: "Selesai",
};

// --- WebSocket Client State & Logic ---
let socket = null;
let activeSocket = null;
let connectionSequence = 0;
let lastReceivedSequence = 0;
let heartbeatTimer = null;
let missedPings = 0;
let readyTimeoutTimer = null;
let readyRetryCount = 0;
let resumeToken = "";
let currentPortIndex = 0;
const ports = [9001, 9002, 9003, 9004, 9005];
let activeSessionId = "";
let handshakeCompleted = false;
let activeBatchMembers = [];

const telemetry = {
  reconnectCount: 0,
  recoveryStartTime: 0,
  recoveryTime: 0,
  rttValues: [],
  droppedSeq: 0,
  duplicatePackets: 0,
  heartbeatTimeout: 0,
  recoverySuccess: 0,
};

function updateTelemetryUI() {
  const reconnectEl = document.getElementById("telemetry-reconnect-count");
  const recoveryEl = document.getElementById("telemetry-recovery-time");
  const avgRttEl = document.getElementById("telemetry-avg-rtt");
  const maxRttEl = document.getElementById("telemetry-max-rtt");
  const droppedSeqEl = document.getElementById("telemetry-dropped-seq");
  const duplicateEl = document.getElementById("telemetry-duplicate-packets");
  const heartbeatEl = document.getElementById("telemetry-heartbeat-timeout");
  const recoverySuccessEl = document.getElementById("telemetry-recovery-success");

  if (reconnectEl) reconnectEl.innerText = telemetry.reconnectCount;
  if (recoveryEl) recoveryEl.innerText = telemetry.recoveryTime ? `${telemetry.recoveryTime}ms` : "0ms";
  if (droppedSeqEl) droppedSeqEl.innerText = telemetry.droppedSeq;
  if (duplicateEl) duplicateEl.innerText = telemetry.duplicatePackets;
  if (heartbeatEl) heartbeatEl.innerText = telemetry.heartbeatTimeout;
  if (recoverySuccessEl) recoverySuccessEl.innerText = telemetry.recoverySuccess;

  if (telemetry.rttValues.length > 0) {
    const sum = telemetry.rttValues.reduce((a, b) => a + b, 0);
    const avg = Math.round(sum / telemetry.rttValues.length);
    const max = Math.max(...telemetry.rttValues);
    if (avgRttEl) avgRttEl.innerText = `${avg}ms`;
    if (maxRttEl) maxRttEl.innerText = `${max}ms`;
  }
}

function connectWebSocket() {
  if (activeSocket) {
    try {
      activeSocket.onopen = null;
      activeSocket.onmessage = null;
      activeSocket.onerror = null;
      activeSocket.onclose = null;
      activeSocket.close();
    } catch (e) {}
    activeSocket = null;
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (readyTimeoutTimer) {
    clearTimeout(readyTimeoutTimer);
    readyTimeoutTimer = null;
  }

  const port = ports[currentPortIndex];
  console.log(`[Transport] Mencoba menghubungkan ke server WebSocket di ws://127.0.0.1:${port}...`);
  updateConnectionUI("connecting");
  
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  activeSocket = ws;
  
  ws.onopen = () => {
    if (ws !== activeSocket) return;
    console.log(`[Transport] Koneksi terhubung pada port ${port}!`);
    socket = ws;
    handshakeCompleted = false;
    connectionSequence = 0;
    lastReceivedSequence = 0;
    readyRetryCount = 0;
    
    updateConnectionUI("authenticating");

    // Send HELLO
    const helloMsg = {
      protocolVersion: 1,
      type: MessageType.HELLO,
      messageId: generateUuid(),
      sessionId: "",
      correlationId: generateUuid(),
      timestamp: new Date().toISOString(),
      sequence: ++connectionSequence,
      payload: {
        extensionVersion: "1.0.19",
        browser: "chrome",
        capabilities: {
          supportsDebugger: true,
          supportsScreenshot: false,
          supportsResume: true
        }
      }
    };
    ws.send(JSON.stringify(helloMsg));
    console.log(`[Protocol] Mengirim HELLO ke server.`);
  };

  ws.onmessage = (event) => {
    if (ws !== activeSocket) return;
    try {
      const envelope = JSON.parse(event.data);
      
      if (envelope.sequence && envelope.sequence <= lastReceivedSequence) {
        console.warn(`[Transport] Mengabaikan paket out-of-order: sequence ${envelope.sequence} <= ${lastReceivedSequence}`);
        if (envelope.sequence === lastReceivedSequence) {
          telemetry.duplicatePackets++;
        } else {
          telemetry.droppedSeq++;
        }
        updateTelemetryUI();
        return;
      }
      lastReceivedSequence = envelope.sequence || lastReceivedSequence;

      console.log(`[Protocol] Menerima pesan:`, envelope.type);
      
      switch (envelope.type) {
        case MessageType.HELLO_ACK:
          console.log(`[Protocol] HELLO_ACK diterima. Auth token:`, envelope.payload.authToken);
          handshakeCompleted = true;
          
          updateConnectionUI(activeSessionId ? "recovering" : "ready");
          startHeartbeat(ws);
          sendReadyMessage();
          break;
          
        case MessageType.SESSION_SNAPSHOT:
          if (readyTimeoutTimer) {
            clearTimeout(readyTimeoutTimer);
            readyTimeoutTimer = null;
          }
          console.log(`[Session] SESSION_SNAPSHOT diterima dari Desktop. Revision:`, envelope.payload.revision);
          
          if (state.revision && envelope.payload.revision < state.revision) {
            console.log(`[Session] Mengabaikan snapshot usang. Local revision: ${state.revision}, snapshot: ${envelope.payload.revision}`);
            break;
          }
          
          if (telemetry.recoveryStartTime) {
            telemetry.recoveryTime = new Date().getTime() - telemetry.recoveryStartTime;
            telemetry.recoveryStartTime = 0;
            telemetry.recoverySuccess++;
            updateTelemetryUI();
          }
          
          activeSessionId = envelope.payload.sessionId;
          resumeToken = envelope.payload.resumeToken;
          state.revision = envelope.payload.revision;
          state.progress = {
            current: envelope.payload.progressCurrent || 0,
            total: envelope.payload.progressTotal || 0,
          };
          state.executionState = envelope.payload.status ? envelope.payload.status.toLowerCase() : "idle";
          state.autofillFailures = envelope.payload.failures || [];
          
          if (envelope.payload.manifestMembers && envelope.payload.manifestMembers.length > 0) {
            state.manifest = {
              manifestVersion: "1.0.19",
              manifestPath: envelope.payload.manifestPath || "",
              members: envelope.payload.manifestMembers
            };
          }
          if (envelope.payload.currentMemberId) {
            state.selectedMemberId = envelope.payload.currentMemberId;
          }
          
          updateConnectionUI("ready");
          persistState().catch((e) => console.log("Failed to save snapshot state:", e));
          
          renderManifestSection();
          renderPreview();
          renderProgress();
          renderPassportFilesSummary();
          renderFailures();
          updateRunControls();

          // Forward to parent tab
          postToParent("NUSUK_WS_SESSION_SNAPSHOT", envelope.payload);
          break;

        case MessageType.CREATE_SESSION:
          console.log(`[Session] CREATE_SESSION diterima dari Desktop. Session ID:`, envelope.sessionId);
          activeSessionId = envelope.sessionId;
          
          const sessionCreatedMsg = {
            protocolVersion: 1,
            type: MessageType.SESSION_CREATED,
            messageId: generateUuid(),
            sessionId: envelope.sessionId,
            correlationId: envelope.correlationId || generateUuid(),
            timestamp: new Date().toISOString(),
            sequence: ++connectionSequence,
            replyToMessageId: envelope.messageId,
            payload: {
              status: "initialized"
            }
          };
          ws.send(JSON.stringify(sessionCreatedMsg));
          console.log(`[Session] Mengirim SESSION_CREATED ke Desktop.`);
          break;
          
        case MessageType.LOAD_BATCH:
          console.log(`[Session] LOAD_BATCH diterima dari Desktop. Jumlah mutamer:`, envelope.payload.members?.length || 0);
          activeBatchMembers = envelope.payload.members || [];
          
          state.manifest = {
            manifestVersion: "1.0.19",
            manifestPath: envelope.payload.manifestPath,
            members: activeBatchMembers
          };
          state.selectedMemberId = state.manifest.members[0]?.id || "";
          state.progress = { current: 0, total: 0 };
          state.revision = 0;
          persistState().catch((e) => console.log("Failed to save load batch state:", e));
          
          renderManifestSection();
          renderPreview();
          renderProgress();
          renderPassportFilesSummary();
          updateRunControls();

          postToParent("NUSUK_WS_LOAD_BATCH", { 
            members: activeBatchMembers,
            manifestPath: envelope.payload.manifestPath
          });
          
          const batchLoadedMsg = {
            protocolVersion: 1,
            type: MessageType.BATCH_LOADED,
            messageId: generateUuid(),
            sessionId: envelope.sessionId,
            correlationId: envelope.correlationId,
            timestamp: new Date().toISOString(),
            sequence: ++connectionSequence,
            replyToMessageId: envelope.messageId,
            payload: {}
          };
          ws.send(JSON.stringify(batchLoadedMsg));
          console.log(`[Session] Mengirim BATCH_LOADED ke Desktop.`);
          break;
          
        case MessageType.START:
        case MessageType.NEXT:
          console.log(`[Session] START/NEXT diterima dari Desktop.`);
          const startAckMsg = {
            protocolVersion: 1,
            type: MessageType.ACK,
            messageId: generateUuid(),
            sessionId: envelope.sessionId,
            correlationId: envelope.correlationId,
            timestamp: new Date().toISOString(),
            sequence: ++connectionSequence,
            replyToMessageId: envelope.messageId,
            payload: {}
          };
          ws.send(JSON.stringify(startAckMsg));
          
          postToParent("NUSUK_WS_START");
          break;

        case MessageType.ACK:
          console.log(`[Protocol] ACK diterima untuk pesan:`, envelope.replyToMessageId);
          break;
          
        case MessageType.PING:
          const pongMsg = {
            protocolVersion: 1,
            type: MessageType.PONG,
            messageId: generateUuid(),
            sessionId: envelope.sessionId || "",
            correlationId: envelope.correlationId || "",
            timestamp: new Date().toISOString(),
            sequence: ++connectionSequence,
            replyToMessageId: envelope.messageId,
            payload: envelope.payload || {}
          };
          ws.send(JSON.stringify(pongMsg));
          break;

        case MessageType.PONG:
          missedPings = 0;
          if (envelope.payload && envelope.payload.clientTime) {
            const rtt = new Date().getTime() - envelope.payload.clientTime;
            telemetry.rttValues.push(rtt);
            if (telemetry.rttValues.length > 50) telemetry.rttValues.shift();
            updateTelemetryUI();
            console.log(`[Transport] Menerima PONG. RTT Latency: ${rtt}ms`);
          }
          break;
          
        case MessageType.ERROR:
          console.error(`[Error] Terjadi kesalahan pada server:`, envelope.payload.message);
          break;
          
        default:
          console.warn(`[Protocol] Tipe pesan tidak dikenal:`, envelope.type);
      }
    } catch (e) {
      console.error("[Protocol] Gagal memproses pesan masuk:", e);
    }
  };

  ws.onclose = (event) => {
    if (ws !== activeSocket) return;
    console.log(`[Transport] Koneksi WebSocket ditutup pada port ${port}. Code: ${event.code}`);
    socket = null;
    activeSocket = null;
    handshakeCompleted = false;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (readyTimeoutTimer) {
      clearTimeout(readyTimeoutTimer);
      readyTimeoutTimer = null;
    }

    updateConnectionUI("disconnected");
    
    telemetry.reconnectCount++;
    updateTelemetryUI();

    currentPortIndex = (currentPortIndex + 1) % ports.length;
    setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = (error) => {
    if (ws !== activeSocket) return;
    console.error(`[Transport] Error WebSocket pada port ${port}.`);
    updateConnectionUI("disconnected");
  };
}

function sendReadyMessage() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const currentUrl = tabs && tabs[0] ? tabs[0].url : "https://masar.nusuk.sa/";
    
    const readyMsg = {
      protocolVersion: 1,
      type: MessageType.READY,
      messageId: generateUuid(),
      sessionId: activeSessionId || "",
      correlationId: generateUuid(),
      timestamp: new Date().toISOString(),
      sequence: ++connectionSequence,
      payload: {
        currentUrl: currentUrl || "https://masar.nusuk.sa/",
        sessionId: activeSessionId || "",
        resumeToken: resumeToken || ""
      }
    };
    if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
      if (activeSessionId) {
        telemetry.recoveryStartTime = new Date().getTime();
        updateTelemetryUI();
      }
      activeSocket.send(JSON.stringify(readyMsg));
      console.log(`[Protocol] Mengirim READY ke server dengan URL: ${currentUrl}`);
      
      if (activeSessionId) {
        if (readyTimeoutTimer) clearTimeout(readyTimeoutTimer);
        readyTimeoutTimer = setTimeout(() => {
          if (readyRetryCount >= 3) {
            console.error("[Session] Gagal memulihkan sesi setelah 3 kali mencoba. Menutup koneksi.");
            updateConnectionUI("disconnected");
            if (activeSocket) {
              activeSocket.close();
            }
            return;
          }
          readyRetryCount++;
          console.warn(`[Session] Timeout memulihkan sesi (percobaan ${readyRetryCount}/3). Mengirim ulang READY...`);
          sendReadyMessage();
        }, 5000);
      }
    }
  });
}

function startHeartbeat(ws) {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  missedPings = 0;
  heartbeatTimer = setInterval(() => {
    if (ws !== activeSocket || ws.readyState !== WebSocket.OPEN) {
      clearInterval(heartbeatTimer);
      return;
    }
    
    if (missedPings >= 3) {
      console.warn("[Transport] 3 pings terlewat. Menutup koneksi...");
      telemetry.heartbeatTimeout++;
      updateTelemetryUI();
      clearInterval(heartbeatTimer);
      ws.close(4001, "Ping Timeout");
      return;
    }

    if (state.connectionState === "recovering") {
      // Do not ping while recovering session snapshot
      return;
    }

    if (state.executionState === "idle" || state.executionState === "completed") {
      // Sleep heartbeat ping during idle/completed states to reduce network traffic
      missedPings = 0;
      return;
    }
    
    const pingMsg = {
      protocolVersion: 1,
      type: MessageType.PING,
      messageId: generateUuid(),
      sessionId: activeSessionId || "",
      correlationId: generateUuid(),
      timestamp: new Date().toISOString(),
      sequence: ++connectionSequence,
      payload: {
        clientTime: new Date().getTime()
      }
    };
    ws.send(JSON.stringify(pingMsg));
    missedPings++;
    console.log(`[Transport] Mengirim PING (lewat: ${missedPings})`);
  }, 5000);
}

function sendWebSocketEvent(payload) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    let type = null;
    let outPayload = {};
    
    switch (payload.eventType) {
      case "CURRENT_MEMBER":
        type = MessageType.CURRENT_MEMBER;
        outPayload = { memberId: payload.memberId };
        break;
      case "CURRENT_STEP":
        type = MessageType.CURRENT_STEP;
        outPayload = { stepName: payload.stepName };
        break;
      case "PROGRESS":
        type = MessageType.PROGRESS;
        outPayload = { 
          current: payload.current, 
          total: payload.total,
          status: payload.status,
          revision: payload.revision
        };
        break;
      case "FAILURE_UPDATED":
        type = MessageType.FAILURE_UPDATED;
        outPayload = {
          memberId: payload.memberId,
          reason: payload.reason,
          failedAt: payload.failedAt
        };
        break;
      case "MEMBER_COMPLETED":
        type = MessageType.MEMBER_COMPLETED;
        outPayload = { memberId: payload.memberId };
        break;
      case "SESSION_COMPLETED":
        type = MessageType.SESSION_COMPLETED;
        outPayload = {};
        break;
      case "STOP":
        type = MessageType.STOP;
        outPayload = {};
        break;
    }
    
    if (type) {
      const envelope = {
        protocolVersion: 1,
        type,
        messageId: generateUuid(),
        sessionId: activeSessionId,
        correlationId: generateUuid(),
        timestamp: new Date().toISOString(),
        sequence: ++connectionSequence,
        payload: outPayload
      };
      socket.send(JSON.stringify(envelope));
      console.log(`[Protocol] Meneruskan event ${type} ke Desktop.`);
    }
  }
}

function generateUuid() {
  if (self.crypto && self.crypto.randomUUID) {
    return self.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

dom.uploadBtn.addEventListener("click", () => {
  dom.jsonInput.click();
});

dom.passportFolderBtn?.addEventListener("click", () => {
  dom.passportFolderInput?.click();
});

dom.passportFilesBtn?.addEventListener("click", () => {
  dom.passportFilesInput?.click();
});

dom.passportFolderInput?.addEventListener("change", handlePassportFileSelection);
dom.passportFilesInput?.addEventListener("change", handlePassportFileSelection);

dom.jsonInput.addEventListener("change", async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) {
    return;
  }

  try {
    const raw = await file.text();
    const manifest = JSON.parse(raw);
    validateManifest(manifest);

    state.manifest = manifest;
    state.selectedMemberId = manifest.members[0]?.id || "";
    await persistState();
    renderManifestSection();
    renderPreview();
    renderPassportFilesSummary();
    updateRunControls();
    postToParent("NUSUK_PANEL_UPLOAD_MANIFEST", {
      manifest,
      selectedMemberId: state.selectedMemberId,
    });
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    dom.jsonInput.value = "";
  }
});

dom.memberSelect.addEventListener("change", async (event) => {
  state.selectedMemberId = String(event.target.value || "");
  await persistState();
  renderPreview();
  renderPassportFilesSummary();
  updateRunControls();
  postToParent("NUSUK_PANEL_SELECT_MEMBER", { memberId: state.selectedMemberId });
});

dom.modeToggleBtn?.addEventListener("click", () => {
  state.viewMode = state.viewMode === "compact" ? "expanded" : "compact";
  applyViewMode(state.viewMode);
  persistState().catch((e) => console.log("Failed to save viewMode:", e));
});

function applyViewMode(mode) {
  if (mode === "expanded") {
    document.body.classList.remove("compact-mode");
    document.body.classList.add("expanded-mode");
    if (dom.modeToggleBtn) dom.modeToggleBtn.textContent = "Ringkas";
  } else {
    document.body.classList.remove("expanded-mode");
    document.body.classList.add("compact-mode");
    if (dom.modeToggleBtn) dom.modeToggleBtn.textContent = "Detail";
  }
}

dom.startBtn.addEventListener("click", () => {
  const stateName = normalizeExecutionState(state.executionState);
  const isResume = stateName === "paused" && state.resumeAvailable;
  const manifestValidationMessage = validateManifestReadyForRun();
  if (manifestValidationMessage) {
    setStatus(manifestValidationMessage, "error");
    return;
  }
  if (!getSelectedMember() && !isResume) {
    setStatus("Pilih data jamaah sebelum menjalankan autofill.", "error");
    return;
  }
  if (!hasPassportDebuggerPathSource() && !isResume) {
    setStatus("JSON belum punya path lokal untuk upload debugger. Buat/export JSON dari PC ini, atau jangan pindahkan folder hasil scan sebelum entry.", "error");
    return;
  }
  postToParent("NUSUK_PANEL_START_AUTOFILL");
});

dom.pauseBtn.addEventListener("click", () => {
  postToParent("NUSUK_PANEL_PAUSE_AUTOFILL");
});

function handleResetAutofill() {
  // Send STOP message to desktop to close session
  sendWebSocketEvent({ eventType: "STOP" });
  
  // Clear local variables
  activeSessionId = "";
  resumeToken = "";
  state.manifest = null;
  state.selectedMemberId = "";
  state.progress = { current: 0, total: 0 };
  state.revision = 0;
  state.autofillFailures = [];
  state.logs = [];
  
  persistState().catch((e) => console.log("Failed to persist reset state:", e));
  
  // Re-render UI
  renderManifestSection();
  renderPreview();
  renderProgress();
  renderPassportFilesSummary();
  renderFailures();
  renderLogs();
  updateRunControls();
  
  // Forward reset to content script
  postToParent("NUSUK_PANEL_RESET_AUTOFILL");
}

dom.resetBtn.addEventListener("click", handleResetAutofill);
dom.completedResetBtn?.addEventListener("click", handleResetAutofill);

dom.restartFailedBtn.addEventListener("click", () => {
  postToParent("NUSUK_PANEL_RESTART_FAILED");
});

dom.clearLogsBtn?.addEventListener("click", () => {
  state.logs = [];
  renderLogs();
});

dom.copyLogsBtn?.addEventListener("click", () => {
  const logTexts = state.logs
    .map(log => `[${formatTime(log.timestamp)}] [${log.level?.toUpperCase()}] ${log.message}`)
    .join("\n");
  navigator.clipboard.writeText(logTexts)
    .then(() => {
      const originalText = dom.copyLogsBtn.textContent;
      dom.copyLogsBtn.textContent = "✓ Tersalin";
      dom.copyLogsBtn.style.color = "var(--success)";
      setTimeout(() => {
        dom.copyLogsBtn.textContent = originalText;
        dom.copyLogsBtn.style.color = "";
      }, 1500);
    })
    .catch((err) => {
      console.error("Gagal menyalin log:", err);
    });
});

dom.retryConnectBtn?.addEventListener("click", () => {
  connectWebSocket();
});

dom.minimizeBtn?.addEventListener("click", async () => {
  console.log("[SidePanel] Tombol minimize diklik. Menyimpan status ke storage.");
  const storage = getStorageLocal();
  if (storage) {
    await storage.set({ entrymate_minimized: true });
  }
  window.close();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return;
  }

  if (message.type === "NUSUK_PANEL_STATE") {
    applyIncomingState(message.payload || {});
    return;
  }

  if (message.type === "NUSUK_PANEL_PROGRESS") {
    state.progress = {
      current: Number(message.payload?.current || 0),
      total: Number(message.payload?.total || 0),
    };
    renderProgress();
    // Teruskan progress ke desktop app
    sendWebSocketEvent({
      eventType: "PROGRESS",
      current: state.progress.current,
      total: state.progress.total
    });
    return;
  }

  if (message.type === "NUSUK_PANEL_STEP") {
    if (dom.actionFeedbackWrap && dom.actionStepTitle && dom.actionStepSelector) {
      dom.actionFeedbackWrap.classList.remove("hidden");
      dom.actionStepTitle.textContent = message.payload?.action || "Mengisi formulir...";
      dom.actionStepSelector.textContent = `Input: ${message.payload?.selector || ""}`;
    }
    return;
  }

  if (message.type === "NUSUK_PANEL_LOG_APPEND") {
    if (message.payload?.entry) {
      appendLogEntry(message.payload.entry);
    }
    return;
  }

  if (message.type === "NUSUK_PANEL_LOG_RESET") {
    state.logs = [];
    renderLogs();
    return;
  }

  if (message.type === "NUSUK_PANEL_STATUS") {
    setStatus(message.payload?.message || "", message.payload?.tone || "neutral");
    return;
  }
});

init().catch((error) => {
  setStatus(error instanceof Error ? error.message : String(error), "error");
});

async function init() {
  const stored = await readStoredState();
  const saved = stored?.[STORAGE_KEY];
  if (saved) {
    if (saved.manifest && Array.isArray(saved.manifest.members)) {
      state.manifest = saved.manifest;
      state.selectedMemberId = saved.selectedMemberId || saved.manifest.members[0]?.id || "";
    }
    state.collapsed = Boolean(saved.collapsed);
    state.panelWidth = Number(saved.panelWidth || 420);
    state.viewMode = saved.viewMode || "compact";
    state.executionState = saved.executionState || "idle";
    state.progress = {
      current: Number(saved.progressCurrent || 0),
      total: Number(saved.progressTotal || 0),
    };
    state.revision = Number(saved.revision || 0);
    state.autofillFailures = Array.isArray(saved.autofillFailures) ? saved.autofillFailures : [];
    activeSessionId = saved.activeSessionId || "";
    resumeToken = saved.resumeToken || "";
  }

  applyViewMode(state.viewMode);
  renderManifestSection();
  renderPreview();
  renderProgress();
  renderPassportFilesSummary();
  renderFailures();
  updateRunControls();
  postToParent("NUSUK_PANEL_READY");

  // Bind report view button to expand and scroll to logs details accordion
  const reportViewBtn = document.getElementById("report-view-btn");
  if (reportViewBtn) {
    reportViewBtn.addEventListener("click", () => {
      const logsDetails = document.getElementById("logs-details");
      if (logsDetails) {
        logsDetails.open = true;
        logsDetails.scrollIntoView({ behavior: "smooth" });
      }
    });
  }

  // Hubungkan ke server WebSocket lokal desktop
  connectWebSocket();
}

function updateConnectionUI(connState) {
  state.connectionState = connState;
  if (!dom.wsIndicator || !dom.wsStatusTitle || !dom.wsStatusDesc || !dom.wsNoticeBanner) return;

  if (connState === "ready" || connState === "recovering") {
    dom.wsIndicator.className = "ws-indicator connected";
    dom.wsStatusTitle.innerText = connState === "recovering" ? "Desktop: Memulihkan" : "Desktop: Terhubung";
    dom.wsStatusDesc.innerText = connState === "recovering"
      ? "Sedang memulihkan sesi otomatisasi..."
      : "Sinkronisasi otomatis aktif via WebSocket.";
    dom.wsNoticeBanner.classList.remove("hidden");
  } else if (connState === "connecting" || connState === "authenticating") {
    dom.wsIndicator.className = "ws-indicator connected animate-pulse";
    dom.wsStatusTitle.innerText = "Desktop: Menyambungkan";
    dom.wsStatusDesc.innerText = connState === "authenticating"
      ? "Sedang melakukan autentikasi..."
      : "Sedang mencoba menghubungkan ke aplikasi desktop...";
    dom.wsNoticeBanner.classList.add("hidden");
    if (dom.wsLatencyWrapper) dom.wsLatencyWrapper.classList.add("hidden");
  } else {
    dom.wsIndicator.className = "ws-indicator disconnected";
    dom.wsStatusTitle.innerText = "Desktop: Terputus";
    dom.wsStatusDesc.innerText = "Hubungkan dengan membuka aplikasi desktop EntryMate.";
    dom.wsNoticeBanner.classList.add("hidden");
    if (dom.wsLatencyWrapper) dom.wsLatencyWrapper.classList.add("hidden");
  }
  
  // Refresh layout classes
  updateRunControls();
}

function applyIncomingState(payload) {
  const oldExecutionState = state.executionState;
  const oldSelectedMemberId = state.selectedMemberId;

  state.manifest = payload.manifest && Array.isArray(payload.manifest.members) ? payload.manifest : state.manifest;
  state.selectedMemberId = String(payload.selectedMemberId || state.selectedMemberId || "");
  state.collapsed = Boolean(payload.collapsed);
  state.executionState = normalizeExecutionState(payload.executionState);
  state.panelWidth = Number(payload.panelWidth || state.panelWidth || 420);
  state.progress = {
    current: Number(payload.progress?.current || 0),
    total: Number(payload.progress?.total || 0),
  };
  state.logs = Array.isArray(payload.logs) ? payload.logs.slice(-50) : state.logs;
  state.uploadFileCount = Object.prototype.hasOwnProperty.call(payload, "uploadFileCount")
    ? Number(payload.uploadFileCount || 0)
    : Number(state.uploadFileCount || 0);
  state.uploadFileNames = Array.isArray(payload.uploadFileNames)
    ? payload.uploadFileNames.slice(0, 5)
    : state.uploadFileNames;
  state.resumeAvailable = Boolean(payload.resumeAvailable);
  state.autofillFailures = Array.isArray(payload.autofillFailures) ? payload.autofillFailures : state.autofillFailures;
  state.revision = Number(payload.revision || state.revision || 0);
  if (payload.activeSessionId) {
    activeSessionId = payload.activeSessionId;
  }

  // === DYNAMIC STATS RESOLUTION & TIMING ===
  if (state.executionState === "running") {
    if (!state.stats.startTime) {
      state.stats.startTime = Date.now();
      state.stats.endTime = null;
      state.stats.passengerDurations = [];
    }
    
    if (state.selectedMemberId && state.selectedMemberId !== oldSelectedMemberId) {
      if (state.stats.passengerStartTime) {
        const duration = Date.now() - state.stats.passengerStartTime;
        state.stats.passengerDurations.push(duration);
      }
      state.stats.passengerStartTime = Date.now();
    }
  } else if (state.executionState === "completed") {
    if (state.stats.startTime && !state.stats.endTime) {
      state.stats.endTime = Date.now();
      if (state.stats.passengerStartTime) {
        const duration = Date.now() - state.stats.passengerStartTime;
        state.stats.passengerDurations.push(duration);
        state.stats.passengerStartTime = null;
      }
    }
  } else if (state.executionState === "idle") {
    state.stats.startTime = null;
    state.stats.endTime = null;
    state.stats.passengerStartTime = null;
    state.stats.passengerDurations = [];
  }

  renderManifestSection();
  renderPreview();
  renderProgress();
  renderPassportFilesSummary();
  renderLogs();
  renderFailures();
  updateRunControls();
}

async function handlePassportFileSelection(event) {
  const selectedFiles = Array.from(event.target?.files || []);
  const files = selectedFiles.filter(isPassportUploadCandidate);
  if (!files.length) {
    setStatus("Tidak ada file passport yang valid. Pilih file gambar atau PDF.", "error");
    event.target.value = "";
    return;
  }

  state.uploadFileCount = files.length;
  state.uploadFileNames = files.slice(0, 5).map((file) => file.webkitRelativePath || file.name);
  renderPassportFilesSummary();
  updateRunControls();
  const ignoredCount = selectedFiles.length - files.length;
  setStatus(`${files.length} file passport siap dipakai untuk upload.${ignoredCount > 0 ? ` ${ignoredCount} file non-passport dilewati.` : ""}`, "success");
  postToParent("NUSUK_PANEL_UPLOAD_FILES", { files });
  event.target.value = "";
}

function isPassportUploadCandidate(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  if (!name || name.endsWith(".json")) {
    return false;
  }
  return type.startsWith("image/")
    || type === "application/pdf"
    || /\.(png|jpe?g|webp|bmp|gif|pdf)$/i.test(name);
}

function renderManifestSection() {
  const members = getMembers();
  const currentOptions = Array.from(dom.memberSelect.options).map((option) => option.value);
  const nextOptions = members.map((member) => String(member.id || ""));
  const mustRebuild = currentOptions.length !== nextOptions.length
    || currentOptions.some((value, index) => value !== nextOptions[index]);

  if (mustRebuild) {
    dom.memberSelect.innerHTML = "";
    if (!members.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Belum ada JSON";
      dom.memberSelect.append(option);
    } else {
      const fragment = document.createDocumentFragment();
      for (const member of members) {
        const option = document.createElement("option");
        option.value = String(member.id || "");
        option.textContent = `${memberDisplayName(member)} | ${memberPassport(member)}`;
        fragment.append(option);
      }
      dom.memberSelect.append(fragment);
    }
  }

  if (members.length && !state.selectedMemberId) {
    state.selectedMemberId = String(members[0]?.id || "");
  }
  dom.memberSelect.value = state.selectedMemberId || "";
  dom.memberSelect.disabled = !members.length;
}

function renderPreview() {
  const member = getSelectedMember();
  if (!member) {
    dom.previewEmpty.classList.remove("hidden");
    dom.previewGrid.classList.add("hidden");
    if (dom.activeMutamerName) dom.activeMutamerName.textContent = "Belum ada proses aktif";
    if (dom.metaPassport) dom.metaPassport.textContent = "-";
    if (dom.metaNationality) dom.metaNationality.textContent = "-";
    clearPreviewBlocks();
    return;
  }

  if (dom.activeMutamerName) {
    dom.activeMutamerName.textContent = memberDisplayName(member);
  }
  if (dom.metaPassport) {
    dom.metaPassport.textContent = memberPassport(member) || "-";
  }
  if (dom.metaNationality) {
    dom.metaNationality.textContent = memberNationality(member) || "-";
  }

  dom.previewEmpty.classList.add("hidden");
  dom.previewGrid.classList.remove("hidden");

  const resolved = member.resolvedProfile || {};
  renderDefinitionList(dom.previewIdentity, [
    ["Nama Depan", resolved.firstName || ""],
    ["Nama Ayah", resolved.fatherName || ""],
    ["Nama Keluarga", resolved.familyName || ""],
    ["DOB", resolved.dob || ""],
  ]);
  renderDefinitionList(dom.previewPassport, [
    ["No Passport", resolved.passportNumber || ""],
    ["Kebangsaan", resolved.nationality || ""],
    ["Tanggal Terbit", resolved.issueDate || ""],
    ["Tanggal Expired", resolved.expiryDate || ""],
  ]);
  renderDefinitionList(dom.previewTravel, [
    ["Negara Lahir", resolved.birthCountry || ""],
    ["Kota Lahir", resolved.birthCity || ""],
    ["Pekerjaan", resolved.profession || ""],
    ["Status Nikah", resolved.maritalStatus || ""],
  ]);
  renderDefinitionList(dom.previewContact, [
    ["Email", resolved.email || ""],
    ["Mobile", resolved.mobileNumber || ""],
    ["Kota Terbit", resolved.cityOfIssued || ""],
    ["Tanggal Rilis", resolved.releaseDate || ""],
  ]);
}

function renderDefinitionList(root, items) {
  if (!root) return;
  root.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (const [label, value] of items) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value || "-";
    fragment.append(dt, dd);
  }
  root.append(fragment);
}

function renderProgress() {
  const current = Number(state.progress.current || 0);
  const total = Number(state.progress.total || 0);
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  dom.progressText.textContent = `Passport ${current} / ${total}`;
  dom.progressBar.style.width = `${percent}%`;

  const etaContainer = document.getElementById("eta-container");
  const etaAvgTimeVal = document.getElementById("eta-avg-time-val");
  const etaRemainingVal = document.getElementById("eta-remaining-val");

  if (etaContainer && etaAvgTimeVal && etaRemainingVal) {
    const remaining = total - current;
    if (state.executionState === "running" && current > 0 && remaining > 0) {
      let avgTimeMs = 15000;
      if (state.stats.passengerDurations.length > 0) {
        const sum = state.stats.passengerDurations.reduce((a, b) => a + b, 0);
        avgTimeMs = sum / state.stats.passengerDurations.length;
      }
      
      const etaMs = remaining * avgTimeMs;
      etaAvgTimeVal.textContent = `${Math.round(avgTimeMs / 1000)}s`;
      etaRemainingVal.textContent = formatDuration(etaMs);
      etaContainer.style.display = "flex";
    } else {
      etaContainer.style.display = "none";
    }
  }
}

function renderPassportFilesSummary() {
  if (!dom.passportFilesSummary) {
    return;
  }
  if (!state.uploadFileCount) {
    if (hasPassportDebuggerPathSource()) {
      dom.passportFilesSummary.textContent = "Mode path JSON aktif. Passport akan dipilih lewat Chrome debugger dari lokasi hasil export di PC ini.";
      dom.passportFilesSummary.className = "file-summary ready";
      return;
    }
    dom.passportFilesSummary.textContent = "Belum ada file passport dipilih. Untuk mode debugger, gunakan JSON yang dibuat di PC ini.";
    dom.passportFilesSummary.className = "file-summary";
    return;
  }
  const preview = state.uploadFileNames.length
    ? ` Contoh: ${state.uploadFileNames.join(", ")}${state.uploadFileCount > state.uploadFileNames.length ? ", ..." : ""}`
    : "";
  dom.passportFilesSummary.textContent = `${state.uploadFileCount} file passport dipilih.${preview}`;
  dom.passportFilesSummary.className = "file-summary ready";
}

function renderLogs() {
  dom.logList.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (const entry of state.logs) {
    fragment.append(buildLogElement(entry));
  }
  dom.logList.append(fragment);
  dom.logList.scrollTop = dom.logList.scrollHeight;
}

function appendLogEntry(entry) {
  const nearBottom = dom.logList.scrollTop + dom.logList.clientHeight >= dom.logList.scrollHeight - 24;
  dom.logList.append(buildLogElement(entry));
  while (dom.logList.children.length > 50) {
    dom.logList.removeChild(dom.logList.firstChild);
  }
  if (nearBottom) {
    dom.logList.scrollTop = dom.logList.scrollHeight;
  }
}

function buildLogElement(entry) {
  const wrapper = document.createElement("div");
  wrapper.className = `log-row ${entry.level || "info"}`;

  const level = document.createElement("span");
  level.className = "log-level";
  level.textContent = String(entry.level || "info");

  const time = document.createElement("span");
  time.className = "log-time";
  time.textContent = formatTime(entry.timestamp);

  const body = document.createElement("span");
  body.className = "log-message";
  body.textContent = entry.message || "";

  wrapper.append(level, time, body);
  return wrapper;
}

function clearPreviewBlocks() {
  if (dom.previewIdentity) dom.previewIdentity.innerHTML = "";
  if (dom.previewPassport) dom.previewPassport.innerHTML = "";
  if (dom.previewTravel) dom.previewTravel.innerHTML = "";
  if (dom.previewContact) dom.previewContact.innerHTML = "";
}

function updateRunControls() {
  const hasMember = Boolean(getSelectedMember());
  const hasPassportSource = hasPassportDebuggerPathSource();
  const stateName = normalizeExecutionState(state.executionState);
  const connState = state.connectionState;
  const canResume = stateName === "paused" && state.resumeAvailable;
  
  if (dom.statePill) {
    dom.statePill.textContent = EXECUTION_LABELS[stateName] || EXECUTION_LABELS.idle;
    dom.statePill.className = `state-pill-badge ${stateName}`;
  }

  dom.startBtn.textContent = stateName === "paused" ? "Lanjutkan" : "Mulai";
  dom.startBtn.disabled = stateName === "running" || (!canResume && (!hasMember || !hasPassportSource));
  dom.pauseBtn.disabled = stateName !== "running";
  dom.resetBtn.disabled = stateName === "idle" && state.progress.current === 0 && state.logs.length === 0;
  
  if (state.autofillFailures && state.autofillFailures.length > 0) {
    dom.failuresCard.style.display = "block";
    dom.restartFailedBtn.disabled = stateName === "running";
    if (dom.failuresCountBadge) {
      dom.failuresCountBadge.textContent = state.autofillFailures.length;
    }
  } else {
    dom.failuresCard.style.display = "none";
  }

  // Resolve body state layout class
  let bodyState = "state-idle";
  if (connState === "disconnected" && readyRetryCount >= 3) {
    bodyState = "state-error";
  } else if (connState === "recovering") {
    bodyState = "state-recovering";
  } else if (stateName === "completed") {
    bodyState = "state-completed";

    // Populate batch completion statistics
    const statsSuccessCount = document.getElementById("stats-success-count");
    const statsFailedCount = document.getElementById("stats-failed-count");
    const statsElapsedTime = document.getElementById("stats-elapsed-time");
    const statsAvgTime = document.getElementById("stats-avg-time");
    const statsReconnects = document.getElementById("stats-reconnects");

    const totalFailed = state.autofillFailures ? state.autofillFailures.length : 0;
    const totalSuccess = Math.max(0, state.progress.current - totalFailed);

    if (statsSuccessCount) statsSuccessCount.textContent = totalSuccess;
    if (statsFailedCount) statsFailedCount.textContent = totalFailed;
    
    if (statsElapsedTime) {
      const elapsed = (state.stats.endTime && state.stats.startTime) ? (state.stats.endTime - state.stats.startTime) : 0;
      statsElapsedTime.textContent = elapsed > 0 ? formatDuration(elapsed) : "-";
    }
    
    if (statsAvgTime) {
      let avgTimeMs = 0;
      if (state.stats.passengerDurations.length > 0) {
        const sum = state.stats.passengerDurations.reduce((a, b) => a + b, 0);
        avgTimeMs = sum / state.stats.passengerDurations.length;
      }
      statsAvgTime.textContent = avgTimeMs > 0 ? `${Math.round(avgTimeMs / 1000)}s` : "-";
    }
    
    if (statsReconnects) {
      statsReconnects.textContent = (typeof telemetry !== "undefined" && telemetry.reconnectCount) ? telemetry.reconnectCount : 0;
    }
  } else if (stateName === "running" || stateName === "paused") {
    bodyState = `state-${stateName}`;
  } else if (state.manifest && state.manifest.members && state.manifest.members.length > 0) {
    bodyState = "state-paused"; // Shows running view in paused state so that controls & progress are visible
  }
  
  document.body.className = bodyState;

  if (stateName !== "running" && dom.actionFeedbackWrap) {
    dom.actionFeedbackWrap.classList.add("hidden");
  }
}

function renderFailures() {
  if (!dom.failuresList) return;
  dom.failuresList.innerHTML = "";
  if (!state.autofillFailures || state.autofillFailures.length === 0) {
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const failure of state.autofillFailures) {
    const member = getMembers().find(m => String(m.id) === String(failure.memberId));
    const name = member ? memberDisplayName(member) : `ID: ${failure.memberId}`;
    
    const wrapper = document.createElement("div");
    wrapper.className = "log-row error";
    
    const label = document.createElement("span");
    label.className = "log-level";
    label.textContent = "GAGAL";
    
    const msg = document.createElement("span");
    msg.className = "log-message";
    msg.textContent = `${name} - ${failure.reason}`;
    
    wrapper.append(label, msg);
    fragment.append(wrapper);
  }
  dom.failuresList.append(fragment);
}

function setStatus(message, tone = "neutral") {
  dom.statusBanner.textContent = String(message || "");
  dom.statusBanner.className = `status-banner ${tone || "neutral"}`;
}

function getMembers() {
  return Array.isArray(state.manifest?.members) ? state.manifest.members : [];
}

function getSelectedMember() {
  return getMembers().find((member) => String(member.id || "") === String(state.selectedMemberId || "")) || null;
}

function memberDisplayName(member) {
  const resolved = member?.resolvedProfile || {};
  return [resolved.firstName || "", resolved.familyName || ""].filter(Boolean).join(" ") || "Tanpa Nama";
}

function memberPassport(member) {
  return member?.resolvedProfile?.passportNumber || member?.passportExtracted?.passportNumber || "-";
}

function memberNationality(member) {
  return member?.resolvedProfile?.nationality || member?.passportExtracted?.nationality || "-";
}

function formatTime(timestamp) {
  if (!timestamp) {
    return "";
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDuration(ms) {
  if (!ms || Number.isNaN(ms) || ms < 0) return "0s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function normalizeExecutionState(value) {
  const text = String(value || "").trim().toLowerCase();
  return ["idle", "running", "paused", "completed"].includes(text) ? text : "idle";
}

function validateManifest(manifest) {
  const validator = window.NusukAutofill?.manifestValidator;
  if (!validator?.validateManifestForEntry) {
    throw new Error("Validator manifest extension belum dimuat.");
  }
  return validator.validateManifestForEntry(manifest);
}

function validateManifestReadyForRun() {
  if (!state.manifest) {
    return "";
  }
  try {
    validateManifest(state.manifest);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function hasPassportDebuggerPathSource() {
  if (!state.manifest || !Array.isArray(state.manifest.members)) {
    return false;
  }
  const manifestPath = String(state.manifest.manifestPath || "").trim();
  const membersToRun = getMembersToRunFromSelection();
  return membersToRun.length > 0
    && membersToRun.every((member) => {
      const passportPath = String(member?.passportImagePath || "").trim();
      return Boolean(passportPath && (manifestPath || isAbsoluteWindowsPath(passportPath)));
    });
}

function isAbsoluteWindowsPath(value) {
  const text = String(value || "").trim();
  return /^[a-zA-Z]:[\\/]/.test(text) || text.startsWith("\\\\");
}

function getMembersToRunFromSelection() {
  const members = getMembers();
  if (!members.length) {
    return [];
  }
  const selectedIndex = Math.max(0, members.findIndex((member) => String(member.id || "") === String(state.selectedMemberId || "")));
  return members.slice(selectedIndex);
}

async function persistState() {
  const stored = await readStoredState();
  const previous = stored?.[STORAGE_KEY] && typeof stored[STORAGE_KEY] === "object" ? stored[STORAGE_KEY] : {};
  await writeStoredState({
    [STORAGE_KEY]: {
      ...previous,
      manifest: state.manifest,
      selectedMemberId: state.selectedMemberId,
      collapsed: state.collapsed,
      panelWidth: state.panelWidth,
      executionState: state.executionState,
      viewMode: state.viewMode,
      revision: state.revision || 0,
      activeSessionId: activeSessionId || "",
      resumeToken: resumeToken || "",
      progressCurrent: state.progress.current,
      progressTotal: state.progress.total,
      autofillFailures: state.autofillFailures || [],
    },
  });
}

async function readStoredState() {
  const storage = getStorageLocal();
  if (!storage?.get) {
    return {};
  }
  return storage.get(STORAGE_KEY);
}

async function writeStoredState(payload) {
  const storage = getStorageLocal();
  if (!storage?.set) {
    return;
  }
  await storage.set(payload);
}

function getStorageLocal() {
  return globalThis.chrome?.storage?.local || null;
}

function postToParent(type, payload = {}) {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.tabs) {
      resolve();
      return;
    }
    // Query tab aktif di jendela saat ini (paling stabil untuk mendeteksi tab asal SidePanel)
    chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
      const targetTabIds = new Set();
      if (activeTabs && activeTabs[0] && activeTabs[0].id) {
        targetTabIds.add(activeTabs[0].id);
      }
      
      // Backup: Kueri semua tab Nusuk yang cocok dengan pola URL
      chrome.tabs.query({ url: "*://*.nusuk.sa/*" }, (nusukTabs) => {
        if (nusukTabs && nusukTabs.length > 0) {
          for (const tab of nusukTabs) {
            targetTabIds.add(tab.id);
          }
        }
        
        const tabIds = Array.from(targetTabIds);
        if (tabIds.length === 0) {
          console.warn("[SidePanel] Tidak menemukan tab Nusuk untuk mengirim pesan:", type);
          resolve();
          return;
        }
        
        let completed = 0;
        for (const tabId of tabIds) {
          chrome.tabs.sendMessage(tabId, { type, payload }, () => {
            const err = chrome.runtime.lastError; // Bersihkan error jika tab tidak siap menerima
            completed++;
            if (completed === tabIds.length) {
              resolve();
            }
          });
        }
      });
    });
  });
}

// Sinkronisasi state saat tab berubah atau memuat ulang
if (typeof chrome !== "undefined" && chrome.tabs) {
  chrome.tabs.onActivated.addListener(() => {
    postToParent("NUSUK_PANEL_READY");
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete") {
      postToParent("NUSUK_PANEL_READY");
    }
  });
}
