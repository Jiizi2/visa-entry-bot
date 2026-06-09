import assert from "node:assert/strict";
import test from "node:test";

import { createRecentBatchActions } from "../src/features/recent/actions.js";

function createModal() {
  const classes = new Set(["is-hidden"]);
  return {
    attrs: {},
    classList: {
      add: (className) => classes.add(className),
      remove: (className) => classes.delete(className),
      contains: (className) => classes.has(className),
    },
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
  };
}

function createInput() {
  return {
    focusCount: 0,
    selectCount: 0,
    value: "",
    focus() {
      this.focusCount += 1;
    },
    select() {
      this.selectCount += 1;
    },
  };
}

function createActionsFixture() {
  const state = {
    recentBatches: [
      { path: "C:/batch-a", label: "Batch A" },
      { path: "C:/batch-b", label: "Batch B" },
    ],
    statusHeadline: "",
    statusDetail: "",
  };
  const dom = {
    recentDeleteModal: createModal(),
    recentDeleteModalDesc: { textContent: "" },
    recentDeleteCancelButton: createInput(),
    recentEditModal: createModal(),
    recentEditInput: createInput(),
  };
  const saved = [];
  let renderCount = 0;
  const actions = createRecentBatchActions({
    dom,
    state,
    basenameFromPath: (path) => String(path).split(/[\\/]/).pop(),
    recentEntryByPath: (path) => state.recentBatches.find((entry) => entry.path === path) || null,
    saveRecentBatches: (entries) => saved.push(entries.map((entry) => ({ ...entry }))),
    renderAll: () => {
      renderCount += 1;
    },
    requestFrame: (callback) => callback(),
  });

  return {
    actions,
    dom,
    saved,
    state,
    get renderCount() {
      return renderCount;
    },
  };
}

test("recent delete action removes entry and updates modal state", () => {
  const fixture = createActionsFixture();

  fixture.actions.openRecentDeleteModal("C:/batch-a");
  assert.equal(fixture.dom.recentDeleteModal.classList.contains("is-hidden"), false);
  assert.equal(fixture.dom.recentDeleteModal.attrs["aria-hidden"], "false");
  assert.match(fixture.dom.recentDeleteModalDesc.textContent, /Batch A/);
  assert.equal(fixture.dom.recentDeleteCancelButton.focusCount, 1);

  fixture.actions.confirmRecentDelete();

  assert.deepEqual(fixture.state.recentBatches.map((entry) => entry.path), ["C:/batch-b"]);
  assert.deepEqual(fixture.saved.at(-1).map((entry) => entry.path), ["C:/batch-b"]);
  assert.equal(fixture.state.statusHeadline, "Riwayat dihapus");
  assert.match(fixture.state.statusDetail, /Batch A/);
  assert.equal(fixture.dom.recentDeleteModal.classList.contains("is-hidden"), true);
  assert.equal(fixture.renderCount, 1);
});

test("recent edit action updates stored label", () => {
  const fixture = createActionsFixture();

  fixture.actions.openRecentEditModal("C:/batch-b");
  assert.equal(fixture.dom.recentEditModal.classList.contains("is-hidden"), false);
  assert.equal(fixture.dom.recentEditModal.attrs["aria-hidden"], "false");
  assert.equal(fixture.dom.recentEditInput.value, "Batch B");
  assert.equal(fixture.dom.recentEditInput.focusCount, 1);
  assert.equal(fixture.dom.recentEditInput.selectCount, 1);

  fixture.dom.recentEditInput.value = "Updated Batch";
  fixture.actions.confirmRecentEdit();

  assert.equal(fixture.state.recentBatches[1].label, "Updated Batch");
  assert.equal(fixture.saved.at(-1)[1].label, "Updated Batch");
  assert.equal(fixture.state.statusHeadline, "Riwayat diperbarui");
  assert.match(fixture.state.statusDetail, /Updated Batch/);
  assert.equal(fixture.dom.recentEditModal.classList.contains("is-hidden"), true);
  assert.equal(fixture.renderCount, 1);
});
