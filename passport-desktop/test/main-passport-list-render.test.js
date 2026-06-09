import assert from "node:assert/strict";
import test from "node:test";

import {
  memberTone,
  passportListPaginationState,
  renderPassportListItem,
  renderPassportListView,
} from "../src/features/passport/list-render.js";

function createClassList() {
  const classes = new Set();
  return {
    toggle(className, force) {
      if (force) {
        classes.add(className);
      } else {
        classes.delete(className);
      }
    },
    contains(className) {
      return classes.has(className);
    },
  };
}

function createButton(dataset = {}) {
  return {
    attrs: {},
    classList: createClassList(),
    dataset,
    disabled: false,
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
  };
}

test("renderPassportListItem renders active reviewed child state", () => {
  const member = {
    id: "member-1",
    status: "VALID",
    confidence: 0.96,
    resolvedProfile: {
      firstName: "Child",
      familyName: "Member",
      dob: "2020/01/01",
      passportNumber: "P123",
    },
  };

  const html = renderPassportListItem({
    state: { activeMemberId: "member-1" },
    member,
    isMemberReviewConfirmed: () => true,
  });

  assert.match(html, /passport-item is-active is-reviewed/);
  assert.match(html, /Child Member/);
  assert.match(html, /P123/);
  assert.match(html, /Butuh companion/);
  assert.equal(memberTone({ status: "ERROR" }), "error");
});

test("renderPassportListView renders counts progress rows and pagination", () => {
  const allMembers = [
    {
      id: "member-1",
      status: "VALID",
      confidence: 0.95,
      resolvedProfile: {
        firstName: "Adult",
        familyName: "One",
        dob: "1980/01/01",
        passportNumber: "A1",
      },
    },
    {
      id: "member-2",
      status: "ERROR",
      confidence: 0.4,
      resolvedProfile: {
        firstName: "Adult",
        familyName: "Two",
        dob: "1981/01/01",
        passportNumber: "A2",
      },
    },
  ];
  const activeFilter = createButton({ validationFilter: "valid" });
  const dom = {
    batchBadge: { textContent: "" },
    filterAllCount: { textContent: "" },
    filterErrorCount: { textContent: "" },
    filterValidCount: { textContent: "" },
    filterButtons: [activeFilter],
    passportList: { innerHTML: "" },
    passportListSummary: { textContent: "" },
    passportPageNextButton: createButton(),
    passportPagePrevButton: createButton(),
    passportReviewProgress: { textContent: "" },
  };
  const state = {
    activeMemberId: "member-1",
    passportListPage: 1,
    passportListPageSize: 8,
    resultDir: "C:/batch-a",
    selectedDir: "",
    validationFilter: "valid",
  };

  renderPassportListView({
    dom,
    state,
    allMembers,
    visibleMembers: [allMembers[0]],
    review: { reviewed: 1, total: 2, remaining: 1 },
    isMemberReviewConfirmed: (member) => member.id === "member-1",
    activeNavigationState: () => ({ canMovePrev: false, canMoveNext: true }),
    canAdvanceToNextPassport: () => true,
  });

  assert.equal(dom.filterAllCount.textContent, "2");
  assert.equal(dom.filterErrorCount.textContent, "1");
  assert.equal(dom.filterValidCount.textContent, "1");
  assert.equal(activeFilter.classList.contains("is-active"), true);
  assert.equal(dom.batchBadge.textContent, "Kelompok batch-a");
  assert.equal(dom.passportReviewProgress.textContent, "1/2 direview | 1 belum dicek");
  assert.match(dom.passportList.innerHTML, /Adult One/);
  assert.match(dom.passportListSummary.textContent, /1-1/);
  assert.equal(dom.passportPagePrevButton.disabled, true);
  assert.equal(dom.passportPageNextButton.disabled, false);
});

test("passportListPaginationState clamps page on state", () => {
  const state = { passportListPage: 10, passportListPageSize: 2 };
  const pagination = passportListPaginationState(state, 3);

  assert.equal(pagination.currentPage, 2);
  assert.equal(state.passportListPage, 2);
});
