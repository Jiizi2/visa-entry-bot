import assert from "node:assert/strict";
import test from "node:test";

import {
  createImportWorkflow,
  normalizePathForCompare,
} from "../src/features/import/flow.js";

function createClassList() {
  const classes = new Set(["is-hidden"]);
  return {
    add: (className) => classes.add(className),
    remove: (className) => classes.delete(className),
    contains: (className) => classes.has(className),
  };
}

function createButton() {
  return {
    attrs: {},
    focusCount: 0,
    textContent: "",
    focus() {
      this.focusCount += 1;
    },
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
  };
}

function createModal() {
  return {
    attrs: {},
    classList: createClassList(),
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
  };
}

function createWorkflowFixture(overrides = {}) {
  const state = {
    activeFieldCategory: "identity",
    activeMemberId: "",
    currentPage: "import",
    errorCount: 0,
    exportError: "",
    exportedBatchPath: "",
    isChoosingFolder: false,
    isPreparingImages: false,
    isScanning: false,
    isStartingScan: false,
    isStoppingScan: false,
    lastScanMetric: null,
    lastWorkerMessage: "",
    manifest: null,
    manifestPath: "",
    originalManifest: null,
    ocrMode: "speed",
    passportListPage: 1,
    activePreparedItemId: "",
    preparedImageCache: new Map(),
    preparedSession: null,
    progressCurrent: 0,
    progressFileName: "",
    progressStageLabel: "",
    progressTotal: 0,
    recentBatches: [],
    resultDir: "",
    resultSourceDir: "",
    reviewCount: 0,
    reviewedMemberIds: new Set(),
    scanLogs: [],
    scanMetricRecords: [],
    scanPerfSummary: null,
    selectedDir: "",
    selectedIds: new Set(),
    statusDetail: "",
    statusHeadline: "",
    totalFiles: 0,
    validationFilter: "all",
    validCount: 0,
    ...overrides.state,
  };
  const dom = {
    folderPath: { value: "C:/batch-a" },
    ...overrides.dom,
  };
  const calls = {
    appendScanLog: [],
    findManifestPath: [],
    openFolderDialog: [],
    prepareImagesCommand: [],
    rememberRecentBatch: [],
    renderAll: 0,
    setPage: [],
    startScanCommand: [],
    stopScanCommand: 0,
    updateOcrMode: [],
  };
  const actions = createImportWorkflow({
    dom,
    state,
    windowRef: { confirm: () => true },
    requestFrame: (callback) => callback(),
    runAction: (action) => action(),
    renderAll: () => {
      calls.renderAll += 1;
    },
    setPage: (page) => {
      calls.setPage.push(page);
      state.currentPage = page;
    },
    appendScanLog: (message) => {
      calls.appendScanLog.push(message);
    },
    rememberRecentBatch: (...args) => {
      calls.rememberRecentBatch.push(args);
    },
    loadManifest: async () => {
      state.manifest = { members: [{ id: "member-1" }, { id: "member-2" }] };
    },
    recalculateMetrics: () => {
      state.totalFiles = Array.isArray(state.manifest?.members) ? state.manifest.members.length : 0;
    },
    manifestMembers: () => Array.isArray(state.manifest?.members) ? state.manifest.members : [],
    updateOcrMode: (mode) => {
      calls.updateOcrMode.push(mode);
      state.ocrMode = mode;
    },
    openFolderDialog: async (options) => {
      calls.openFolderDialog.push(options);
      return "C:/chosen";
    },
    prepareImagesCommand: async (payload) => {
      calls.prepareImagesCommand.push(payload);
      return {
        selectedDir: payload.selectedDir,
        preparedManifestPath: `${payload.selectedDir}/.passport-assistant-prepared/prepared-inputs.json`,
        convertedCount: 0,
        items: [{ id: "prep-0001", fileName: "passport.jpg" }],
      };
    },
    startScanCommand: async (payload) => {
      calls.startScanCommand.push(payload);
    },
    stopScanCommand: async () => {
      calls.stopScanCommand += 1;
    },
    findManifestPath: async (basePath) => {
      calls.findManifestPath.push(basePath);
      return "C:/batch-a/output/manifest.json";
    },
    ...overrides.dependencies,
  });

  return { actions, calls, dom, state };
}

test("normalizePathForCompare normalizes slashes case and trailing separators", () => {
  assert.equal(normalizePathForCompare("C:/Batch/A/"), "c:\\batch\\a");
  assert.equal(normalizePathForCompare(" C:\\Batch\\A\\ "), "c:\\batch\\a");
});

