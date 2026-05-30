import assert from "node:assert/strict";
import test from "node:test";

import { createPassportDeleteActions } from "../src/main-passport-delete-actions.js";

function createClassList() {
  const classes = new Set(["is-hidden"]);
  return {
    add: (className) => classes.add(className),
    remove: (className) => classes.delete(className),
    contains(className) {
      return classes.has(className);
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

function createButton() {
  return {
    focusCount: 0,
    focus() {
      this.focusCount += 1;
    },
  };
}

function createFixture() {
  const adult = {
    id: "adult-1",
    reviewConfirmed: true,
    resolvedProfile: {
      firstName: "Adult",
      familyName: "One",
      passportNumber: "A1",
    },
  };
  const child = {
    id: "child-1",
    companion: { passportNumber: "A1" },
    companionMemberId: "adult-1",
    companionRelation: "Mother",
    reviewConfirmed: true,
    resolvedProfile: {
      firstName: "Child",
      familyName: "One",
      passportNumber: "C1",
    },
  };
  const state = {
    activeMemberId: "adult-1",
    manifest: { members: [adult, child] },
    passportImageCache: new Map([["adult-1", "image"]]),
    reviewedMemberIds: new Set(["adult-1", "child-1"]),
    selectedIds: new Set(["adult-1", "child-1"]),
    statusDetail: "",
    statusHeadline: "",
    totalFiles: 2,
  };
  const dom = {
    passportDeleteCancelButton: createButton(),
    passportDeleteModal: createModal(),
    passportDeleteModalDesc: { textContent: "" },
  };
  const calls = {
    recalculateMetrics: 0,
    renderAll: 0,
    scheduleManifestSave: [],
    syncPassportPageWithActiveMember: 0,
  };
  const actions = createPassportDeleteActions({
    dom,
    state,
    requestFrame: (callback) => callback(),
    activeMember: () => state.manifest.members.find((member) => member.id === state.activeMemberId) || null,
    manifestMembers: () => state.manifest.members,
    clearMemberReviewConfirmation: (member) => {
      delete member.reviewConfirmed;
      state.reviewedMemberIds.delete(member.id);
    },
    recalculateMetrics: () => {
      calls.recalculateMetrics += 1;
      state.totalFiles = state.manifest.members.length;
    },
    filteredMembers: () => state.manifest.members,
    ensureVisibleActiveMember: () => {},
    syncPassportPageWithActiveMember: () => {
      calls.syncPassportPageWithActiveMember += 1;
    },
    scheduleManifestSave: (delayMs) => {
      calls.scheduleManifestSave.push(delayMs);
    },
    renderAll: () => {
      calls.renderAll += 1;
    },
  });

  return { actions, adult, calls, child, dom, state };
}

test("passport delete action opens modal and removes member", () => {
  const { actions, calls, child, dom, state } = createFixture();

  actions.openPassportDeleteModal("adult-1");
  assert.equal(dom.passportDeleteModal.classList.contains("is-hidden"), false);
  assert.equal(dom.passportDeleteModal.attrs["aria-hidden"], "false");
  assert.match(dom.passportDeleteModalDesc.textContent, /Adult One \(A1\)/);
  assert.equal(dom.passportDeleteCancelButton.focusCount, 1);

  actions.confirmPassportDelete();

  assert.deepEqual(state.manifest.members.map((member) => member.id), ["child-1"]);
  assert.equal(state.selectedIds.has("adult-1"), false);
  assert.equal(state.reviewedMemberIds.has("adult-1"), false);
  assert.equal(state.passportImageCache.has("adult-1"), false);
  assert.equal(child.companionMemberId, undefined);
  assert.equal(child.companionRelation, undefined);
  assert.equal(child.companion, undefined);
  assert.equal(child.reviewConfirmed, undefined);
  assert.equal(state.statusHeadline, "Passport dihapus dari review");
  assert.match(state.statusDetail, /Adult One/);
  assert.deepEqual(calls.scheduleManifestSave, [0]);
  assert.equal(calls.recalculateMetrics, 1);
  assert.equal(calls.renderAll, 1);
  assert.equal(calls.syncPassportPageWithActiveMember, 1);
});
