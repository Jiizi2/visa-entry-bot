const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ROOT = path.resolve(__dirname, "..");
const GROUPS = ["firstName", "secondName", "thirdName", "familyName"];

function load(ctx, file) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, "content", file), "utf8"), ctx, { filename: file });
}

function identityHarness(profileOverrides = {}) {
  const inputs = {};
  const labels = [];
  const domUtils = {
    isVisible: node => !node.hidden,
    setInputValue: (node, value) => { node.value = value; },
    queryAll: selector => {
      if (selector.includes("input")) {
        if (selector.includes("passportNumber")) return inputs.passport ? [inputs.passport] : [];
        const group = GROUPS.find(value => selector.includes(`formgroupname='${value}'`));
        const language = selector.includes("formcontrolname='ar'") ? "ar" : "en";
        const value = inputs[`${group}.${language}`];
        return value ? (Array.isArray(value) ? value : [value]) : [];
      }
      return labels;
    },
  };
  const ctx = vm.createContext({ window: { NusukAutofill: { domUtils } } });
  load(ctx, "identity-guard.js");
  const profile = {
    passportNumber: "E4332864", firstName: "FATIH RAFAIZAN", fatherName: "", grandfatherName: "", familyName: "ARDIAN",
    arabic: { firstName: "فاتح", fatherName: "", grandfatherName: "", familyName: "ارديان" },
    ...profileOverrides,
  };
  function formFromProfile(value = profile) {
    const fields = ["firstName", "fatherName", "grandfatherName", "familyName"];
    for (const language of ["en", "ar"]) fields.forEach((field, index) => {
      inputs[`${GROUPS[index]}.${language}`] = { value: (language === "ar" ? value.arabic : value)[field] || "" };
    });
    inputs.passport = { value: value.passportNumber };
  }
  function label(text, value) {
    labels.push({ textContent: text, parentElement: { textContent: `${text}\n${value}`, parentElement: null } });
  }
  formFromProfile();
  return { ctx, guard: ctx.window.NusukAutofill.identityGuard, context: { member: { id: "first", passportImagePath: "C:/Passports/fatih.jpeg", reviewConfirmed: true, reviewStatus: "VALID", resolvedProfile: profile }, identityEvidence: {} }, inputs, labels, label, formFromProfile };
}

test("a different Nusuk OCR name is recorded without blocking the reviewed name or overwriting during the check", () => {
  const h = identityHarness();
  h.guard.verifyPassportIdentity(h.context);
  h.inputs["firstName.en"].value = "MUHAMMAD CHOLID";
  h.inputs["familyName.en"].value = "HIDAYATULLAH";
  h.guard.verifyPassportName(h.context);
  assert.equal(h.context.identityEvidence.nameCorrection.observedName, "MUHAMMAD CHOLID HIDAYATULLAH");
  assert.equal(h.context.identityEvidence.nameCorrection.expectedName, "FATIH RAFAIZAN ARDIAN");
  assert.equal(h.inputs["firstName.en"].value, "MUHAMMAD CHOLID");
  assert.throws(() => h.guard.verifyMemberNames(h.context), /firstName.*masih berisi nama lain/);
  h.formFromProfile();
  h.guard.verifyMemberNames(h.context);
});

function reportedNameHarness() {
  return identityHarness({
    passportNumber: "C8640496", firstName: "DIAH", fatherName: "PURNAMAWATI ALI", grandfatherName: "", familyName: "ANYANG",
    arabic: { firstName: "دياه", fatherName: "بورناماواتي علي", grandfatherName: "", familyName: "أنيانغ" },
  });
}

test("SUHERMAN misread as LUZERMAN uses reviewed single-name fields and still requires them on Summary", () => {
  const h = identityHarness({ firstName: "SUHERMAN", fatherName: "", grandfatherName: "", familyName: "SUHERMAN" });
  h.guard.recordPassportUpload(h.context, h.context.member.passportImagePath, "fatih.jpeg");
  h.inputs["firstName.en"].value = "LUZERMAN";
  h.inputs["familyName.en"].value = "";
  h.guard.verifyPassportName(h.context);
  assert.equal(h.context.identityEvidence.nameCorrection.observedName, "LUZERMAN");
  assert.equal(h.context.identityEvidence.nameCorrection.expectedName, "SUHERMAN SUHERMAN");
  h.formFromProfile();
  h.guard.verifyMemberNames(h.context);
  h.label("Full Name", "LUZERMAN"); h.label("Passport Image", "fatih.jpeg");
  assert.throws(() => h.guard.verifySummaryIdentity(h.context), /Nama pada ringkasan.*berbeda/);
  h.labels[0].parentElement.textContent = "Full Name\nSUHERMAN SUHERMAN";
  h.guard.verifySummaryIdentity(h.context);
});

test("unreviewed or invalid EntryMate data cannot replace a differing Nusuk OCR name", () => {
  for (const flags of [{ reviewConfirmed: false }, { reviewConfirmed: undefined }, { reviewStatus: "NEEDS_REVIEW" }]) {
    const h = identityHarness(); Object.assign(h.context.member, flags);
    h.inputs["firstName.en"].value = "LUZERMAN";
    assert.throws(() => h.guard.verifyPassportName(h.context), /belum dikonfirmasi melalui review/);
    assert.equal(h.context.identityEvidence.passportName, undefined);
    assert.equal(h.inputs["firstName.en"].value, "LUZERMAN");
  }
});

test("revoking review confirmation after filling prevents final submission even when Summary matches", () => {
  const h = identityHarness(); h.guard.verifyPassportName(h.context); h.guard.verifyMemberNames(h.context);
  h.label("Full Name", "FATIH RAFAIZAN ARDIAN"); h.label("Passport Image", "fatih.jpeg");
  h.context.member.reviewConfirmed = false;
  assert.throws(() => h.guard.verifySummaryIdentity(h.context), /belum dikonfirmasi melalui review/);
});

