import assert from "node:assert/strict";
import test from "node:test";

import {
  importFooterMessage,
  ocrStatusDescriptor,
  renderMiniStatus,
  renderRecentActionIcon,
  renderRecentBatchesView,
} from "../src/main-import-render.js";

test("importFooterMessage describes selected-folder conflicts and completed scans", () => {
  assert.equal(importFooterMessage({
    state: {
      selectedDir: "C:/new-batch",
      resultSourceDir: "C:/old-batch",
      resultDir: "",
    },
    hasAnyScanResult: () => true,
    hasScanResultForSelectedDir: () => false,
  }), "Data aktif saat ini berasal dari folder old-batch. Jika lanjut, proses akan mengganti data dengan folder new-batch.");

  assert.equal(importFooterMessage({
    state: { validCount: 2, reviewCount: 1, errorCount: 0 },
    hasAnyScanResult: () => true,
    hasScanResultForSelectedDir: () => true,
  }), "Proses terakhir sudah selesai. 2 data siap dipakai, 1 perlu review, dan 0 error.");
});

test("ocrStatusDescriptor maps import state to mini status", () => {
  assert.deepEqual(ocrStatusDescriptor({
    state: { isStoppingScan: true },
    hasAnyScanResult: () => false,
    hasScanResultForSelectedDir: () => false,
  }), { label: "Menghentikan", tone: "warn" });
  assert.deepEqual(ocrStatusDescriptor({
    state: { selectedDir: "C:/batch" },
    hasAnyScanResult: () => false,
    hasScanResultForSelectedDir: () => false,
  }), { label: "Siap", tone: "ready" });
});

test("renderMiniStatus updates node label and tone", () => {
  const node = {};
  renderMiniStatus(node, { label: "Siap", tone: "ready" });
  assert.equal(node.textContent, "Siap");
  assert.equal(node.className, "mini-status ready");
});

test("renderRecentBatchesView renders empty and populated states", () => {
  const dom = { recentBatchesList: { innerHTML: "" } };
  renderRecentBatchesView({ dom, state: { recentBatches: [] } });
  assert.match(dom.recentBatchesList.innerHTML, /Belum ada folder/);

  renderRecentBatchesView({
    dom,
    state: {
      recentBatches: [{
        path: "C:/batch",
        label: "Batch A",
        totalFiles: 3,
        usedAt: "2026-05-29T00:00:00.000Z",
      }],
    },
  });
  assert.match(dom.recentBatchesList.innerHTML, /Batch A/);
  assert.match(dom.recentBatchesList.innerHTML, /3 file/);
  assert.match(dom.recentBatchesList.innerHTML, /data-recent-edit-path/);
});

test("renderRecentActionIcon renders edit and delete icons", () => {
  assert.match(renderRecentActionIcon("edit"), /recent-action-svg/);
  assert.match(renderRecentActionIcon("delete"), /M9 3h6/);
});
