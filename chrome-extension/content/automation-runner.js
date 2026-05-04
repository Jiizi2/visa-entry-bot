(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const {
    PASSPORT_UPLOAD_SELECTOR,
    NEXT_BUTTON_SELECTOR,
  } = root.constants || {};
  const { normalizeDateToIso } = root.dateUtils || {};
  const { deepValue } = root.valueUtils || {};
  const { buildPerMemberSteps } = root.automationSteps || {};
  if (!PASSPORT_UPLOAD_SELECTOR || !NEXT_BUTTON_SELECTOR || !normalizeDateToIso || !deepValue || !buildPerMemberSteps) {
    throw new Error("NusukAutofill automation runner dependencies were not loaded.");
  }

  function createAutomationRunner({
    state,
    checkpoint,
    slowModeDelayAfterStep,
    appendLog,
    postPanelState,
    persistState,
    runStep,
    countsForProgress,
  }) {
    async function runAutomation(payload, runId = state.runToken) {
      const members = resolveAutomationMembers(payload);
      if (!members.length) {
        throw new Error("Missing member payload.");
      }

      const globalSteps = [
        {
          action: "open_mutamer_form",
          selector: PASSPORT_UPLOAD_SELECTOR,
          timeout_ms: 30000,
        },
      ];

      const perMemberSteps = buildPerMemberSteps(NEXT_BUTTON_SELECTOR);
      const progressSteps = [...globalSteps, ...perMemberSteps].filter(countsForProgress);
      state.progressCurrent = 0;
      state.progressTotal = progressSteps.length * members.length;
      postPanelState();

      const startMemberIndex = Math.max(0, Number(payload?.startMemberIndex ?? payload?.memberIndex ?? 0));
      for (let memberOffset = 0; memberOffset < members.length; memberOffset += 1) {
        const member = members[memberOffset];
        const context = {
          member,
          memberIndex: startMemberIndex + memberOffset,
          batchMemberIndex: memberOffset,
          memberNumber: memberOffset + 1,
          totalMembers: members.length,
          isLastMember: memberOffset === members.length - 1,
          entryReleaseDate: resolvePreferredReleaseDate(member),
          manifestPath: String(payload?.manifestPath || state.manifest?.manifestPath || ""),
          runId,
        };

        state.selectedMemberId = String(member.id || state.selectedMemberId || "");
        appendLog?.("info", `Memproses jamaah ${memberOffset + 1}/${members.length}: ${describeMember(member)}`);
        postPanelState();

        for (let index = 0; index < globalSteps.length; index += 1) {
          await checkpoint(runId);
          await runStep(globalSteps[index], { ...context, index });
          await slowModeDelayAfterStep(globalSteps[index], runId);
        }

        for (let index = 0; index < perMemberSteps.length; index += 1) {
          await checkpoint(runId);
          const step = perMemberSteps[index];
          await runStep(step, { ...context, index: globalSteps.length + index });
          if (isMutamerSuccessPopupWaitStep(step)) {
            await markMemberAddedForResume(payload, members, startMemberIndex, memberOffset);
          }
          await slowModeDelayAfterStep(step, runId);
        }

        appendLog?.("success", `Jamaah ${memberOffset + 1}/${members.length} berhasil dientry: ${describeMember(member)}`);
      }
    }

    async function markMemberAddedForResume(payload, members, startMemberIndex, memberOffset) {
      const remainingMembers = members.slice(memberOffset + 1);
      if (!remainingMembers.length) {
        state.currentRunPayload = null;
        await persistState?.();
        return;
      }
      state.currentRunPayload = {
        ...payload,
        members: remainingMembers,
        startMemberIndex: startMemberIndex + memberOffset + 1,
        totalMembers: remainingMembers.length,
      };
      await persistState?.();
    }

    function getSelectedMember() {
      const members = Array.isArray(state.manifest?.members) ? state.manifest.members : [];
      return members.find((member) => String(member.id || "") === String(state.selectedMemberId || "")) || null;
    }

    return {
      runAutomation,
      getSelectedMember,
    };
  }

  function resolveAutomationMembers(payload) {
    if (Array.isArray(payload?.members)) {
      return payload.members.filter((member) => member && typeof member === "object");
    }
    return payload?.member && typeof payload.member === "object" ? [payload.member] : [];
  }

  function describeMember(member) {
    const resolved = member?.resolvedProfile || {};
    const name = [resolved.firstName || "", resolved.familyName || ""].filter(Boolean).join(" ") || "Tanpa Nama";
    const passport = resolved.passportNumber || member?.passportExtracted?.passportNumber || "-";
    return `${name} | ${passport}`;
  }

  function isMutamerSuccessPopupWaitStep(step) {
    return String(step?.action || "").trim().toLowerCase() === "wait_for_selector"
      && String(step?.selector || "").toLowerCase().includes("mutamer has been added successfully");
  }

  function resolvePreferredReleaseDate(member) {
    const passportIssueDate = String(deepValue(member, "passportExtracted.issueDate") || "").trim();
    const releaseDate = String(deepValue(member, "resolvedProfile.releaseDate") || "").trim();
    const issueDate = String(deepValue(member, "resolvedProfile.issueDate") || "").trim();
    const normalizedPassportIssue = normalizeDateToIso(passportIssueDate);
    const normalizedRelease = normalizeDateToIso(releaseDate);
    const normalizedIssue = normalizeDateToIso(issueDate);

    if (normalizedPassportIssue) {
      return passportIssueDate;
    }
    if (normalizedRelease && normalizedIssue && normalizedRelease !== normalizedIssue) {
      return issueDate;
    }
    return releaseDate || issueDate || "";
  }

  root.automationRunner = Object.freeze({
    createAutomationRunner,
  });
})();
