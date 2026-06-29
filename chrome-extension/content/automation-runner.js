(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const {
    PASSPORT_UPLOAD_SELECTOR,
    NEXT_BUTTON_SELECTOR,
    AUTOFILL_MAX_RETRIES_PER_MEMBER,
    AUTOFILL_RETRY_BASE_DELAY_MS,
    AUTOFILL_RETRY_MAX_DELAY_MS,
    AUTOFILL_MEMBER_WATCHDOG_MS,
    AUTOFILL_SESSION_RECOVERY_WAIT_MS,
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
    sleep,
    waitUntil,
    detectNusukStage,
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
          members,
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
        if (chrome?.runtime?.sendMessage) {
          chrome.runtime.sendMessage({
            type: "NUSUK_WS_EVENT",
            payload: {
              eventType: "CURRENT_MEMBER",
              memberId: member.id || `member-${memberOffset + 1}`
            }
          });
        }
        appendLog?.("info", `Memproses jamaah ${memberOffset + 1}/${members.length}: ${describeMember(member)}`);
        postPanelState();

        const result = await runMemberWithRetry({
          payload,
          members,
          startMemberIndex,
          memberOffset,
          context,
          globalSteps,
          perMemberSteps,
          runId,
        });

        if (result.success) {
          appendLog?.("success", `Jamaah ${memberOffset + 1}/${members.length} berhasil dientry: ${describeMember(member)}`);
          if (chrome?.runtime?.sendMessage) {
            chrome.runtime.sendMessage({
              type: "NUSUK_WS_EVENT",
              payload: {
                eventType: "MEMBER_COMPLETED",
                memberId: member.id
              }
            });
          }
          continue;
        }

        appendLog?.("error", `Jamaah ${memberOffset + 1}/${members.length} dilewati setelah retry maksimal: ${describeMember(member)}. Alasan: ${result.reason}`);
        await recordMemberFailure(payload, members, startMemberIndex, memberOffset, result.reason);
      }
      if (chrome?.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: "NUSUK_WS_EVENT",
          payload: {
            eventType: "SESSION_COMPLETED"
          }
        });
      }
    }

    async function runMemberWithRetry({ payload, members, startMemberIndex, memberOffset, context, globalSteps, perMemberSteps, runId }) {
      const maxRetries = Math.max(1, Number(AUTOFILL_MAX_RETRIES_PER_MEMBER || 3));
      const memberStartProgress = Number(state.progressCurrent || 0);
      for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        await checkpoint(runId);
        try {
          await withWatchdog(
            runMemberOnce({ payload, members, startMemberIndex, memberOffset, context, globalSteps, perMemberSteps, runId }),
            Number(AUTOFILL_MEMBER_WATCHDOG_MS || 180000),
            `jamaah ${context.memberNumber}/${context.totalMembers}`
          );
          return { success: true };
        } catch (error) {
          throwIfControlError(error);
          state.progressCurrent = Math.min(memberStartProgress, Number(state.progressTotal || memberStartProgress));
          const reason = classifyAutomationFailure(error);
          await recordAttemptFailure(context, attempt, maxRetries, reason, error);
          if (attempt >= maxRetries) {
            return { success: false, reason };
          }
          await recoverAfterAttemptFailure(reason, runId);
          await sleep(backoffDelay(attempt), runId);
        }
      }
      return { success: false, reason: "max_retries_exceeded" };
    }

    async function runMemberOnce({ payload, members, startMemberIndex, memberOffset, context, globalSteps, perMemberSteps, runId }) {
      await ensureSessionStillUsable();
      const resumeStage = resolveCurrentNusukStage();
      const shouldSkipOpenForm = resumeStage > 0 && resumeStage < 5;
      const firstPerMemberStepIndex = shouldSkipOpenForm
        ? findResumeStepIndex(perMemberSteps, resumeStage)
        : 0;
      if (shouldSkipOpenForm) {
        appendLog?.("warning", `Resume terdeteksi di ${stageLabel(resumeStage)}. Melanjutkan dari step halaman ini, bukan membuka Add Mutamer baru.`);
      }

      for (let index = 0; index < globalSteps.length; index += 1) {
        if (shouldSkipOpenForm) {
          break;
        }
        await checkpoint(runId);
        await ensureSessionStillUsable();
        if (chrome?.runtime?.sendMessage) {
          chrome.runtime.sendMessage({
            type: "NUSUK_WS_EVENT",
            payload: {
              eventType: "CURRENT_STEP",
              stepName: globalSteps[index].label || globalSteps[index].action || `Langkah ${index + 1}`
            }
          });
        }
        await runStep(globalSteps[index], { ...context, index });
        await slowModeDelayAfterStep(globalSteps[index], runId);
      }

      for (let index = firstPerMemberStepIndex; index < perMemberSteps.length; index += 1) {
        await checkpoint(runId);
        await ensureSessionStillUsable();
        const step = perMemberSteps[index];
        if (chrome?.runtime?.sendMessage) {
          chrome.runtime.sendMessage({
            type: "NUSUK_WS_EVENT",
            payload: {
              eventType: "CURRENT_STEP",
              stepName: step.label || step.action || `Langkah ${index + 1}`
            }
          });
        }
        await runStep(step, { ...context, index: globalSteps.length + index });
        if (isMutamerSuccessPopupWaitStep(step)) {
          await markMemberAddedForResume(payload, members, startMemberIndex, memberOffset);
        }
        await slowModeDelayAfterStep(step, runId);
      }
    }

    function resolveCurrentNusukStage() {
      if (typeof detectNusukStage !== "function") {
        return 0;
      }
      try {
        return Number(detectNusukStage() || 0);
      } catch {
        return 0;
      }
    }

    function findResumeStepIndex(steps, stage) {
      const pageNameByStage = {
        1: "passport_details",
        2: "member_form",
        3: "disclosure",
        4: "summary",
      };
      const pageName = pageNameByStage[stage] || "";
      if (!pageName) {
        return 0;
      }
      const index = steps.findIndex((step) => String(step?.action || "").trim().toLowerCase() === "wait_for_nusuk_page_ready"
        && String(step?.page || "").trim().toLowerCase() === pageName);
      return index >= 0 ? index : 0;
    }

    function stageLabel(stage) {
      if (stage === 1) {
        return "Passport Details";
      }
      if (stage === 2) {
        return "Member Form";
      }
      if (stage === 3) {
        return "Disclosure Form";
      }
      if (stage === 4) {
        return "Summary";
      }
      return "halaman aktif";
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

    async function recordMemberFailure(payload, members, startMemberIndex, memberOffset, reason) {
      const failedMember = members[memberOffset];
      state.autofillFailures = [
        ...(Array.isArray(state.autofillFailures) ? state.autofillFailures : []),
        {
          memberIndex: startMemberIndex + memberOffset,
          memberId: String(failedMember?.id || ""),
          reason: String(reason || "unknown"),
          failedAt: new Date().toISOString(),
        },
      ].slice(-100);

      const remainingMembers = members.slice(memberOffset + 1);
      state.currentRunPayload = remainingMembers.length
        ? {
            ...payload,
            members: remainingMembers,
            startMemberIndex: startMemberIndex + memberOffset + 1,
            totalMembers: remainingMembers.length,
          }
        : null;
      await persistState?.();
    }

    async function recordAttemptFailure(context, attempt, maxRetries, reason, error) {
      const member = context.member || {};
      const report = {
        memberIndex: context.memberIndex,
        batchMemberIndex: context.batchMemberIndex,
        memberId: String(member.id || ""),
        passportNumber: String(member?.resolvedProfile?.passportNumber || member?.passportExtracted?.passportNumber || ""),
        attempt,
        maxRetries,
        reason,
        url: String(location.href || ""),
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      };
      state.autofillAttemptFailures = [
        ...(Array.isArray(state.autofillAttemptFailures) ? state.autofillAttemptFailures : []),
        report,
      ].slice(-100);
      appendLog?.("warning", `Percobaan ${attempt}/${maxRetries} gagal untuk ${describeMember(member)}: ${reason}`);
      await captureFailureScreenshot(report).catch(() => {});
      await persistState?.();
    }

    async function captureFailureScreenshot(report) {
      if (!chrome?.runtime?.sendMessage) {
        return;
      }
      const response = await chrome.runtime.sendMessage({
        type: "NUSUK_CAPTURE_FAILURE_SCREENSHOT",
        payload: {
          memberIndex: report.memberIndex,
          attempt: report.attempt,
          reason: report.reason,
        },
      });
      if (!response?.ok || !response.dataUrl) {
        return;
      }
      state.autofillFailureScreenshots = [
        ...(Array.isArray(state.autofillFailureScreenshots) ? state.autofillFailureScreenshots : []),
        {
          memberIndex: report.memberIndex,
          attempt: report.attempt,
          reason: report.reason,
          capturedAt: new Date().toISOString(),
          dataUrl: response.dataUrl,
        },
      ].slice(-3);
    }

    async function recoverAfterAttemptFailure(reason, runId) {
      if (reason === "session_expired") {
        appendLog?.("warning", "Session terlihat expired. Silakan login ulang di tab ini; automation akan lanjut setelah halaman kembali siap.");
        await waitForSessionRecovery(runId);
        return;
      }

      if (reason === "watchdog_timeout" || reason === "page_frozen" || reason === "navigation_failure" || reason === "missing_element") {
        appendLog?.("warning", "Halaman terlihat macet. Refresh halaman lalu lanjut dari checkpoint jamaah yang sama.");
        state.executionState = "running";
        await persistState?.();
        window.location.reload();
        await sleep(10000, runId);
        return;
      }

      await dismissBlockingPopups();
    }

    async function waitForSessionRecovery(runId) {
      const timeoutMs = Number(AUTOFILL_SESSION_RECOVERY_WAIT_MS || 180000);
      if (typeof waitUntil !== "function") {
        await sleep(Math.min(timeoutMs, 15000), runId);
        return;
      }
      await waitUntil(
        () => !isSessionExpired(),
        timeoutMs,
        "Session masih expired setelah menunggu login ulang.",
        runId
      );
    }

    async function dismissBlockingPopups() {
      const candidates = Array.from(document.querySelectorAll(".popup button, .modal button, button"))
        .filter((button) => button instanceof HTMLElement)
        .filter((button) => /^(ok|close|cancel|back)$/i.test(String(button.textContent || "").trim()));
      const button = candidates.find((item) => {
        const rect = item.getBoundingClientRect();
        const style = window.getComputedStyle(item);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      });
      button?.click?.();
    }

    async function ensureSessionStillUsable() {
      if (isSessionExpired()) {
        throw new Error("session_expired");
      }
    }

    function isSessionExpired() {
      const url = String(location.href || "").toLowerCase();
      if (url.includes("/login") || url.includes("/auth") || url.includes("signin") || url.includes("sessionexpired")) {
        return true;
      }
      const bodyText = String(document.body?.innerText || "").toLowerCase();
      if (bodyText.includes("session expired") || bodyText.includes("please login") || bodyText.includes("sign in")) {
        return true;
      }
      return Boolean(document.querySelector("input[type='password'], input[name='password'], input[formcontrolname='password']"));
    }

    function classifyAutomationFailure(error) {
      const message = String(error?.message || error || "").toLowerCase();
      if (message.includes("execution interrupted")) {
        return "interrupted";
      }
      if (message.includes("watchdog_timeout")) {
        return "watchdog_timeout";
      }
      if (message.includes("session_expired") || isSessionExpired()) {
        return "session_expired";
      }
      if (message.includes("timed out") || message.includes("timeout")) {
        return "timeout";
      }
      if (message.includes("navigation") || message.includes("halaman nusuk belum siap")) {
        return "navigation_failure";
      }
      if (message.includes("tombol next belum siap") || message.includes("next button is not enabled") || message.includes("form belum siap")) {
        return "validation_blocked";
      }
      if (message.includes("selector") || message.includes("tidak ditemukan") || message.includes("not found") || message.includes("belum muncul")) {
        return "missing_element";
      }
      if (document.hidden || document.readyState === "loading") {
        return "page_frozen";
      }
      return "unknown";
    }

    function throwIfControlError(error) {
      if (error && typeof error === "object" && error.name === "NusukControlError") {
        throw error;
      }
    }

    function backoffDelay(attempt) {
      const base = Math.max(500, Number(AUTOFILL_RETRY_BASE_DELAY_MS || 2000));
      const max = Math.max(base, Number(AUTOFILL_RETRY_MAX_DELAY_MS || 15000));
      const jitter = Math.floor(Math.random() * 800);
      return Math.min(max, base * Math.pow(2, Math.max(0, attempt - 1)) + jitter);
    }

    async function withWatchdog(promise, timeoutMs, label) {
      let timer = 0;
      const watchdog = new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(`watchdog_timeout:${label}`)), Math.max(5000, Number(timeoutMs || 0)));
      });
      try {
        return await Promise.race([promise, watchdog]);
      } finally {
        window.clearTimeout(timer);
      }
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
