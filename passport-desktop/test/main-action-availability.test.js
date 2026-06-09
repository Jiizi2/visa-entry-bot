import assert from "node:assert/strict";
import test from "node:test";

import { createActionAvailabilityController } from "../src/core/action-availability.js";

function createClassList() {
  const classes = new Set();
  return {
    contains: (className) => classes.has(className),
    toggle: (className, force) => {
      if (force) {
        classes.add(className);
      } else {
        classes.delete(className);
      }
    },
  };
}

function createNode() {
  return {
    attrs: {},
    classList: createClassList(),
    disabled: false,
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
  };
}

function createMember(status = "VALID") {
  return {
    id: "m1",
    reviewStatus: status,
    status,
  };
}

function createFixture(overrides = {}) {
  const member = overrides.member === undefined ? createMember() : overrides.member;
  const state = {
    isChoosingFolder: false,
    isEntryRunning: false,
    isScanning: false,
    isStartingScan: false,
    isStoppingScan: false,
    manifest: { members: [member].filter(Boolean) },
    manifestPath: "manifest.json",
    selectedDir: "C:/batch",
    ...overrides.state,
  };
  const dom = {
    chooseFolderButton: createNode(),
    deletePassportButton: createNode(),
    entryBackReviewButton: createNode(),
    folderDropzone: createNode(),
    folderPath: createNode(),
    importNextButton: createNode(),
    navButtons: [createNode()],
    ocrModeInputs: [createNode()],
    passportPageNextButton: createNode(),
    passportPagePrevButton: createNode(),
    prepareEntryButton: createNode(),
    resetFieldsButton: createNode(),
    reviewCompleteExportButton: createNode(),
    reviewPreviewExportButton: createNode(),
    saveNextButton: createNode(),
    scanButton: createNode(),
    stopScanButton: createNode(),
    workspaceNextButtons: [createNode()],
    workspacePrevButtons: [createNode()],
    ...overrides.dom,
  };
  const controller = createActionAvailabilityController({
    dom,
    state,
    activeMember: overrides.activeMember ?? (() => member),
    activeNavigationState: overrides.activeNavigationState ?? (() => ({ canMovePrev: false, canMoveNext: true })),
    hasScanResultForSelectedDir: overrides.hasScanResultForSelectedDir ?? (() => true),
    manifestMembers: overrides.manifestMembers ?? (() => state.manifest.members),
    reviewCompletionState: overrides.reviewCompletionState ?? (() => ({ remaining: 0 })),
    canExportReviewedJson: overrides.canExportReviewedJson ?? (() => true),
    isMemberReviewConfirmed: overrides.isMemberReviewConfirmed ?? (() => true),
    reviewCompletionValidation: overrides.reviewCompletionValidation ?? (() => ({ ok: true })),
  });

  return {
    controller,
    dom,
    member,
    state,
  };
}

test("action availability enables ready import review and export actions", () => {
  const { controller, dom } = createFixture();

  controller.updateActionAvailability();

  assert.equal(dom.scanButton.disabled, false);
  assert.equal(dom.importNextButton.disabled, false);
  assert.equal(dom.chooseFolderButton.disabled, false);
  assert.equal(dom.folderPath.disabled, false);
  assert.equal(dom.folderDropzone.classList.contains("is-busy"), false);
  assert.equal(dom.reviewPreviewExportButton.classList.contains("is-hidden"), false);
  assert.equal(dom.reviewPreviewExportButton.disabled, false);
  assert.equal(dom.reviewCompleteExportButton.disabled, false);
  assert.equal(dom.prepareEntryButton.disabled, false);
  assert.equal(dom.deletePassportButton.disabled, false);
  assert.equal(dom.resetFieldsButton.disabled, false);
  assert.equal(dom.saveNextButton.disabled, false);
  assert.equal(dom.navButtons[0].disabled, false);
  assert.equal(dom.workspacePrevButtons[0].disabled, true);
  assert.equal(dom.workspaceNextButtons[0].disabled, false);
  assert.equal(dom.passportPagePrevButton.attrs["aria-disabled"], "true");
  assert.equal(dom.passportPageNextButton.attrs["aria-disabled"], "false");
});

test("action availability disables controls while scanning", () => {
  const { controller, dom } = createFixture({
    activeMember: () => null,
    canExportReviewedJson: () => false,
    hasScanResultForSelectedDir: () => false,
    reviewCompletionState: () => ({ remaining: 1 }),
    state: {
      isScanning: true,
      selectedDir: "",
    },
  });

  controller.updateActionAvailability();

  assert.equal(dom.scanButton.disabled, true);
  assert.equal(dom.stopScanButton.disabled, false);
  assert.equal(dom.stopScanButton.classList.contains("is-hidden"), false);
  assert.equal(dom.importNextButton.disabled, true);
  assert.equal(dom.chooseFolderButton.disabled, true);
  assert.equal(dom.folderPath.disabled, true);
  assert.equal(dom.ocrModeInputs[0].disabled, true);
  assert.equal(dom.folderDropzone.classList.contains("is-busy"), true);
  assert.equal(dom.reviewPreviewExportButton.disabled, true);
  assert.equal(dom.reviewCompleteExportButton.disabled, true);
  assert.equal(dom.prepareEntryButton.disabled, true);
  assert.equal(dom.deletePassportButton.disabled, true);
  assert.equal(dom.resetFieldsButton.disabled, true);
  assert.equal(dom.saveNextButton.disabled, true);
  assert.equal(dom.workspaceNextButtons[0].disabled, true);
});

test("action availability blocks invalid error records", () => {
  const { controller } = createFixture({
    isMemberReviewConfirmed: () => false,
    member: createMember("ERROR"),
    reviewCompletionValidation: () => ({ ok: false }),
  });

  assert.equal(controller.canAdvanceToNextPassport({ canMoveNext: true }), false);
});

test("action availability requires confirmation and valid review before advancing", () => {
  const ready = createFixture({
    isMemberReviewConfirmed: () => true,
    reviewCompletionValidation: () => ({ ok: true }),
  });
  const unconfirmed = createFixture({
    isMemberReviewConfirmed: () => false,
    reviewCompletionValidation: () => ({ ok: true }),
  });

  assert.equal(ready.controller.canAdvanceToNextPassport({ canMoveNext: true }), true);
  assert.equal(unconfirmed.controller.canAdvanceToNextPassport({ canMoveNext: true }), false);
});
