import test from "node:test";
import assert from "node:assert/strict";
import { normalizeConfigForNusuk } from "./engine.mjs";

function normalizeSteps(steps) {
  const config = normalizeConfigForNusuk({
    per_member_steps: steps,
  });
  return Array.isArray(config?.per_member_steps) ? config.per_member_steps : [];
}

function indexOfStep(steps, matcher) {
  return steps.findIndex((step, idx) => matcher(step || {}, idx));
}

function isNextClickStep(step) {
  return String(step?.action ?? "").trim().toLowerCase() === "click"
    && String(step?.selector ?? "").toLowerCase().includes("next");
}

test("remove misplaced arabic wait that appears before identity marker", () => {
  const steps = normalizeSteps([
    {
      action: "wait_for_selector",
      selector: "input[placeholder='First Name (Arabic)']",
      timeout_ms: 120000,
    },
    {
      action: "fill",
      selector: "input[placeholder='City of Issued']",
      value: "{{member.resolvedProfile.cityOfIssued}}",
    },
  ]);

  const firstArabicWaitIdx = indexOfStep(
    steps,
    (step) =>
      String(step.action ?? "").toLowerCase() === "wait_for_selector"
      && String(step.selector ?? "").toLowerCase().includes("first name (arabic)"),
  );
  const firstIdentityIdx = indexOfStep(
    steps,
    (step) =>
      String(step.action ?? "").toLowerCase() === "fill"
      && String(step.value ?? "").trim() === "{{member.resolvedProfile.cityOfIssued}}",
  );

  assert.ok(firstIdentityIdx >= 0, "identity marker should exist");
  assert.ok(
    firstArabicWaitIdx === -1 || firstArabicWaitIdx > firstIdentityIdx,
    "arabic wait must not appear before identity marker",
  );
});

test("insert bridge next steps before first arabic fill when no next exists", () => {
  const steps = normalizeSteps([
    {
      action: "fill",
      value: "{{member.resolvedProfile.cityOfIssued}}",
      selector: "input[placeholder='City of Issued']",
    },
    {
      action: "fill",
      value: "{{member.resolvedProfile.arabic.firstName}}",
      selector: "input[placeholder='First Name (Arabic)']",
    },
  ]);

  const arabicFillIdx = indexOfStep(
    steps,
    (step) =>
      String(step.action ?? "").toLowerCase() === "fill"
      && String(step.value ?? "").trim() === "{{member.resolvedProfile.arabic.firstName}}",
  );
  assert.ok(arabicFillIdx > 0, "arabic fill step should exist");

  const nextClickBeforeArabic = steps
    .slice(0, arabicFillIdx)
    .findIndex((step) => isNextClickStep(step));

  assert.ok(nextClickBeforeArabic >= 0, "should have Next click before arabic fill");
});

test("prepend wait_for_enabled before malformed standalone Next click", () => {
  const steps = normalizeSteps([
    {
      action: "click",
      selector: ".action-buttons .navigation-buttons button:has-text('Next')",
      timeout_ms: 10000,
    },
  ]);

  assert.equal(String(steps[0]?.action ?? "").toLowerCase(), "wait_for_enabled");
  assert.equal(String(steps[1]?.action ?? "").toLowerCase(), "click");
});

test("legacy mixed-page order gets Next inserted after identity fields", () => {
  const steps = normalizeSteps([
    {
      action: "fill",
      value: "{{member.resolvedProfile.cityOfIssued}}",
      selector: "input[placeholder='City of Issued']",
    },
    {
      action: "fill",
      value: "{{member.resolvedProfile.arabic.firstName}}",
      selector: "input[placeholder='First Name (Arabic)']",
    },
    {
      action: "fill",
      value: "{{member.resolvedProfile.profession}}",
      selector: "input[placeholder='Profession']",
    },
  ]);

  const arabicFillIdx = indexOfStep(
    steps,
    (step) =>
      String(step.action ?? "").toLowerCase() === "fill"
      && String(step.value ?? "").trim() === "{{member.resolvedProfile.arabic.firstName}}",
  );
  assert.ok(arabicFillIdx > 0, "arabic fill step should exist");

  const nextClickIdx = indexOfStep(
    steps,
    (step, idx) => idx < arabicFillIdx && isNextClickStep(step),
  );
  assert.ok(nextClickIdx >= 0, "legacy ordering should insert Next click before arabic page fields");
});

test("inject vaccination upload when missing", () => {
  const steps = normalizeSteps([
    {
      action: "fill",
      selector: "input[placeholder='Email']",
      value: "{{member.resolvedProfile.email}}",
    },
  ]);

  const vaccinationStep = steps.find((step) =>
    String(step?.action ?? "").toLowerCase() === "set_files"
    && String(step?.selector ?? "").toLowerCase().includes("vaccination"),
  );

  assert.ok(vaccinationStep, "should inject vaccination upload step");
  assert.equal(String(vaccinationStep.value ?? "").trim(), "{{member.passportImagePath}}");
});
