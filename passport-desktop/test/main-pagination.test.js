import assert from "node:assert/strict";
import test from "node:test";

import {
  paginateItems,
  paginationState,
  passportListSummaryText,
  reviewPaginationSummaryText,
} from "../src/main-pagination.js";

test("paginationState clamps current page and computes item range", () => {
  assert.deepEqual(paginationState(18, { currentPage: 3, pageSize: 8 }), {
    totalItems: 18,
    pageSize: 8,
    totalPages: 3,
    currentPage: 3,
    offset: 16,
    startIndex: 17,
    endIndex: 18,
    canMovePrev: true,
    canMoveNext: false,
  });

  assert.equal(paginationState(2, { currentPage: 99, pageSize: 8 }).currentPage, 1);
});

test("paginateItems slices by pagination state", () => {
  assert.deepEqual(paginateItems(["a", "b", "c"], paginationState(3, { currentPage: 2, pageSize: 2 })), ["c"]);
});

test("reviewPaginationSummaryText formats active review status", () => {
  assert.equal(reviewPaginationSummaryText({
    totalItems: 3,
    activeIndex: 1,
    reviewed: 2,
    total: 3,
  }), "Passport 2 dari 3 | 2/3 direview");
  assert.equal(reviewPaginationSummaryText({
    totalItems: 0,
    activeIndex: -1,
    reviewed: 0,
    total: 0,
  }), "0 dari 0 passport");
});

test("passportListSummaryText formats filtered and unfiltered ranges", () => {
  assert.equal(passportListSummaryText(paginationState(18, { currentPage: 1, pageSize: 8 }), 18), "1-8 dari 18 data | Halaman 1/3");
  assert.equal(passportListSummaryText(paginationState(4, { currentPage: 1, pageSize: 8 }), 18), "1-4 dari 4 data terfilter (18 total)");
  assert.equal(passportListSummaryText(paginationState(0, { currentPage: 1, pageSize: 8 }), 18), "0 dari 18 data");
});
