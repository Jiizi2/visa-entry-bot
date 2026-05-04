(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const { interpolate, normalizeOption } = root.valueUtils || {};
  const {
    clickElement,
    setInputValue,
    findFirstVisible,
    queryAll,
    isVisible,
    isEnabled,
  } = root.domUtils || {};
  const {
    isLikelyNextSelector,
    isLikelyProceedSelector,
    describeSelectorForLog,
  } = root.nusukNavigation || {};
  if (!interpolate || !normalizeOption || !clickElement || !setInputValue || !findFirstVisible || !queryAll || !isVisible || !isEnabled || !isLikelyNextSelector || !isLikelyProceedSelector || !describeSelectorForLog) {
    throw new Error("NusukAutofill step basic action dependencies were not loaded.");
  }

  function createStepBasicActions({
    sleep,
    waitForInput,
    waitForEnabled,
    waitForSelector,
    waitForPageReady,
    markActiveElement,
    appendLog,
    finishStep,
    waitForProceedOrPassportDetails,
    waitForNusukPageReady,
    clickProceedButtonRobust,
    waitForEnabledNextButton,
    clickNextButtonRobust,
    attemptFillRequiredFieldsForCurrentPage,
  }) {
    async function handleWaitForSelector(step, selector, timeoutMs, runId) {
      appendLog("info", `Waiting for ${describeSelectorForLog(selector, step)}`);
      if (isLikelyProceedSelector(selector)) {
        await waitForProceedOrPassportDetails(timeoutMs, runId);
        await waitForPageReady(Math.min(timeoutMs, 6000), runId);
        finishStep(step, selector);
        return;
      }
      await waitForSelector(selector, {
        timeoutMs,
        state: String(step?.wait_state || "").trim().toLowerCase() || "visible",
      }, runId);
      await waitForPageReady(Math.min(timeoutMs, 6000), runId);
      finishStep(step, selector);
    }

    async function handleWaitForEnabled(step, context, selector, timeoutMs, runId) {
      appendLog("info", `Checking enabled state for ${describeSelectorForLog(selector, step)}`);
      if (isLikelyNextSelector(selector)) {
        await waitForEnabledNextButton(timeoutMs, runId, context);
      } else {
        await waitForEnabled(selector, timeoutMs, runId);
      }
      finishStep(step, selector);
    }

    async function handleWait(step, selector, runId) {
      await sleep(Number(step?.ms || 500), runId);
      finishStep(step, selector);
    }

    async function handleWaitForNusukPageReady(step, selector, timeoutMs, runId) {
      const pageName = String(step?.page || step?.page_name || selector || "").trim();
      appendLog("info", `Waiting for ${describeSelectorForLog(selector, step)}`);
      await waitForNusukPageReady(pageName, timeoutMs, runId);
      await waitForPageReady(Math.min(timeoutMs, 6000), runId);
      finishStep(step, selector || pageName);
    }

    async function handleOpenMutamerForm(step, selector, timeoutMs, runId) {
      appendLog("info", "Checking mutamer form.");
      const deadline = Date.now() + Math.max(500, Number(timeoutMs || 0));
      let clicked = false;

      while (Date.now() < deadline) {
        const addButton = findAddNewMutamerButton();
        if (addButton && (isMutamerListVisible() || !findAttachedPassportInput(selector))) {
          markActiveElement(addButton);
          await clickElement(addButton);
          clicked = true;
          await sleep(650, runId);
          continue;
        }

        const passportInput = findAttachedPassportInput(selector);
        if (passportInput) {
          appendLog(clicked ? "success" : "info", clicked ? "Mutamer form opened." : "Mutamer form already open.");
          finishStep(step, selector);
          return;
        }

        await sleep(160, runId);
      }

      throw new Error("Form upload passport belum muncul dan tombol Add new mutamer tidak ditemukan.");
    }

    async function handleClick(step, context, selector, timeoutMs, runId) {
      appendLog("info", `Clicking ${describeSelectorForLog(selector, step)}`);
      if (isLikelyNextSelector(selector)) {
        await waitForEnabledNextButton(timeoutMs, runId, context);
        const clicked = await clickNextButtonRobust(timeoutMs, runId, context);
        if (!clicked) {
          throw new Error("Failed to click Next.");
        }
      } else if (isLikelyProceedSelector(selector)) {
        const clicked = await clickProceedButtonRobust(timeoutMs, runId);
        if (!clicked) {
          throw new Error("Failed to click Proceed.");
        }
      } else {
        const element = await waitForSelector(selector, { timeoutMs, state: "visible" }, runId);
        markActiveElement(element);
        await clickElement(element);
      }
      finishStep(step, selector);
    }

    async function handleFill(step, context, selector, timeoutMs, skipWhenEmpty, runId) {
      const value = interpolate(step?.value || "", context).trim();
      if (!value && skipWhenEmpty) {
        appendLog("warning", `Skipping empty field for ${selector}`);
        finishStep(step, selector);
        return;
      }
      if (!value) {
        throw new Error(`Missing fill value for selector: ${selector}`);
      }
      const input = await waitForInput(selector, timeoutMs, runId);
      markActiveElement(input);
      setInputValue(input, value);
      appendLog("success", `Filled ${selector} with ${value}`);
      finishStep(step, selector);
    }

    function handleFillArabicMinimal(step, context, selector) {
      const firstValue = interpolate(step?.first_value || "", context).trim();
      const familyValue = interpolate(step?.family_value || "", context).trim();
      if (!firstValue || !familyValue) {
        throw new Error("fill_arabic_minimal requires first and family Arabic values.");
      }
      const firstInput = findFirstVisible([
        "div[formgroupname='firstName'] input[formcontrolname='ar']",
        "input[formcontrolname='firstName.ar']",
        "input[name='firstName.ar']",
        "input[placeholder='First Name (Arabic)']",
        "input[placeholder='First name (Arabic)']",
      ].join(", "));
      const familyInput = findFirstVisible([
        "div[formgroupname='familyName'] input[formcontrolname='ar']",
        "input[formcontrolname='familyName.ar']",
        "input[name='familyName.ar']",
        "input[placeholder='Family Name (Arabic)']",
      ].join(", "));
      if (!firstInput || !familyInput) {
        throw new Error("Arabic inputs are not visible.");
      }
      markActiveElement(firstInput);
      setInputValue(firstInput, firstValue);
      markActiveElement(familyInput);
      setInputValue(familyInput, familyValue);
      appendLog("success", "Filled minimal Arabic fields.");
      finishStep(step, selector);
    }

    async function handleClickSuccessPopupAction(step, context, selector, timeoutMs, runId) {
      const action = resolveSuccessPopupAction(step, context);
      const button = await waitForSuccessPopupActionButton(action, timeoutMs, runId);
      markActiveElement(button);
      await clickElement(button);
      appendLog("success", action === "add_another" ? "Success popup confirmed: Add Another Mutamer." : "Success popup confirmed: Go To Mutamer List.");
      finishStep(step, selector);
    }

    async function waitForSuccessPopupActionButton(action, timeoutMs, runId) {
      const deadline = Date.now() + Math.max(500, Number(timeoutMs || 0));
      let lastFallback = null;
      let fallbackReadyAt = 0;
      const fallbackAction = action === "add_another" ? "go_to_list" : "add_another";
      while (Date.now() < deadline) {
        const buttons = findSuccessPopupActionButtons();
        const preferred = buttons.find((item) => item.action === action);
        if (preferred?.button) {
          return preferred.button;
        }
        const fallback = buttons.find((item) => item.action === fallbackAction);
        if (fallback?.button) {
          lastFallback = fallback.button;
          fallbackReadyAt = fallbackReadyAt || Date.now() + 1200;
          if (Date.now() >= fallbackReadyAt) {
            appendLog("warning", fallbackAction === "go_to_list"
              ? "Tombol Add Another Mutamer tidak terlihat, kembali ke Mutamer List lalu lanjut dari tombol Add new mutamer."
              : "Tombol Go To Mutamer List tidak terlihat, memakai Add Another Mutamer untuk menutup popup akhir.");
            return lastFallback;
          }
        } else {
          fallbackReadyAt = 0;
        }
        await sleep(160, runId);
      }
      if (lastFallback) {
        appendLog("warning", fallbackAction === "go_to_list"
          ? "Tombol Add Another Mutamer tidak terlihat, kembali ke Mutamer List lalu lanjut dari tombol Add new mutamer."
          : "Tombol Go To Mutamer List tidak terlihat, memakai Add Another Mutamer untuk menutup popup akhir.");
        return lastFallback;
      }
      throw new Error(action === "add_another"
        ? "Tombol Add Another Mutamer tidak ditemukan setelah mutamer berhasil ditambahkan."
        : "Tombol Go To Mutamer List tidak ditemukan setelah mutamer berhasil ditambahkan.");
    }

    function findSuccessPopupActionButtons() {
      return queryAll(".popup .popup-actions button, .popup .popup-actions [role='button'], .popup button")
        .filter((button) => button instanceof HTMLElement && isVisible(button) && isEnabled(button))
        .map((button) => ({
          button,
          action: classifySuccessPopupAction(button),
        }))
        .filter((item) => item.action);
    }

    function classifySuccessPopupAction(button) {
      const text = normalizeOption(button.textContent || button.getAttribute("aria-label") || "");
      if (text.includes("add another mutamer") || text.includes("add another")) {
        return "add_another";
      }
      if (text.includes("go to mutamer list") || text.includes("mutamer list")) {
        return "go_to_list";
      }
      return "";
    }

    function resolveSuccessPopupAction(step, context) {
      const configured = normalizeOption(interpolate(step?.preferred_action || step?.success_action || "", context || {}));
      if (configured.includes("add another")) {
        return "add_another";
      }
      if (configured.includes("go to") || configured.includes("list")) {
        return "go_to_list";
      }
      return context?.isLastMember === false ? "add_another" : "go_to_list";
    }

    function findAttachedPassportInput(selector) {
      return queryAll(selector).find((node) => node instanceof HTMLInputElement && node.type === "file") || null;
    }

    function findAddNewMutamerButton() {
      return queryAll([
        ".mutamer-header-actions button",
        ".mutamer-header button",
        "button",
        "[role='button']",
      ].join(", "))
        .find((button) => {
          if (!(button instanceof HTMLElement) || !isVisible(button) || !isEnabled(button)) {
            return false;
          }
          const text = normalizeOption(button.textContent || button.getAttribute("aria-label") || button.getAttribute("title") || "");
          return text.includes("add new mutamer")
            || text.includes("add mutamer")
            || (text.includes("add new") && text.includes("mutamer"));
        }) || null;
    }

    function isMutamerListVisible() {
      return queryAll(".mutamer-header-title h2, h1, h2, .title")
        .some((node) => node instanceof HTMLElement && isVisible(node) && normalizeOption(node.textContent || "").includes("mutamer list"));
    }

    return {
      handleWaitForSelector,
      handleWaitForEnabled,
      handleWait,
      handleWaitForNusukPageReady,
      handleOpenMutamerForm,
      handleClick,
      handleFill,
      handleFillArabicMinimal,
      handleClickSuccessPopupAction,
    };
  }

  root.stepBasicActions = Object.freeze({
    createStepBasicActions,
  });
})();
