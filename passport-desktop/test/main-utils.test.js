import assert from "node:assert/strict";
import test from "node:test";

import { formatDurationMs } from "../src/shared/utils.js";

test("formatDurationMs renders scan timing labels", () => {
  assert.equal(formatDurationMs(0), "-");
  assert.equal(formatDurationMs(320), "320 ms");
  assert.equal(formatDurationMs(1234), "1,2 dtk");
  assert.equal(formatDurationMs(12800), "13 dtk");
  assert.equal(formatDurationMs(65400), "1m 5s");
});
