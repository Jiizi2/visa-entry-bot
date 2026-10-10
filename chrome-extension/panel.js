const STORAGE_KEY = "entrymatePanelPreferences";
let currentTabId = null;
let panelTargetReady = false;
let panelWindowId = null;
let panelConnectionError = null;
let resolvingSubmission = false;

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
  modeToggleBtn: document.getElementById("mode-toggle-btn"),
  activeMutamerName: document.getElementById("active-mutamer-name"),
  minimizeBtn: document.getElementById("minimize-btn"),
  
  // NEW DOM ELEMENTS FOR UX REDESIGN
  logList: document.getElementById("log-list"),
  clearLogsBtn: document.getElementById("clear-logs-btn"),
  copyLogsBtn: document.getElementById("copy-logs-btn"),
  failuresCountBadge: document.getElementById("failures-count-badge"),
  metaPassport: document.getElementById("meta-passport"),
  metaNationality: document.getElementById("meta-nationality"),
  actionFeedbackWrap: document.getElementById("action-feedback-wrap"),
  actionStepTitle: document.getElementById("action-step-title"),
  actionStepSelector: document.getElementById("action-step-selector"),
  completedResetBtn: document.getElementById("completed-reset-btn"),
  batchRecovery: document.getElementById("batch-recovery"),
  batchRecoverySummary: document.getElementById("batch-recovery-summary"),
  pendingSubmissionReview: document.getElementById("pending-submission-review"),
  pendingSubmissionDetail: document.getElementById("pending-submission-detail"),
  submissionSavedBtn: document.getElementById("submission-saved-btn"),
  submissionNotSavedBtn: document.getElementById("submission-not-saved-btn"),
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
  pageStatus: 'loading',
  canNavigateToEntry: false,
  completedMemberIds: [],
  pendingSubmission: null,
  remainingMemberCount: 0,
  nextMemberId: "",
  submissionResolutionInProgress: false,
  
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

const dropZone = document.getElementById('json-drop-zone');
const importStatus = document.getElementById('json-import-status');
let importTargetTabId = null;
const fileImporter = createBatchFileImporter({
  validate: (...args) => window.NusukAutofill.manifestValidator.validateManifestForEntry(...args),
  accept: manifest => {
    if (currentTabId !== importTargetTabId) throw new Error('Tab tujuan berubah. Seret kembali file pada tab Nusuk yang ingin digunakan.');
    return postToParent('NUSUK_PANEL_UPLOAD_MANIFEST', { manifest });
  },
  blocked: () => !panelTargetReady ? 'Buka Nusuk dan tunggu panel siap sebelum memuat file JSON.' : ['running', 'paused'].includes(state.executionState) || !!state.pendingSubmission,
  notify: (message, tone) => {
    importStatus.textContent = message;
    importStatus.className = 'json-import-status ' + tone;
    importStatus.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  },
  busy: value => {
    if (value) importTargetTabId = currentTabId;
    dropZone.setAttribute('aria-busy', String(value));
    dropZone.classList.toggle('is-loading', value);
    dom.uploadBtn.disabled = value;
    document.getElementById('choose-json-btn').disabled = value;
    updateRunControls();
  },
});
fileImporter.bindDropTarget(document, dropZone);
document.getElementById('choose-json-btn').addEventListener('click', () => dom.jsonInput.click());

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

dom.jsonInput.addEventListener('change', async event => {
  await fileImporter.importFiles(event.target.files);
  dom.jsonInput.value = '';
});

