import assert from "node:assert/strict";
import test from "node:test";

import {
  compactScanLogs,
  renderProgressPanelView,
  renderScanLogsView,
  scanConsoleStatusDescriptor,
} from "../src/main-scan-render.js";

function node() {
  return {
    textContent: "",
    className: "",
    disabled: false,
    style: {
      width: "",
    },
    parentElement: {
      attributes: new Map(),
      setAttribute(name, value) {
        this.attributes.set(name, String(value));
      },
    },
  };
}

test("compactScanLogs summarizes active scan state", () => {
  assert.deepEqual(compactScanLogs({
    isScanning: true,
    progressTotal: 4,
    progressCurrent: 2,
    progressFileName: "active.jpg",
    progressStageLabel: "OCR",
    lastWorkerMessage: "Worker online",
  }), [
    "2 selesai | +1 aktif | -1 sisa",
    "active.jpg | OCR",
    "Worker online",
  ]);
});

test("compactScanLogs appends final result with timing", () => {
  assert.deepEqual(compactScanLogs({
    isScanning: false,
    manifestPath: "manifest.json",
    validCount: 1,
    reviewCount: 1,
    errorCount: 0,
  }, [
    { processingMetrics: { totalMs: 1000 } },
    { processingMetrics: { totalMs: 3000 } },
  ]), [
    "Hasil akhir | VALID 1 | REVIEW 1 | ERROR 0 | avg 2,0 dtk",
  ]);
});

test("renderProgressPanelView renders progress and scan stats", () => {
  const dom = {
    progressTitle: node(),
    progressCaption: node(),
    progressFill: node(),
    scanStatTotal: node(),
    scanStatDone: node(),
    scanStatLeft: node(),
    scanStatAverage: node(),
    scanStatLastTime: node(),
    scanConsoleState: node(),
  };

  renderProgressPanelView({
    dom,
    state: {
      isScanning: true,
      progressTotal: 4,
      progressCurrent: 2,
      progressFileName: "active.jpg",
      progressStageLabel: "OCR",
      scanLogs: [],
      scanMetricRecords: [],
    },
    members: [{ processingMetrics: { totalMs: 2000 } }],
  });

  assert.equal(dom.progressTitle.textContent, "Proses berjalan 50%");
  assert.equal(dom.progressFill.style.width, "50%");
  assert.equal(dom.scanStatLeft.textContent, "2");
  assert.equal(dom.scanConsoleState.textContent, "Berjalan");
});

test("renderScanLogsView toggles empty and compact log states", () => {
  const dom = {
    scanLogBox: node(),
    logCounter: node(),
    scanLogToggle: node(),
  };

  renderScanLogsView({ dom, state: { scanLogs: [], showFullScanLog: false } });
  assert.equal(dom.scanLogBox.textContent, "Menunggu proses dimulai...");
  assert.equal(dom.scanLogToggle.disabled, true);

  renderScanLogsView({ dom, state: { scanLogs: ["a", "b", "c"], showFullScanLog: false } });
  assert.equal(dom.scanLogBox.textContent, "b\nc");
  assert.equal(dom.logCounter.textContent, "3 log");
  assert.equal(dom.scanLogToggle.textContent, "Detail");
});

test("scanConsoleStatusDescriptor maps scan state", () => {
  assert.deepEqual(scanConsoleStatusDescriptor({ isScanning: true }), { label: "Berjalan", tone: "info" });
  assert.deepEqual(scanConsoleStatusDescriptor({ manifestPath: "manifest.json" }), { label: "Selesai", tone: "ready" });
  assert.deepEqual(scanConsoleStatusDescriptor({}), { label: "Menunggu", tone: "neutral" });
});
