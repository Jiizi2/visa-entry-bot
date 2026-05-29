import assert from "node:assert/strict";
import test from "node:test";

import { createManifestPersistence } from "../src/main-manifest-persistence.js";

function createTimerWindow() {
  const timers = [];
  const cleared = [];
  return {
    timers,
    cleared,
    clearTimeout(handle) {
      cleared.push(handle);
    },
    setTimeout(callback, delay) {
      const handle = timers.length + 1;
      timers.push({ callback, delay, handle });
      return handle;
    },
  };
}

test("manifest persistence ignores empty manifest state", async () => {
  const windowRef = createTimerWindow();
  let saveCount = 0;
  const persistence = createManifestPersistence({
    state: { manifestPath: "", manifest: null },
    renderAll: () => {},
    saveManifest: async () => {
      saveCount += 1;
    },
    windowRef,
  });

  persistence.scheduleManifestSave();
  await persistence.flushManifestSave();

  assert.equal(windowRef.timers.length, 0);
  assert.equal(saveCount, 0);
});

test("manifest persistence schedules and flushes latest manifest snapshot", async () => {
  const state = {
    manifestPath: "C:/batch/manifest.json",
    manifest: { members: [{ id: "member-1", name: "Before" }] },
  };
  const windowRef = createTimerWindow();
  const saved = [];
  const persistence = createManifestPersistence({
    state,
    renderAll: () => {},
    saveManifest: async (payload) => {
      saved.push(payload);
    },
    windowRef,
    defaultDelayMs: 123,
  });

  persistence.scheduleManifestSave();
  persistence.scheduleManifestSave(0);
  state.manifest.members[0].name = "After";
  await persistence.flushManifestSave();

  assert.equal(windowRef.timers.length, 2);
  assert.deepEqual(windowRef.timers.map((timer) => timer.delay), [123, 0]);
  assert.deepEqual(windowRef.cleared, [1, 2]);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].manifestPath, "C:/batch/manifest.json");
  assert.deepEqual(saved[0].manifestData, { members: [{ id: "member-1", name: "After" }] });

  state.manifest.members[0].name = "Mutated";
  assert.equal(saved[0].manifestData.members[0].name, "After");
});

test("manifest persistence reports latest save failure", async () => {
  const state = {
    manifestPath: "C:/batch/manifest.json",
    manifest: { members: [] },
    statusHeadline: "",
    statusDetail: "",
  };
  const windowRef = createTimerWindow();
  let renderCount = 0;
  const persistence = createManifestPersistence({
    state,
    renderAll: () => {
      renderCount += 1;
    },
    saveManifest: async () => {
      throw new Error("disk full");
    },
    windowRef,
  });

  await persistence.flushManifestSave();

  assert.equal(state.statusHeadline, "Gagal menyimpan review");
  assert.equal(state.statusDetail, "Error: disk full");
  assert.equal(renderCount, 1);
});
