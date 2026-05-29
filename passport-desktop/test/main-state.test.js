import assert from "node:assert/strict";
import test from "node:test";

import {
  createInitialState,
  MANIFEST_SAVE_DELAY_MS,
  STORAGE_KEYS,
} from "../src/main-state.js";

test("createInitialState returns default app state", () => {
  const state = createInitialState();

  assert.equal(state.currentPage, "import");
  assert.equal(state.ocrMode, "speed");
  assert.equal(state.passportListPageSize, 8);
  assert.equal(state.passportPreviewZoom, 1);
  assert.equal(state.passportCropZoom, 1);
  assert.equal(state.isScanning, false);
  assert.ok(state.selectedIds instanceof Set);
  assert.ok(state.reviewedMemberIds instanceof Set);
  assert.ok(state.passportImageCache instanceof Map);
  assert.equal(MANIFEST_SAVE_DELAY_MS, 350);
  assert.equal(STORAGE_KEYS.recentBatches, "passport-assistant-recent-batches-v1");
});

test("createInitialState does not share mutable collections", () => {
  const first = createInitialState();
  const second = createInitialState();

  first.selectedIds.add("member-1");
  first.reviewedMemberIds.add("member-2");
  first.passportImageCache.set("member-3", "data");
  first.recentBatches.push({ path: "C:/batch" });

  assert.equal(second.selectedIds.size, 0);
  assert.equal(second.reviewedMemberIds.size, 0);
  assert.equal(second.passportImageCache.size, 0);
  assert.equal(second.recentBatches.length, 0);
});
