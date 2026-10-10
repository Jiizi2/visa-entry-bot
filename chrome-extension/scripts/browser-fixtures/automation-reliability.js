// Exercise the production steps, dispatcher, identity checks, navigation and batch
// runner against a local Nusuk fixture. Only OS file access and external controls
// are simulated; no account or network request is involved.
window.runAutomationReliabilityTests = async function (test, assert, field) {
  const root = window.NusukAutofill, surface = document.getElementById("surface");

  function fixture(options = {}) {
    let clock = 1, activePage = "list", activeMember = null;
    const scheduled = [], submitted = [], uploaded = [], filledNames = new Map(), logs = [];
    const members = Array.from({ length: 16 }, (_, index) => ({
      id: String(index + 1), fileName: `${index + 1}.jpeg`, passportImagePath: `C:/Demo/${index + 1}.jpeg`,
      reviewStatus: "VALID", status: "VALID", reviewConfirmed: true,
      resolvedProfile: {
        firstName: "ALI", fatherName: "", grandfatherName: "", familyName: `BUDI ${String.fromCharCode(65 + index)}`,
        passportNumber: `X${String(index + 1).padStart(7, "0")}`, nationality: "INDONESIA", gender: "MALE",
        dob: "1990-01-01", issueDate: "2025-01-01", expiryDate: "2030-01-01", passportType: "NORMAL",
        cityOfIssued: "JAKARTA", birthCountry: "INDONESIA", birthCity: "JAKARTA", maritalStatus: "MARRIED",
        profession: "BUSINESS", email: "ali@example.com", mobileNumber: "+628123456789",
        arabic: { firstName: "علي", fatherName: "", grandfatherName: "", familyName: "بودي" },
      },
    }));
    if (options.suherman) {
      Object.assign(members[9].resolvedProfile, { firstName: "SUHERMAN", familyName: "SUHERMAN" });
      Object.assign(members[9].resolvedProfile.arabic, { firstName: "سوهيرمان", familyName: "سوهيرمان" });
    }
    const state = { runToken: 1, executionState: "running", manifest: { schemaVersion: "nusuk-entry-batch-v1", members }, currentRunPayload: { members } };
    const originalNow = Date.now, originalSend = chrome.runtime.sendMessage;
    Date.now = () => clock;
    chrome.runtime.sendMessage = async () => ({ ok: false });
    const schedule = (ms, action) => scheduled.push({ at: clock + ms, action });
    const checkpoint = async runId => { if (runId !== state.runToken) throw Object.assign(new Error("cancelled"), { name: "NusukControlError" }); };
    const sleep = async (ms, runId) => {
      await checkpoint(runId);
      clock += ms;
      scheduled.sort((left, right) => left.at - right.at);
      while (scheduled[0]?.at <= clock) scheduled.shift().action();
      await checkpoint(runId);
    };
    const transition = (action, delay = 900) => {
      document.getElementById("next").disabled = true;
      surface.insertAdjacentHTML("beforeend", '<div class="loading-overlay">Loading</div>');
      schedule(delay, action);
    };
    const nextButton = () => '<div class="action-buttons"><div class="navigation-buttons"><button id="next">Next</button></div></div>';
    function list() {
      activePage = "list";
      surface.innerHTML = '<h2>Mutamer List</h2><button id="add">Add new mutamer</button>';
      document.getElementById("add").addEventListener("click", () => schedule(800, upload));
    }
    function upload() {
      activePage = "upload";
      // Nusuk can hide the native input while showing its Choose File wrapper.
      surface.innerHTML = '<div class="passport-upload-section"><input type="file" style="display:none" accept="image/jpeg"><button>Choose File</button></div>';
    }
    function proceed() {
      surface.insertAdjacentHTML("beforeend", '<div class="popup"><div class="popup-actions"><button id="proceed">Proceed</button></div></div>');
      document.getElementById("proceed").addEventListener("click", () => passport());
    }
    function passport() {
      activePage = "passport";
      const value = options.wrongNumber && activeMember.id === "10" ? "X9999999"
        : options.delayedNumber && activeMember.id === "10" ? "" : activeMember.resolvedProfile.passportNumber;
      surface.innerHTML = `<input name="passportNo" id="passport-number" value="${value}" readonly><select formcontrolname="passportTypeId"><option>NORMAL</option></select><p-calendar formcontrolname="passportIssueDate"><input type="text"></p-calendar><input formcontrolname="issueCityName">${nextButton()}`;
      if (!value) schedule(19000, () => { document.getElementById("passport-number").value = activeMember.resolvedProfile.passportNumber; });
      document.getElementById("next").addEventListener("click", () => transition(memberForm));
    }
    function memberForm() {
      activePage = "member";
      const profile = activeMember.resolvedProfile;
      surface.innerHTML = "";
      ["firstName", "secondName", "thirdName", "familyName"].forEach((group, index) => {
        const name = ["firstName", "fatherName", "grandfatherName", "familyName"][index];
        const stale = options.staleNames || options.misreadAllNames || (options.suherman && activeMember.id === "10");
        const value = stale ? (index === 0 ? "LUZERMAN" : index === 3 && !options.suherman ? "PERSON" : "") : profile[name];
        surface.insertAdjacentHTML("beforeend", `<div formgroupname="${group}"><input formcontrolname="en" value="${value}"><input formcontrolname="ar" value="${profile.arabic[name]}"></div>`);
      });
      surface.insertAdjacentHTML("beforeend", `<input formcontrolname="profession"><select formcontrolname="birthCountryId"><option>INDONESIA</option></select><input formcontrolname="birthCityName"><input formcontrolname="email"><input formcontrolname="phone">${nextButton()}`);
      if (options.staleNames) schedule(3000, () => {
        // Only update controls belonging to this Member Form; a late render
        // must not modify the next page after the reviewed fields were filled.
        if (activePage === "member") ["firstName", "fatherName", "grandfatherName", "familyName"].forEach((name, index) => { root.domUtils.findFirstVisible(root.identityGuard.nameSelector(index, "en")).value = profile[name]; });
      });
      if (options.resetFilledNames) surface.querySelector("input[formcontrolname='profession']").addEventListener("change", () => {
        root.domUtils.findFirstVisible(root.identityGuard.nameSelector(0, "en")).value = "LUZERMAN";
        root.domUtils.findFirstVisible(root.identityGuard.nameSelector(2, "ar")).value = "OLD";
      });
      if (options.refusesName && activeMember.id === "10") {
        root.domUtils.findFirstVisible(root.identityGuard.nameSelector(0, "en")).addEventListener("change", event => { event.target.value = "LUZERMAN"; });
      }
      document.getElementById("next").addEventListener("click", () => {
        if (!(options.refusesName && activeMember.id === "10")) root.identityGuard.verifyMemberNames({ member: activeMember, identityEvidence: { passportNumber: profile.passportNumber, passportName: `${profile.firstName} ${profile.familyName}` } });
        filledNames.set(activeMember.id, [0, 1, 2, 3].map(index => root.domUtils.findFirstVisible(root.identityGuard.nameSelector(index, "en")).value).filter(Boolean).join(" "));
        transition(disclosure);
      });
    }
    function disclosure() {
      activePage = "disclosure";
      surface.innerHTML = `<div class="card"><h2 class="title">Disclosure Form</h2><div class="question"><label><input type="radio" name="medical" value="false">No</label><label><input type="radio" name="medical" value="true">Yes</label></div>${nextButton()}</div>`;
      document.getElementById("next").addEventListener("click", () => transition(summary));
    }
    function summary() {
      activePage = "summary";
      const member = activeMember, profile = member.resolvedProfile;
      const name = options.wrongSummaryName && member.id === "10" ? "LUZERMAN" : filledNames.get(member.id);
      const filename = options.wrongSummaryFile && member.id === "10" ? "other.jpeg" : member.fileName;
      const details = options.hiddenSummaryData && member.id === "10" ? "" : field("Full Name", name) + field("Passport Image", filename);
      surface.innerHTML = `<div class="card"><h2 class="title">Summary</h2>${field("Passport Number", profile.passportNumber)}${details}${nextButton()}</div>`;
      if (options.hiddenOldInput) surface.insertAdjacentHTML("beforeend", '<div hidden class="passport-upload-section"><input type="file" accept="image/jpeg"></div>');
      document.getElementById("next").addEventListener("click", () => {
        submitted.push(member.id);
        transition(() => success(member), 1300);
      });
    }
    function success(member) {
      activePage = "success";
      surface.querySelector(".loading-overlay")?.remove();
      const fallbackOnly = Number(member.id) % 4 === 0;
      surface.insertAdjacentHTML("beforeend", `<div class="popup"><h3>Mutamer has been added successfully</h3><div class="popup-actions">${fallbackOnly ? "" : '<button id="another">Add Another Mutamer</button>'}<button id="list">Go To Mutamer List</button></div></div>`);
      for (const [id, action] of [["another", upload], ["list", list]]) {
        document.getElementById(id)?.addEventListener("click", () => {
          surface.querySelector(".popup").remove();
          // The old Summary remains briefly after Nusuk closes the popup.
          activePage = "summary";
          schedule(2200, action);
        });
      }
    }
    const persistState = async () => {};
    const waits = root.waitUtils.createWaitUtils({ state, checkpoint, sleep });
    const nav = root.nusukNavigation.createNusukNavigation({ state, checkpoint, sleep, persistState, waitUntil: waits.waitUntil, markActiveElement() {} });
    const dispatcher = root.stepRunner.createStepRunner({
      state, checkpoint, sleep, ...waits, ...nav, appendLog: (level, message) => logs.push({ level, message }), markActiveElement() {}, clearActiveHighlight() {}, postToPanel() {},
      setCalendarDate: async ({ selector, rawValue }) => { root.domUtils.findFirstVisible(selector).value = rawValue; },
      selectPrimengDropdown: async () => {}, selectLabeledDropdown: async () => {},
      setPhoneFields: async (selector, value) => { root.domUtils.findFirstVisible(selector).value = value; },
      upload: {
        waitForFileInputForStep: async step => step.upload_kind === "vaccination" ? null : surface.querySelector("input[type='file']"),
        resolveUploadFilePath: value => value, resolveSelectedUploadFile: async () => null, notifyUploadWidget() {},
        formatBytesAsKb: value => value,
        trySetFileInputWithDebugger: async (input, path) => {
          assert(activePage === "upload", `A new passport was uploaded onto the previous ${activePage} page`);
          activeMember = members.find(member => member.passportImagePath === path);
          assert(activeMember, "Unknown requested passport");
          uploaded.push(activeMember.id);
          const filename = options.wrongSelectedFile && activeMember.id === "10" ? "other.jpeg" : activeMember.fileName;
          const transfer = new DataTransfer(); transfer.items.add(new File(["fixture"], filename, { type: "image/jpeg" })); input.files = transfer.files;
          schedule(1200, proceed);
          return { ok: true };
        },
      },
    });
    const runner = root.automationRunner.createAutomationRunner({
      state, checkpoint, sleep, persistState, ...waits, runStep: dispatcher.runStep, detectNusukStage: nav.detectNusukStage, appendLog: (level, message) => logs.push({ level, message }), postPanelState() {},
    });
    list();
    return { state, submitted, uploaded, filledNames, logs, run: () => runner.runAutomation(state.currentRunPayload), restore: () => { Date.now = originalNow; chrome.runtime.sendMessage = originalSend; } };
  }

  for (const [label, options] of [
    ["delayed Add Another and Go To List transitions", {}],
    ["hidden inputs from an earlier upload and late OCR names", { hiddenOldInput: true, staleNames: true }],
    ["a passport number that appears after the first identity wait expires", { delayedNumber: true }],
    ["SUHERMAN consistently misread as LUZERMAN on passport 10", { suherman: true }],
    ["permanently misread OCR names on every passport", { misreadAllNames: true }],
    ["name fields changed by Nusuk after the production fill steps", { resetFilledNames: true }],
    ["a Summary name that still differs from the reviewed name", { wrongSummaryName: true, suherman: true }],
    ["a name control that refuses correction", { refusesName: true, suherman: true }],
    ["Summary names and attachment filenames that are not displayed", { hiddenSummaryData: true }],
  ]) {
    await test(`all 16 passports save exactly once with ${label}`, async () => {
      const h = fixture(options);
      try {
        await h.run();
        const expected = Array.from({ length: 16 }, (_, index) => String(index + 1));
        assert(JSON.stringify(h.submitted) === JSON.stringify(expected), `Saved passports: ${h.submitted.join(", ")}`);
        assert(JSON.stringify(h.uploaded) === JSON.stringify(expected), "A passport was uploaded twice or skipped");
        assert(h.state.progressCurrent === 16 && h.state.completedMemberIds.length === 16, "The batch stopped before passport 16");
        assert(!h.state.pendingSubmission && !h.state.currentRunPayload, "The completed batch retained a pending save or queue");
        if (options.suherman) {
          if (!options.refusesName) assert(h.filledNames.get("10") === "SUHERMAN SUHERMAN", "The accepted name fields did not follow the reviewed profile");
          const note = h.state.autofillNameCorrections.find(note => note.memberId === "10");
          assert(note?.observedName === "LUZERMAN" && note.expectedName === "SUHERMAN SUHERMAN", "The reported OCR correction was lost");
          assert(h.logs.some(log => log.message.includes("Catatan OCR Nusuk")), "The correction was absent from the final report");
        }
        if (options.misreadAllNames) assert(h.state.autofillNameCorrections.length === 16, "Some corrected OCR names were lost or recorded twice");
        if (options.wrongSummaryName || options.refusesName || options.hiddenSummaryData) {
          const warnings = h.state.autofillDataWarnings;
          assert(warnings.length > 0 && warnings.every(note => note.memberId === "10"), "Warnings did not identify the affected passport");
          assert(new Set(warnings.map(note => note.key)).size === warnings.length, "Repeated checks duplicated warnings");
          assert(h.logs.some(log => log.level === "warning" && log.message.includes("Periksa hasil paspor X0000010")), "The final review reminder was missing");
        }
      } finally { h.restore(); }
    });
  }
  for (const [label, options, expectedError] of [
    ["a different passport number", { wrongNumber: true, suherman: true }, /Nomor paspor.*berbeda/],
    ["a wrong selected file", { wrongSelectedFile: true, suherman: true }, /file paspor terpilih.*berbeda/],
    ["a wrong Summary attachment", { wrongSummaryFile: true, suherman: true }, /File paspor.*berbeda/],
  ]) {
    await test(`${label} on passport 10 stops before Save and preserves the remaining seven`, async () => {
      const h = fixture(options);
      try {
        let failure;
        try { await h.run(); } catch (error) { failure = error; }
        assert(expectedError.test(failure?.message || ""), failure?.message || "An incorrect passport was saved");
        assert(h.submitted.length === 9 && h.state.progressCurrent === 9, "An incorrect passport was saved or previous successes were lost");
        assert(h.state.currentRunPayload.members.length === 7 && h.state.currentRunPayload.members[0].id === "10", "The failed passport or remaining queue was lost");
        assert(!h.state.pendingSubmission, "A save lock was created before the final identity checks passed");
      } finally { h.restore(); }
    });
  }
};