test("differing OCR names cannot hide a wrong selected file, another member's upload evidence or a live attachment conflict", () => {
  const h = identityHarness(); h.inputs["firstName.en"].value = "LUZERMAN";
  assert.throws(() => h.guard.recordPassportUpload(h.context, "C:/Passports/other.jpeg", "other.jpeg"), /file upload paspor berbeda/);
  assert.throws(() => h.guard.recordPassportUpload(h.context, h.context.member.passportImagePath, "other.jpeg"), /file upload paspor berbeda/);
  h.context.identityEvidence.passportFile = { memberId: "second", path: h.context.member.passportImagePath };
  assert.throws(() => h.guard.verifyPassportName(h.context), /bukan milik jamaah aktif/);
  h.guard.recordPassportUpload(h.context, h.context.member.passportImagePath, "fatih.jpeg");
  h.label("Passport Image", "other.jpeg");
  assert.throws(() => h.guard.verifyPassportName(h.context), /File paspor.*berbeda/);
  assert.equal(h.context.identityEvidence.passportName, undefined);
});

test("the original OCR discrepancy survives retries after the reviewed name has already been filled", () => {
  const h = identityHarness(); h.inputs["firstName.en"].value = "LUZERMAN";
  h.guard.verifyPassportName(h.context);
  h.formFromProfile(); h.guard.verifyPassportName({ ...h.context });
  assert.equal(h.context.identityEvidence.uploadedPassportName, "LUZERMAN ARDIAN");
  assert.equal(h.context.identityEvidence.nameCorrection.observedName, "LUZERMAN ARDIAN");
});

test("names changed after filling are corrected with bounded retries and a fresh passport check", async () => {
  const h = identityHarness(); h.guard.verifyPassportName(h.context);
  h.inputs["firstName.en"].value = "LUZERMAN"; h.inputs["thirdName.ar"].value = "OLD";
  let waits = 0;
  const options = { checkpoint: async () => {}, sleep: async () => { waits++; }, runId: 1, isCurrentForm: () => true };
  await h.guard.ensureMemberNames(h.context, options);
  assert.equal(waits, 1);
  h.guard.verifyMemberNames(h.context);
  h.inputs["firstName.en"].value = "OTHER"; h.inputs.passport.value = "OTHER";
  await assert.rejects(h.guard.ensureMemberNames(h.context, options), /Nomor paspor.*berbeda/);
  assert.equal(h.inputs["firstName.en"].value, "OTHER");
});

test("name repair stops after two corrections, cancellation, page changes, or an unknown destination", async () => {
  for (const problem of ["rejected", "cancelled", "page_changed", "missing"]) {
    const h = identityHarness(); h.guard.verifyPassportName(h.context);
    h.inputs["firstName.en"].value = "OTHER";
    let writes = 0;
    h.ctx.window.NusukAutofill.domUtils.setInputValue = () => { writes++; };
    if (problem === "missing") delete h.inputs["familyName.ar"];
    const options = {
      checkpoint: async () => { if (problem === "cancelled") throw new Error("cancelled"); },
      sleep: async () => {}, runId: 1, isCurrentForm: () => problem !== "page_changed",
    };
    await assert.rejects(h.guard.ensureMemberNames(h.context, options), problem === "cancelled" ? /cancelled/ : /Entry dihentikan/);
    assert.equal(writes, problem === "rejected" ? 2 : 0);
  }
});

test("reported passport with blank Nusuk middle names can use the reviewed complete name", () => {
  const h = reportedNameHarness();
  h.guard.verifyPassportIdentity(h.context);
  h.inputs["secondName.en"].value = "";
  h.guard.verifyPassportName(h.context);
  assert.equal(h.inputs["secondName.en"].value, "");
  assert.equal(h.context.identityEvidence.passportName, "DIAH PURNAMAWATI ALI ANYANG");
  assert.throws(() => h.guard.verifyMemberNames(h.context), /fatherName.*terpotong/);
  h.formFromProfile();
  h.guard.verifyMemberNames(h.context);
});

test("different or empty OCR names are accepted only with a matching passport number", () => {
  for (const [key, value, expected] of [
    ["passport", "C8640497", /Nomor paspor.*berbeda/],
    ["firstName.en", "SITI", /Nama pada paspor.*berbeda/],
    ["familyName.en", "OTHER", /Nama pada paspor.*berbeda/],
    ["firstName.en", "", /Nama pada paspor.*berbeda/],
    ["familyName.en", "", /Nama pada paspor.*berbeda/],
  ]) {
    const h = reportedNameHarness();
    h.guard.verifyPassportIdentity(h.context);
    h.inputs["secondName.en"].value = "";
    h.inputs[key].value = value;
    if (key === "passport") assert.throws(() => h.guard.verifyPassportName(h.context), expected);
    else {
      h.guard.verifyPassportName(h.context);
      assert.equal(h.context.identityEvidence.passportName, "DIAH PURNAMAWATI ALI ANYANG");
      assert.throws(() => h.guard.verifyMemberNames(h.context), /terpotong/);
    }
  }
});

test("a member form without a passport number requires evidence from its passport details step", () => {
  const h = reportedNameHarness();
  h.guard.verifyPassportIdentity(h.context);
  delete h.inputs.passport;
  h.inputs["secondName.en"].value = "";
  h.guard.verifyPassportName({ ...h.context });
  h.context.identityEvidence = {};
  assert.throws(() => h.guard.verifyPassportName(h.context), /Nomor paspor.*tidak dapat diverifikasi/);
  h.context.identityEvidence = { passportNumber: "C8640497" };
  assert.throws(() => h.guard.verifyPassportName(h.context), /Nomor paspor.*tidak dapat diverifikasi/);
});

test("an empty or placeholder passport control on Member Form can reuse this member's verified number", () => {
  for (const displayed of ["", "  ", "—", "\u200e\u200f"]) {
    const h = reportedNameHarness();
    h.guard.verifyPassportIdentity(h.context);
    h.inputs.passport.value = displayed;
    h.inputs["secondName.en"].value = "";
    h.guard.verifyPassportName(h.context);
    assert.equal(h.context.identityEvidence.passportNumber, "C8640496");
    assert.throws(() => h.guard.verifyPassportName({ ...h.context, identityEvidence: {} }), /Nomor paspor.*tidak dapat diverifikasi/);
    h.context.member.resolvedProfile.passportNumber = "C8640497";
    assert.throws(() => h.guard.verifyPassportName(h.context), /Nomor paspor.*tidak dapat diverifikasi/);
  }
});

