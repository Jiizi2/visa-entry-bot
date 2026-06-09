import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_OCR_MODE,
  loadOcrMode,
  normalizeOcrMode,
  ocrModeLabel,
} from "../src/shared/ocr.js";

test("normalizeOcrMode accepts known modes and falls back to default", () => {
  assert.equal(normalizeOcrMode("BALANCED"), "balanced");
  assert.equal(normalizeOcrMode("unknown"), DEFAULT_OCR_MODE);
  assert.equal(normalizeOcrMode(null), DEFAULT_OCR_MODE);
});

test("ocrModeLabel returns display labels", () => {
  assert.equal(ocrModeLabel("speed"), "Speed");
  assert.equal(ocrModeLabel("heavy"), "Heavy");
  assert.equal(ocrModeLabel("bad-value"), "Speed");
});

test("loadOcrMode returns default OCR mode", () => {
  assert.equal(loadOcrMode(), DEFAULT_OCR_MODE);
});
