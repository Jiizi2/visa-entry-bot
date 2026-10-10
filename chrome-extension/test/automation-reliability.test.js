const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ROOT = path.resolve(__dirname, "..");
const tick = () => new Promise(resolve => setImmediate(resolve));

function fakeClock() {
  let now = 0, nextId = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout: (callback, ms) => { const id = ++nextId; timers.set(id, { callback, at: now + ms }); return id; },
    clearTimeout: id => timers.delete(id),
    advance(ms) {
      const target = now + ms;
      while (true) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > target) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = target;
    },
  };
}

function harness({ onStep, memberCount = 16 } = {}) {
  const clock = fakeClock(), submitted = [], calls = [];
  const members = Array.from({ length: memberCount }, (_, index) => ({
    id: String(index + 1), passportImagePath: `C:/Demo/${index + 1}.jpeg`,
    resolvedProfile: { firstName: "ALI", familyName: "BUDI", passportNumber: `X${String(index + 1).padStart(7, "0")}` },
  }));
  const state = { runToken: 1, executionState: "running", manifest: { members }, currentRunPayload: { members } };
  const root = {
    constants: { PASSPORT_UPLOAD_SELECTOR: "passport", NEXT_BUTTON_SELECTOR: "next", AUTOFILL_MAX_RETRIES_PER_MEMBER: 3, AUTOFILL_MEMBER_WATCHDOG_MS: 180000 },
    dateUtils: { normalizeDateToIso: value => value }, valueUtils: { deepValue: () => "" },
    manifestValidator: { ENTRY_BATCH_SCHEMA_VERSION: "nusuk-entry-batch-v1", validateManifestForEntry() {} },
    identityGuard: { verifySummaryIdentity() {} },
    automationSteps: { buildPerMemberSteps: () => [
      { action: "verify_passport_identity" },
      { action: "click" },
      { action: "wait_for_selector", selector: "Mutamer has been added successfully" },
    ] },
  };
  const ctx = vm.createContext({
    window: { NusukAutofill: root, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
    Date: class extends Date { static now() { return clock.now(); } },
    chrome: { runtime: { sendMessage: async () => ({ ok: false }) } },
    location: { href: "https://masar.nusuk.sa/entry", reload: () => { throw new Error("Unexpected page reload"); } },
    document: { readyState: "complete", hidden: false, body: { innerText: "" }, querySelector: () => null, querySelectorAll: () => [] },
  });
  for (const file of ["submission-guard.js", "automation-runner.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, "content", file), "utf8"), ctx, { filename: file });
  }
  const checkpoint = async runId => {
    if (runId !== state.runToken) throw Object.assign(new Error("cancelled"), { name: "NusukControlError" });
  };
  const persistState = async () => {};
  const runner = root.automationRunner.createAutomationRunner({
    state, checkpoint, persistState, postPanelState() {}, appendLog() {},
    sleep: async ms => { clock.advance(ms); }, slowModeDelayAfterStep: async () => {}, detectNusukStage: () => 0,
    runStep: async (step, context) => {
      calls.push({ action: step.action, memberId: context.member.id });
      await onStep?.({ step, context, state, clock, checkpoint });
      await checkpoint(context.runId);
      if (step.action === "click") {
        await root.submissionGuard.submitOnce({ state, context, runId: context.runId, persistState, checkpoint, click: async () => submitted.push(context.member.id) });
      }
    },
  });
  return { clock, state, runner, submitted, calls };
}

test("a 16-passport batch can exceed three minutes per passport when each step continues to complete", async () => {
  const h = harness({ onStep: ({ clock }) => { clock.advance(100000); } });
  await h.runner.runAutomation(h.state.currentRunPayload);
  assert.deepEqual(h.submitted, Array.from({ length: 16 }, (_, index) => String(index + 1)));
  assert.equal(h.state.progressCurrent, 16);
  assert.equal(h.state.completedMemberIds.length, 16);
  assert.equal(h.state.pendingSubmission, null);
  assert.equal(h.state.currentRunPayload, null);
});

test("pausing longer than the watchdog window preserves the active passport and run token", async () => {
  let release;
  const paused = new Promise(resolve => { release = resolve; });
  const h = harness({ memberCount: 1, onStep: async ({ step }) => { if (step.action === "open_mutamer_form") await paused; } });
  const running = h.runner.runAutomation(h.state.currentRunPayload);
  running.catch(() => {});
  await tick();
  h.state.executionState = "paused";
  h.clock.advance(360000);
  try { assert.equal(h.state.runToken, 1); } finally { h.state.executionState = "running"; release(); }
  await running;
  assert.deepEqual(h.submitted, ["1"]);
});

test("a genuinely stuck step cancels late writes and retains the rest of the 16-passport batch", async () => {
  let release, wrote = false;
  const pending = new Promise(resolve => { release = resolve; });
  const h = harness({ onStep: async ({ context, checkpoint }) => { await pending; await checkpoint(context.runId); wrote = true; } });
  const running = h.runner.runAutomation(h.state.currentRunPayload);
  running.catch(() => {});
  await tick();
  h.clock.advance(180000);
  await assert.rejects(running, /watchdog_timeout/);
  assert.equal(h.state.runToken, 2);
  release(); await tick();
  assert.equal(wrote, false);
  assert.equal(h.submitted.length, 0);
  assert.equal(h.calls.length, 1);
  assert.equal(h.state.currentRunPayload.members.length, 16);
});

test("temporarily unreadable passport data retries the same member and completes all 16 without duplicate saves", async () => {
  let unreadable = true;
  const h = harness({ onStep: ({ step, context }) => {
    if (unreadable && context.member.id === "10" && step.action === "verify_passport_identity") {
      unreadable = false;
      throw Object.assign(new Error("Nomor paspor belum selesai dimuat"), { name: "NusukIdentityError", retryable: true });
    }
  } });
  await h.runner.runAutomation(h.state.currentRunPayload);
  assert.deepEqual(h.submitted, Array.from({ length: 16 }, (_, index) => String(index + 1)));
  assert.equal(h.state.progressCurrent, 16);
  assert.equal(h.state.autofillFailures?.length || 0, 0);
  assert.equal(h.state.autofillAttemptFailures.length, 1);
});

test("a replaced run's watchdog cannot invalidate the replacement run or allow late writes", async () => {
  let release, wrote = false;
  const pending = new Promise(resolve => { release = resolve; });
  const h = harness({ memberCount: 1, onStep: async ({ context, checkpoint }) => { await pending; await checkpoint(context.runId); wrote = true; } });
  const running = h.runner.runAutomation(h.state.currentRunPayload);
  running.catch(() => {});
  await tick();
  h.state.runToken = 2;
  h.clock.advance(180000);
  await assert.rejects(running, /Execution interrupted/);
  assert.equal(h.state.runToken, 2);
  release(); await tick();
  assert.equal(wrote, false);
  assert.equal(h.submitted.length, 0);
});