test("passport display characters are equivalent without guessing letters or dropping punctuation", () => {
  const h = identityHarness({ passportNumber: "X2575843" });
  for (const displayed of [" x 2575843 ", "\u200fX٢٥٧٥٨٤٣\u200e", "X۲۵۷۵۸۴۳", "Ｘ２５７５８４３"]) {
    h.inputs.passport.value = displayed;
    h.guard.verifyPassportIdentity(h.context);
    assert.equal(h.context.identityEvidence.passportNumber, "X2575843");
  }
  for (const displayed of ["X2575848", "X-2575843", "X257584", "X2575843OTHER"]) {
    h.inputs.passport.value = displayed;
    assert.throws(() => h.guard.verifyPassportIdentity(h.context), /Nomor paspor.*berbeda/);
  }
  h.context.member.resolvedProfile.passportNumber = "O1234567";
  h.inputs.passport.value = "01234567";
  assert.throws(() => h.guard.verifyPassportIdentity(h.context), /Nomor paspor.*berbeda/);
});

function readinessHarness(h, { onSleep, onCheckpoint, timeoutMs = 900 } = {}) {
  let clock = 0, notices = 0, checks = 0;
  h.ctx.Date = { now: () => clock };
  const options = {
    timeoutMs, runId: 7,
    checkpoint: async runId => { assert.equal(runId, 7); checks++; onCheckpoint?.(clock); },
    sleep: async (ms, runId) => { assert.equal(runId, 7); clock += ms; onSleep?.(clock); },
    onWait: () => { notices++; },
  };
  return { options, elapsed: () => clock, notices: () => notices, checks: () => checks };
}

test("identity verification waits for a delayed Nusuk value and keeps the original evidence", async () => {
  const h = identityHarness();
  h.inputs.passport.value = "";
  const wait = readinessHarness(h, { onSleep: clock => { if (clock >= 720) h.inputs.passport.value = "E4332864"; } });
  await h.guard.waitForIdentityCheck("verifyPassportIdentity", h.context, wait.options);
  assert.equal(wait.elapsed(), 720);
  assert.equal(wait.notices(), 1);
  assert.equal(h.context.identityEvidence.passportNumber, "E4332864");
});

test("a passport that never appears times out without using manifest data as page evidence", async () => {
  const h = identityHarness(); delete h.inputs.passport;
  const wait = readinessHarness(h, { timeoutMs: 540 });
  await assert.rejects(h.guard.waitForIdentityCheck("verifyPassportIdentity", h.context, wait.options), /Nomor paspor.*tidak dapat diverifikasi/);
  assert.equal(wait.elapsed(), 540);
  assert.equal(h.context.identityEvidence.passportNumber, undefined);
});

test("blank or misread OCR names do not consume an identity timeout before reviewed names can be filled", async () => {
  for (const blankField of ["firstName.en", "familyName.en"]) {
    const h = identityHarness(), original = h.inputs[blankField].value;
    h.inputs[blankField].value = "";
    const wait = readinessHarness(h, { onSleep: clock => { if (clock >= 360) h.inputs[blankField].value = original; } });
    await h.guard.waitForIdentityCheck("verifyPassportName", h.context, wait.options);
    assert.equal(wait.elapsed(), 0);
    assert.equal(h.context.identityEvidence.passportName, "FATIH RAFAIZAN ARDIAN");
  }
  const h = identityHarness(); h.inputs["firstName.en"].value = ""; h.inputs["familyName.en"].value = "OTHER";
  const wait = readinessHarness(h);
  await h.guard.waitForIdentityCheck("verifyPassportName", h.context, wait.options);
  assert.equal(wait.elapsed(), 0);
  assert.equal(h.context.identityEvidence.nameCorrection.observedName, "OTHER");
});

test("empty destination and split-summary names wait for rendering but never accept another name", async () => {
  const h = identityHarness(); h.guard.verifyPassportName(h.context);
  h.inputs["firstName.en"].value = "";
  let wait = readinessHarness(h, { onSleep: clock => { if (clock >= 360) h.formFromProfile(); } });
  await h.guard.waitForIdentityCheck("verifyMemberNames", h.context, wait.options);
  assert.equal(wait.elapsed(), 360);
  h.label("Full Name", "FATIH RAFAIZAN ARDIAN"); h.label("First Name", ""); h.label("Passport Image", "fatih.jpeg");
  wait = readinessHarness(h, { onSleep: clock => { if (clock >= 360) h.labels[1].parentElement.textContent = "First Name\nFATIH RAFAIZAN"; } });
  await h.guard.waitForIdentityCheck("verifySummaryIdentity", h.context, wait.options);
  assert.equal(wait.elapsed(), 360);
  h.labels[1].parentElement.textContent = "First Name\nOTHER";
  wait = readinessHarness(h);
  await assert.rejects(h.guard.waitForIdentityCheck("verifySummaryIdentity", h.context, wait.options), /firstName pada ringkasan berbeda/);
  assert.equal(wait.elapsed(), 900);
});

test("a persistent conflicting number is rejected after the rendering wait without recording evidence", async () => {
  for (const initiallyEmpty of [false, true]) {
    const h = identityHarness(); h.inputs.passport.value = initiallyEmpty ? "" : "E4332865";
    const wait = readinessHarness(h, { onSleep: () => { h.inputs.passport.value = "E4332865"; } });
    await assert.rejects(h.guard.waitForIdentityCheck("verifyPassportIdentity", h.context, wait.options), /Nomor paspor.*berbeda/);
    assert.equal(wait.elapsed(), 900);
    assert.equal(h.context.identityEvidence.passportNumber, undefined);
  }
});

test("old passport values can finish rendering before identity is accepted without overwriting them", async () => {
  for (const checkName of ["verifyPassportIdentity", "verifyPassportName"]) {
    const h = identityHarness();
    h.inputs.passport.value = "E9999999";
    h.inputs["firstName.en"].value = "OTHER";
    h.inputs["familyName.en"].value = "PERSON";
    const wait = readinessHarness(h, { onSleep: clock => {
      assert.equal(h.context.identityEvidence.passportNumber, undefined);
      assert.equal(h.context.identityEvidence.passportName, undefined);
      if (clock >= 720) h.formFromProfile();
    } });
    await h.guard.waitForIdentityCheck(checkName, h.context, wait.options);
    assert.equal(wait.elapsed(), 720);
    assert.equal(h.context.identityEvidence.passportNumber, "E4332864");
  }
});

test("pause or cancellation interrupts an identity wait before recording evidence", async () => {
  const h = identityHarness(); h.inputs.passport.value = "";
  const cancelled = new Error("run cancelled");
  const wait = readinessHarness(h, { onCheckpoint: clock => { if (clock >= 360) throw cancelled; } });
  await assert.rejects(h.guard.waitForIdentityCheck("verifyPassportIdentity", h.context, wait.options), error => error === cancelled);
  assert.equal(wait.elapsed(), 360);
  assert.equal(h.context.identityEvidence.passportNumber, undefined);
});

