import assert from "node:assert/strict";
import test from "node:test";

import { createViewController } from "../src/main-view-controller.js";

function node() {
  return {
    className: "",
    disabled: false,
    innerHTML: "",
    textContent: "",
    setAttribute(name, value) {
      this[name] = String(value);
    },
  };
}

test("view controller renders entry page and delegates entry logs", () => {
  let renderEntryLogsCount = 0;
  const dom = {
    entryStatusPill: node(),
  };
  const controller = createViewController({
    dom,
    state: {
      exportedBatchPath: "",
      isEntryRunning: false,
      isScanning: false,
      manifestPath: "manifest.json",
    },
    activeMember: () => null,
    activeNavigationState: () => ({ canMovePrev: false, canMoveNext: false }),
    canAdvanceToNextPassport: () => false,
    exportPreviewState: () => ({
      canExport: true,
      description: "Ready",
      failedMembers: [],
      members: [],
      readyMembers: [],
      review: { remaining: 0 },
      reviewedMemberIds: new Set(),
      selectedIds: new Set(["m1"]),
      skippedMembers: [],
    }),
    filteredMembers: () => [],
    initializeWorkspaceDatePickers: () => {},
    isMemberReviewConfirmed: () => false,
    manifestMembers: () => [],
    renderEntryLogs: () => {
      renderEntryLogsCount += 1;
    },
    reviewCompletionState: () => ({ total: 0, reviewed: 0, remaining: 0 }),
    reviewPrimaryActionLabel: () => "Lanjut",
  });

  controller.renderEntryPage();

  assert.equal(dom.entryStatusPill.textContent, "Review selesai");
  assert.equal(renderEntryLogsCount, 1);
});

test("view controller exposes active category from state", () => {
  const controller = createViewController({
    dom: {},
    state: { activeFieldCategory: "arabic" },
    activeMember: () => null,
    activeNavigationState: () => ({ canMovePrev: false, canMoveNext: false }),
    canAdvanceToNextPassport: () => false,
    exportPreviewState: () => ({}),
    filteredMembers: () => [],
    initializeWorkspaceDatePickers: () => {},
    isMemberReviewConfirmed: () => false,
    manifestMembers: () => [],
    renderEntryLogs: () => {},
    reviewCompletionState: () => ({ total: 0, reviewed: 0, remaining: 0 }),
    reviewPrimaryActionLabel: () => "Lanjut",
  });

  assert.equal(controller.activeCategoryPair().id, "arabic");
});
