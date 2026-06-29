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
};

const EXECUTION_LABELS = {
  idle: "Menunggu",
  running: "Berjalan",
  paused: "Dijeda",
  completed: "Selesai",
};

// --- WebSocket Client State & Logic ---
let socket = null;
let currentPortIndex = 0;
const ports = [9001, 9002, 9003, 9004, 9005];
let activeSessionId = "";
let handshakeCompleted = false;
let activeBatchMembers = [];

function connectWebSocket() {
  const port = ports[currentPortIndex];
  console.log(`[Transport] Mencoba menghubungkan ke server WebSocket di ws://127.0.0.1:${port}...`);
  if (dom.wsStatusDesc) {
    dom.wsStatusDesc.innerText = `Mencoba menghubungkan ke desktop pada port ${port}...`;
  }
  
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  
  ws.onopen = () => {
    console.log(`[Transport] Koneksi terhubung pada port ${port}!`);
    socket = ws;
    handshakeCompleted = false;
    
    // Send HELLO
    const helloMsg = {
      protocolVersion: 1,
      type: MessageType.HELLO,
      messageId: generateUuid(),
      sessionId: "",
      correlationId: generateUuid(),
      timestamp: new Date().toISOString(),
      payload: {
        extensionVersion: "1.0.19",
        browser: "chrome",
        capabilities: {
          supportsDebugger: true,
          supportsScreenshot: false,
          supportsResume: false
        }
      }
    };
    ws.send(JSON.stringify(helloMsg));
    console.log(`[Protocol] Mengirim HELLO ke server.`);
    updateConnectionUI(true);
  };

  ws.onmessage = (event) => {
    try {
      const envelope = JSON.parse(event.data);
      console.log(`[Protocol] Menerima pesan:`, envelope.type);
      
      switch (envelope.type) {
        case MessageType.HELLO_ACK:
          console.log(`[Protocol] HELLO_ACK diterima. Auth token:`, envelope.payload.authToken);
          handshakeCompleted = true;
          if (dom.wsStatusDesc) {
            dom.wsStatusDesc.innerText = `Terhubung & Siap pada port ${port}.`;
          }
          
          // Query active tab URL to send READY
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const currentUrl = tabs && tabs[0] ? tabs[0].url : "https://masar.nusuk.sa/";
            
            const readyMsg = {
              protocolVersion: 1,
              type: MessageType.READY,
              messageId: generateUuid(),
              sessionId: "",
              correlationId: envelope.correlation_id || generateUuid(),
              timestamp: new Date().toISOString(),
              replyToMessageId: envelope.messageId,
              payload: {
                currentUrl: currentUrl || "https://masar.nusuk.sa/"
              }
            };
            ws.send(JSON.stringify(readyMsg));
            console.log(`[Protocol] Mengirim READY ke server dengan URL: ${currentUrl}`);
          });
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
          
          // 1. Update local SidePanel state
          state.manifest = {
            manifestVersion: "1.0.19",
            manifestPath: envelope.payload.manifestPath,
            members: activeBatchMembers
          };
          state.selectedMemberId = state.manifest.members[0]?.id || "";
          persistState().catch((e) => console.log("Failed to save load batch state:", e));
          
          renderManifestSection();
          renderPreview();
          renderProgress();
          renderPassportFilesSummary();
          updateRunControls();

          // 2. Kirim ke active tab Nusuk agar content script sinkron
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
            replyToMessageId: envelope.messageId,
            payload: {}
          };
          ws.send(JSON.stringify(pongMsg));
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
    console.log(`[Transport] Koneksi WebSocket ditutup pada port ${port}. Code: ${event.code}`);
    socket = null;
    handshakeCompleted = false;
    updateConnectionUI(false);
    if (dom.wsStatusDesc) {
      dom.wsStatusDesc.innerText = `Terputus dari port ${port} (Code: ${event.code}). Mencoba port lain...`;
    }
    
    // Putar port jika gagal, lalu hubungkan kembali
    currentPortIndex = (currentPortIndex + 1) % ports.length;
    setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = (error) => {
    console.error(`[Transport] Error WebSocket pada port ${port}.`);
    updateConnectionUI(false);
    if (dom.wsStatusDesc) {
      dom.wsStatusDesc.innerText = `Gagal koneksi ke port ${port}. Mencoba berikutnya...`;
    }
  };
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
        outPayload = { current: payload.current, total: payload.total };
        break;
      case "MEMBER_COMPLETED":
        type = MessageType.MEMBER_COMPLETED;
        outPayload = { memberId: payload.memberId };
        break;
      case "SESSION_COMPLETED":
        type = MessageType.SESSION_COMPLETED;
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

dom.resetBtn.addEventListener("click", () => {
  postToParent("NUSUK_PANEL_RESET_AUTOFILL");
});

dom.restartFailedBtn.addEventListener("click", () => {
  postToParent("NUSUK_PANEL_RESTART_FAILED");
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
  }

  applyViewMode(state.viewMode);
  renderManifestSection();
  renderPreview();
  renderProgress();
  renderPassportFilesSummary();
  renderFailures();
  updateRunControls();
  postToParent("NUSUK_PANEL_READY");

  // Hubungkan ke server WebSocket lokal desktop
  connectWebSocket();
}

function updateConnectionUI(isConnected) {
  if (isConnected) {
    dom.wsIndicator.className = "ws-indicator connected";
    dom.wsStatusTitle.innerText = "Hubungan Desktop: Terhubung";
    dom.wsStatusDesc.innerText = "Sinkronisasi otomatis aktif via WebSocket.";
    dom.wsNoticeBanner.classList.remove("hidden");
  } else {
    dom.wsIndicator.className = "ws-indicator disconnected";
    dom.wsStatusTitle.innerText = "Hubungan Desktop: Terputus";
    dom.wsStatusDesc.innerText = "Hubungkan dengan membuka aplikasi desktop EntryMate.";
    dom.wsNoticeBanner.classList.add("hidden");
  }
}

function applyIncomingState(payload) {
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
    clearPreviewBlocks();
    return;
  }

  if (dom.activeMutamerName) {
    dom.activeMutamerName.textContent = `${memberDisplayName(member)} (${memberPassport(member)})`;
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
  dom.progressText.textContent = `${current} / ${total}`;
  dom.progressBar.style.width = `${percent}%`;
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
  const canResume = stateName === "paused" && state.resumeAvailable;
  dom.statePill.textContent = EXECUTION_LABELS[stateName] || EXECUTION_LABELS.idle;
  dom.statePill.className = `state-pill ${stateName}`;

  dom.startBtn.textContent = stateName === "paused" ? "Lanjutkan" : "Mulai";
  dom.startBtn.disabled = stateName === "running" || (!canResume && (!hasMember || !hasPassportSource));
  dom.pauseBtn.disabled = stateName !== "running";
  dom.resetBtn.disabled = stateName === "idle" && state.progress.current === 0 && state.logs.length === 0;
  
  if (state.autofillFailures && state.autofillFailures.length > 0) {
    dom.failuresCard.style.display = "block";
    dom.restartFailedBtn.disabled = stateName === "running";
  } else {
    dom.failuresCard.style.display = "none";
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
  try {
    if (typeof globalThis !== "undefined" && globalThis.chrome && globalThis.chrome.storage && globalThis.chrome.storage.local) {
      return globalThis.chrome.storage.local;
    }
  } catch (e) {
    console.warn("Storage API not available in panel.js:", e);
  }
  return null;
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
