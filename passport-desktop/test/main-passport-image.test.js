import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCroppedPassportImageToMember,
  passportCropApplied,
  passportCropSourceImageCandidates,
  passportUploadImagePathForMember,
  preservePassportCropFields,
} from "../src/features/passport/image.js";

test("passport image helpers prefer cropped upload path and keep original source", () => {
  const member = {
    id: "member-1",
    passportImagePath: "data/original.jpg",
    fileName: "original.jpg",
  };

  const next = applyCroppedPassportImageToMember(
    member,
    { path: "C:/batch/nusuk-crops/original-member-1-crop.jpg", relativePath: "data/batch/output/nusuk-crops/original-member-1-crop.jpg" },
    { rect: { x: 10, y: 20, width: 300, height: 400 }, sourceImagePath: "data/original.jpg" },
    { now: () => new Date("2026-05-29T00:00:00.000Z") },
  );

  assert.equal(passportCropApplied(next), true);
  assert.equal(next.originalPassportImagePath, "data/original.jpg");
  assert.equal(next.passportImagePath, "data/batch/output/nusuk-crops/original-member-1-crop.jpg");
  assert.equal(passportUploadImagePathForMember(next), "data/batch/output/nusuk-crops/original-member-1-crop.jpg");
  assert.equal(next.cropMetadata.croppedAt, "2026-05-29T00:00:00.000Z");
});

test("passport crop source candidates keep original before cropped path", () => {
  const candidates = passportCropSourceImageCandidates({
    originalPassportImagePath: "data/original.jpg",
    passportImagePath: "data/crop.jpg",
    croppedPassportImagePath: "data/crop.jpg",
  });

  assert.deepEqual(candidates, ["data/original.jpg", "data/crop.jpg"]);
});

test("preservePassportCropFields keeps crop path when resetting member fields", () => {
  const current = {
    passportImagePath: "data/output/nusuk-crops/ali-crop.jpg",
    originalPassportImagePath: "data/passports/ali.jpg",
    croppedPassportImagePath: "data/output/nusuk-crops/ali-crop.jpg",
    nusukUploadImagePath: "data/output/nusuk-crops/ali-crop.jpg",
    cropMetadata: { rect: { x: 1, y: 2, width: 3, height: 4 } },
  };
  const reset = preservePassportCropFields(current, {
    passportImagePath: "data/passports/ali.jpg",
    resolvedProfile: { firstName: "Ali" },
  });

  assert.equal(reset.passportImagePath, "data/output/nusuk-crops/ali-crop.jpg");
  assert.equal(reset.originalPassportImagePath, "data/passports/ali.jpg");
  assert.deepEqual(reset.cropMetadata.rect, { x: 1, y: 2, width: 3, height: 4 });
});
