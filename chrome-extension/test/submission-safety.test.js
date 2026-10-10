const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ROOT = path.resolve(__dirname, "..");
const load = (ctx, file) => vm.runInContext(fs.readFileSync(path.join(ROOT, "content", file), "utf8"), ctx, { filename: file });
const member = { id: "demo", passportImagePath: "C:/Demo/demo.jpeg", resolvedProfile: { passportNumber: "X1234567" } };

function submissionHarness(options = {}) {
  let clicks = 0, checks = 0;
  const state = { runToken: 1 };
  const root = { identityGuard: { verifySummaryIdentity: () => { checks++; options.verify?.(); } } };
  const ctx = vm.createContext({ window: { NusukAutofill: root } });
  load(ctx, "submission-guard.js");
  const context = { member: structuredClone(member) };
  const submit = () => root.submissionGuard.submitOnce({
    state, context, runId: 1,
    persistState: options.persist || (async () => {}),
    checkpoint: async runId => { if (runId !== state.runToken) throw new Error("cancelled"); },
    click: async () => { clicks++; },
  });
  return { root, state, context, submit, clicks: () => clicks, checks: () => checks };
}

test("submission is locked before asynchronous storage, and a concurrent or reloaded submit is rejected", async () => {
  let saved;
  const h = submissionHarness({ persist: () => new Promise(resolve => { saved = resolve; }) });
  const running = h.submit();
  assert.equal(h.clicks(), 0);
  assert.equal(h.state.pendingSubmission.passportNumber, "X1234567");
  await assert.rejects(h.submit(), /pengiriman ulang diblokir/);
  saved(); await running;
  assert.equal(h.clicks(), 1);
  assert.equal(h.checks(), 2);
  assert.throws(() => h.root.submissionGuard.assertNoPending(structuredClone(h.state)), /belum terkonfirmasi/);
});

test("unavailable checkpoint storage prevents the irreversible click", async () => {
  const h = submissionHarness({ persist: async () => { throw new Error("storage failed"); } });
  await assert.rejects(h.submit(), /checkpoint.*storage failed/);
  assert.equal(h.clicks(), 0);
  assert.ok(h.state.pendingSubmission);
});

test("a form change while saving its checkpoint is caught by the second identity check", async () => {
  let swapped = false;
  const h = submissionHarness({ persist: async () => { swapped = true; }, verify: () => { if (swapped) throw new Error("wrong passport"); } });
  await assert.rejects(h.submit(), /wrong passport/);
  assert.equal(h.clicks(), 0);
  assert.ok(h.state.pendingSubmission);
});

test("cancellation while persisting the submission checkpoint cannot click the old form", async () => {
  const h = submissionHarness({ persist: async () => { h.state.runToken++; } });
  await assert.rejects(h.submit(), /cancelled/);
  assert.equal(h.clicks(), 0);
});

test("success must belong to the submitted member, number, and image", async () => {
  const h = submissionHarness(); await h.submit();
  h.root.submissionGuard.assertPendingMember(h.state, h.context);
  for (const mutate of [m => { m.id = "other"; }, m => { m.resolvedProfile.passportNumber = "X9999999"; }, m => { m.passportImagePath = "C:/Demo/other.jpeg"; }]) {
    const changed = structuredClone(h.context); mutate(changed.member);
    assert.throws(() => h.root.submissionGuard.assertPendingMember(h.state, changed), /tidak memiliki pengiriman yang cocok/);
  }
});

test("panel-state writes cannot erase the separate persisted submission lock", async () => {
  const stored = {};
  const ctx = vm.createContext({
    window: { NusukAutofill: { constants: { STORAGE_KEY: "nusukAutofillState" } } },
    chrome: { storage: { local: { set: async values => { Object.assign(stored, structuredClone(values)); } } } },
  });
  load(ctx, "panel-state-store.js");
  const state = { pendingSubmission: { memberId: "demo", passportNumber: "X1234567" } };
  const store = ctx.window.NusukAutofill.panelStateStore.createPanelStateStore({ state });
  await store.persistState({ required: true, submissionCheckpoint: true });
  stored.nusukAutofillState = { executionState: "idle" }; // An independently open panel writes old view state.
  await store.persistState();
  assert.equal(stored.nusukPendingSubmission.passportNumber, "X1234567");
  state.pendingSubmission = null;
  await store.persistState({ required: true, submissionCheckpoint: true });
  assert.equal(stored.nusukPendingSubmission, null);
});

test("required persistence fails when Chrome storage is unavailable", async () => {
  const ctx = vm.createContext({ window: { NusukAutofill: { constants: { STORAGE_KEY: "state" } } } });
  load(ctx, "panel-state-store.js");
  const store = ctx.window.NusukAutofill.panelStateStore.createPanelStateStore({ state: {} });
  await assert.rejects(store.persistState({ required: true }), /checkpoint.*tidak tersedia/);
});