test("import workflow updates selected folder conflict state", () => {
  const { actions, state } = createWorkflowFixture({
    state: {
      manifest: { members: [{ id: "member-1" }] },
      manifestPath: "C:/old/output/manifest.json",
      resultSourceDir: "C:/old",
      selectedDir: "C:/old",
    },
  });

  assert.equal(actions.hasScanResultForPath("C:/old/"), true);
  actions.updateSelectedDir("C:/new");

  assert.equal(state.selectedDir, "C:/new");
  assert.equal(state.statusHeadline, "Folder diubah");
  assert.match(state.statusDetail, /old ke new/);
  assert.equal(state.currentPage, "import");
});

test("import workflow starts scan from folder input", async () => {
  const { actions, calls, state } = createWorkflowFixture({
    state: {
      preparedSession: {
        selectedDir: "C:/batch-a",
        preparedManifestPath: "C:/batch-a/.passport-assistant-prepared/prepared-inputs.json",
        items: [{ id: "prep-0001" }],
      },
    },
  });

  await actions.handleStartScanButtonClick();

  assert.equal(state.selectedDir, "C:/batch-a");
  assert.equal(state.isScanning, true);
  assert.equal(state.isStartingScan, true);
  assert.equal(state.currentPage, "scan");
  assert.deepEqual(calls.startScanCommand, [{
    selectedDir: "C:/batch-a",
    ocrMode: "speed",
    preparedManifestPath: "C:/batch-a/.passport-assistant-prepared/prepared-inputs.json",
  }]);
  assert.deepEqual(calls.updateOcrMode, ["speed"]);
  assert.match(calls.appendScanLog.join("\n"), /Mode OCR: Speed/);
});

test("import workflow prepares images before first scan click", async () => {
  const { actions, calls, state } = createWorkflowFixture();

  await actions.handleScanButtonClick();

  assert.equal(state.isScanning, false);
  assert.equal(state.preparedSession.preparedManifestPath, "C:/batch-a/.passport-assistant-prepared/prepared-inputs.json");
  assert.equal(state.activePreparedItemId, "prep-0001");
  assert.equal(state.currentPage, "prepare");
  assert.deepEqual(calls.prepareImagesCommand, [{ selectedDir: "C:/batch-a" }]);
  assert.deepEqual(calls.startScanCommand, []);
});

test("import workflow keeps dialog folder selection before prepare starts", async () => {
  const { actions, calls, dom, state } = createWorkflowFixture({
    dom: {
      folderPath: { value: "" },
    },
  });

  await actions.chooseFolder();

  assert.equal(state.selectedDir, "C:/chosen");
  assert.equal(dom.folderPath.value, "C:/chosen");
  assert.deepEqual(calls.prepareImagesCommand, [{ selectedDir: "C:/chosen" }]);
  assert.equal(state.currentPage, "prepare");
});

test("import workflow resolves rescan modal promise", async () => {
  const dom = {
    folderPath: { value: "C:/new" },
    rescanCancelButton: createButton(),
    rescanConfirmButton: createButton(),
    rescanConfirmModal: createModal(),
    rescanModalDesc: { textContent: "" },
    rescanModalTitle: { textContent: "" },
  };
  const { actions } = createWorkflowFixture({
    dom,
    state: {
      resultSourceDir: "C:/old",
      selectedDir: "C:/new",
    },
  });

  const confirmation = actions.requestRescanConfirmation("replace-folder");
  assert.equal(dom.rescanModalTitle.textContent, "Ganti folder aktif?");
  assert.match(dom.rescanModalDesc.textContent, /old.*new/);
  assert.equal(dom.rescanConfirmButton.focusCount, 1);

  actions.resolveRescanConfirmation(true);

  assert.equal(await confirmation, true);
  assert.equal(dom.rescanConfirmModal.classList.contains("is-hidden"), true);
  assert.equal(dom.rescanConfirmModal.attrs["aria-hidden"], "true");
});

test("import workflow opens recent batch from stored manifest path", async () => {
  const { actions, calls, state } = createWorkflowFixture({
    state: {
      recentBatches: [{
        path: "C:/batch-a",
        manifestPath: "C:/batch-a/output/manifest.json",
      }],
    },
  });

  await actions.openRecentBatch("C:/batch-a");

  assert.equal(state.manifestPath, "C:/batch-a/output/manifest.json");
  assert.equal(state.resultDir, "C:/batch-a/output");
  assert.equal(state.resultSourceDir, "C:/batch-a");
  assert.equal(state.totalFiles, 2);
  assert.equal(state.progressStageLabel, "Data dimuat dari riwayat");
  assert.deepEqual(calls.setPage, ["validation"]);
  assert.deepEqual(calls.rememberRecentBatch.at(-1), [
    "C:/batch-a",
    2,
    "C:/batch-a/output/manifest.json",
  ]);
  assert.deepEqual(calls.findManifestPath, []);
});
