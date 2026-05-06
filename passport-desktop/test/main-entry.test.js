import assert from "node:assert/strict";
import test from "node:test";

import {
  computeReviewCompletionState,
  countMembersByStatus,
  isMemberReadyForEntry,
  memberReviewStatus,
} from "../src/main-entry.js";

test("memberReviewStatus prefers reviewStatus and falls back to status", () => {
  assert.equal(memberReviewStatus({ reviewStatus: "NEEDS_REVIEW", status: "VALID" }), "NEEDS_REVIEW");
  assert.equal(memberReviewStatus({ status: "VALID" }), "VALID");
  assert.equal(memberReviewStatus({}), "");
});

test("countMembersByStatus uses effective review status", () => {
  const members = [
    { status: "VALID" },
    { status: "VALID", reviewStatus: "NEEDS_REVIEW" },
    { status: "ERROR", reviewStatus: "ERROR" },
  ];

  assert.equal(countMembersByStatus(members, "VALID"), 1);
  assert.equal(countMembersByStatus(members, "NEEDS_REVIEW"), 1);
  assert.equal(countMembersByStatus(members, "ERROR"), 1);
});

test("review completion treats only effective valid members as auto-reviewed", () => {
  const members = [
    { id: "ready", status: "VALID", reviewStatus: "VALID" },
    { id: "review", status: "VALID", reviewStatus: "NEEDS_REVIEW" },
  ];

  assert.equal(isMemberReadyForEntry(members[0]), true);
  assert.equal(isMemberReadyForEntry(members[1]), false);
  assert.deepEqual(computeReviewCompletionState(members, new Set()), {
    total: 2,
    reviewed: 1,
    remaining: 1,
  });
  assert.deepEqual(computeReviewCompletionState(members, new Set(["review"])), {
    total: 2,
    reviewed: 2,
    remaining: 0,
  });
});