test("the production step runner waits for missing identity before completing its checkpoint", async () => {
  const h = identityHarness(); h.inputs.passport.value = "";
  const wait = readinessHarness(h, { onSleep: clock => { if (clock >= 360) h.inputs.passport.value = "E4332864"; } });
  let completed = 0;
  const root = h.ctx.window.NusukAutofill;
  Object.assign(root, {
    valueUtils: { interpolate: value => value },
    stepProgress: { createStepProgress: () => ({ finishStep: () => { completed++; } }) },
    stepBasicActions: { createStepBasicActions: () => ({}) },
    stepFormActions: { createStepFormActions: () => ({}) },
    stepUploadActions: { createStepUploadActions: () => ({}) },
  });
  load(h.ctx, "step-runner.js");
  const runner = root.stepRunner.createStepRunner({ state: { runToken: 7 }, ...wait.options, slowModeDelayBeforeStep: async () => {}, appendLog() {} });
  await runner.runStep({ action: "verify_passport_identity", timeout_ms: 900 }, { ...h.context, runId: 7 });
  assert.equal(wait.elapsed(), 360);
  assert.equal(completed, 1);
  assert.equal(h.context.identityEvidence.passportNumber, "E4332864");
});

test("a final summary cannot reuse a passport number that is absent from the summary", () => {
  const h = identityHarness(); h.guard.verifyPassportName(h.context); delete h.inputs.passport;
  h.label("Full Name", "FATIH RAFAIZAN ARDIAN"); h.label("Passport Image", "fatih.jpeg");
  assert.throws(() => h.guard.verifySummaryIdentity(h.context), /Nomor paspor.*tidak dapat diverifikasi/);
});

test("blank and misread middle fields can be replaced but must match the reviewed name after filling", () => {
  for (const missingIndex of [1, 2]) {
    const h = identityHarness({ firstName: "DIAH", fatherName: "PURNAMAWATI", grandfatherName: "ALI", familyName: "ANYANG" });
    const missingKey = `${GROUPS[missingIndex]}.en`;
    const presentKey = `${GROUPS[missingIndex === 1 ? 2 : 1]}.en`;
    h.inputs[missingKey].value = "";
    h.guard.verifyPassportName(h.context);
    h.inputs[presentKey].value = "OTHER";
    h.guard.verifyPassportName(h.context);
    assert.throws(() => h.guard.verifyMemberNames(h.context), /terpotong/);
  }
});

test("different, reordered or partially spelled OCR words do not block reviewed name filling", () => {
  for (const value of ["SITI ALI", "PURNAMAWATI A", "PURNAMAWAT", "ALI PURNAMAWATI"]) {
    const h = reportedNameHarness();
    h.inputs["secondName.en"].value = value;
    h.guard.verifyPassportName(h.context);
    assert.equal(h.context.identityEvidence.uploadedPassportName, `DIAH ${value} ANYANG`);
    assert.throws(() => h.guard.verifyMemberNames(h.context), /fatherName.*terpotong/);
  }
});

test("whole missing words inside any name column can be completed from the reviewed full name", () => {
  const cases = [
    { expected: ["GLADYS SHAFIRA", "", "", "AMRU"], actual: ["GLADYS", "", "", "AMRU"] },
    { expected: ["FATIH RAFAIZAN", "", "", "ARDIAN"], actual: ["FATIH", "", "", "ARDIAN"] },
    { expected: ["DIAH", "PURNAMAWATI ALI", "", "ANYANG"], actual: ["DIAH", "PURNAMAWATI", "", "ANYANG"] },
    { expected: ["ALEX BUDI", "CITRA DANI", "EKO", "FARAH"], actual: ["ALEX", "CITRA", "", "FARAH"] },
    { expected: ["ALEX", "BUDI CITRA", "", "VAN DANI"], actual: ["ALEX BUDI", "", "", "DANI"] },
  ];
  for (const { expected, actual } of cases) {
    const h = identityHarness(Object.fromEntries(["firstName", "fatherName", "grandfatherName", "familyName"].map((field, index) => [field, expected[index]])));
    actual.forEach((value, index) => { h.inputs[`${GROUPS[index]}.en`].value = value; });
    h.guard.verifyPassportName(h.context);
    assert.equal(h.context.identityEvidence.uploadedPassportName, actual.filter(Boolean).join(" "));
    assert.equal(h.context.identityEvidence.passportName, expected.filter(Boolean).join(" "));
    actual.forEach((value, index) => assert.equal(h.inputs[`${GROUPS[index]}.en`].value, value));
    assert.throws(() => h.guard.verifyMemberNames(h.context), /terpotong/);
    h.formFromProfile();
    h.guard.verifyMemberNames(h.context);
  }
});

test("repeated, incomplete or misread boundary words use the same reviewed name authority", () => {
  const h = identityHarness({ firstName: "ALEX BUDI", fatherName: "CITRA", grandfatherName: "BUDI", familyName: "DANI" });
  for (const given of ["ALEX BUDI BUDI", "ALEX CITRA BUDI", "alex   budi"]) {
    h.inputs["firstName.en"].value = given;
    h.inputs["secondName.en"].value = "";
    h.inputs["thirdName.en"].value = "";
    h.guard.verifyPassportName(h.context);
  }
  for (const given of ["BUDI CITRA BUDI", "ALEX CITRA CITRA", "ALEX BUDI BUDI CITRA", "ALEX BUD", "ALEX OTHER", "ALEX ALEX", "ALEX BUDI BUDI BUDI"]) {
    h.inputs["firstName.en"].value = given;
    h.guard.verifyPassportName(h.context);
    assert.equal(h.context.identityEvidence.passportName, "ALEX BUDI CITRA BUDI DANI");
  }
  h.inputs["firstName.en"].value = "ALEX";
  h.inputs["familyName.en"].value = "";
  h.guard.verifyPassportName(h.context);
  assert.throws(() => h.guard.verifyMemberNames(h.context), /terpotong/);
});

