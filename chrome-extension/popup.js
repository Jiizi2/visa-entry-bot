const STORAGE_KEY = "nusukAutofillState";

const elements = {
  uploadTrigger: document.getElementById("upload-trigger"),
  jsonInput: document.getElementById("json-input"),
  memberSelect: document.getElementById("member-select"),
  preview: document.getElementById("preview"),
  autofillBtn: document.getElementById("autofill-btn"),
  status: document.getElementById("status"),
};

let state = {
  manifest: null,
  selectedMemberId: "",
};

elements.uploadTrigger.addEventListener("click", () => {
  elements.jsonInput.click();
});

elements.jsonInput.addEventListener("change", async (event) => {
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
    render();
    setStatus(`${manifest.members.length} data jamaah dimuat dari ${file.name}.`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    elements.jsonInput.value = "";
  }
});

elements.memberSelect.addEventListener("change", async (event) => {
  state.selectedMemberId = String(event.target.value || "");
  await persistState();
  render();
});

elements.autofillBtn.addEventListener("click", async () => {
  const member = getSelectedMember();
  if (!member) {
    setStatus("Pilih data jamaah dulu.", true);
    return;
  }

  try {
    setStatus("Mengirim autofill ke tab Nusuk aktif...");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("No active tab found.");
    }
    if (!/^https:\/\/(.+\.)?nusuk\.sa\//i.test(String(tab.url || ""))) {
      throw new Error("Buka halaman Nusuk di tab aktif sebelum menjalankan autofill.");
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "NUSUK_AUTOFILL_MEMBER",
      payload: {
        member,
        memberIndex: 0,
        totalMembers: 1,
      },
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Content script rejected the autofill request.");
    }

    setStatus(response.message || "Autofill dimulai.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
});

init().catch((error) => {
  setStatus(error instanceof Error ? error.message : String(error), true);
});

async function init() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const saved = stored?.[STORAGE_KEY];
  if (saved?.manifest && Array.isArray(saved.manifest.members)) {
    state.manifest = saved.manifest;
    state.selectedMemberId = saved.selectedMemberId || saved.manifest.members[0]?.id || "";
  }
  render();
}

function render() {
  const manifest = state.manifest;
  const members = Array.isArray(manifest?.members) ? manifest.members : [];

  elements.memberSelect.innerHTML = "";
  if (!members.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Belum ada JSON";
    elements.memberSelect.append(option);
    elements.memberSelect.disabled = true;
    elements.autofillBtn.disabled = true;
    elements.preview.textContent = "Upload JSON untuk melihat data jamaah.";
    return;
  }

  for (const member of members) {
    const option = document.createElement("option");
    option.value = String(member.id || "");
    const resolved = member?.resolvedProfile || {};
    const label = [
      resolved.firstName || member?.passportExtracted?.firstName || "Tanpa Nama",
      resolved.familyName || member?.passportExtracted?.familyName || "",
      resolved.passportNumber || member?.passportExtracted?.passportNumber || "",
    ].filter(Boolean).join(" | ");
    option.textContent = label;
    if (option.value === state.selectedMemberId) {
      option.selected = true;
    }
    elements.memberSelect.append(option);
  }

  if (!state.selectedMemberId && members[0]?.id) {
    state.selectedMemberId = members[0].id;
    elements.memberSelect.value = state.selectedMemberId;
  }

  const member = getSelectedMember();
  elements.memberSelect.disabled = false;
  elements.autofillBtn.disabled = !member;
  elements.preview.textContent = member
    ? JSON.stringify(buildPreview(member, manifest), null, 2)
    : "Pilih jamaah untuk melihat pratinjau.";
}

function getSelectedMember() {
  const members = Array.isArray(state.manifest?.members) ? state.manifest.members : [];
  return members.find((member) => String(member.id || "") === String(state.selectedMemberId || "")) || null;
}

function buildPreview(member, manifest) {
  const resolved = member?.resolvedProfile || {};
  return {
    groupId: manifest?.groupId || "",
    id: member?.id || "",
    fileName: member?.fileName || "",
    firstName: resolved.firstName || "",
    familyName: resolved.familyName || "",
    passportNumber: resolved.passportNumber || "",
    nationality: resolved.nationality || "",
    issueDate: resolved.issueDate || "",
    releaseDate: resolved.releaseDate || "",
    expiryDate: resolved.expiryDate || "",
    birthCity: resolved.birthCity || "",
    email: resolved.email || "",
    mobileNumber: resolved.mobileNumber || "",
  };
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Root JSON harus berupa object.");
  }
  if (!Array.isArray(manifest.members) || !manifest.members.length) {
    throw new Error("JSON harus memiliki members[] yang tidak kosong.");
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
    },
  });
}

function setStatus(message, isError = false) {
  elements.status.textContent = String(message || "");
  elements.status.className = isError ? "status error" : "status";
}
