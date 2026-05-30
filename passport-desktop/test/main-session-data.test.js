import assert from "node:assert/strict";
import test from "node:test";

import { createSessionDataController } from "../src/main-session-data.js";

function withLocalStorage(callback) {
  const previousStorage = globalThis.localStorage;
  const entries = new Map();
  globalThis.localStorage = {
    getItem(key) {
      return entries.has(key) ? entries.get(key) : null;
    },
    setItem(key, value) {
      entries.set(key, String(value));
    },
  };

  try {
    return callback(entries);
  } finally {
    if (previousStorage === undefined) {
      delete globalThis.localStorage;
    } else {
      globalThis.localStorage = previousStorage;
    }
  }
}

function createFixture(overrides = {}) {
  const members = overrides.members ?? [];
  const state = {
    errorCount: 0,
    isScanning: true,
    lastWorkerMessage: "",
    manifestPath: "",
    ocrMode: "speed",
    progressCurrent: 1,
    progressFileName: "active.jpg",
    progressStageLabel: "OCR",
    progressTotal: 3,
    recentBatches: [],
    reviewCount: 0,
    scanLogs: [],
    validCount: 0,
    ...overrides.state,
  };
  const controller = createSessionDataController({
    state,
    manifestMembers: () => members,
    recentBatchesStorageKey: "test-recent-batches",
  });

  return {
    controller,
    members,
    state,
  };
}

test("session data appends compact scan logs from the latest worker message", () => {
  const { controller, state } = createFixture();

  controller.appendScanLog(" Worker online ");

  assert.equal(state.lastWorkerMessage, "Worker online");
  assert.deepEqual(state.scanLogs, [
    "1 selesai | +1 aktif | -1 sisa",
    "active.jpg | OCR",
    "Worker online",
  ]);
});

test("session data ignores empty scan messages", () => {
  const { controller, state } = createFixture();

  controller.appendScanLog("   ");

  assert.equal(state.lastWorkerMessage, "");
  assert.deepEqual(state.scanLogs, []);
});

test("session data remembers saves and loads recent batches", () => {
  withLocalStorage(() => {
    const { controller, state } = createFixture();

    controller.rememberRecentBatch("C:/batches/Batch A", 4, "C:/batches/Batch A/manifest.json");
    const loaded = controller.loadRecentBatches();

    assert.equal(state.recentBatches.length, 1);
    assert.equal(state.recentBatches[0].label, "Batch A");
    assert.equal(state.recentBatches[0].totalFiles, 4);
    assert.equal(state.recentBatches[0].manifestPath, "C:/batches/Batch A/manifest.json");
    assert.equal(controller.recentEntryByPath(" C:/batches/Batch A "), state.recentBatches[0]);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].label, "Batch A");
  });
});

test("session data normalizes OCR mode updates", () => {
  const { controller, state } = createFixture();

  controller.updateOcrMode("HEAVY");
  assert.equal(state.ocrMode, "heavy");

  controller.updateOcrMode("unknown");
  assert.equal(state.ocrMode, "speed");
});