dom.memberSelect.addEventListener('change', async event => {
  const response = await postToParent('NUSUK_PANEL_SELECT_MEMBER', { memberId: String(event.target.value || '') });
  if (!response.ok) dom.memberSelect.value = state.selectedMemberId;
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

function handleResetAutofill() { void postToParent('NUSUK_PANEL_RESET_AUTOFILL'); }

dom.resetBtn.addEventListener("click", handleResetAutofill);
dom.completedResetBtn?.addEventListener("click", handleResetAutofill);

dom.restartFailedBtn.addEventListener("click", () => {
  postToParent("NUSUK_PANEL_RESTART_FAILED");
});
document.getElementById('completed-retry-btn')?.addEventListener('click', () => postToParent('NUSUK_PANEL_RESTART_FAILED'));
dom.submissionSavedBtn?.addEventListener('click', () => resolveSubmission('saved'));
dom.submissionNotSavedBtn?.addEventListener('click', () => resolveSubmission('not_saved'));

async function resolveSubmission(outcome) {
  if (resolvingSubmission || !state.pendingSubmission) return;
  const pending = state.pendingSubmission;
  resolvingSubmission = true;
  updateRunControls();
  try {
    const response = await postToParent('NUSUK_PANEL_RESOLVE_SUBMISSION', {
      outcome, memberId: pending.memberId, passportNumber: pending.passportNumber, startedAt: pending.startedAt,
    });
    if (!response.ok) setStatus(response.error, 'error');
  } finally {
    resolvingSubmission = false;
    updateRunControls();
  }
}

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

  if (message.tabId == null || currentTabId == null || message.tabId !== currentTabId) return;

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
  panelWindowId = (await chrome.windows.getCurrent()).id;
  const stored = await readStoredState();
  const saved = stored?.[STORAGE_KEY];
  if (saved) {
    state.collapsed = Boolean(saved.collapsed);
    state.panelWidth = Number(saved.panelWidth || 420);
    state.viewMode = saved.viewMode || 'compact';
  }

  applyViewMode(state.viewMode);
  renderManifestSection();
  renderPreview();
  renderProgress();
  renderPassportFilesSummary();
  renderFailures();
  updateRunControls();
  await postToParent("NUSUK_PANEL_READY");

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

}

function applyIncomingState(payload) {
  const oldExecutionState = state.executionState;
  const oldSelectedMemberId = state.selectedMemberId;

  state.manifest = payload.manifest && Array.isArray(payload.manifest.members) ? payload.manifest : null;
  state.selectedMemberId = String(payload.selectedMemberId || "");
  state.pendingSubmission = payload.pendingSubmission || null;
  state.collapsed = Boolean(payload.collapsed);
  state.executionState = normalizeExecutionState(payload.executionState);
  state.pageStatus = payload.pageStatus || state.pageStatus;
  state.canNavigateToEntry = Boolean(payload.canNavigateToEntry);
  state.completedMemberIds = payload.completedMemberIds || [];
  state.remainingMemberCount = Number(payload.remainingMemberCount || 0);
  state.nextMemberId = String(payload.nextMemberId || "");
  state.submissionResolutionInProgress = Boolean(payload.submissionResolutionInProgress);
  if (state.executionState === 'paused' && state.nextMemberId) state.selectedMemberId = state.nextMemberId;
  state.panelWidth = Number(payload.panelWidth || state.panelWidth || 420);
  state.progress = {
    current: Number(payload.progress?.current || 0),
    total: Number(payload.progress?.total || 0),
  };
  state.logs = Array.isArray(payload.logs) ? payload.logs.slice(-50) : [];
  state.uploadFileCount = Object.prototype.hasOwnProperty.call(payload, "uploadFileCount")
    ? Number(payload.uploadFileCount || 0)
    : 0;
  state.uploadFileNames = Array.isArray(payload.uploadFileNames)
    ? payload.uploadFileNames.slice(0, 5)
    : [];
  state.resumeAvailable = Boolean(payload.resumeAvailable);
  state.autofillFailures = Array.isArray(payload.autofillFailures) ? payload.autofillFailures : [];
  state.revision = Number(payload.revision || 0);
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
  dom.progressText.textContent = `Tersimpan ${current} / ${total}`;
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
  const canResume = stateName === "paused" && state.resumeAvailable;
  const canStartHere = state.pageStatus === 'ready' || state.canNavigateToEntry;
  const resolving = resolvingSubmission || state.submissionResolutionInProgress;
  const needsReview = Boolean(state.pendingSubmission) && stateName !== 'running';
  if (needsReview && !dom.statusBanner.classList.contains('error')) {
    setStatus('Hasil simpan belum terkonfirmasi.', 'warning');
  } else if (canResume && ['Siap.', 'Hasil simpan belum terkonfirmasi.'].includes(dom.statusBanner.textContent)) {
    setStatus('Progres tersimpan. Siap dilanjutkan.', 'neutral');
  }
  
  if (dom.statePill) {
    dom.statePill.textContent = needsReview ? 'Perlu diperiksa' : EXECUTION_LABELS[stateName] || EXECUTION_LABELS.idle;
    dom.statePill.className = `state-pill-badge ${stateName}`;
  }

  dom.startBtn.textContent = canResume ? "Lanjutkan sisa" : "Mulai pengisian";
  dom.startBtn.disabled = !panelTargetReady || resolving || fileImporter.isImporting() || Boolean(state.pendingSubmission) || stateName === "running" || stateName === "completed" || !canStartHere || (!canResume && (!hasMember || !hasPassportSource));
  dom.pauseBtn.disabled = stateName !== "running";
  dom.resetBtn.disabled = resolving || (stateName === "idle" && !hasMember && !state.pendingSubmission);
  if (dom.completedResetBtn) dom.completedResetBtn.disabled = resolving;
  const replacingBlocked = !panelTargetReady || resolving || ["running", "paused"].includes(stateName) || Boolean(state.pendingSubmission) || fileImporter.isImporting();
  dom.uploadBtn.disabled = replacingBlocked;
  document.getElementById('choose-json-btn').disabled = replacingBlocked;
  dom.memberSelect.disabled = replacingBlocked || !hasMember;
  if (dom.passportFolderBtn) dom.passportFolderBtn.disabled = replacingBlocked;
  if (dom.passportFilesBtn) dom.passportFilesBtn.disabled = replacingBlocked;
  renderBatchRecovery(resolving);
  const intake = document.querySelector('.json-drop-section');
  if (intake) intake.hidden = ["running", "paused"].includes(stateName) || Boolean(state.pendingSubmission);
  
  if (state.autofillFailures && state.autofillFailures.length > 0) {
    dom.failuresCard.style.display = "block";
    dom.restartFailedBtn.textContent = canResume ? 'Lanjutkan sisa' : 'Ulangi yang gagal';
    dom.restartFailedBtn.disabled = !panelTargetReady || resolving || Boolean(state.pendingSubmission) || stateName === "running" || !canStartHere;
    if (dom.failuresCountBadge) {
      dom.failuresCountBadge.textContent = state.autofillFailures.length;
    }
  } else {
    dom.failuresCard.style.display = "none";
  }

  // Resolve body state layout class
  let bodyState = "state-idle";
  if (stateName === "completed") {
    bodyState = "state-completed";

    // Populate batch completion statistics
    const statsSuccessCount = document.getElementById("stats-success-count");
    const statsFailedCount = document.getElementById("stats-failed-count");
    const statsElapsedTime = document.getElementById("stats-elapsed-time");
    const statsAvgTime = document.getElementById("stats-avg-time");

    const totalFailed = state.autofillFailures ? state.autofillFailures.length : 0;
    const totalSuccess = state.completedMemberIds.length;
    const retry = document.getElementById('completed-retry-btn');
    if (retry) { retry.hidden = totalFailed === 0; retry.disabled = !panelTargetReady || resolving || Boolean(state.pendingSubmission) || !canStartHere; }

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
    
  } else if (stateName === "running" || stateName === "paused") {
    bodyState = `state-${stateName}`;
  } else if (state.pendingSubmission || (state.manifest && state.manifest.members && state.manifest.members.length > 0)) {
    bodyState = "state-paused"; // Shows running view in paused state so that controls & progress are visible
  }
  
  document.body.className = `${bodyState} ${state.viewMode}-mode`;
  document.getElementById('file-target-status').textContent = panelTargetReady ? 'Tab Nusuk · File JSON' : 'Buka tab Nusuk';
  const folder = String(state.manifest?.manifestPath || '').split(/[\\/]/).slice(-2, -1)[0];
  document.getElementById('batch-context').textContent = `${getMembers().length} jamaah · ${folder || 'Batch dari aplikasi'}`;
  const guidance = { ready: 'Data siap. Pilih “Mulai pengisian” untuk mengisi Nusuk.', login_required: 'Login ke Nusuk terlebih dahulu. Data batch tetap tersimpan.', loading: 'Menunggu halaman Nusuk selesai dimuat.', navigate_required: state.canNavigateToEntry ? 'Pilih “Mulai pengisian”. Mu’tamer List akan dibuka otomatis pada tab ini sebelum pengisian.' : 'Buka Masar Nusuk untuk memulai pengisian.' };
  document.getElementById('page-readiness').textContent = stateName === 'running' ? 'Pengisian berjalan. Anda dapat menjeda dari panel ini.' : stateName === 'paused' && state.pageStatus === 'ready' ? state.pendingSubmission ? 'Periksa hasil simpan di bawah untuk melanjutkan batch.' : 'Progres tersimpan. Pilih “Lanjutkan sisa” untuk meneruskan pengisian.' : guidance[state.pageStatus] || guidance.loading;
  const passengerLabel = document.querySelector('.passenger-card .card-label');
  if (passengerLabel) passengerLabel.textContent = stateName === 'running' ? 'Jamaah sedang diproses' : 'Jamaah berikutnya';
  if (stateName === 'idle' && state.manifest) setStatus(state.pageStatus === 'ready' ? 'Data siap untuk pengisian.' : guidance[state.pageStatus] || guidance.loading, state.pageStatus === 'ready' ? 'success' : 'warning');

  if (stateName !== "running" && dom.actionFeedbackWrap) {
    dom.actionFeedbackWrap.classList.add("hidden");
  }
}

function renderBatchRecovery(resolving) {
  if (!dom.batchRecovery) return;
  dom.batchRecovery.hidden = state.executionState === 'running' || (!state.pendingSubmission && !(state.executionState === 'paused' && state.resumeAvailable));
  const completed = new Set(state.completedMemberIds.map(String));
  const savedCount = getMembers().filter(member => completed.has(String(member.id))).length;
  dom.batchRecoverySummary.textContent = `${savedCount} paspor sudah tersimpan.${state.remainingMemberCount ? ` ${state.remainingMemberCount} paspor tersisa.` : ''} Paspor yang sudah tersimpan tidak akan diulang.`;
  dom.pendingSubmissionReview.hidden = !state.pendingSubmission;
  if (state.pendingSubmission) {
    const member = getMembers().find(item => String(item.id) === state.pendingSubmission.memberId);
    dom.pendingSubmissionDetail.textContent = `Hasil simpan belum terkonfirmasi: ${member ? memberDisplayName(member) + ' · ' : ''}${state.pendingSubmission.passportNumber}`;
  }
  dom.submissionSavedBtn.disabled = dom.submissionNotSavedBtn.disabled = !panelTargetReady || resolving || state.executionState === 'running' || !state.pendingSubmission || !state.manifest;
  dom.submissionSavedBtn.textContent = resolving ? 'Mencatat hasil...' : 'Sudah tersimpan';
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
  await writeStoredState({ [STORAGE_KEY]: { collapsed: state.collapsed, panelWidth: state.panelWidth, viewMode: state.viewMode } });
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

async function postToParent(type, payload = {}) {
  const requestedTabId = currentTabId;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'NUSUK_PANEL_COMMAND', payload: { type, payload, tabId: requestedTabId } });
    if (response?.ok !== true) throw new Error(response?.error || 'Buka Nusuk dan muat ulang tab untuk mengaktifkan extension.');
    if (currentTabId !== requestedTabId) throw new Error('Tab tujuan berubah. Seret kembali file pada tab Nusuk yang ingin digunakan.');
    if (response.tabId != null) currentTabId = response.tabId;
    if (type === 'NUSUK_PANEL_READY') {
      panelTargetReady = true;
      if (importStatus.textContent === panelConnectionError) {
        importStatus.textContent = '';
        importStatus.className = 'json-import-status';
        importStatus.setAttribute('role', 'status');
      }
      panelConnectionError = null;
    }
    if (response.panelState) applyIncomingState(response.panelState);
    updateRunControls();
    return response;
  } catch (error) {
    const rawMessage = String(error?.message || error);
    const message = /Receiving end does not exist|Extension context invalidated/i.test(rawMessage)
      ? 'EntryMate belum aktif. Muat ulang extension di chrome://extensions/, lalu muat ulang tab Nusuk dan buka kembali panel.'
      : rawMessage;
    if (currentTabId !== requestedTabId) return { ok: false, error: message };
    if (type === 'NUSUK_PANEL_READY') { panelTargetReady = false; panelConnectionError = message; updateRunControls(); }
    importStatus.textContent = message;
    importStatus.className = 'json-import-status error';
    importStatus.setAttribute('role', 'alert');
    return { ok: false, error: message };
  }
}

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  if (panelWindowId == null || windowId !== panelWindowId) return;
  currentTabId = tabId;
  panelTargetReady = false;
  applyIncomingState({ executionState: 'idle', manifest: null, pageStatus: 'loading' });
  await postToParent('NUSUK_PANEL_READY');
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete' && tabId === currentTabId) void postToParent('NUSUK_PANEL_READY');
});
