const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ROOT = path.resolve(__dirname, "..");
const ids = members => Array.from(members || [], member => String(member.id));
const range = (from, to = 15) => Array.from({ length: to - from + 1 }, (_, index) => String(from + index));
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(options = {}) {
  const members = Array.from({ length: options.memberCount || 15 }, (_, index) => ({
    id: String(index + 1), passportImagePath: `C:/Demo/${index + 1}.jpeg`, reviewConfirmed: true,
    resolvedProfile: { passportNumber: `X${String(index + 1).padStart(7, "0")}`, firstName: "ALI", familyName: "BUDI" },
  }));
  const state = {
    storageKey: "testState", browserSessionId: "testBrowser", runToken: 0, executionState: "idle",
    manifest: { schemaVersion: "nusuk-entry-batch-v1", manifestPath: "C:/Demo/batch.json", members },
    selectedMemberId: "1", completedMemberIds: [], autofillFailures: [], logs: [],
    pendingSubmission: null, currentRunPayload: null, ...options.initialState,
  };
  const submitted = [], runs = [], snapshots = [], stored = {};
  const root = {
    identityGuard: { nameSelector: (index, language) => `input[name='${index}-${language}']`, verifySummaryIdentity() {}, identityError(message) { const error = new Error(message); error.name = "NusukIdentityError"; return error; } },
    manifestValidator: { ENTRY_BATCH_SCHEMA_VERSION: "nusuk-entry-batch-v1", validateManifestForEntry: () => ({ warnings: [] }) },
    pageContext: { readPageContext: () => ({ pageStatus: "ready" }) },
  };
  const ctx = vm.createContext({
    window: { NusukAutofill: root, setTimeout, clearTimeout }, console: { log() {}, warn() {} },
    location: { href: "https://masar.nusuk.sa/umrah/mutamer/add-mutamer" },
    document: { hidden: false, readyState: "complete", body: { innerText: "" }, querySelector: () => null, querySelectorAll: () => [] },
    chrome: {
      storage: { local: { set: async values => { await options.onSave?.(values, state); Object.assign(stored, structuredClone(values)); } } },
      runtime: { getURL: () => "chrome-extension://test/", sendMessage: async message => { if (message.type === "NUSUK_CONTENT_PANEL_MESSAGE" && message.payload.type === "NUSUK_PANEL_STATE") snapshots.push(structuredClone(message.payload.payload)); return { ok: false }; } },
    },
  });
  for (const file of ["constants.js", "date-utils.js", "value-utils.js", "automation-steps.js", "submission-guard.js", "execution-control.js", "panel-state-store.js", "automation-runner.js", "autofill-session.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, "content", file), "utf8"), ctx, { filename: file });
  }
  const execution = root.executionControl.createExecutionControl({ state });
  const store = root.panelStateStore.createPanelStateStore({ state, getUploadState: () => ({ uploadFileCount: 0, uploadFileNames: [] }) });
  const steps = root.automationSteps.buildPerMemberSteps(root.constants.NEXT_BUTTON_SELECTOR);
  const finalClick = steps.findLastIndex(step => step.action === "click") + 1;
  let fail = options.fail || "";
  const failMemberId = options.failMemberId || "10";
  const runner = root.automationRunner.createAutomationRunner({
    state, ...execution, ...store, detectNusukStage: () => 0,
    slowModeDelayAfterStep: async () => {}, sleep: async (_, runId) => execution.checkpoint(runId),
    runStep: async (step, context) => {
      await options.onStep?.(step, context);
      const id = String(context.member.id);
      if (fail === "before_save" && id === failMemberId) throw new Error("Nusuk timeout");
      if (options.ocrCorrections && step.action === "verify_passport_name") {
        context.identityEvidence.nameCorrection = { observedName: "LUZERMAN", expectedName: "ALI BUDI" };
      }
      if (options.dataWarnings && step.action === "verify_passport_name") {
        const warning = { key: "summary_full_name", message: "Nama pada ringkasan berbeda dari data jamaah" };
        context.onDataWarning(warning); context.onDataWarning(warning);
      }
      if (step.action === "click" && context.index === finalClick) {
        await root.submissionGuard.submitOnce({ state, context, runId: context.runId, ...store, ...execution, click: async () => { submitted.push(id); } });
      }
      if (step.action === "wait_for_selector" && step.selector.includes("Mutamer has been added successfully") && id === failMemberId) {
        if (fail === "unconfirmed") throw new Error("Nusuk did not return its save response");
        await options.waitForConfirmation?.();
      }
      if (fail === "close_popup" && id === "9" && step.action === "click_success_popup_action") throw new Error("Nusuk popup failed to close");
    },
  });
  const session = root.autofillSession.createAutofillSession({
    state, ...execution, ...store, clearActiveHighlight() {},
    getSelectedMember: runner.getSelectedMember,
    runAutomation: async (payload, runId) => { runs.push(ids(payload.members)); await runner.runAutomation(payload, runId); },
  });
  const resolution = outcome => ({ outcome, memberId: state.pendingSubmission?.memberId, passportNumber: state.pendingSubmission?.passportNumber, startedAt: state.pendingSubmission?.startedAt });
  return { state, submitted, stored, runs, snapshots, session, runner, resolution, recover: () => { fail = ""; },
    openList: () => { ctx.location.href = "https://masar.nusuk.sa/umrah/mutamer/mutamer-list"; } };
}

test("a 15-passport batch stopped at passport 10 resumes only passports 10 through 15", async () => {
  const h = harness({ fail: "before_save" });
  await h.session.startAutofillFromPanel();
  assert.equal(h.state.executionState, "paused");
  assert.deepEqual(Array.from(h.state.completedMemberIds), range(1, 9));
  assert.deepEqual(ids(h.state.currentRunPayload.members), range(10));
  assert.deepEqual(ids(h.stored.testState.currentRunPayload.members), range(10));
  assert.equal(h.state.progressCurrent, 9);
  assert.equal(h.state.progressTotal, 15);
  assert.equal(h.snapshots.at(-1).remainingMemberCount, 6);
  assert.equal(h.snapshots.at(-1).nextMemberId, "10");
  h.recover(); await h.session.startAutofillFromPanel();
  assert.deepEqual(h.submitted, range(1));
  assert.deepEqual(h.runs[1], range(10));
  assert.equal(h.state.executionState, "completed");
  assert.equal(h.state.progressCurrent, 15);
  assert.equal(h.state.currentRunPayload, null);
});

test("retry waits for the main queue to finish, while resume keeps all unprocessed passports", async () => {
  const h = harness({ fail: "before_save" });
  await h.session.startAutofillFromPanel();
  h.recover(); await h.session.restartFailedFromPanel();
  assert.equal(h.runs.length, 1);
  assert.deepEqual(ids(h.state.currentRunPayload.members), range(10));
  await h.session.startAutofillFromPanel();
  assert.deepEqual(h.runs[1], range(10));
  assert.deepEqual(h.submitted, range(1));
  assert.equal(h.state.autofillFailures.length, 0);
});

test("a stopped passport can be deferred, the rest completed, and only that passport retried on command", async () => {
  const h = harness({ fail: "before_save" });
  await h.session.startAutofillFromPanel();
  await h.session.skipMemberFromPanel({ memberId: "10" });
  assert.deepEqual(ids(h.state.currentRunPayload.members), range(11));
  assert.equal(h.state.freshEntryRequired, true);
  assert.equal(h.state.autofillFailures[0].deferred, true);
  assert.equal(h.state.autofillFailures[0].reason, "timeout");
  assert.match(h.state.autofillFailures[0].message, /Nusuk timeout/);
  assert.deepEqual(Array.from(h.snapshots.at(-1).queuedMemberIds), range(11));
  await h.session.startAutofillFromPanel(); // Cannot reuse the skipped member's live form.
  assert.equal(h.runs.length, 1);
  h.openList(); await h.session.startAutofillFromPanel();
  assert.deepEqual(h.submitted, [...range(1, 9), ...range(11)]);
  assert.equal(h.state.executionState, "completed");
  assert.equal(h.state.progressCurrent, 14);
  assert.equal(h.stored.testState.autofillFailures[0].memberId, "10");
  assert.match(h.state.logs.at(-1).message, /1 jamaah gagal atau dilewati/);
  h.recover(); await h.session.restartFailedFromPanel();
  assert.deepEqual(h.runs.at(-1), ["10"]);
  assert.equal(h.state.completedMemberIds.length, 15);
  assert.equal(h.state.autofillFailures.length, 0);
  assert.deepEqual(h.submitted, [...range(1, 9), ...range(11), "10"]);
});

test("names marked before start stay deferred across a reload and are only included in explicit retry", async () => {
  const first = harness();
  await first.session.skipMemberFromPanel({ memberId: "2" });
  await first.session.skipMemberFromPanel({ memberId: "5" });
  const reloaded = harness({ initialState: structuredClone(first.stored.testState) });
  await reloaded.session.startAutofillFromPanel();
  assert.deepEqual(reloaded.submitted, range(1).filter(id => !["2", "5"].includes(id)));
  assert.equal(reloaded.state.executionState, "completed");
  assert.equal(reloaded.state.autofillFailures.length, 2);
  await reloaded.session.restartFailedFromPanel();
  assert.deepEqual(reloaded.runs.at(-1), ["2", "5"]);
  assert.equal(reloaded.state.completedMemberIds.length, 15);
});

test("marking names before start preserves earlier children while adults still run first", async () => {
  for (const skipId of ["1", "3"]) {
    const h = harness();
    h.state.manifest.members[skipId === "1" ? 1 : 0].resolvedProfile.dob = "2020-01-01";
    await h.session.skipMemberFromPanel({ memberId: skipId });
    assert.equal(h.state.selectedMemberId, skipId === "1" ? "2" : "1");
    await h.session.startAutofillFromPanel();
    assert.equal(h.state.completedMemberIds.length, 14);
    assert.equal(h.submitted.at(-1), skipId === "1" ? "2" : "1");
    assert.ok(h.submitted.includes(skipId === "1" ? "2" : "1"));
    assert.equal(h.submitted.includes(skipId), false);
  }
});

test("a restored queue cannot reopen a skipped form or reintroduce its deferred member", async () => {
  const first = harness({ fail: "before_save" });
  await first.session.startAutofillFromPanel();
  await first.session.skipMemberFromPanel({ memberId: "10" });
  const initialState = structuredClone(first.stored.testState);
  initialState.currentRunPayload.members = initialState.manifest.members; // Simulate an older unsliced queue.
  const reloaded = harness({ initialState });
  assert.equal(await reloaded.session.resumeAutofillAfterReload(), false);
  assert.equal(reloaded.runs.length, 0);
  reloaded.openList(); await reloaded.session.resumeAutofillAfterReload();
  assert.deepEqual(reloaded.submitted, range(11));
  assert.equal(reloaded.state.autofillFailures[0].memberId, "10");
  assert.equal(reloaded.state.autofillFailures[0].deferred, true);
});

test("skipping the last failed name completes the main queue without automatically retrying it", async () => {
  const h = harness({ fail: "before_save", failMemberId: "15" });
  await h.session.startAutofillFromPanel();
  await h.session.skipMemberFromPanel({ memberId: "15" });
  assert.equal(h.state.executionState, "completed");
  assert.equal(h.state.currentRunPayload, null);
  assert.equal(h.snapshots.at(-1).resumeAvailable, false);
  assert.deepEqual(h.submitted, range(1, 14));
  assert.equal(h.state.progressCurrent, 14);
  h.recover(); h.openList(); await h.session.restartFailedFromPanel();
  assert.deepEqual(h.runs.at(-1), ["15"]);
  assert.equal(h.state.completedMemberIds.length, 15);
});

test("a paused in-flight member is cancelled before skip, and its late callbacks cannot save it", async () => {
  let release, waiting = false;
  const h = harness({ onStep: (step, context) => {
    if (step.action === "open_mutamer_form" && context.member.id === "1") {
      waiting = true; return new Promise(resolve => { release = resolve; });
    }
  } });
  const running = h.session.startAutofillFromPanel();
  for (let attempt = 0; attempt < 20 && !waiting; attempt++) await tick();
  assert.equal(waiting, true);
  await assert.rejects(h.session.skipMemberFromPanel({ memberId: "1" }), /Jeda/);
  await h.session.pauseAutofillFromPanel();
  const skipping = h.session.skipMemberFromPanel({ memberId: "1" });
  release(); await skipping; await running;
  assert.equal(h.submitted.length, 0);
  assert.deepEqual(ids(h.state.currentRunPayload.members), range(2));
  h.openList(); await h.session.startAutofillFromPanel();
  assert.deepEqual(h.submitted, range(2));
  assert.equal(h.state.autofillFailures[0].memberId, "1");
});

test("an unresolved save cannot be skipped; an operator-confirmed unsaved name can be deferred", async () => {
  const h = harness({ fail: "unconfirmed" });
  await h.session.startAutofillFromPanel();
  const pending = structuredClone(h.state.pendingSubmission);
  for (const memberId of ["10", "11"]) await assert.rejects(h.session.skipMemberFromPanel({ memberId }), /belum terkonfirmasi/);
  assert.deepEqual(structuredClone(h.state.pendingSubmission), pending);
  assert.deepEqual(ids(h.state.currentRunPayload.members), range(10));
  await h.session.resolvePendingSubmissionFromPanel(h.resolution("not_saved"));
  await h.session.skipMemberFromPanel({ memberId: "10" });
  h.recover(); h.openList(); await h.session.startAutofillFromPanel();
  assert.deepEqual(h.runs.at(-1), range(11));
  assert.equal(h.state.completedMemberIds.length, 14);
});

test("skip persistence failure restores the queue, failure reason and form checkpoint", async () => {
  let failStorage = false;
  const h = harness({ fail: "before_save", onSave: () => { if (failStorage) throw new Error("storage failed"); } });
  await h.session.startAutofillFromPanel();
  const before = structuredClone(h.state.autofillFailures);
  failStorage = true;
  await assert.rejects(h.session.skipMemberFromPanel({ memberId: "10" }), /Antrean sebelumnya tetap dipertahankan/);
  assert.deepEqual(structuredClone(h.state.autofillFailures), before);
  assert.deepEqual(ids(h.state.currentRunPayload.members), range(10));
  assert.equal(Boolean(h.state.freshEntryRequired), false);
  assert.equal(h.state.queueUpdateInProgress, false);
});

test("concurrent skip, reset and starts are blocked while a queue update is being stored", async () => {
  let hold = false, release;
  const h = harness({ fail: "before_save", onSave: () => hold ? new Promise(resolve => { release = resolve; }) : undefined });
  await h.session.startAutofillFromPanel();
  hold = true;
  const skipping = h.session.skipMemberFromPanel({ memberId: "10" });
  await tick();
  assert.equal(h.state.queueUpdateInProgress, true);
  await assert.rejects(h.session.skipMemberFromPanel({ memberId: "11" }), /Tunggu/);
  await assert.rejects(h.session.resetAutofillFromPanel(), /Tunggu/);
  await h.session.startAutofillFromPanel();
  assert.equal(h.runs.length, 1);
  release(); await skipping;
  assert.equal(h.state.queueUpdateInProgress, false);
  assert.deepEqual(ids(h.state.currentRunPayload.members), range(11));
});

test("large batches retain every deferred name instead of discarding the oldest 100 failures", async () => {
  const h = harness({ memberCount: 106 });
  for (let index = 1; index <= 105; index++) await h.session.skipMemberFromPanel({ memberId: String(index) });
  await h.session.startAutofillFromPanel();
  assert.deepEqual(h.submitted, ["106"]);
  assert.equal(h.state.autofillFailures.length, 105);
  assert.equal(h.stored.testState.autofillFailures.length, 105);
  assert.equal(h.snapshots.at(-1).autofillFailures[0].memberId, "1");
  await h.session.resetAutofillFromPanel();
  assert.equal(h.state.autofillFailures.length, 0);
  assert.equal(h.state.freshEntryRequired, false);
});

test("a reloaded content script resumes the persisted queue and ignores stale completed members", async () => {
  const first = harness({ fail: "before_save" });
  await first.session.startAutofillFromPanel();
  const initialState = structuredClone(first.stored.testState);
  // Even an older, unsliced checkpoint cannot submit confirmed passports again.
  initialState.currentRunPayload.members = initialState.manifest.members;
  const reloaded = harness({ initialState });
  await reloaded.session.resumeAutofillAfterReload();
  assert.deepEqual(reloaded.submitted, range(10));
  assert.equal(reloaded.state.completedMemberIds.length, 15);
});

test("OCR correction notes survive a stopped batch and reload, appear once at completion, and clear on reset", async () => {
  const first = harness({ fail: "before_save", ocrCorrections: true });
  await first.session.startAutofillFromPanel();
  assert.equal(first.state.executionState, "paused");
  assert.equal(first.stored.testState.autofillNameCorrections.length, 9);
  const reloaded = harness({ initialState: structuredClone(first.stored.testState), ocrCorrections: true });
  await reloaded.session.resumeAutofillAfterReload();
  assert.equal(reloaded.state.executionState, "completed");
  assert.equal(reloaded.state.autofillNameCorrections.length, 15);
  assert.equal(new Set(reloaded.state.autofillNameCorrections.map(note => note.memberId)).size, 15);
  assert.equal(reloaded.state.logs.filter(log => log.message.includes("LUZERMAN → ALI BUDI")).length, 15);
  assert.match(reloaded.state.logs.at(-1).message, /Nama OCR Nusuk pada 15 jamaah berbeda dari data review/);
  await reloaded.session.resetAutofillFromPanel();
  assert.equal(reloaded.state.autofillNameCorrections.length, 0);
  assert.equal(reloaded.stored.testState.autofillNameCorrections.length, 0);
});

test("data warnings survive a stopped batch and reload, remain unique, and clear on reset", async () => {
  const first = harness({ fail: "before_save", dataWarnings: true });
  await first.session.startAutofillFromPanel();
  assert.equal(first.state.executionState, "paused");
  assert.equal(first.stored.testState.autofillDataWarnings.length, 9);
  const reloaded = harness({ initialState: structuredClone(first.stored.testState), dataWarnings: true });
  await reloaded.session.resumeAutofillAfterReload();
  assert.equal(reloaded.state.executionState, "completed");
  assert.equal(reloaded.state.autofillDataWarnings.length, 15);
  assert.equal(new Set(reloaded.state.autofillDataWarnings.map(note => note.memberId)).size, 15);
  assert.equal(reloaded.state.logs.at(-1).level, "warning");
  assert.match(reloaded.state.logs.at(-1).message, /catatan data pada 15 jamaah/);
  assert.deepEqual(reloaded.submitted, range(10));
  await reloaded.session.resetAutofillFromPanel();
  assert.equal(reloaded.state.autofillDataWarnings.length, 0);
  assert.equal(reloaded.stored.testState.autofillDataWarnings.length, 0);
});

test("an uncertain save stays locked until the operator checks it; a saved passport is skipped", async () => {
  const h = harness({ fail: "unconfirmed" });
  await h.session.startAutofillFromPanel();
  assert.deepEqual(h.submitted, range(1, 10));
  assert.equal(h.state.pendingSubmission.memberId, "10");
  await h.session.startAutofillFromPanel(); await h.session.restartFailedFromPanel(); await h.session.resumeAutofillAfterReload();
  assert.equal(h.runs.length, 1);
  await h.session.resolvePendingSubmissionFromPanel(h.resolution("saved"));
  assert.equal(h.runs.length, 1); // Recording a result never starts automation.
  assert.equal(h.state.pendingSubmission, null);
  assert.deepEqual(ids(h.state.currentRunPayload.members), range(11));
  assert.equal(h.state.progressCurrent, 10);
  assert.equal(h.stored["testState:pending"], null);
  h.recover(); await h.session.startAutofillFromPanel();
  assert.deepEqual(h.submitted, range(1));
});

test("a passport confirmed not saved can be retried without clearing earlier successes", async () => {
  const h = harness({ fail: "unconfirmed" });
  await h.session.startAutofillFromPanel();
  await h.session.resolvePendingSubmissionFromPanel(h.resolution("not_saved"));
  assert.deepEqual(Array.from(h.state.completedMemberIds), range(1, 9));
  assert.deepEqual(ids(h.state.currentRunPayload.members), range(10));
  assert.equal(h.state.executionState, "paused");
  assert.equal(h.state.progressCurrent, 9);
  h.recover(); await h.session.startAutofillFromPanel();
  assert.deepEqual(h.submitted.slice(10), range(10));
  assert.equal(h.state.completedMemberIds.length, 15);
});

test("a stale or mismatched save resolution cannot unlock a different submission", async () => {
  const h = harness({ fail: "unconfirmed" });
  await h.session.startAutofillFromPanel();
  const pending = structuredClone(h.state.pendingSubmission);
  for (const change of [{ memberId: "11" }, { passportNumber: "OTHER" }, { startedAt: "old" }, { outcome: "unknown" }]) {
    await assert.rejects(h.session.resolvePendingSubmissionFromPanel({ ...h.resolution("saved"), ...change }));
    assert.deepEqual(structuredClone(h.state.pendingSubmission), pending);
    assert.equal(h.state.completedMemberIds.length, 9);
  }
  h.state.manifest.members[9].passportImagePath = "C:/Demo/wrong.jpeg";
  await assert.rejects(h.session.resolvePendingSubmissionFromPanel(h.resolution("saved")), /tidak memiliki pengiriman yang cocok/);
  assert.ok(h.state.pendingSubmission);
});

test("failed recovery storage restores the save lock, remaining queue, and all successful passports", async () => {
  let failStorage = false;
  const h = harness({ fail: "unconfirmed", onSave: async () => { if (failStorage) throw new Error("storage failed"); } });
  await h.session.startAutofillFromPanel();
  const pending = structuredClone(h.state.pendingSubmission);
  failStorage = true;
  await assert.rejects(h.session.resolvePendingSubmissionFromPanel(h.resolution("saved")), /Progres sebelumnya tetap dipertahankan/);
  assert.deepEqual(structuredClone(h.state.pendingSubmission), pending);
  assert.deepEqual(Array.from(h.state.completedMemberIds), range(1, 9));
  assert.deepEqual(ids(h.state.currentRunPayload.members), range(10));
  assert.equal(h.state.progressCurrent, 9);
  assert.equal(h.state.submissionResolutionInProgress, false);
});

test("concurrent recovery, start, and reset cannot act while a save resolution is persisting", async () => {
  let holdSave = false, release;
  const h = harness({ fail: "unconfirmed", onSave: () => holdSave ? new Promise(resolve => { release = resolve; }) : undefined });
  await h.session.startAutofillFromPanel();
  const request = h.resolution("saved");
  holdSave = true;
  const resolving = h.session.resolvePendingSubmissionFromPanel(request);
  await tick();
  assert.equal(h.state.submissionResolutionInProgress, true);
  await assert.rejects(h.session.resolvePendingSubmissionFromPanel(request), /Jeda/);
  await assert.rejects(h.session.resetAutofillFromPanel(), /Tunggu/);
  await h.session.startAutofillFromPanel();
  assert.equal(h.runs.length, 1);
  release(); await resolving;
  assert.equal(h.state.submissionResolutionInProgress, false);
  assert.deepEqual(ids(h.state.currentRunPayload.members), range(11));
});

test("resolving a paused in-flight save cancels its old callbacks before changing the queue", async () => {
  let release, waiting = false;
  const h = harness({ waitForConfirmation: () => { waiting = true; return new Promise(resolve => { release = resolve; }); } });
  const running = h.session.startAutofillFromPanel();
  for (let attempt = 0; attempt < 20 && !waiting; attempt++) await tick();
  assert.equal(waiting, true);
  await h.session.pauseAutofillFromPanel();
  const resolving = h.session.resolvePendingSubmissionFromPanel(h.resolution("not_saved"));
  release(); await resolving; await running;
  assert.deepEqual(Array.from(h.state.completedMemberIds), range(1, 9));
  assert.deepEqual(ids(h.state.currentRunPayload.members), range(10));
  assert.equal(h.state.pendingSubmission, null);
  assert.equal(h.state.executionState, "paused");
});

test("a confirmed passport stays completed if Nusuk cannot close its success popup", async () => {
  const h = harness({ fail: "close_popup" });
  await h.session.startAutofillFromPanel();
  assert.deepEqual(Array.from(h.state.completedMemberIds), range(1, 9));
  assert.deepEqual(ids(h.state.currentRunPayload.members), range(10));
  h.recover(); await h.session.startAutofillFromPanel();
  assert.deepEqual(h.submitted, range(1));
});

test("failed success checkpoint storage leaves the passport unresolved instead of losing it from the queue", async () => {
  const h = harness({ onSave: async (values, state) => {
    if (Object.hasOwn(values, "testState:pending") && values["testState:pending"] === null && state.completedMemberIds.includes("10")) throw new Error("storage failed after Nusuk success");
  } });
  await h.session.startAutofillFromPanel();
  assert.equal(h.state.pendingSubmission.memberId, "10");
  assert.deepEqual(Array.from(h.state.completedMemberIds), range(1, 9));
  assert.deepEqual(ids(h.state.currentRunPayload.members), range(10));
});

test("an unavailable starting checkpoint pauses the batch before any passport is submitted", async () => {
  const h = harness({ onSave: async () => { throw new Error("storage unavailable"); } });
  await assert.rejects(h.session.startAutofillFromPanel(), /storage unavailable/);
  assert.equal(h.state.executionState, "paused");
  assert.equal(h.submitted.length, 0);
  assert.deepEqual(ids(h.state.currentRunPayload.members), range(1));
});

test("checking the last uncertain passport completes the batch or leaves only that passport to retry", async () => {
  for (const outcome of ["saved", "not_saved"]) {
    const h = harness({ fail: "unconfirmed", failMemberId: "15" });
    await h.session.startAutofillFromPanel();
    assert.equal(h.state.progressCurrent, 14);
    await h.session.resolvePendingSubmissionFromPanel(h.resolution(outcome));
    if (outcome === "saved") {
      assert.equal(h.state.executionState, "completed");
      assert.equal(h.state.currentRunPayload, null);
      assert.equal(h.state.progressCurrent, 15);
      assert.equal(h.snapshots.at(-1).resumeAvailable, false);
    } else {
      assert.equal(h.state.executionState, "paused");
      assert.deepEqual(ids(h.state.currentRunPayload.members), ["15"]);
      assert.equal(h.state.progressCurrent, 14);
    }
  }
});