test("a single-word passport name can be mirrored into both required reviewed name fields", () => {
  const h = identityHarness({ firstName: "SARI", fatherName: "", grandfatherName: "", familyName: "SARI" });
  for (const parts of [["SARI", "", "", ""], ["", "", "", "SARI"], ["SARI", "", "", "SARI"]]) {
    parts.forEach((value, index) => { h.inputs[`${GROUPS[index]}.en`].value = value; });
    h.guard.verifyPassportName(h.context);
    assert.equal(h.context.identityEvidence.passportName, "SARI SARI");
  }
  h.inputs.passport.value = "OTHER";
  assert.throws(() => h.guard.verifyPassportName(h.context), /Nomor paspor.*berbeda/);
});

function nameDistributions(words) {
  const distributions = [];
  for (let firstEnd = 1; firstEnd < words.length; firstEnd++) {
    for (let secondEnd = firstEnd; secondEnd < words.length; secondEnd++) {
      for (let thirdEnd = secondEnd; thirdEnd < words.length; thirdEnd++) {
        distributions.push([
          words.slice(0, firstEnd).join(" "), words.slice(firstEnd, secondEnd).join(" "),
          words.slice(secondEnd, thirdEnd).join(" "), words.slice(thirdEnd).join(" "),
        ]);
      }
    }
  }
  return distributions;
}

test("name matching is independent of all valid column distributions and omitted interior word combinations", t => {
  const words = ["ALEX", "BUDI", "CITRA", "DANI", "EKO", "FARAH"];
  const fields = ["firstName", "fatherName", "grandfatherName", "familyName"];
  const h = identityHarness();
  let cases = 0;
  for (let count = 2; count <= words.length; count++) {
    const full = words.slice(0, count);
    for (const expected of nameDistributions(full).filter(parts => parts.slice(0, 3).every(part => part.length <= 15))) {
      const profile = { ...h.context.member.resolvedProfile, ...Object.fromEntries(fields.map((field, index) => [field, expected[index]])) };
      h.context.member.resolvedProfile = profile;
      for (let mask = 0; mask < 2 ** (count - 2); mask++) {
        const observed = full.filter((_, index) => index === 0 || index === count - 1 || mask & 2 ** (index - 1));
        for (const actual of nameDistributions(observed)) {
          h.context.identityEvidence = {};
          actual.forEach((value, index) => { h.inputs[`${GROUPS[index]}.en`].value = value; });
          h.guard.verifyPassportName(h.context);
          assert.equal(h.context.identityEvidence.passportName, full.join(" "));
          assert.equal(h.context.identityEvidence.uploadedPassportName, observed.join(" "));
          cases++;
        }
      }
    }
  }
  assert.ok(cases > 1000);
  t.diagnostic(`Verified ${cases} name distributions and whole-word omission combinations.`);
});

test("foreign, extra, reordered and truncated OCR words remain blocked after filling across column distributions", t => {
  const words = ["ALEX", "BUDI", "CITRA", "DANI", "EKO", "FARAH"];
  let cases = 0;
  for (let count = 2; count <= words.length; count++) {
    const full = words.slice(0, count);
    const h = identityHarness({ firstName: full[0], fatherName: full.slice(1, 3).slice(0, count - 2).join(" "), grandfatherName: full.slice(3, -1).join(" "), familyName: full.at(-1) });
    const mismatches = [full.slice(1), full.slice(0, -1), [...full].reverse(), [full[0], "OTHER", full.at(-1)]];
    full.forEach((word, index) => {
      mismatches.push(full.map((value, position) => position === index ? "OTHER" : value));
      mismatches.push(full.map((value, position) => position === index ? word.slice(0, -1) : value));
      mismatches.push([...full.slice(0, index), word, ...full.slice(index)]);
    });
    for (const mismatch of mismatches) {
      for (const parts of nameDistributions(mismatch)) {
        h.context.identityEvidence = {};
        parts.forEach((value, index) => { h.inputs[`${GROUPS[index]}.en`].value = value; });
        h.guard.verifyPassportName(h.context);
        assert.equal(h.context.identityEvidence.uploadedPassportName, mismatch.join(" "));
        assert.throws(() => h.guard.verifyMemberNames(h.context), /terpotong/);
        cases++;
      }
    }
  }
  assert.ok(cases > 1000);
  t.diagnostic(`Rejected ${cases} uncorrected name and column distribution combinations after the OCR checkpoint.`);
});

test("an unrecognized nonempty middle name control cannot be treated as a blank field", () => {
  const h = reportedNameHarness();
  delete h.inputs["secondName.en"];
  assert.throws(() => h.guard.verifyPassportName(h.context), /fatherName.*tidak dapat diverifikasi/);
});

test("a complete passport name with a different column distribution is accepted", () => {
  const h = reportedNameHarness();
  h.inputs["secondName.en"].value = "PURNAMAWATI";
  h.inputs["thirdName.en"].value = "ALI";
  h.guard.verifyPassportName(h.context);
  assert.throws(() => h.guard.verifyMemberNames(h.context), /fatherName.*terpotong/);
});

test("missing middle names at upload still require the complete reviewed name on the summary", () => {
  const h = reportedNameHarness();
  h.inputs["secondName.en"].value = "";
  h.guard.verifyPassportName(h.context);
  h.label("Passport Image", "fatih.jpeg");
  h.label("Full Name", "DIAH ANYANG");
  assert.throws(() => h.guard.verifySummaryIdentity(h.context), /Nama pada ringkasan.*berbeda/);
  h.labels[1].parentElement.textContent = "Full Name\nDIAH PURNAMAWATI ALI ANYANG";
  h.guard.verifySummaryIdentity(h.context);
});

test("a different or unreadable active passport cannot be used for a resumed member", () => {
  const h = identityHarness();
  h.inputs.passport.value = "E9999999";
  assert.throws(() => h.guard.verifyPassportIdentity(h.context), /Nomor paspor.*berbeda/);
  delete h.inputs.passport;
  assert.throws(() => h.guard.verifyPassportName(h.context), /Nomor paspor.*tidak dapat diverifikasi/);
});

test("a passport field can be verified through its label when Nusuk uses another control name", () => {
  const h = identityHarness();
  delete h.inputs.passport;
  h.labels.push({ textContent: "Passport Number", control: { value: "E4332864" } });
  h.guard.verifyPassportIdentity(h.context);
  h.labels[0].control.value = "E9999999";
  assert.throws(() => h.guard.verifyPassportIdentity(h.context), /Nomor paspor.*berbeda/);
});

