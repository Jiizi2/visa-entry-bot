import assert from "node:assert/strict";
import test from "node:test";

import { bindActions } from "../src/main-actions.js";

function fakeNode(dataset = {}) {
  const listeners = new Map();
  return {
    dataset,
    value: "",
    classList: {
      contains: () => true,
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    dispatch(type, event = {}) {
      const handler = listeners.get(type);
      assert.equal(typeof handler, "function", `missing ${type} handler`);
      handler({
        target: this,
        preventDefault: () => {},
        stopPropagation: () => {},
        ...event,
      });
    },
  };
}

function fakeDom() {
  return {
    navButtons: [fakeNode({ page: "entry" })],
    folderPath: fakeNode(),
    chooseFolderButton: fakeNode(),
    folderDropzone: fakeNode(),
    scanButton: fakeNode(),
    ocrModeInputs: [fakeNode()],
    entryDefaultInputs: [fakeNode({ entryDefaultKey: "profession" })],
    applyEntryDefaultsButton: fakeNode(),
    stopScanButton: fakeNode(),
    importNextButton: fakeNode(),
    rescanConfirmButton: fakeNode(),
    rescanCancelButton: fakeNode(),
    rescanConfirmModal: fakeNode(),
    stopScanConfirmButton: fakeNode(),
    stopScanCancelButton: fakeNode(),
    stopScanConfirmModal: fakeNode(),
    recentDeleteConfirmButton: fakeNode(),
    recentDeleteCancelButton: fakeNode(),
    recentDeleteModal: fakeNode(),
    recentEditSaveButton: fakeNode(),
    recentEditCancelButton: fakeNode(),
    recentEditModal: fakeNode(),
    recentEditInput: fakeNode(),
    passportDeleteConfirmButton: fakeNode(),
    passportDeleteCancelButton: fakeNode(),
    passportDeleteModal: fakeNode(),
    reviewCompleteCancelButton: fakeNode(),
    reviewCompleteExportButton: fakeNode(),
    reviewPreviewExportButton: fakeNode(),
    reviewCompleteModal: fakeNode(),
    entryBackReviewButton: fakeNode(),
    prepareEntryButton: fakeNode(),
    openJsonLocationButton: fakeNode(),
    reviewExportPreviewBody: fakeNode(),
    entryExportPreviewBody: fakeNode(),
    entryLogClearButton: fakeNode(),
    scanLogToggle: fakeNode(),
    recentBatchesList: fakeNode(),
    filterButtons: [fakeNode({ validationFilter: "valid" })],
    passportList: fakeNode(),
    fieldReviewRows: fakeNode(),
    resetFieldsButton: fakeNode(),
    deletePassportButton: fakeNode(),
    saveNextButton: fakeNode(),
    fieldCategoryTabs: fakeNode(),
    passportPagePrevButton: fakeNode(),
    passportPageNextButton: fakeNode(),
    passportZoomOutButton: fakeNode(),
    passportZoomInButton: fakeNode(),
    passportZoomResetButton: fakeNode(),
    passportPreviewFrame: fakeNode(),
    workspacePrevButtons: [fakeNode()],
    workspaceNextButtons: [fakeNode()],
  };
}

function bindWithDefaults(overrides = {}) {
  const calls = [];
  const noop = (name) => (...args) => calls.push([name, ...args]);
  const dom = fakeDom();
  const appWindow = fakeNode();
  bindActions({
    dom,
    appWindow,
    state: {
      isScanning: false,
      isChoosingFolder: false,
      entryLogs: ["old"],
      validationFilter: "all",
      passportListPage: 2,
      showFullScanLog: false,
    },
    runAction: (action, label) => {
      calls.push(["runAction", label]);
      return action();
    },
    setPage: noop("setPage"),
    updateSelectedDir: noop("updateSelectedDir"),
    renderImportPage: noop("renderImportPage"),
    updateActionAvailability: noop("updateActionAvailability"),
    chooseFolder: noop("chooseFolder"),
    handleScanButtonClick: noop("handleScanButtonClick"),
    handleOcrModeChange: noop("handleOcrModeChange"),
    handleEntryDefaultChange: noop("handleEntryDefaultChange"),
    handleApplyEntryDefaults: noop("handleApplyEntryDefaults"),
    openStopScanModal: noop("openStopScanModal"),
    resolveRescanConfirmation: noop("resolveRescanConfirmation"),
    confirmStopScan: noop("confirmStopScan"),
    closeStopScanModal: noop("closeStopScanModal"),
    confirmRecentDelete: noop("confirmRecentDelete"),
    closeRecentDeleteModal: noop("closeRecentDeleteModal"),
    confirmRecentEdit: noop("confirmRecentEdit"),
    closeRecentEditModal: noop("closeRecentEditModal"),
    confirmPassportDelete: noop("confirmPassportDelete"),
    closePassportDeleteModal: noop("closePassportDeleteModal"),
    closeReviewCompleteModal: noop("closeReviewCompleteModal"),
    handlePrepareEntry: noop("handlePrepareEntry"),
    handleOpenJsonLocation: noop("handleOpenJsonLocation"),
    handleExportPreviewMemberClick: noop("handleExportPreviewMemberClick"),
    renderEntryLogs: noop("renderEntryLogs"),
    openRecentBatch: noop("openRecentBatch"),
    openRecentEditModal: noop("openRecentEditModal"),
    openRecentDeleteModal: noop("openRecentDeleteModal"),
    ensureVisibleActiveMember: noop("ensureVisibleActiveMember"),
    renderAll: noop("renderAll"),
    scrollPassportListToTop: noop("scrollPassportListToTop"),
    updateActiveMemberCompanion: noop("updateActiveMemberCompanion"),
    scheduleRenderAll: noop("scheduleRenderAll"),
    updateActiveMemberCompanionRelation: noop("updateActiveMemberCompanionRelation"),
    updateActiveMemberField: noop("updateActiveMemberField"),
    resetActiveMemberFields: noop("resetActiveMemberFields"),
    openPassportDeleteModal: noop("openPassportDeleteModal"),
    handleSaveAndNext: noop("handleSaveAndNext"),
    renderWorkspace: noop("renderWorkspace"),
    moveActiveMember: noop("moveActiveMember"),
    changePassportPreviewZoom: noop("changePassportPreviewZoom"),
    resetPassportPreviewZoom: noop("resetPassportPreviewZoom"),
    handlePassportPreviewWheel: noop("handlePassportPreviewWheel"),
    handlePassportPreviewKeydown: noop("handlePassportPreviewKeydown"),
    ...overrides,
  });
  return { dom, calls };
}

test("bindActions wires primary navigation and folder input callbacks", () => {
  const { dom, calls } = bindWithDefaults();

  dom.navButtons[0].dispatch("click");
  dom.folderPath.value = "C:/passports";
  dom.folderPath.dispatch("input");

  assert.deepEqual(calls.slice(0, 4), [
    ["setPage", "entry"],
    ["updateSelectedDir", "C:/passports"],
    ["renderImportPage"],
    ["updateActionAvailability"],
  ]);
});

test("bindActions wraps scan actions with runAction labels", () => {
  const { dom, calls } = bindWithDefaults();

  dom.scanButton.dispatch("click");
  dom.chooseFolderButton.dispatch("click");

  assert.deepEqual(calls.slice(0, 4), [
    ["runAction", "Siapkan foto"],
    ["handleScanButtonClick"],
    ["runAction", "Pilih folder"],
    ["chooseFolder"],
  ]);
});

test("bindActions wires entry default setting changes and apply action", () => {
  const { dom, calls } = bindWithDefaults();

  dom.entryDefaultInputs[0].value = "INDONESIA";
  dom.entryDefaultInputs[0].dispatch("change");
  dom.applyEntryDefaultsButton.dispatch("click");

  assert.equal(calls[0][0], "handleEntryDefaultChange");
  assert.equal(calls[0][1].target, dom.entryDefaultInputs[0]);
  assert.deepEqual(calls.slice(1, 3), [
    ["runAction", "Terapkan default entry"],
    ["handleApplyEntryDefaults"],
  ]);
});
