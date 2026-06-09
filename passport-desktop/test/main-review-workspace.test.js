import assert from "node:assert/strict";
import test from "node:test";

import {
  activeCategoryPairForState,
  renderCompanionReviewPanel,
  renderFieldReviewRows,
  renderWorkspaceView,
  workspaceStatusLabel,
  workspaceStatusTone,
} from "../src/features/review/workspace.js";

function createClassList() {
  const classes = new Set();
  return {
    add: (className) => classes.add(className),
    remove: (className) => classes.delete(className),
    contains: (className) => classes.has(className),
  };
}

function createWorkspaceDom() {
  return {
    detailStatus: { className: "", textContent: "" },
    detailSummary: { classList: createClassList(), textContent: "" },
    detailTitle: { textContent: "" },
    fieldCategoryTabs: { innerHTML: "" },
    fieldConfidenceBox: { innerHTML: "" },
    fieldReviewRows: { classList: createClassList(), innerHTML: "" },
    reviewFlagsBox: { innerHTML: "" },
    saveNextButton: { textContent: "" },
    workspaceIssueBox: {
      classList: createClassList(),
      className: "",
      textContent: "",
    },
    workspacePassportCode: { textContent: "" },
  };
}

test("workspace status helpers map member review state", () => {
  assert.equal(workspaceStatusLabel({ status: "ERROR" }), "Perlu perhatian");
  assert.equal(workspaceStatusTone({ status: "ERROR" }), "error");
  assert.equal(workspaceStatusLabel({ status: "VALID", confidence: 0.5 }), "Perlu dicek");
  assert.equal(workspaceStatusLabel({ status: "VALID", confidence: 0.95 }), "Reviewed");
  assert.equal(workspaceStatusTone({ status: "VALID", confidence: 0.95 }), "valid");
  assert.equal(activeCategoryPairForState({ activeFieldCategory: "missing" }).id, "identity");
});

test("renderFieldReviewRows renders editable fields and clamps name length", () => {
  const member = {
    id: "member-1",
    status: "NEEDS_REVIEW",
    confidence: 0.91,
    resolvedProfile: {
      firstName: "ABCDEFGHIJKLMNOPQRST",
      fatherName: "Ali",
      familyName: "Saleh",
      dob: "1990/01/02",
      passportNumber: "P123",
    },
    passportExtracted: {
      firstName: "ABC",
      passportNumber: "P123",
    },
  };

  const html = renderFieldReviewRows({
    state: {
      activeFieldCategory: "identity",
      reviewBlock: { target: "field", fieldKey: "firstName" },
    },
    member,
    members: [member],
  });

  assert.match(html, /data-field-key="firstName"/);
  assert.match(html, /value="ABCDEFGHIJKLMNO"/);
  assert.match(html, /field-requirement-badge required">Wajib/);
  assert.match(html, /field-requirement-badge optional">Optional/);
  assert.match(html, /is-blocked/);
  assert.match(html, /Sumber scan/);
  assert.equal(member.resolvedProfile.firstName, "ABCDEFGHIJKLMNO");
});

test("renderCompanionReviewPanel renders adult companion choices for children", () => {
  const adult = {
    id: "adult-1",
    resolvedProfile: {
      firstName: "Adult",
      familyName: "Member",
      dob: "1980/01/01",
      passportNumber: "A123",
    },
  };
  const child = {
    id: "child-1",
    companionMemberId: "adult-1",
    resolvedProfile: {
      firstName: "Child",
      familyName: "Member",
      dob: "2020/01/01",
      passportNumber: "C123",
    },
  };

  const html = renderCompanionReviewPanel({
    state: {},
    member: child,
    members: [child, adult],
  });

  assert.match(html, /Companion wajib/);
  assert.match(html, /Adult Member \| A123/);
  assert.match(html, /is-complete/);
});

test("renderWorkspaceView renders empty workspace state", () => {
  const dom = createWorkspaceDom();
  const documentRef = {
    querySelector: () => ({ classList: createClassList() }),
  };

  renderWorkspaceView({
    dom,
    state: {},
    documentRef,
    activeMember: () => null,
    manifestMembers: () => [],
    initializeWorkspaceDatePickers: () => {},
    reviewPrimaryActionLabel: () => "Lanjut",
  });

  assert.equal(dom.detailStatus.textContent, "Menunggu");
  assert.equal(dom.workspacePassportCode.textContent, "-");
  assert.match(dom.fieldReviewRows.innerHTML, /Belum ada data/);
  assert.equal(dom.saveNextButton.textContent, "Lanjut");
});
