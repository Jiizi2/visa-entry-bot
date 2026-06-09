import assert from "node:assert/strict";
import test from "node:test";

import { createPageFlow } from "../src/core/page-flow.js";

function createClassList() {
  const classes = new Set();
  return {
    add: (className) => classes.add(className),
    contains: (className) => classes.has(className),
  };
}

test("page flow blocks navigation when selected folder conflicts with active result", () => {
  const state = {
    currentPage: "validation",
    resultDir: "",
    resultSourceDir: "C:/old-batch",
    selectedDir: "C:/new-batch",
    statusDetail: "",
    statusHeadline: "",
  };
  let renderCount = 0;
  const pageFlow = createPageFlow({
    dom: {},
    state,
    manifestMembers: () => [{ id: "member-1" }],
    reviewCompletionState: () => ({ remaining: 0 }),
    requiredFieldBlockingIssueForBatch: () => ({ ok: true }),
    showBatchReviewBlockingMessage: () => {},
    hasFolderSelectionConflict: () => true,
    renderAll: () => {
      renderCount += 1;
    },
  });

  pageFlow.setPage("entry");

  assert.equal(state.currentPage, "import");
  assert.equal(state.statusHeadline, "Konfirmasi folder dulu");
  assert.match(state.statusDetail, /old-batch.*new-batch/);
  assert.equal(renderCount, 1);
});

test("page flow validates entry page prerequisites", () => {
  const state = {
    currentPage: "import",
    manifest: { members: [{ id: "member-1" }] },
    manifestPath: "manifest.json",
    statusDetail: "",
    statusHeadline: "",
  };
  let renderCount = 0;
  const pageFlow = createPageFlow({
    dom: {},
    state,
    manifestMembers: () => state.manifest.members,
    reviewCompletionState: () => ({ remaining: 2 }),
    requiredFieldBlockingIssueForBatch: () => ({ ok: true }),
    showBatchReviewBlockingMessage: () => {},
    hasFolderSelectionConflict: () => false,
    renderAll: () => {
      renderCount += 1;
    },
  });

  pageFlow.setPage("entry");

  assert.equal(state.currentPage, "validation");
  assert.equal(state.statusHeadline, "Review belum selesai");
  assert.match(state.statusDetail, /2 passport/);
  assert.equal(renderCount, 1);
});

test("page flow opens and closes review complete modal", () => {
  const modal = {
    attrs: {},
    classList: createClassList(),
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
  };
  const state = {
    currentPage: "validation",
    manifest: { members: [{ id: "member-1" }] },
    manifestPath: "manifest.json",
  };
  let renderCount = 0;
  const pageFlow = createPageFlow({
    dom: { reviewCompleteModal: modal },
    state,
    manifestMembers: () => state.manifest.members,
    reviewCompletionState: () => ({ remaining: 0 }),
    requiredFieldBlockingIssueForBatch: () => ({ ok: true }),
    showBatchReviewBlockingMessage: () => {},
    hasFolderSelectionConflict: () => false,
    renderAll: () => {
      renderCount += 1;
    },
  });

  pageFlow.openReviewCompleteModal();
  pageFlow.closeReviewCompleteModal();

  assert.equal(state.currentPage, "entry");
  assert.equal(renderCount, 1);
  assert.equal(modal.classList.contains("is-hidden"), true);
  assert.equal(modal.attrs["aria-hidden"], "true");
});
