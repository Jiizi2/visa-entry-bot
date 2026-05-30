import assert from "node:assert/strict";
import test from "node:test";

import { createReviewFlow } from "../src/main-review-flow.js";

function createFocusableNode(dataset = {}) {
  return {
    dataset,
    focusCount: 0,
    scrollCount: 0,
    scrollOptions: null,
    focus() {
      this.focusCount += 1;
    },
    scrollIntoView(options) {
      this.scrollCount += 1;
      this.scrollOptions = options;
    },
  };
}

function createFixture(overrides = {}) {
  const fieldNodes = overrides.fieldNodes ?? [
    createFocusableNode({ fieldKey: "firstName" }),
    createFocusableNode({ fieldKey: "passportNumber" }),
  ];
  const companionSelect = overrides.companionSelect ?? createFocusableNode();
  const activePassportRow = overrides.activePassportRow ?? createFocusableNode();
  const state = {
    activeFieldCategory: "identity",
    activeMemberId: "m1",
    currentPage: "entry",
    reviewBlock: { target: "field" },
    statusDetail: "",
    statusHeadline: "",
    validationFilter: "valid",
    ...overrides.state,
  };
  const members = overrides.members ?? [
    {
      id: "m1",
      resolvedProfile: { firstName: "First", familyName: "Member" },
    },
    {
      id: "m2",
      resolvedProfile: { firstName: "Second", familyName: "Member" },
    },
  ];
  const calls = {
    renderAll: 0,
    syncPassportPageWithActiveMember: 0,
  };
  const flow = createReviewFlow({
    dom: {
      fieldReviewRows: {
        querySelectorAll: () => fieldNodes,
        querySelector: () => companionSelect,
      },
      passportList: {
        querySelector: () => activePassportRow,
      },
    },
    state,
    requestFrame: (callback) => callback(),
    manifestMembers: () => members,
    syncPassportPageWithActiveMember: () => {
      calls.syncPassportPageWithActiveMember += 1;
    },
    renderAll: () => {
      calls.renderAll += 1;
    },
  });

  return {
    activePassportRow,
    calls,
    companionSelect,
    fieldNodes,
    flow,
    members,
    state,
  };
}

test("review flow blocks batch entry on a specific review field", () => {
  const { calls, fieldNodes, flow, state } = createFixture();

  flow.showBatchReviewBlockingMessage({
    ok: false,
    memberId: "m2",
    categoryId: "passport",
    fieldKey: "passportNumber",
    message: "Nomor passport wajib diisi.",
  });

  assert.equal(state.activeMemberId, "m2");
  assert.equal(state.currentPage, "validation");
  assert.equal(state.activeFieldCategory, "passport");
  assert.equal(state.reviewBlock.target, "field");
  assert.equal(state.reviewBlock.fieldKey, "passportNumber");
  assert.equal(typeof state.reviewBlock.token, "number");
  assert.equal(state.statusHeadline, "Review belum lengkap");
  assert.equal(state.statusDetail, "Nomor passport wajib diisi.");
  assert.equal(calls.syncPassportPageWithActiveMember, 1);
  assert.equal(calls.renderAll, 1);
  assert.equal(fieldNodes[1].focusCount, 1);
  assert.equal(fieldNodes[1].scrollCount, 1);
  assert.deepEqual(fieldNodes[1].scrollOptions, { block: "center", behavior: "smooth" });
});

test("review flow jumps from export preview back to a member", () => {
  const previousElement = globalThis.Element;
  class FakeElement {
    constructor(dataset = {}) {
      this.dataset = dataset;
    }

    closest(selector) {
      return selector === "[data-review-member-id]" ? this : null;
    }
  }
  globalThis.Element = FakeElement;

  try {
    const { activePassportRow, calls, flow, state } = createFixture();
    const button = new FakeElement({ reviewMemberId: "m2" });
    const event = {
      target: button,
      preventDefaultCount: 0,
      preventDefault() {
        this.preventDefaultCount += 1;
      },
    };

    flow.handleExportPreviewMemberClick(event);

    assert.equal(event.preventDefaultCount, 1);
    assert.equal(state.reviewBlock, null);
    assert.equal(state.validationFilter, "all");
    assert.equal(state.activeMemberId, "m2");
    assert.equal(state.activeFieldCategory, "identity");
    assert.equal(state.currentPage, "validation");
    assert.equal(state.statusHeadline, "Kembali ke review");
    assert.match(state.statusDetail, /Second Member/);
    assert.equal(calls.syncPassportPageWithActiveMember, 1);
    assert.equal(calls.renderAll, 1);
    assert.equal(activePassportRow.focusCount, 1);
    assert.equal(activePassportRow.scrollCount, 1);
  } finally {
    if (previousElement === undefined) {
      delete globalThis.Element;
    } else {
      globalThis.Element = previousElement;
    }
  }
});
