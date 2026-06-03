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

test("missingRequiredReviewFields ignores optional empty review fields", () => {
  assert.deepEqual(missingRequiredReviewFields({
    resolvedProfile: completeProfile({ countryOfIssued: "" }),
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

test("missingRequiredReviewFields does not allow intentional empty flags for required fields", () => {
  const missing = missingRequiredReviewFields({
    resolvedProfile: completeProfile({ passportNumber: "" }),
    reviewFlags: {
      resolvedProfile: {
        passportNumber: ["INTENTIONAL_EMPTY"],
      },
    },
  });

  assert.equal(missing[0].key, "passportNumber");
});

test("requiredFieldBlockingIssueForBatch blocks error records with missing required fields", () => {
  const issue = requiredFieldBlockingIssueForBatch([
    { id: "error", reviewStatus: "ERROR", resolvedProfile: {} },
    { id: "valid", reviewStatus: "VALID", resolvedProfile: completeProfile() },
  ]);

  assert.equal(issue.ok, false);
  assert.equal(issue.memberId, "error");
  assert.equal(issue.fieldKey, "firstName");
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
