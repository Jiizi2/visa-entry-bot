import assert from "node:assert/strict";
import test from "node:test";

import {
  compactScanLogs,
  progressSnapshotForState,
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
    "2 selesai | 1 aktif | 1 sisa",
    "active.jpg | OCR",
    "Worker online",
  ]);
});

test("compactScanLogs summarizes prepared preview without scan counters", () => {
  assert.deepEqual(compactScanLogs({
    isScanning: false,
    preparedSession: {
      items: [{ id: "a" }, { id: "b", editedPath: "edited.jpg" }],
    },
    progressTotal: 2,
    progressCurrent: 0,
    lastWorkerMessage: "Foto siap preview | 2 gambar | 0 hasil PDF",
  }), [
    "Preview siap | 2 foto",
    "1 foto sudah dirapikan",
    "Foto siap preview | 2 gambar | 0 hasil PDF",
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

test("renderProgressPanelView renders prepared preview as a completed prepare stage", () => {
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
      isScanning: false,
      preparedSession: { items: [{ id: "a" }, { id: "b" }] },
      scanLogs: [],
      scanMetricRecords: [],
    },
  });

  assert.equal(dom.progressTitle.textContent, "Preview foto siap");
  assert.equal(dom.progressFill.style.width, "100%");
  assert.equal(dom.scanStatDone.textContent, "2");
  assert.equal(dom.scanStatLeft.textContent, "0");
  assert.equal(dom.scanConsoleState.textContent, "Siap Preview");
});

test("progressSnapshotForState clamps invalid progress values", () => {
  assert.deepEqual(progressSnapshotForState({
    isScanning: true,
    progressTotal: 4,
    progressCurrent: 9,
  }), {
    total: 4,
    current: 4,
    percentage: 100,
    title: "Proses berjalan 100%",
    caption: "",
  });
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
  assert.deepEqual(scanConsoleStatusDescriptor({ isPreparingImages: true }), { label: "Menyiapkan", tone: "info" });
  assert.deepEqual(scanConsoleStatusDescriptor({ isScanning: true }), { label: "Berjalan", tone: "info" });
  assert.deepEqual(scanConsoleStatusDescriptor({ manifestPath: "manifest.json" }), { label: "Selesai", tone: "ready" });
  assert.deepEqual(scanConsoleStatusDescriptor({ preparedSession: { items: [{ id: "a" }] } }), { label: "Siap Preview", tone: "ready" });
  assert.deepEqual(scanConsoleStatusDescriptor({}), { label: "Menunggu", tone: "neutral" });
});
