import assert from "node:assert/strict";
import test from "node:test";

import {
  ageFromDateValue,
  childInfoForMember,
  companionCandidatesFor,
  fieldFlagsForMember,
  memberDisplayName,
  memberPassport,
  normalizeCompanionRelation,
  syncMemberChildMetadata,
} from "../src/main-members.js";

test("memberDisplayName prefers resolved profile names", () => {
  assert.equal(
    memberDisplayName({
      fileName: "scan.jpg",
      passportExtracted: { firstName: "OCR", familyName: "Name" },
      resolvedProfile: {
        firstName: "Ali",
        fatherName: "Bin",
        grandfatherName: "",
        familyName: "Rahman",
      },
    }),
    "Ali Bin Rahman",
  );
});

test("memberPassport falls back to extracted passport number", () => {
  assert.equal(memberPassport({ passportExtracted: { passportNumber: "A123" } }), "A123");
});

test("ageFromDateValue calculates age from Nusuk date strings", () => {
  const now = new Date(2026, 4, 26);
  assert.equal(ageFromDateValue("2010/05/26", now), 16);
  assert.equal(ageFromDateValue("2010/05/27", now), 15);
  assert.equal(ageFromDateValue("not-a-date", now), null);
});

test("child metadata clears companion data for adults", () => {
  const member = {
    resolvedProfile: { dob: "1990/01/01" },
    companionMemberId: "parent",
    companionRelation: "Mother",
    companion: { id: "parent" },
  };

  const info = syncMemberChildMetadata(member);
  assert.equal(info.isChild, false);
  assert.equal(Number.isFinite(info.age), true);
  assert.equal(member.companionMemberId, undefined);
  assert.equal(member.companionRelation, undefined);
  assert.equal(member.companion, undefined);
});

test("companionCandidatesFor excludes children and the active member", () => {
  const active = { id: "child", resolvedProfile: { dob: "2020/01/01" } };
  const adult = { id: "adult", resolvedProfile: { firstName: "Adult", dob: "1990/01/01" } };
  const otherChild = { id: "other-child", resolvedProfile: { firstName: "Kid", dob: "2020/01/01" } };

  assert.deepEqual(companionCandidatesFor(active, [active, adult, otherChild]), [adult]);
  assert.equal(childInfoForMember(active).isChild, true);
});

test("normalizeCompanionRelation maps fuzzy values to known options", () => {
  assert.equal(normalizeCompanionRelation("mother"), "Mother");
  assert.equal(normalizeCompanionRelation("unknown relation"), "Mother");
});

test("fieldFlagsForMember merges resolved and extracted flags", () => {
  assert.deepEqual(
    fieldFlagsForMember({
      reviewFlags: {
        resolvedProfile: { passportNumber: ["LOW_CONFIDENCE"] },
        passportExtracted: { passportNumber: ["DERIVED_VALUE"] },
      },
    }, "passportNumber"),
    ["LOW_CONFIDENCE", "DERIVED_VALUE"],
  );
});