function bridgeHarness(state, run) {
  let listener;
  const reports = [], runs = [];
  const root = { manifestValidator: {
    validateManifestForEntry: manifest => { if (!manifest.members?.length || manifest.members.some(m => !m?.reviewConfirmed)) throw new Error("unreviewed"); return { warnings: [] }; },
    formatManifestUploadMessage: () => "loaded",
  } };
  const ctx = vm.createContext({ window: { NusukAutofill: root }, console: { log() {} }, chrome: { runtime: { onMessage: { addListener: fn => { listener = fn; } } } } });
  load(ctx, "panel-bridge.js");
  root.panelBridge.createPanelBridge({ state, persistState: async () => {}, postPanelState() {}, postToPanel: (_, data) => reports.push(data), runAutomation: payload => { runs.push(payload); return run ? run() : Promise.resolve(); } }).bindWindowBridge();
  const dispatch = (type, payload) => { let response; listener({ type, payload }, {}, value => { response = value; }); return response; };
  return { dispatch, reports, runs };
}

test("active and paused batches cannot be replaced through JSON upload or member selection", () => {
  for (const executionState of ["running", "paused"]) {
    const state = { executionState, activeSessionId: "old", selectedMemberId: "old", manifest: { members: [{ id: "old" }] }, completedMemberIds: ["saved"], revision: 10 };
    const h = bridgeHarness(state);
    assert.equal(h.dispatch("NUSUK_PANEL_UPLOAD_MANIFEST", { manifest: { members: [{ id: "new", reviewConfirmed: true }] } }).ok, false);
    assert.equal(state.manifest.members[0].id, "old");
    h.dispatch("NUSUK_PANEL_SELECT_MEMBER", { memberId: "new" });
    assert.equal(state.selectedMemberId, "old");
    assert.equal(state.revision, 10);
    assert.deepEqual(state.completedMemberIds, ["saved"]);
    assert.equal(h.runs.length, 0);
  }
});

test("an unresolved submission blocks replacement batches and direct entry even when execution is idle", () => {
  const state = { executionState: "idle", pendingSubmission: { memberId: "old" }, manifest: { members: [{ id: "old" }] } };
  const h = bridgeHarness(state);
  assert.equal(h.dispatch("NUSUK_PANEL_UPLOAD_MANIFEST", { manifest: { members: [{ id: "new", reviewConfirmed: true }] } }).ok, false);
  assert.equal(h.dispatch("NUSUK_AUTOFILL_MEMBER", { member: { id: "new", reviewConfirmed: true } }).ok, false);
  assert.equal(h.runs.length, 0);
  assert.equal(state.manifest.members[0].id, "old");
});

test("direct runtime entry rejects unreviewed data before creating a run", () => {
  const state = { executionState: "idle", runToken: 0 };
  const h = bridgeHarness(state);
  assert.equal(h.dispatch("NUSUK_AUTOFILL_MEMBER", { member: { id: "unreviewed" } }).ok, false);
  assert.equal(state.executionState, "idle");
  assert.equal(state.runToken, 0);
  assert.equal(h.runs.length, 0);
});

test("late callbacks from a replaced runtime run cannot stop the new run", async () => {
  for (const type of ["NUSUK_AUTOFILL_MEMBER"]) {
    let reject;
    const pending = new Promise((_, fail) => { reject = fail; });
    const state = { executionState: "idle", runToken: 0, activeSessionId: "demo" };
    const h = bridgeHarness(state, () => pending);
    const reviewed = { ...member, reviewConfirmed: true };
    h.dispatch(type, type === "NUSUK_AUTOFILL_MEMBER" ? { member: reviewed } : { sessionId: "demo", revision: 1, status: "RUNNING", manifestMembers: [reviewed] });
    assert.equal(h.runs.length, 1);
    state.runToken++; state.executionState = "running"; state.activeSessionId = "new";
    reject(new Error("late failure")); await new Promise(resolve => setImmediate(resolve));
    assert.equal(state.executionState, "running");
    assert.equal(state.activeSessionId, "new");
    assert.equal(h.reports.length, 0);
  }
});

test("start, resume, and retry remain blocked until an unresolved save has been checked", async () => {
  const state = { executionState: "paused", runToken: 1, pendingSubmission: { memberId: "demo", passportNumber: "X1234567" }, currentRunPayload: { members: [member] } };
  const reports = [], saves = []; let runs = 0, resetConfirmed = false;
  const root = { constants: {}, manifestValidator: {}, pageContext: { readPageContext: () => ({ pageStatus: "ready" }) } };
  const ctx = vm.createContext({ window: { NusukAutofill: root, confirm: () => resetConfirmed } });
  load(ctx, "submission-guard.js"); load(ctx, "autofill-session.js");
  const control = root.autofillSession.createAutofillSession({
    state, runAutomation: async () => { runs++; }, postToPanel: (_, value) => reports.push(value),
    persistState: async options => { saves.push({ options, pending: structuredClone(state.pendingSubmission) }); },
    postPanelState() {}, clearActiveHighlight() {}, resetProgress() {},
  });
  await control.startAutofillFromPanel(); await control.resumeAutofillAfterReload(); await control.restartFailedFromPanel();
  assert.equal(runs, 0);
  assert.equal(reports.filter(report => /pengiriman ulang diblokir/.test(report.message)).length, 3);
  await control.resetAutofillFromPanel();
  assert.equal(state.runToken, 1);
  assert.ok(state.pendingSubmission);
  resetConfirmed = true; await control.resetAutofillFromPanel();
  assert.equal(state.runToken, 2);
  assert.equal(state.pendingSubmission, null);
  assert.equal(saves.at(-1).options.submissionCheckpoint, true);
});
