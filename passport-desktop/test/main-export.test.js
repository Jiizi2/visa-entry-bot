import assert from "node:assert/strict";
import test from "node:test";

import {
  buildManifestForEntryExport,
  confirmedReviewIds,
  defaultSelectedIds,
  effectiveSelectedIdsForExport,
  isMemberReadyForJson,
  validateCompanionsForExport,
} from "../src/main-export.js";

test("defaultSelectedIds returns entry-ready member ids", () => {
  assert.deepEqual(defaultSelectedIds({
    members: [
      { id: "valid", reviewStatus: "VALID" },
      { id: "review", reviewStatus: "NEEDS_REVIEW" },
      { reviewStatus: "VALID" },
    ],
  }), ["valid"]);
});

test("confirmedReviewIds returns persisted review confirmations", () => {
  assert.deepEqual(confirmedReviewIds({
    members: [
      { id: "a", reviewConfirmed: true },
      { id: "b", reviewConfirmed: false },
    ],
  }), new Set(["a"]));
});

test("isMemberReadyForJson requires valid status and review confirmation", () => {
  assert.equal(isMemberReadyForJson({ id: "a", reviewStatus: "VALID" }, new Set(["a"])), true);
  assert.equal(isMemberReadyForJson({ id: "a", reviewStatus: "VALID" }, new Set()), false);
  assert.equal(isMemberReadyForJson({ id: "a", reviewStatus: "ERROR" }, new Set(["a"])), false);
});

test("effectiveSelectedIdsForExport includes selected child companion", () => {
  const manifest = {
    members: [
      { id: "child", reviewStatus: "VALID", companionMemberId: "adult" },
      { id: "adult", reviewStatus: "VALID" },
    ],
  };

  assert.deepEqual(effectiveSelectedIdsForExport(manifest, new Set(["child"])), new Set(["child", "adult"]));
});

test("validateCompanionsForExport blocks selected children without adult companion", () => {
  const manifest = {
    members: [
      { id: "child", resolvedProfile: { firstName: "Tiny", dob: "2020/01/01" }, reviewStatus: "VALID" },
    ],
  };

  const result = validateCompanionsForExport(manifest, new Set(["child"]));
  assert.equal(result.ok, false);
  assert.equal(result.firstMemberId, "child");
  assert.match(result.message, /companion dewasa/);
});

test("buildManifestForEntryExport enriches child companion data and keeps adults first", () => {
  const manifest = {
    members: [
      {
        id: "child",
        reviewStatus: "VALID",
        companionMemberId: "adult",
        resolvedProfile: { firstName: "Child", dob: "2020/01/01", passportNumber: "C1" },
      },
      {
        id: "adult",
        reviewStatus: "VALID",
        resolvedProfile: { firstName: "Adult", dob: "1990/01/01", passportNumber: "A1" },
      },
    ],
  };

  const result = buildManifestForEntryExport(manifest, new Set(["child"]));
  assert.deepEqual([...result.selectedIds].sort(), ["adult", "child"]);
  assert.equal(result.manifest.members[0].id, "adult");
  assert.equal(result.manifest.members[1].id, "child");
  assert.deepEqual(result.manifest.members[1].companion, {
    id: "adult",
    name: "Adult",
    passportNumber: "A1",
    relation: "Mother",
  });
  assert.equal(manifest.members[0].companion, undefined);
});

test("buildManifestForEntryExport uses cropped passport image path for Nusuk upload", () => {
  const manifest = {
    members: [{
      id: "adult",
      status: "VALID",
      reviewStatus: "VALID",
      reviewConfirmed: true,
      passportImagePath: "data/passports/adult.jpg",
      croppedPassportImagePath: "data/output/nusuk-crops/adult-crop.jpg",
      resolvedProfile: { firstName: "Adult", dob: "1990/01/01" },
    }],
  };

  const result = buildManifestForEntryExport(manifest, new Set(["adult"]));

  assert.equal(result.manifest.members[0].passportImagePath, "data/output/nusuk-crops/adult-crop.jpg");
  assert.equal(manifest.members[0].passportImagePath, "data/passports/adult.jpg");
});

test("buildManifestForEntryExport applies entry defaults to empty resolved fields only", () => {
  const manifest = {
    members: [{
      id: "adult",
      status: "VALID",
      reviewStatus: "VALID",
      reviewConfirmed: true,
      resolvedProfile: {
        firstName: "Adult",
        profession: "TEACHER",
        email: "",
      },
    }],
  };

  const result = buildManifestForEntryExport(manifest, new Set(["adult"]), {
    profession: "OTHER",
    passportType: "NORMAL",
    email: "group@example.com",
  });

  assert.equal(result.manifest.members[0].resolvedProfile.profession, "TEACHER");
  assert.equal(result.manifest.members[0].resolvedProfile.passportType, "NORMAL");
  assert.equal(result.manifest.members[0].resolvedProfile.email, "group@example.com");
  assert.equal(manifest.members[0].resolvedProfile.email, "");
});
