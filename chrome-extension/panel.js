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
  minimizeBtn: document.getElementById("minimize-btn"),
  closeBtn: document.getElementById("close-btn"),
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
  logList: document.getElementById("log-list"),
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
};

const EXECUTION_LABELS = {
  idle: "Menunggu",
  running: "Berjalan",
  paused: "Dijeda",
  completed: "Selesai",
};

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
  updateRunControls();
  postToParent("NUSUK_PANEL_SELECT_MEMBER", { memberId: state.selectedMemberId });
});

dom.minimizeBtn.addEventListener("click", async () => {
  state.collapsed = true;
  await persistState();
  postToParent("NUSUK_PANEL_MINIMIZE");
});

dom.closeBtn.addEventListener("click", async () => {
  state.collapsed = true;
  await persistState();
  postToParent("NUSUK_PANEL_CLOSE");
});

dom.startBtn.addEventListener("click", () => {
  const stateName = normalizeExecutionState(state.executionState);
  const isResume = stateName === "paused" && state.resumeAvailable;
  if (!getSelectedMember() && !isResume) {
    setStatus("Pilih data jamaah sebelum menjalankan autofill.", "error");
    return;
  }
  if (!state.uploadFileCount && !isResume) {
    setStatus("Pilih folder/file passport sebelum mulai.", "error");
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

window.addEventListener("message", (event) => {
  if (event.source !== window.parent) {
    return;
  }
  const message = event.data;
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
    return;
  }

  if (message.type === "NUSUK_PANEL_LOG_APPEND") {
    const entry = message.payload?.entry;
    if (entry) {
      state.logs = [...state.logs, entry].slice(-50);
      appendLogEntry(entry);
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
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const saved = stored?.[STORAGE_KEY];
  if (saved?.manifest && Array.isArray(saved.manifest.members)) {
    state.manifest = saved.manifest;
    state.selectedMemberId = saved.selectedMemberId || saved.manifest.members[0]?.id || "";
    state.collapsed = Boolean(saved.collapsed);
    state.panelWidth = Number(saved.panelWidth || 420);
  }

  renderManifestSection();
  renderPreview();
  renderProgress();
  renderPassportFilesSummary();
  renderLogs();
  updateRunControls();
  postToParent("NUSUK_PANEL_READY");
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

  renderManifestSection();
  renderPreview();
  renderProgress();
  renderPassportFilesSummary();
  renderLogs();
  updateRunControls();
}

async function handlePassportFileSelection(event) {
  const files = Array.from(event.target?.files || []);
  if (!files.length) {
    return;
  }

  state.uploadFileCount = files.length;
  state.uploadFileNames = files.slice(0, 5).map((file) => file.webkitRelativePath || file.name);
  renderPassportFilesSummary();
  updateRunControls();
  setStatus(`${files.length} file passport siap dipakai untuk upload.`, "success");
  postToParent("NUSUK_PANEL_UPLOAD_FILES", { files });
  event.target.value = "";
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
    clearPreviewBlocks();
    return;
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
    dom.passportFilesSummary.textContent = "Belum ada file passport dipilih.";
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
  dom.previewIdentity.innerHTML = "";
  dom.previewPassport.innerHTML = "";
  dom.previewTravel.innerHTML = "";
  dom.previewContact.innerHTML = "";
}

function updateRunControls() {
  const hasMember = Boolean(getSelectedMember());
  const hasUploadFiles = Number(state.uploadFileCount || 0) > 0;
  const stateName = normalizeExecutionState(state.executionState);
  const canResume = stateName === "paused" && state.resumeAvailable;
  dom.statePill.textContent = EXECUTION_LABELS[stateName] || EXECUTION_LABELS.idle;
  dom.statePill.className = `state-pill ${stateName}`;

  dom.startBtn.textContent = stateName === "paused" ? "Lanjutkan" : "Mulai";
  dom.startBtn.disabled = stateName === "running" || (!canResume && (!hasMember || !hasUploadFiles));
  dom.pauseBtn.disabled = stateName !== "running";
  dom.resetBtn.disabled = stateName === "idle" && state.progress.current === 0 && state.logs.length === 0;
  dom.minimizeBtn.disabled = state.collapsed;
  dom.minimizeBtn.setAttribute("aria-disabled", dom.minimizeBtn.disabled ? "true" : "false");
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
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Root JSON harus berupa object.");
  }
  if (!Array.isArray(manifest.members) || !manifest.members.length) {
    throw new Error("JSON harus memiliki array members yang tidak kosong.");
  }
}

async function persistState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const previous = stored?.[STORAGE_KEY] && typeof stored[STORAGE_KEY] === "object" ? stored[STORAGE_KEY] : {};
  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      ...previous,
      manifest: state.manifest,
      selectedMemberId: state.selectedMemberId,
      collapsed: state.collapsed,
      panelWidth: state.panelWidth,
      executionState: state.executionState,
    },
  });
}

function postToParent(type, payload = {}) {
  window.parent.postMessage({ type, payload }, "*");
}