test("exact names including empty English and Arabic middle fields are verified", () => {
  const h = identityHarness();
  h.guard.verifyPassportIdentity(h.context);
  h.guard.verifyPassportName(h.context);
  // Step runner spreads context for each action, so evidence must survive that copy.
  h.guard.verifyMemberNames({ ...h.context });
  h.inputs["secondName.en"].value = "NAMA LAMA";
  assert.throws(() => h.guard.verifyMemberNames(h.context), /fatherName.*masih berisi nama lain/);
  h.formFromProfile();
  h.inputs["thirdName.ar"].value = "قديم";
  assert.throws(() => h.guard.verifyMemberNames(h.context), /grandfatherName.*masih berisi nama lain/);
  h.formFromProfile();
  h.inputs["firstName.en"].value = "FATIH RAFAI";
  assert.throws(() => h.guard.verifyMemberNames(h.context), /firstName.*terpotong/);
});

test("summary checks exact name and passport and fails closed when evidence is missing", () => {
  const h = identityHarness();
  h.guard.verifyPassportName(h.context);
  delete h.inputs.passport;
  h.label("Passport Number", "E4332864");
  h.label("Full Name", "FATIH RAFAIZAN ARDIAN");
  h.label("Passport Image", "fatih.jpeg\n.jpeg · 173378");
  h.guard.verifySummaryIdentity(h.context);
  h.labels[1].parentElement.textContent = "Full Name\nMUHAMMAD CHOLID HIDAYATULLAH";
  assert.throws(() => h.guard.verifySummaryIdentity(h.context), /Nama pada ringkasan.*berbeda/);
  h.labels.splice(1, 1);
  assert.throws(() => h.guard.verifySummaryIdentity(h.context), /nama pada ringkasan.*tidak dapat diverifikasi/);
});

test("a matching summary can verify identity after earlier runtime evidence is lost", () => {
  const h = identityHarness();
  delete h.inputs.passport;
  h.label("Passport Number", "E4332864");
  h.label("Full Name", "FATIH RAFAIZAN ARDIAN");
  h.label("Passport Image", "fatih.jpeg");
  for (const identityEvidence of [undefined, {}, { passportNumber: "OTHER", passportName: "OTHER PERSON" }]) {
    h.guard.verifySummaryIdentity({ ...h.context, identityEvidence });
  }
});

test("conflicting duplicate name controls cannot be ignored before overwriting passport names", () => {
  const h = identityHarness();
  h.inputs["firstName.en"] = [{ value: "FATIH RAFAIZAN" }, { value: "OTHER PERSON" }];
  assert.throws(() => h.guard.verifyPassportName(h.context), /beberapa kolom nama/);
});

test("a correct summary full name does not hide conflicting split names or an incorrect attachment", () => {
  const h = identityHarness();
  h.guard.verifyPassportName(h.context);
  h.label("Full Name", "FATIH RAFAIZAN ARDIAN");
  h.label("Passport Image", "other-person.jpeg");
  assert.throws(() => h.guard.verifySummaryIdentity(h.context), /File paspor.*berbeda/);
  h.labels[1].parentElement.textContent = "Passport Image\nfatih.jpeg";
  h.guard.verifySummaryIdentity(h.context);
  h.label("First Name", "MUHAMMAD CHOLID");
  assert.throws(() => h.guard.verifySummaryIdentity(h.context), /firstName pada ringkasan berbeda/);
  h.labels.pop(); h.labels.pop();
  assert.throws(() => h.guard.verifySummaryIdentity(h.context), /File paspor.*tidak dapat diverifikasi/);
});

function attachmentHarness(expectedName) {
  const h = identityHarness();
  h.context.member.passportImagePath = `C:/Passports/${expectedName}`;
  h.guard.verifyPassportName(h.context);
  h.label("Full Name", "FATIH RAFAIZAN ARDIAN");
  h.label("Passport Image", expectedName);
  h.showAttachment = name => { h.labels[1].parentElement.textContent = `Passport Image\n${name}`; };
  return h;
}

test("summary attachment names tolerate Nusuk capitalization and space-to-underscore formatting", () => {
  for (const [expected, observed] of [
    ["HALIJAH 2.png", "halijah_2.png"],
    ["SITI AISYAH 01.PDF", "siti_aisyah_01.pdf"],
    ["Ali-Budi 3.JPEG", "ali-budi_3.jpeg"],
    ["Document  Alpha  4.WEBP", "document__alpha_4.webp"],
    ["ÉMILIE 03.PNG", "e\u0301milie_03.png"],
    ["Mr. Ali 5.png", "mr._ali_5.png\n.png · 173378"],
  ]) {
    const h = attachmentHarness(expected);
    h.showAttachment(observed);
    h.guard.verifySummaryIdentity(h.context);
    assert.equal(h.context.member.passportImagePath, `C:/Passports/${expected}`);
  }
});

test("summary filename formatting cannot conceal a different name, sequence number or extension", () => {
  const h = attachmentHarness("HALIJAH 2.png");
  for (const observed of ["halijah_1.png", "halijah_02.png", "halijah_20.png", "halijah2.png", "halijah_2.jpg", "halijah_2.pdf", "salijah_2.png", "halijah_2_copy.png", "halijah-2.png", "halijah_2.png.exe"]) {
    h.showAttachment(observed);
    assert.throws(() => h.guard.verifySummaryIdentity(h.context), /File paspor/);
  }
  h.showAttachment(".png · 173378");
  assert.throws(() => h.guard.verifySummaryIdentity(h.context), /File paspor.*tidak dapat diverifikasi/);
});

test("a renamed summary attachment is blocked when the same formatted name identifies another batch file", () => {
  const h = attachmentHarness("Document 2.png");
  h.context.batchMembers = [h.context.member, { id: "other", passportImagePath: "C:/Passports/Document_2.png" }];
  h.showAttachment("document_2.png");
  assert.throws(() => h.guard.verifySummaryIdentity(h.context), /File paspor.*ambigu/);
  h.showAttachment("Document 2.png");
  h.guard.verifySummaryIdentity(h.context);
  h.context.batchMembers[1].passportImagePath = "C:/Passports/Document_3.png";
  h.showAttachment("document_2.png");
  h.guard.verifySummaryIdentity(h.context);
});

