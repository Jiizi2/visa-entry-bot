import assert from "node:assert/strict";
import test from "node:test";

import {
  createEntryFlow,
  truncateForLog,
} from "../src/features/entry/flow.js";

function createAdultMember(id = "member-1") {
  return {
    id,
    reviewConfirmed: true,
    reviewStatus: "VALID",
    resolvedProfile: {
      firstName: "Adult",
      familyName: "Member",
      dob: "1980/01/01",
      passportNumber: "P123",
    },
  };
}

function createFlowFixture(overrides = {}) {
  const member = createAdultMember();
  const state = {
    activeMemberId: "",
    currentPage: "entry",
    entryLogs: [],
    exportError: "",
    exportedBatchPath: "",
    isEntryRunning: false,
    manifest: { members: [member] },
    manifestPath: "C:/batch/manifest.json",
    reviewedMemberIds: new Set(["member-1"]),
    selectedIds: new Set(["member-1"]),
    statusDetail: "",
    statusHeadline: "",
    ...overrides.state,
  };
  const dom = {
    entryLogBox: { textContent: "" },
    entryLogCounter: { textContent: "" },
    ...overrides.dom,
  };
  const calls = {
    createNusukBatch: [],
    flushManifestSave: 0,
    openJsonLocation: [],
    renderAll: 0,
    renderReviewExportModal: 0,
    showBatchReviewBlockingMessage: [],
    syncPassportPageWithActiveMember: 0,
  };
  const flow = createEntryFlow({
    dom,
    state,
    manifestMembers: () => Array.isArray(state.manifest?.members) ? state.manifest.members : [],
    reviewCompletionState: () => overrides.review ?? { total: 1, reviewed: 1, remaining: 0 },
    requiredFieldBlockingIssueForBatch: () => overrides.requiredIssue ?? { ok: true, message: "" },
    showBatchReviewBlockingMessage: (issue) => {
      calls.showBatchReviewBlockingMessage.push(issue);
    },
    syncPassportPageWithActiveMember: () => {
      calls.syncPassportPageWithActiveMember += 1;
    },
    isEntryAccessible: () => overrides.entryAccessible ?? true,
    renderAll: () => {
      calls.renderAll += 1;
    },
    renderReviewExportModal: () => {
      calls.renderReviewExportModal += 1;
    },
    flushManifestSave: async () => {
      calls.flushManifestSave += 1;
    },
    createNusukBatch: async (payload) => {
      calls.createNusukBatch.push(payload);
      return "C:/batch/nusuk.json";
    },
    openJsonLocation: async (path) => {
      calls.openJsonLocation.push(path);
    },
    now: () => new Date("2026-05-29T00:00:00.000Z"),
  });

  return { calls, dom, flow, member, state };
}

test("entry flow appends logs and renders log box", () => {
  const { calls, dom, flow, state } = createFlowFixture();

  flow.appendEntryLog("Hello", "success");

  assert.equal(state.entryLogs.length, 1);
  assert.match(state.entryLogs[0], /\[SUCCESS\] Hello/);
  assert.equal(dom.entryLogBox.textContent, state.entryLogs[0]);
  assert.equal(dom.entryLogCounter.textContent, "1 log");
  assert.equal(calls.renderReviewExportModal, 1);
});

test("entry flow blocks export when review is incomplete", async () => {
  const { calls, flow, state } = createFlowFixture({
    review: { total: 2, reviewed: 1, remaining: 1 },
  });

  await flow.handlePrepareEntry();

  assert.equal(state.currentPage, "validation");
  assert.equal(state.statusHeadline, "Review belum selesai");
  assert.match(state.exportError, /Masih ada 1/);
  assert.equal(calls.createNusukBatch.length, 0);
  assert.equal(calls.renderAll > 0, true);
});

test("entry flow exports reviewed JSON", async () => {
  const { calls, flow, state } = createFlowFixture();

  await flow.handlePrepareEntry();

  assert.equal(calls.flushManifestSave, 1);
  assert.equal(calls.createNusukBatch.length, 1);
  assert.equal(calls.createNusukBatch[0].manifestPath, "C:/batch/manifest.json");
  assert.deepEqual(calls.createNusukBatch[0].selectedIds, ["member-1"]);
  assert.equal(calls.createNusukBatch[0].manifestData.members[0].id, "member-1");
  assert.equal(state.exportedBatchPath, "C:/batch/nusuk.json");
  assert.equal(state.statusHeadline, "JSON dibuat");
  assert.equal(state.isEntryRunning, false);
  assert.match(state.entryLogs.join("\n"), /JSON untuk extension dibuat/);
});

test("entry flow exposes preview and export readiness helpers", () => {
  const { flow } = createFlowFixture();

  assert.equal(flow.canExportReviewedJson(), true);
  assert.equal(flow.isMemberReadyForJson(createAdultMember("member-2")), true);
  assert.equal(flow.exportPreviewState().canExport, true);
  assert.equal(truncateForLog("a b\nc", 20), "a b c");
  assert.equal(truncateForLog("abcdef", 5), "ab...");
});

test("entry flow opens exported JSON location", async () => {
  const { calls, flow, state } = createFlowFixture({
    state: { exportedBatchPath: "C:/batch/nusuk-entry-batch.json" },
  });

  await flow.handleOpenJsonLocation();

  assert.deepEqual(calls.openJsonLocation, ["C:/batch/nusuk-entry-batch.json"]);
  assert.equal(state.statusHeadline, "Folder JSON dibuka");
});
