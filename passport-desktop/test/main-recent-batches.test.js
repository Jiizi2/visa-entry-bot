import assert from "node:assert/strict";
import test from "node:test";

import { buildRememberedRecentBatches } from "../src/main-recent-batches.js";

test("buildRememberedRecentBatches preserves edited labels for existing paths", () => {
  const entries = [{
    path: "C:/visa-entry-bot/data/group-a",
    label: "Ramadhan Group",
    usedAt: "2026-01-01T00:00:00.000Z",
    totalFiles: 2,
    manifestPath: "C:/visa-entry-bot/data/group-a/manifest.json",
  }];

  const next = buildRememberedRecentBatches(
    entries,
    "C:/visa-entry-bot/data/group-a",
    3,
    "",
    (path) => path.split("/").pop(),
  );

  assert.equal(next[0].label, "Ramadhan Group");
  assert.equal(next[0].totalFiles, 3);
  assert.equal(next[0].manifestPath, "C:/visa-entry-bot/data/group-a/manifest.json");
});
