import assert from "node:assert/strict";
import test from "node:test";

import { FIELD_CATEGORY_PAIRS } from "../src/main-fields.js";
import { createReviewActions } from "../src/main-review-actions.js";

function createMember(id, firstName = "Adult") {
  return {
    id,
    reviewConfirmed: true,
    reviewStatus: "NEEDS_REVIEW",
    status: "NEEDS_REVIEW",
    resolvedProfile: {
      firstName,
      fatherName: "",
      grandfatherName: "",
      familyName: "Member",
      dob: "1980/01/01",
      passportNumber: `P-${id}`,
      arabic: {},
    },
  };
}

function createFixture(overrides = {}) {
  const members = overrides.members ?? [createMember("m1"), createMember("m2", "Second")];
  const state = {
    activeFieldCategory: "identity",
    activeMemberId: "m1",
    originalManifest: { members: members.map((member) => JSON.parse(JSON.stringify(member))) },
    passportListPage: 1,
    passportListPageSize: 8,
    reviewBlock: { target: "field" },
    reviewedMemberIds: new Set(members.map((member) => member.id)),
    selectedIds: new Set(),
    statusDetail: "",
    statusHeadline: "",
    ...overrides.state,
  };
  const calls = {
    openReviewCompleteModal: 0,
    recalculateMetrics: 0,
    renderAll: 0,
    scheduleManifestSave: [],
    scrollPassportListToTop: 0,
    showReviewBlockingMessage: [],
    syncPassportPageWithActiveMember: 0,
  };
  const activeMember = () => members.find((member) => member.id === state.activeMemberId) || null;
  const filteredMembers = () => members;
  const activeNavigationState = () => {
    const index = members.findIndex((member) => member.id === state.activeMemberId);
    return {
      canMovePrev: index > 0,
      canMoveNext: index >= 0 && index < members.length - 1,
    };
  };
  const actions = createReviewActions({
    state,
    activeMember,
    manifestMembers: () => members,
    filteredMembers,
    activeNavigationState,
    activeCategoryPair: () => FIELD_CATEGORY_PAIRS.find((pair) => pair.id === state.activeFieldCategory) || FIELD_CATEGORY_PAIRS[0],
    reviewCompletionState: overrides.reviewCompletionState ?? (() => ({ total: 2, reviewed: 1, remaining: 1 })),
    reviewCompletionValidation: overrides.reviewCompletionValidation ?? (() => ({ ok: true })),
    clearReviewBlock: () => {
      state.reviewBlock = null;
    },
    showReviewBlockingMessage: (validation) => {
      calls.showReviewBlockingMessage.push(validation);
    },
    openReviewCompleteModal: () => {
      calls.openReviewCompleteModal += 1;
    },
    recalculateMetrics: () => {
      calls.recalculateMetrics += 1;
    },
    scheduleManifestSave: (delayMs) => {
      calls.scheduleManifestSave.push(delayMs);
    },
    renderAll: () => {
      calls.renderAll += 1;
    },
    syncPassportPageWithActiveMember: () => {
      calls.syncPassportPageWithActiveMember += 1;
    },
    scrollPassportListToTop: () => {
      calls.scrollPassportListToTop += 1;
    },
    originalMemberById: (memberId) => state.originalManifest.members.find((member) => member.id === memberId) || null,
    replaceMemberInManifest: (memberId, nextMember) => {
      const index = members.findIndex((member) => member.id === memberId);
      if (index >= 0) {
        members[index] = nextMember;
      }
    },
  });

  return { actions, calls, members, state };
}

test("review actions update field values and clear confirmation", () => {
  const { actions, calls, members, state } = createFixture();

  actions.updateActiveMemberField("firstName", "ABCDEFGHIJKLMNOPQRSTUVWXYZ");

  assert.equal(members[0].resolvedProfile.firstName, "ABCDEFGHIJKLMNO");
  assert.equal(members[0].reviewConfirmed, undefined);
  assert.equal(state.reviewedMemberIds.has("m1"), false);
  assert.equal(state.reviewBlock, null);
  assert.deepEqual(calls.scheduleManifestSave, [undefined]);
  assert.equal(state.statusHeadline, "Perubahan lokal tersimpan");
  assert.match(state.statusDetail, /Nama depan/);
});

test("review actions save and next marks member valid then moves", () => {
  const { actions, calls, members, state } = createFixture({
    state: { activeFieldCategory: "arabic" },
  });

  actions.handleSaveAndNext();

  assert.equal(members[0].status, "VALID");
  assert.equal(members[0].reviewStatus, "VALID");
  assert.equal(members[0].reviewConfirmed, true);
  assert.equal(state.selectedIds.has("m1"), true);
  assert.equal(state.activeMemberId, "m2");
  assert.deepEqual(calls.scheduleManifestSave, [0]);
  assert.equal(calls.recalculateMetrics, 1);
  assert.equal(calls.syncPassportPageWithActiveMember, 1);
});

test("review actions block moving forward until current member is confirmed", () => {
  const { actions, calls, members, state } = createFixture();
  delete members[0].reviewConfirmed;
  state.reviewedMemberIds.delete("m1");

  actions.moveActiveMember(1);

  assert.equal(calls.showReviewBlockingMessage.length, 1);
  assert.match(calls.showReviewBlockingMessage[0].message, /Tandai passport/);
});

test("review actions reset active member from original manifest", () => {
  const { actions, calls, members, state } = createFixture();
  members[0].resolvedProfile.firstName = "Changed";

  actions.resetActiveMemberFields();

  assert.equal(members[0].resolvedProfile.firstName, "Adult");
  assert.equal(state.reviewedMemberIds.has("m1"), false);
  assert.deepEqual(calls.scheduleManifestSave, [0]);
  assert.equal(calls.renderAll, 1);
});