test("filename normalization still requires exact passport and complete reviewed names on the summary", () => {
  const h = attachmentHarness("Document 2.png");
  h.showAttachment("document_2.png");
  h.inputs.passport.value = "WRONG";
  assert.throws(() => h.guard.verifySummaryIdentity(h.context), /Nomor paspor.*berbeda/);
  h.formFromProfile();
  h.labels[0].parentElement.textContent = "Full Name\nOTHER PERSON";
  assert.throws(() => h.guard.verifySummaryIdentity(h.context), /Nama pada ringkasan.*berbeda/);
});

test("empty name fields clear old values through input events", async () => {
  const h = identityHarness();
  const writes = [];
  const root = h.ctx.window.NusukAutofill;
  const input = { value: "NAMA LAMA" };
  Object.assign(root.domUtils, {
    clickElement() {}, setInputValue: (node, value) => { node.value = value; writes.push(value); },
    findFirstVisible: () => input, isEnabled: () => true,
  });
  root.valueUtils = { interpolate: () => "", normalizeOption: value => value };
  root.nusukNavigation = { isLikelyNextSelector: () => false, isLikelyProceedSelector: () => false, describeSelectorForLog: value => value };
  load(h.ctx, "step-basic-actions.js");
  const actions = root.stepBasicActions.createStepBasicActions({ checkpoint: async () => {}, markActiveElement() {}, appendLog() {}, finishStep() {} });
  await actions.handleFill({ clear_when_empty: true }, {}, "middle name", 1000, false, 1);
  assert.equal(input.value, "");
  assert.deepEqual(writes, [""]);
});

function runnerHarness({ fail, stage = 0, timers = false, steps } = {}) {
  const calls = [], events = [], callbacks = [];
  const members = [{ id: "first", resolvedProfile: { firstName: "FATIH", familyName: "ARDIAN" } }, { id: "second" }];
  const state = { manifest: { members }, runToken: 1, currentRunPayload: { members }, executionState: "running" };
  const root = {
    constants: { PASSPORT_UPLOAD_SELECTOR: "passport", NEXT_BUTTON_SELECTOR: "next", AUTOFILL_MAX_RETRIES_PER_MEMBER: 3 },
    dateUtils: { normalizeDateToIso: value => value }, valueUtils: { deepValue: () => "" },
    automationSteps: { buildPerMemberSteps: () => steps || [{ action: "verify", page: "disclosure" }] },
    identityGuard: { identityError: message => Object.assign(new Error(message), { name: "NusukIdentityError" }) },
    manifestValidator: { ENTRY_BATCH_SCHEMA_VERSION: "nusuk-entry-batch-v1", validateManifestForEntry() {} },
  };
  const ctx = vm.createContext({
    window: { NusukAutofill: root, setTimeout: timers ? callback => { callbacks.push(callback); return callbacks.length; } : () => 0, clearTimeout() {} },
    location: { href: "https://masar.nusuk.sa/entry" },
    document: { body: { innerText: "" }, querySelector: () => null, hidden: false, readyState: "complete" },
    chrome: { runtime: { sendMessage: async value => { events.push(value); return {}; } } },
  });
  load(ctx, "submission-guard.js");
  load(ctx, "automation-runner.js");
  const checkpoint = async runId => { if (runId !== state.runToken) throw Object.assign(new Error("cancelled"), { name: "NusukControlError" }); };
  const runner = root.automationRunner.createAutomationRunner({
    state, checkpoint, slowModeDelayAfterStep: async () => {}, appendLog() {}, postPanelState() {}, persistState: async () => {}, countsForProgress: () => true,
    runStep: async (step, context) => { calls.push({ action: step.action, id: context.member.id }); await fail?.(step, context, checkpoint); },
    sleep: async () => {}, detectNusukStage: () => stage,
  });
  return { runner, state, calls, events, callbacks, root };
}

test("identity failure stops the batch immediately and keeps the failed member for review", async () => {
  const h = runnerHarness({ fail: () => { throw Object.assign(new Error("passport mismatch"), { name: "NusukIdentityError" }); } });
  await assert.rejects(h.runner.runAutomation(h.state.currentRunPayload), /Entry dihentikan.*passport mismatch/);
  assert.deepEqual(h.calls, [{ action: "open_mutamer_form", id: "first" }]);
  assert.equal(h.state.currentRunPayload.members[0].id, "first");
  assert.equal(h.state.autofillFailures[0].reason, "identity_mismatch");
  assert.equal(h.events.some(event => ["MEMBER_COMPLETED", "SESSION_COMPLETED"].includes(event.payload.eventType)), false);
});

test("attachment collision checks retain all manifest members when a resumed payload contains only the remainder", async () => {
  const completed = { id: "saved", passportImagePath: "C:/Passports/Document_2.png" };
  const current = { id: "first", passportImagePath: "C:/Passports/Document 2.png" };
  const h = runnerHarness({ fail: (step, context) => {
    assert.equal(context.batchMembers.length, 2);
    assert.equal(context.batchMembers[0].id, "saved");
    assert.equal(context.members.length, 1);
    throw Object.assign(new Error("stop after checking batch context"), { name: "NusukIdentityError" });
  } });
  h.state.manifest.members = [completed, current];
  h.state.currentRunPayload.members = [current];
  await assert.rejects(h.runner.runAutomation(h.state.currentRunPayload), /stop after checking batch context/);
});

function resumedRunnerHarness(stage) {
  const identity = identityHarness();
  delete identity.inputs.passport;
  identity.label("Passport Number", "E4332864");
  identity.label("Full Name", "FATIH RAFAIZAN ARDIAN");
  identity.label("Passport Image", "fatih.jpeg");
  let saves = 0;
  const h = runnerHarness({
    stage,
    steps: [
      { action: "set_files" },
      { action: "wait_for_nusuk_page_ready", page: "member_form" },
      { action: "wait_for_nusuk_page_ready", page: "disclosure" },
      { action: "set_disclosure_all_no" },
      { action: "wait_for_nusuk_page_ready", page: "summary" },
      { action: "click" },
      { action: "wait_for_selector", selector: "Mutamer has been added successfully" },
    ],
    fail: async (step, context, checkpoint) => {
      if (step.action === "click") {
        await h.root.submissionGuard.submitOnce({
          state: h.state, context, runId: context.runId, checkpoint,
          persistState: async () => {}, click: async () => { saves++; },
        });
      }
    },
  });
  h.root.identityGuard = identity.guard;
  h.state.manifest.members = [{ id: "saved" }, identity.context.member];
  h.state.completedMemberIds = ["saved"];
  h.state.currentRunPayload = { members: [identity.context.member] };
  return { ...h, identity, saves: () => saves };
}

