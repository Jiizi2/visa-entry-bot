import assert from "node:assert/strict";
import test from "node:test";

import { createMemberStateController } from "../src/shared/member-state.js";

function createMember(id, status, reviewConfirmed = false) {
  return {
    id,
    reviewConfirmed,
    reviewStatus: status,
    status,
    resolvedProfile: {
      firstName: id,
      familyName: "Member",
      dob: "1980/01/01",
    },
  };
}

function createFixture(overrides = {}) {
  const members = overrides.members ?? [
    createMember("m1", "VALID", true),
    createMember("m2", "ERROR"),
    createMember("m3", "NEEDS_REVIEW"),
    createMember("m4", "VALID", true),
    createMember("m5", "VALID", true),
  ];
  const state = {
    activeMemberId: "m1",
    errorCount: 0,
    isScanning: false,
    manifest: { members },
    manifestPath: "manifest.json",
    originalManifest: { members: members.map((member) => JSON.parse(JSON.stringify(member))) },
    passportListPage: 1,
    passportListPageSize: 2,
    reviewCount: 0,
    reviewedMemberIds: new Set(["m1", "m4", "m5"]),
    totalFiles: 0,
    validCount: 0,
    validationFilter: "all",
    ...overrides.state,
  };
  const dom = {
    passportList: {
      scrollTop: 99,
    },
  };
  const calls = {
    renderAll: 0,
  };
  const controller = createMemberStateController({
    state,
    dom,
    requestFrame: (callback) => callback(),
    renderAll: () => {
      calls.renderAll += 1;
    },
  });

  return {
    calls,
    controller,
    dom,
    members,
    state,
  };
}

test("member state filters members and recalculates review metrics", () => {
  const { controller, state } = createFixture({
    state: {
      validationFilter: "error",
    },
  });

  assert.deepEqual(controller.filteredMembers().map((member) => member.id), ["m2", "m3"]);

  controller.recalculateMetrics();

  assert.equal(state.totalFiles, 5);
  assert.equal(state.validCount, 3);
  assert.equal(state.errorCount, 1);
  assert.equal(state.reviewCount, 1);
  assert.deepEqual(controller.reviewCompletionState(), {
    total: 4,
    reviewed: 3,
    remaining: 1,
  });
  assert.equal(controller.isEntryAccessible(), false);

  state.manifest.members[2].reviewConfirmed = true;
  assert.equal(controller.isEntryAccessible(), true);
});

test("member state keeps the active member visible inside the selected filter", () => {
  const { controller, state } = createFixture({
    state: {
      activeMemberId: "m2",
      passportListPage: 9,
      validationFilter: "valid",
    },
  });

  controller.ensureVisibleActiveMember();

  assert.equal(state.activeMemberId, "m1");
  assert.equal(state.passportListPage, 1);
  assert.deepEqual(controller.activeNavigationState(), {
    canMovePrev: false,
    canMoveNext: true,
  });
});

test("member state syncs pagination and changes active passport page", () => {
  const { calls, controller, dom, state } = createFixture({
    state: {
      activeMemberId: "m5",
    },
  });

  controller.syncPassportPageWithActiveMember();
  assert.equal(state.passportListPage, 3);

  controller.changePassportListPage(-1);

  assert.equal(state.passportListPage, 2);
  assert.equal(state.activeMemberId, "m3");
  assert.equal(calls.renderAll, 1);
  assert.equal(dom.passportList.scrollTop, 0);
});

test("member state replaces manifest members and finds original records", () => {
  const { controller, state } = createFixture();
  const original = controller.originalMemberById("m2");

  controller.replaceMemberInManifest("m2", createMember("m2", "VALID", true));

  assert.equal(original.status, "ERROR");
  assert.equal(state.manifest.members[1].status, "VALID");
  assert.equal(state.validCount, 4);
  assert.equal(state.errorCount, 0);
});
