import assert from "node:assert/strict";
import test from "node:test";

import {
  arabicFieldForLatinName,
  isReviewFieldRequired,
  transliteratedArabicValueForField,
} from "../src/main-fields.js";

test("latin name fields map to matching arabic fields", () => {
  assert.equal(arabicFieldForLatinName("firstName"), "arabic.firstName");
  assert.equal(arabicFieldForLatinName("fatherName"), "arabic.fatherName");
  assert.equal(arabicFieldForLatinName("grandfatherName"), "arabic.grandfatherName");
  assert.equal(arabicFieldForLatinName("familyName"), "arabic.familyName");
  assert.equal(arabicFieldForLatinName("arabic.firstName"), "");
});

test("latin name edits produce clamped arabic review values", () => {
  assert.equal(transliteratedArabicValueForField("firstName", "MUHAMMAD"), "\u0645\u062d\u0645\u062f");
  assert.equal(transliteratedArabicValueForField("familyName", "NURHIDAYAH"), "\u0646\u0648\u0631 \u0647\u062f\u0627\u064a\u0629");
  assert.equal(transliteratedArabicValueForField("passportNumber", "E1234567"), "");
});

test("review field metadata separates required and optional fields", () => {
  assert.equal(isReviewFieldRequired("passportNumber"), true);
  assert.equal(isReviewFieldRequired("arabic.familyName"), true);
  assert.equal(isReviewFieldRequired("fatherName"), false);
  assert.equal(isReviewFieldRequired("arabic.grandfatherName"), false);
  assert.equal(isReviewFieldRequired("countryOfIssued"), false);
});