test("disclosure and summary resume verify the live summary and save once without earlier runtime evidence", async () => {
  for (const stage of [3, 4]) {
    const h = resumedRunnerHarness(stage);
    await h.runner.runAutomation(h.state.currentRunPayload);
    assert.equal(h.saves(), 1);
    assert.equal(h.calls[0].action, "wait_for_nusuk_page_ready");
    assert.equal(h.calls.some(call => ["open_mutamer_form", "set_files"].includes(call.action)), false);
    assert.equal(h.calls.some(call => call.action === "set_disclosure_all_no"), stage === 3);
    assert.deepEqual(Array.from(h.state.completedMemberIds), ["saved", "first"]);
    assert.equal(h.state.progressCurrent, 2);
    assert.equal(h.state.currentRunPayload, null);
    assert.equal(h.state.pendingSubmission, null);
    assert.equal(h.events.filter(event => event.payload.eventType === "MEMBER_COMPLETED").length, 1);
  }
});

test("resumed identity checks block incorrect or incomplete summaries before saving and retain the queue", async () => {
  const cases = [
    [h => { h.labels[0].parentElement.textContent = "Passport Number\nOTHER"; }, /Nomor paspor.*berbeda/],
    [h => { h.labels[1].parentElement.textContent = "Full Name\nOTHER PERSON"; }, /Nama pada ringkasan.*berbeda/],
    [h => { h.labels[2].parentElement.textContent = "Passport Image\nother.jpeg"; }, /File paspor.*berbeda/],
    [h => { h.labels.splice(0, 1); }, /Nomor paspor.*tidak dapat diverifikasi/],
    [h => { h.labels.splice(1, 1); }, /nama pada ringkasan.*tidak dapat diverifikasi/],
    [h => { h.labels.splice(2, 1); }, /File paspor.*tidak dapat diverifikasi/],
  ];
  for (const stage of [3, 4]) {
    for (const [changeSummary, expected] of cases) {
      const h = resumedRunnerHarness(stage);
      const next = { id: "second" };
      h.state.manifest.members.push(next);
      h.state.currentRunPayload.members.push(next);
      changeSummary(h.identity);
      await assert.rejects(h.runner.runAutomation(h.state.currentRunPayload), expected);
      assert.equal(h.saves(), 0);
      assert.equal(h.state.pendingSubmission, undefined);
      assert.deepEqual(Array.from(h.state.completedMemberIds), ["saved"]);
      assert.deepEqual(Array.from(h.state.currentRunPayload.members, member => member.id), ["first", "second"]);
      assert.equal(h.calls.every(call => call.id === "first"), true);
    }
  }
});

test("a saved member is never re-entered when closing the success popup fails", async () => {
  const h = runnerHarness({
    steps: [{ action: "wait_for_selector", selector: "Mutamer has been added successfully" }, { action: "click_success_popup_action" }],
    fail: (step, context) => {
      if (step.action === "wait_for_selector") h.state.pendingSubmission = { memberId: context.member.id, passportNumber: "", passportImagePath: "" };
      if (step.action === "click_success_popup_action") throw new Error("popup blocked");
    },
  });
  await assert.rejects(h.runner.runAutomation(h.state.currentRunPayload), /sudah tersimpan.*tidak diulang otomatis/);
  assert.equal(h.state.currentRunPayload.members[0].id, "second");
  assert.equal(h.state.completedMemberIds[0], "first");
  assert.equal(h.calls.filter(call => call.action === "open_mutamer_form").length, 1);
  assert.equal(h.events.filter(event => event.payload.eventType === "MEMBER_COMPLETED").length, 1);
});

test("watchdog invalidates a pending attempt and stops before another member", async () => {
  let release, wrote = false;
  const pending = new Promise(resolve => { release = resolve; });
  const h = runnerHarness({ timers: true, fail: async (step, context, checkpoint) => { await pending; await checkpoint(context.runId); wrote = true; } });
  const running = h.runner.runAutomation(h.state.currentRunPayload);
  await new Promise(resolve => setImmediate(resolve));
  h.callbacks.at(-1)();
  await assert.rejects(running, /watchdog_timeout/);
  assert.equal(h.state.runToken, 2);
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(wrote, false);
  assert.equal(h.calls.length, 1);
});

test("a timeout after sending a save cannot retry the member or continue the batch", async () => {
  const h = runnerHarness({ fail: () => { h.state.pendingSubmission = { memberId: "first" }; throw new Error("server timeout"); } });
  await assert.rejects(h.runner.runAutomation(h.state.currentRunPayload), /Entry dihentikan.*server timeout/);
  assert.equal(h.calls.length, 1);
  assert.equal(h.state.autofillFailures[0].reason, "submission_unconfirmed");
  assert.equal(h.state.currentRunPayload.members[0].id, "first");
});

test("a success popup without a matching submission cannot report a member as completed", async () => {
  const h = runnerHarness({ steps: [{ action: "wait_for_selector", selector: "Mutamer has been added successfully" }] });
  await assert.rejects(h.runner.runAutomation(h.state.currentRunPayload), /konfirmasi sukses tidak memiliki pengiriman/);
  assert.equal(h.state.completedMemberIds?.length || 0, 0);
  assert.equal(h.events.some(event => event.payload.eventType === "MEMBER_COMPLETED"), false);
});

test("all runner entry paths validate the payload before touching the page", async () => {
  const h = runnerHarness();
  h.root.manifestValidator.validateManifestForEntry = () => { throw new Error("unreviewed member"); };
  await assert.rejects(h.runner.runAutomation(h.state.currentRunPayload), /unreviewed member/);
  assert.equal(h.calls.length, 0);
});

test("a restored unresolved save blocks the runner before any page operation", async () => {
  const h = runnerHarness();
  h.state.pendingSubmission = { memberId: "first" };
  await assert.rejects(h.runner.runAutomation(h.state.currentRunPayload), /pengiriman ulang diblokir/);
  assert.equal(h.calls.length, 0);
});

test("identity guard loads before all consumers in the production extension", () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8")).content_scripts[0].js;
  for (const consumer of ["nusuk-navigation.js", "step-runner.js", "automation-runner.js"]) {
    assert.ok(scripts.indexOf("content/identity-guard.js") < scripts.indexOf(`content/${consumer}`));
  }
});
