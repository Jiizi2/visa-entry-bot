import assert from "node:assert/strict";
import test from "node:test";

import {
  companionBlockingIssue,
  fieldCategoryPairIdForKey,
  missingRequiredReviewFields,
  requiredFieldBlockingIssueForBatch,
  reviewCompletionValidation,
} from "../src/main-review-validation.js";

function yearsAgoDate(yearsAgo) {
  const now = new Date();
  return `${String(now.getFullYear() - yearsAgo).padStart(4, "0")}/01/01`;
}

function completeProfile(overrides = {}) {
  return {
    firstName: "Ali",
    fatherName: "",
    grandfatherName: "",
    familyName: "Rahman",
    dob: yearsAgoDate(30),
    nationality: "Indonesia",
    passportNumber: "A123",
    countryOfIssued: "Indonesia",
    expiryDate: "2030/01/01",
    gender: "Male",
    passportType: "P",
    releaseDate: "2025/01/01",
    cityOfIssued: "Jakarta",
    birthCountry: "Indonesia",
    birthCity: "Jakarta",
    profession: "Employee",
    maritalStatus: "Single",
    email: "ali@example.com",
    mobileNumber: "628123456789",
    arabic: {
      firstName: "علي",
      fatherName: "",
      grandfatherName: "",
      familyName: "رحمن",
    },
    ...overrides,
  };
}

test("missingRequiredReviewFields ignores optional empty father and grandfather fields", () => {
  assert.deepEqual(missingRequiredReviewFields({
    resolvedProfile: completeProfile(),
  }), []);
});

test("reviewCompletionValidation points at the first missing required field", () => {
  const validation = reviewCompletionValidation({
    resolvedProfile: completeProfile({ passportNumber: "" }),
  });

  assert.equal(validation.ok, false);
  assert.equal(validation.target, "field");
  assert.equal(validation.fieldKey, "passportNumber");
  assert.match(validation.message, /data wajib/);
});

test("missingRequiredReviewFields allows intentional empty review flags", () => {
  assert.deepEqual(missingRequiredReviewFields({
    resolvedProfile: completeProfile({ passportNumber: "" }),
    reviewFlags: {
      resolvedProfile: {
        passportNumber: ["INTENTIONAL_EMPTY"],
      },
    },
  }), []);
});

test("requiredFieldBlockingIssueForBatch skips error records", () => {
  assert.equal(requiredFieldBlockingIssueForBatch([
    { id: "error", reviewStatus: "ERROR", resolvedProfile: {} },
    { id: "valid", reviewStatus: "VALID", resolvedProfile: completeProfile() },
  ]).ok, true);
});

test("companionBlockingIssue requires adult companion for children", () => {
  const child = {
    id: "child",
    resolvedProfile: completeProfile({ dob: yearsAgoDate(5) }),
  };
  const adult = {
    id: "adult",
    resolvedProfile: completeProfile({ firstName: "Adult", dob: yearsAgoDate(30) }),
  };

  assert.equal(companionBlockingIssue(child, [child, adult])?.target, "companion");
  child.companionMemberId = "adult";
  assert.equal(companionBlockingIssue(child, [child, adult]), null);
});

test("fieldCategoryPairIdForKey maps known and unknown fields", () => {
  assert.equal(fieldCategoryPairIdForKey("passportNumber"), "identity");
  assert.equal(fieldCategoryPairIdForKey("arabic.firstName"), "arabic");
  assert.equal(fieldCategoryPairIdForKey("unknownField"), "identity");
});
