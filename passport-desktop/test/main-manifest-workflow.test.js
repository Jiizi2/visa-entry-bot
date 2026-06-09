import assert from "node:assert/strict";
import test from "node:test";

import { createManifestWorkflow } from "../src/shared/manifest-workflow.js";

function createFixture(overrides = {}) {
  const members = overrides.members ?? [
    {
      id: "m1",
      reviewConfirmed: true,
      reviewStatus: "VALID",
      status: "VALID",
      resolvedProfile: {
        firstName: "Adult",
        familyName: "One",
        dob: "1980/01/01",
        passportNumber: "P1",
      },
    },
    {
      id: "m2",
      reviewStatus: "NEEDS_REVIEW",
      status: "NEEDS_REVIEW",
      resolvedProfile: {
        firstName: "",
        familyName: "Two",
        dob: "1980/01/01",
        passportNumber: "P2",
      },
    },
  ];
  const state = {
    activeMemberId: "",
    exportedBatchPath: "old.json",
    exportError: "old error",
    manifest: null,
    manifestPath: "manifest.json",
    originalManifest: null,
    passportImageCache: new Map([["m1", { status: "ready" }]]),
    recentBatches: [],
    reviewedMemberIds: new Set(),
    selectedDir: "C:/new",
    selectedIds: new Set(),
    ...overrides.state,
  };
  const calls = {
    ensureVisibleActiveMember: 0,
    recalculateMetrics: 0,
    renderAll: 0,
    syncManifestChildMetadata: 0,
  };
  const controller = createManifestWorkflow({
    state,
    manifestMembers: () => state.manifest?.members ?? members,
    syncManifestChildMetadata: (manifest) => {
      calls.syncManifestChildMetadata += 1;
      manifest.wasSynced = true;
    },
    firstMemberId: (manifest) => manifest.members[0]?.id ?? "",
    recalculateMetrics: () => {
      calls.recalculateMetrics += 1;
    },
    ensureVisibleActiveMember: () => {
      calls.ensureVisibleActiveMember += 1;
    },
    renderAll: () => {
      calls.renderAll += 1;
    },
    loadManifestCommand: async () => ({ members: members.map((member) => JSON.parse(JSON.stringify(member))) }),
    hasAnyScanResult: overrides.hasAnyScanResult ?? (() => true),
    hasScanResultForSelectedDir: overrides.hasScanResultForSelectedDir ?? (() => false),
  });

  return {
    calls,
    controller,
    members,
    state,
  };
}

test("manifest workflow loads manifest and resets derived review state", async () => {
  const { calls, controller, state } = createFixture();

  await controller.loadManifest();

  assert.equal(state.manifest.wasSynced, true);
  assert.equal(state.originalManifest.wasSynced, true);
  assert.notEqual(state.originalManifest, state.manifest);
  assert.equal(state.activeMemberId, "m1");
  assert.deepEqual([...state.selectedIds], ["m1"]);
  assert.equal(state.reviewedMemberIds.has("m1"), true);
  assert.equal(state.passportImageCache.size, 0);
  assert.equal(state.exportedBatchPath, "");
  assert.equal(state.exportError, "");
  assert.equal(calls.syncManifestChildMetadata, 1);
  assert.equal(calls.recalculateMetrics, 1);
  assert.equal(calls.ensureVisibleActiveMember, 1);
});

test("manifest workflow toggles selection and reports folder conflicts", () => {
  const { calls, controller, state } = createFixture();

  controller.toggleMemberSelection("m1", true);
  controller.toggleMemberSelection("m2", false);

  assert.equal(state.selectedIds.has("m1"), true);
  assert.equal(state.selectedIds.has("m2"), false);
  assert.equal(calls.renderAll, 2);
  assert.equal(controller.hasFolderSelectionConflict(), true);
});

test("manifest workflow delegates review validation to active members", () => {
  const { controller } = createFixture();

  const validation = controller.reviewCompletionValidation({
    id: "m2",
    reviewStatus: "NEEDS_REVIEW",
    resolvedProfile: {
      firstName: "",
      familyName: "Two",
      dob: "1980/01/01",
      passportNumber: "P2",
    },
  });

  assert.equal(validation.ok, false);
  assert.equal(controller.requiredFieldBlockingIssueForBatch().ok, false);
});
