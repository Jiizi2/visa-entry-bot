import assert from "node:assert/strict";
import test from "node:test";

import {
  clampPassportCropZoom,
  defaultPassportCropRect,
  normalizeCropRect,
  passportCropModeDescriptor,
  updateCropRectForInteraction,
} from "../src/main-passport-crop.js";

test("clampPassportCropZoom keeps crop zoom within supported bounds", () => {
  assert.equal(clampPassportCropZoom(0.2), 0.75);
  assert.equal(clampPassportCropZoom(3), 2);
  assert.equal(clampPassportCropZoom(1.234), 1.23);
  assert.equal(clampPassportCropZoom("bad"), 1);
});

test("passportCropModeDescriptor separates prepared and Nusuk crop copy", () => {
  assert.equal(passportCropModeDescriptor("prepared").title, "Rapikan Foto Scan");
  assert.equal(passportCropModeDescriptor("prepared").saveLabel, "Simpan Foto");
  assert.equal(passportCropModeDescriptor("member").title, "Crop Foto Passport");
  assert.equal(passportCropModeDescriptor("member").saveLabel, "Simpan Crop");
});

test("normalizeCropRect clamps crop rectangle inside image bounds", () => {
  assert.deepEqual(
    normalizeCropRect({ x: -10, y: 20, width: 500, height: 20 }, 400, 300),
    { x: 0, y: 20, width: 400, height: 48 },
  );
});

test("defaultPassportCropRect leaves a small inset around the image", () => {
  assert.deepEqual(defaultPassportCropRect(1000, 500), {
    x: 60,
    y: 30,
    width: 880,
    height: 440,
  });
});

test("updateCropRectForInteraction moves and resizes crop rectangles", () => {
  const rect = { x: 50, y: 40, width: 200, height: 160 };

  assert.deepEqual(updateCropRectForInteraction("move", rect, 40, -100, 500, 400), {
    x: 90,
    y: 0,
    width: 200,
    height: 160,
  });
  assert.deepEqual(updateCropRectForInteraction("se", rect, 400, 300, 500, 400), {
    x: 50,
    y: 40,
    width: 450,
    height: 360,
  });
  assert.deepEqual(updateCropRectForInteraction("nw", rect, 190, 140, 500, 400), {
    x: 202,
    y: 152,
    width: 48,
    height: 48,
  });
});
