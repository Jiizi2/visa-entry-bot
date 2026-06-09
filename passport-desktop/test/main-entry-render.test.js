import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExportPreviewState,
  renderExportPreviewRows,
  renderExportSummaryCards,
  reviewExportStatusDescriptor,
} from "../src/features/entry/render.js";

test("buildExportPreviewState limits visible members while review remains incomplete", () => {
  const members = [
    { id: "ready", reviewStatus: "VALID", reviewConfirmed: true },
    { id: "todo", reviewStatus: "VALID" },
    { id: "error", reviewStatus: "ERROR" },
  ];
  const preview = buildExportPreviewState({
    members,
    selectedIds: new Set(["ready", "todo"]),
    review: { reviewed: 1, total: 2, remaining: 1 },
    reviewedMemberIds: new Set(),
    canExportReviewedJson: false,
    isEntryRunning: false,
  });

  assert.deepEqual(preview.members.map((member) => member.id), ["ready", "error"]);
  assert.equal(preview.readyMembers.length, 1);
  assert.equal(preview.canExport, false);
  assert.match(preview.description, /Selesaikan review/);
});

test("buildExportPreviewState marks export ready only when allowed and not running", () => {
  const members = [{ id: "ready", reviewStatus: "VALID", reviewConfirmed: true }];
  const preview = buildExportPreviewState({
    members,
    selectedIds: new Set(["ready"]),
    review: { reviewed: 1, total: 1, remaining: 0 },
    reviewedMemberIds: new Set(),
    canExportReviewedJson: true,
    isEntryRunning: false,
  });

  assert.equal(preview.canExport, true);
  assert.match(preview.description, /1 jamaah akan masuk batch/);
});

test("renderExportSummaryCards and rows render preview data", () => {
  const preview = buildExportPreviewState({
    members: [{
      id: "ready",
      fileName: "ready.jpg",
      reviewStatus: "VALID",
      resolvedProfile: { firstName: "Ali", passportNumber: "A1" },
    }],
    selectedIds: new Set(["ready"]),
    review: { reviewed: 1, total: 1, remaining: 0 },
    reviewedMemberIds: new Set(["ready"]),
    canExportReviewedJson: true,
    isEntryRunning: false,
  });

  assert.match(renderExportSummaryCards(preview), /Masuk Batch/);
  assert.match(renderExportPreviewRows(preview), /Dipakai extension/);
  assert.match(renderExportPreviewRows(preview), /Reviewed/);
  assert.match(renderExportPreviewRows(preview), /Ali/);
});

test("reviewExportStatusDescriptor maps export state to label and tone", () => {
  assert.deepEqual(reviewExportStatusDescriptor({ isEntryRunning: true }, { canExport: false }), {
    label: "Export berjalan",
    tone: "warn",
  });
  assert.deepEqual(reviewExportStatusDescriptor({ exportedBatchPath: "batch.json" }, { canExport: false }), {
    label: "JSON dibuat",
    tone: "valid",
  });
  assert.deepEqual(reviewExportStatusDescriptor({}, { canExport: true }), {
    label: "Review selesai",
    tone: "ready",
  });
});
