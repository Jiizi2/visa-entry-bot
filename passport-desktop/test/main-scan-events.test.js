import assert from "node:assert/strict";
import test from "node:test";

import {
  formatStageLog,
  handleScanEventPayload,
  setupScanEventBridge,
} from "../src/main-scan-events.js";

function baseState() {
  return {
    selectedDir: "C:/batch",
    ocrMode: "speed",
    scanMetricRecords: [],
  };
}

test("setupScanEventBridge registers scan-event listener", async () => {
  const registered = [];
  await setupScanEventBridge({
    state: baseState(),
    listen: async (eventName, handler) => {
      registered.push({ eventName, handler });
    },
  });

  assert.equal(registered.length, 1);
  assert.equal(registered[0].eventName, "scan-event");
  assert.equal(typeof registered[0].handler, "function");
});

test("handleScanEventPayload starts scan and records recent batch", async () => {
  const state = baseState();
  const logs = [];
  const recent = [];
  let rendered = 0;

  await handleScanEventPayload({
    event: "scan_started",
    totalFiles: 3,
    groupId: "group-1",
    ocrProfile: "balanced",
  }, {
    state,
    appendScanLog: (message) => logs.push(message),
    rememberRecentBatch: (...args) => recent.push(args),
    renderAll: () => {
      rendered += 1;
    },
  });

  assert.equal(state.isScanning, true);
  assert.equal(state.progressTotal, 3);
  assert.equal(state.progressStageLabel, "Menyiapkan antrean scan");
  assert.match(logs[0], /OCR Balanced/);
  assert.deepEqual(recent[0], ["C:/batch", 3]);
  assert.equal(rendered, 1);
});

test("handleScanEventPayload records scan metrics", async () => {
  const state = baseState();
  const logs = [];
  let scheduled = 0;

  await handleScanEventPayload({
    event: "scan_metric",
    fileName: "passport.jpg",
    metrics: { totalMs: 1234.4 },
  }, {
    state,
    appendScanLog: (message) => logs.push(message),
    scheduleRenderAll: () => {
      scheduled += 1;
    },
  });

  assert.deepEqual(state.lastScanMetric, {
    fileName: "passport.jpg",
    totalMs: 1234,
    metrics: { totalMs: 1234.4 },
  });
  assert.equal(state.scanMetricRecords.length, 1);
  assert.match(logs[0], /passport\.jpg/);
  assert.equal(scheduled, 1);
});

test("handleScanEventPayload completes scan after loading manifest", async () => {
  const state = baseState();
  const calls = [];

  await handleScanEventPayload({
    event: "scan_complete",
    manifestPath: "manifest.json",
    groupDir: "group-dir",
    totalFiles: 2,
    validCount: 1,
    errorCount: 0,
    reviewCount: 1,
  }, {
    state,
    appendScanLog: (message) => calls.push(["log", message]),
    rememberRecentBatch: (...args) => calls.push(["recent", ...args]),
    loadManifest: async () => calls.push(["load"]),
    closeStopScanModal: () => calls.push(["close"]),
    renderAll: () => calls.push(["render"]),
  });

  assert.equal(state.isScanning, false);
  assert.equal(state.manifestPath, "manifest.json");
  assert.equal(state.resultDir, "group-dir");
  assert.equal(state.progressStageLabel, "Semua file selesai");
  assert.deepEqual(calls.slice(-3), [
    ["load"],
    ["close"],
    ["render"],
  ]);
});

test("formatStageLog formats file and message fallback", () => {
  assert.equal(formatStageLog({ fileName: "a.jpg", message: "OCR" }), "a.jpg | OCR");
  assert.equal(formatStageLog({}), "passport | Sedang bekerja");
});
