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
      if (isMutamerSuccessSelector(selector)) {
        await waitForNusukPageReady("success", timeoutMs, runId);
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
      let lastDiagnosticAt = 0;

      while (Date.now() < deadline) {
        const passportInput = findAttachedPassportInput(selector);
        if (passportInput) {
          appendLog(clicked ? "success" : "info", clicked ? "Mutamer form opened." : "Mutamer form already open.");
          finishStep(step, selector);
          return;
        }

        const addButton = findAddNewMutamerButton();
        if (addButton) {
          markActiveElement(addButton);
          await clickElement(addButton);
          clicked = true;
          await sleep(650, runId);
          continue;
        }

        if (Date.now() - lastDiagnosticAt > 5000) {
          const hint = describeVisibleMutamerOpenCandidates();
          if (hint) {
            appendLog("warning", `Belum menemukan tombol Add mutamer. Kandidat terlihat: ${hint}`);
          }
          lastDiagnosticAt = Date.now();
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

    async function handleClickAddCompanion(step, context, selector, timeoutMs, runId) {
      if (step?.minor_only && !isMinorMember(context?.member)) {
        appendLog("info", "Add Companion dilewati: jamaah bukan anak-anak.");
        finishStep(step, selector || "Add Companion");
        return;
      }
      appendLog("info", "Checking Add Companion action.");
      const deadline = Date.now() + Math.max(500, Number(timeoutMs || 0));
      let sawCompanionControl = false;
      while (Date.now() < deadline) {
        const button = findAddCompanionButton(selector);
        if (button) {
          sawCompanionControl = true;
          if (!isEnabled(button)) {
            await sleep(160, runId);
            continue;
          }
          markActiveElement(button);
          await clickElement(button);
          await sleep(650, runId);
          appendLog("success", "Add Companion clicked.");
          const selected = await selectCompanionFromPicker(context, timeoutMs, runId);
          if (selected) {
            appendLog("success", "Companion selected.");
          }
          const relation = await selectCompanionRelation(context, timeoutMs, runId);
          if (relation) {
            appendLog("success", `Companion relation selected: ${relation}.`);
          }
          finishStep(step, selector || "Add Companion");
          return;
        }
        await sleep(160, runId);
      }

      if (step?.optional_selector && !sawCompanionControl) {
        appendLog("info", "Add Companion tidak muncul, dilewati.");
        finishStep(step, selector || "Add Companion");
        return;
      }
      throw new Error(sawCompanionControl ? "Tombol Add Companion belum aktif." : "Tombol Add Companion tidak ditemukan.");
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
      if (isMutamerListVisible() && !isSuccessPopupVisible()) {
        appendLog("success", "Mutamer sudah masuk list; popup sukses tidak perlu diklik.");
        finishStep(step, selector);
        return;
      }
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

    function isSuccessPopupVisible() {
      return Boolean(findFirstVisible([
        ".popup h3:has-text('Mutamer has been added successfully')",
        ".popup:has-text('Mutamer has been added successfully')",
      ].join(", ")));
    }

    function isMutamerSuccessSelector(selector) {
      return String(selector || "").toLowerCase().includes("mutamer has been added successfully");
    }

    function findAttachedPassportInput(selector) {
      return queryAll(selector).find((node) => node instanceof HTMLInputElement && node.type === "file") || null;
    }

    function findAddNewMutamerButton() {
      return queryAll([
        ".mutamer-header-actions button",
        ".mutamer-header-actions a",
        ".mutamer-header-actions [role='button']",
        ".mutamer-header button",
        ".mutamer-header a",
        ".mutamer-header [role='button']",
        "button[class*='add' i]",
        "a[class*='add' i]",
        "[role='button'][class*='add' i]",
        "[aria-label*='add' i]",
        "[title*='add' i]",
        ".btn",
        "button",
        "a",
        "[role='button']",
      ].join(", "))
        .find((element) => {
          if (!(element instanceof HTMLElement) || !isVisible(element) || !isEnabled(element)) {
            return false;
          }
          return looksLikeAddMutamerControl(element);
        }) || null;
    }

    function looksLikeAddMutamerControl(element) {
      const text = normalizeOption([
        element.textContent || "",
        element.getAttribute("aria-label") || "",
        element.getAttribute("title") || "",
        element.getAttribute("data-testid") || "",
        element.getAttribute("class") || "",
      ].join(" "));
      if (!text) {
        return false;
      }
      const hasAdd = text.includes("add") || text.includes("new") || text.includes("plus") || text.includes("+");
      const hasMutamer = text.includes("mutamer")
        || text.includes("pilgrim")
        || text.includes("applicant")
        || text.includes("member")
        || text.includes("beneficiary");
      return text.includes("add new mutamer")
        || text.includes("add mutamer")
        || text.includes("new mutamer")
        || (hasAdd && hasMutamer)
        || (isMutamerListVisible() && hasAdd);
    }

    function findAddCompanionButton(selector) {
      const candidates = [
        ...(selector ? queryAll(selector) : []),
        ...findCompanionSectionButtons(),
        ...queryAll([
          ".companion button",
          ".companion a",
          ".companion [role='button']",
          "[class*='companion' i] button",
          "[class*='companion' i] a",
          "[class*='companion' i] [role='button']",
          "button",
          "a",
          "[role='button']",
        ].join(", ")),
      ];
      return candidates.find((element) => {
        if (!(element instanceof HTMLElement) || !isVisible(element)) {
          return false;
        }
        return looksLikeAddCompanionControl(element);
      }) || null;
    }

    function findCompanionSectionButtons() {
      const sections = queryAll(".card, section, .form-group, .row, div")
        .filter((node) => node instanceof HTMLElement && isVisible(node))
        .filter((node) => isCompanionSection(node));
      const buttons = [];
      for (const section of sections) {
        buttons.push(...Array.from(section.querySelectorAll("button, a, [role='button']")));
      }
      return buttons;
    }

    function isCompanionSection(node) {
      const text = normalizeOption(node.textContent || "");
      if (!text.includes("companion")) {
        return false;
      }
      return text.includes("companion information")
        || text.includes("companion is required")
        || text.includes("add companion")
        || text.includes("please add the companion");
    }

    async function selectCompanionFromPicker(context, timeoutMs, runId) {
      const deadline = Date.now() + Math.max(1200, Math.min(Math.max(5000, Number(timeoutMs || 10000)), 20000));
      const target = preferredCompanionTarget(context);
      if (!target.tokens.length) {
        throw new Error("Data companion tidak ditemukan di JSON untuk jamaah anak-anak ini.");
      }
      let selectedControl = null;
      while (Date.now() < deadline) {
        const rootNode = findCompanionPickerRoot();
        if (!rootNode) {
          await sleep(160, runId);
          continue;
        }

        await filterCompanionPicker(rootNode, target, runId);

        const row = findPreferredCompanionRow(rootNode, target);
        const control = row ? findSelectableRowRadio(row) || findSelectableRowCheckbox(row) : null;
        if (control && control !== selectedControl) {
          selectedControl = control;
          markActiveElement(control);
          await clickElement(control);
          await sleep(350, runId);
        }

        const confirmButton = findCompanionPickerConfirmButton(rootNode);
        if (selectedControl && confirmButton) {
          markActiveElement(confirmButton);
          await clickElement(confirmButton);
          await sleep(700, runId);
          return true;
        }

        if (selectedControl && isControlSelected(selectedControl) && !confirmButton) {
          return true;
        }

        if (selectedControl && isCompanionPickerClosedOrSettled(rootNode)) {
          return true;
        }

        await sleep(180, runId);
      }
      throw new Error(`Companion tidak ditemukan di list Nusuk: ${target.label}.`);
    }

    function findCompanionPickerRoot() {
      return queryAll([
        ".modal",
        ".popup",
        ".p-dialog",
        ".cdk-overlay-pane",
        ".overlay",
        ".page",
        "body",
      ].join(", ")).find((node) => node instanceof HTMLElement
        && isVisible(node)
        && looksLikeCompanionPicker(node)) || null;
    }

    function looksLikeCompanionPicker(node) {
      const text = normalizeOption(node.textContent || "");
      return text.includes("mutamer list")
        && (text.includes("passport number") || text.includes("mutamer name") || Boolean(node.querySelector?.("tbody tr input[type='checkbox'], tbody tr p-tablecheckbox, tbody tr p-checkbox, tbody tr .p-checkbox")));
    }

    async function filterCompanionPicker(rootNode, target, runId) {
      const value = target.searchValue;
      if (!value || rootNode.getAttribute("data-nusuk-companion-filtered") === value) {
        return;
      }
      appendLog("info", `Filter companion: ${value}`);
      const trigger = findCompanionFilterTrigger(rootNode, value);
      if (trigger) {
        markActiveElement(trigger);
        await clickElement(trigger);
        await sleep(250, runId);
      }
      const filterRoot = findCompanionFilterOverlay() || rootNode;
      const input = findCompanionFilterInput(filterRoot) || findCompanionFilterInput(document.body);
      if (!input) {
        return;
      }
      markActiveElement(input);
      setInputValue(input, value);
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
      const applyButton = findCompanionFilterApplyButton(filterRoot) || findCompanionFilterApplyButton(document.body);
      if (applyButton) {
        markActiveElement(applyButton);
        await clickElement(applyButton);
      }
      rootNode.setAttribute("data-nusuk-companion-filtered", value);
      await sleep(900, runId);
    }

    function findCompanionFilterTrigger(rootNode, value) {
      const headers = Array.from(rootNode.querySelectorAll("th, .column-header"))
        .filter((node) => node instanceof HTMLElement && isVisible(node));
      const passportLike = looksLikePassportNumber(value);
      const targetHeader = headers.find((header) => {
        const text = normalizeOption(header.textContent || "");
        return passportLike ? text.includes("passport number") : text.includes("mutamer name");
      }) || headers.find((header) => {
        const text = normalizeOption(header.textContent || "");
        return text.includes("passport number") || text.includes("mutamer name");
      });
      return targetHeader?.querySelector?.(".filter-trigger, .filter button")
        || targetHeader?.querySelector?.("[class*='filter' i] button")
        || null;
    }

    function looksLikePassportNumber(value) {
      return /^[a-z][0-9]{5,}$/i.test(String(value || "").trim());
    }

    function findCompanionFilterInput(rootNode) {
      return Array.from(rootNode.querySelectorAll([
        "input[type='text']",
        "input[type='search']",
        "input:not([type])",
        ".p-column-filter input",
        ".p-column-filter-menu input",
        ".p-column-filter-constraints input",
      ].join(", "))).find((input) => input instanceof HTMLInputElement && isVisible(input) && isEnabled(input)) || null;
    }

    function findCompanionFilterOverlay() {
      return queryAll([
        ".p-column-filter-overlay",
        ".p-column-filter-menu",
        ".p-column-filter-constraints",
        ".p-overlaypanel",
        ".p-connected-overlay",
        ".cdk-overlay-pane",
      ].join(", ")).find((node) => node instanceof HTMLElement
        && isVisible(node)
        && Boolean(node.querySelector?.("input"))) || null;
    }

    function findCompanionFilterApplyButton(rootNode) {
      return Array.from(rootNode.querySelectorAll([
        ".p-column-filter-buttonbar button",
        "button",
        "[role='button']",
      ].join(", "))).find((button) => {
        if (!(button instanceof HTMLElement) || !isVisible(button) || !isEnabled(button)) {
          return false;
        }
        const text = normalizeOption(button.textContent || button.getAttribute("aria-label") || "");
        return text === "apply" || text.includes("apply");
      }) || null;
    }

    function findPreferredCompanionRow(rootNode, target) {
      const rows = Array.from(rootNode.querySelectorAll("tbody tr"))
        .filter((row) => row instanceof HTMLElement && isVisible(row));
      return rows.find((row) => rowMatchesPreferredCompanion(row, target)) || null;
    }

    function findSelectableRowRadio(row) {
      return Array.from(row.querySelectorAll([
        "p-radiobutton",
        "p-radioButton",
        ".p-radiobutton",
        ".p-radiobutton-box",
        "[role='radio']",
        "input[type='radio']",
      ].join(", "))).find((radio) => radio instanceof HTMLElement && isVisible(radio) && isEnabled(radio)) || null;
    }

    function rowMatchesPreferredCompanion(row, target) {
      if (!target.tokens.length) {
        return false;
      }
      const rowText = normalizeOption(row.textContent || "");
      return target.tokens.some((token) => token && rowText.includes(token));
    }

    function preferredCompanionTarget(context) {
      const member = context?.member || {};
      const explicit = explicitCompanionTokens(member);
      if (explicit.tokens.length) {
        return explicit;
      }
      const members = Array.isArray(context?.members) ? context.members : [];
      const currentId = String(context?.member?.id || "");
      const candidates = members.filter((member) => String(member?.id || "") !== currentId && !isMinorMember(member));
      if (candidates.length !== 1) {
        return { searchValue: "", label: "companion tidak unik", tokens: [] };
      }
      return memberToCompanionTarget(candidates[0], "adult companion dari batch");
    }

    function explicitCompanionTokens(member) {
      const source = member?.companion || member?.companionProfile || member?.guardian || member?.mahram || member?.resolvedProfile?.companion || {};
      const directTokens = [
        member?.companionId,
        member?.companionMemberId,
        member?.companionPassportNumber,
        member?.companionName,
        member?.guardianPassportNumber,
        member?.guardianName,
        source?.id,
        source?.memberId,
        source?.passportNumber,
        source?.name,
        [source?.firstName, source?.familyName].filter(Boolean).join(" "),
      ].map((item) => normalizeOption(item || "")).filter(Boolean);
      const searchValue = [
        member?.companionPassportNumber,
        member?.guardianPassportNumber,
        source?.passportNumber,
        member?.companionName,
        member?.guardianName,
        source?.name,
      ].find(Boolean) || "";
      return {
        searchValue: String(searchValue || "").trim(),
        label: String(searchValue || directTokens[0] || "companion JSON").trim(),
        tokens: Array.from(new Set(directTokens)),
      };
    }

    function memberToCompanionTarget(member, label) {
      const resolved = member?.resolvedProfile || {};
      const extracted = member?.passportExtracted || {};
      const fullName = [resolved.firstName || extracted.firstName, resolved.familyName || extracted.familyName].filter(Boolean).join(" ");
      const tokens = [
        resolved.passportNumber,
        extracted.passportNumber,
        fullName,
      ].map((item) => normalizeOption(item || "")).filter(Boolean);
      const searchValue = String(resolved.passportNumber || extracted.passportNumber || fullName || "").trim();
      return {
        searchValue,
        label: searchValue || label,
        tokens: Array.from(new Set(tokens)),
      };
    }

    function findSelectableRowCheckbox(row) {
      return Array.from(row.querySelectorAll([
        "p-tablecheckbox",
        "p-checkbox",
        ".p-checkbox",
        ".p-checkbox-box",
        "input[type='checkbox']",
      ].join(", "))).find((checkbox) => checkbox instanceof HTMLElement && isVisible(checkbox) && isEnabled(checkbox)) || null;
    }

    function findCompanionPickerConfirmButton(rootNode) {
      const footer = Array.from(rootNode.querySelectorAll(".p-dialog-footer, .modal-footer, .popup-actions"))
        .find((node) => node instanceof HTMLElement && isVisible(node));
      const searchRoot = footer || rootNode;
      const candidates = Array.from(searchRoot.querySelectorAll("button, a, [role='button']"))
        .filter((button) => button instanceof HTMLElement && isVisible(button) && isEnabled(button));
      return candidates.find((button) => {
        if (isOriginalCompanionActionButton(button)) {
          return false;
        }
        const text = normalizeOption(button.textContent || button.getAttribute("aria-label") || button.getAttribute("title") || "");
        return text === "add"
          || text === "select"
          || text === "save"
          || text === "confirm"
          || text === "done"
          || text.includes("add companion")
          || text.includes("select companion")
          || text.includes("save companion");
      }) || null;
    }

    function isOriginalCompanionActionButton(button) {
      const card = button.closest?.(".companion-card, .card");
      return card instanceof HTMLElement && isCompanionSection(card);
    }

    function isControlSelected(control) {
      if (control instanceof HTMLInputElement && control.checked) {
        return true;
      }
      const row = control?.closest?.("tr");
      const className = String(control?.className || "").toLowerCase();
      return className.includes("p-radiobutton-checked")
        || className.includes("p-highlight")
        || className.includes("p-checkbox-checked")
        || String(control?.querySelector?.(".p-radiobutton-box")?.className || "").toLowerCase().includes("p-highlight")
        || String(control?.querySelector?.(".p-checkbox-box")?.className || "").toLowerCase().includes("p-highlight")
        || (row instanceof HTMLElement && String(row.className || "").toLowerCase().includes("selected"));
    }

    function isCompanionPickerClosedOrSettled(rootNode) {
      return !(rootNode instanceof HTMLElement) || !document.contains(rootNode) || !isVisible(rootNode);
    }

    async function selectCompanionRelation(context, timeoutMs, runId) {
      const relation = resolveCompanionRelation(context);
      const deadline = Date.now() + Math.max(1200, Math.min(Math.max(5000, Number(timeoutMs || 10000)), 20000));
      while (Date.now() < deadline) {
        const rootNode = findCompanionRelationRoot();
        if (!rootNode) {
          await sleep(160, runId);
          continue;
        }
        if (companionRelationAlreadySelected(rootNode, relation)) {
          return relation;
        }
        const trigger = findCompanionRelationTrigger(rootNode);
        if (!trigger) {
          await sleep(160, runId);
          continue;
        }
        const clickTarget = trigger.querySelector?.(".p-dropdown-trigger, [role='combobox']") || trigger;
        markActiveElement(clickTarget);
        await clickElement(clickTarget);
        await sleep(250, runId);
        const option = findCompanionRelationOption(relation);
        if (!option) {
          await sleep(160, runId);
          continue;
        }
        markActiveElement(option);
        await clickElement(option);
        await sleep(500, runId);
        if (companionRelationAlreadySelected(rootNode, relation)) {
          return relation;
        }
        return relation;
      }
      throw new Error(`Relation companion belum terpilih: ${relation}.`);
    }

    function resolveCompanionRelation(context) {
      const member = context?.member || {};
      const companion = member?.companion || member?.companionProfile || member?.guardian || member?.mahram || {};
      const explicit = [
        member?.companionRelation,
        member?.guardianRelation,
        member?.mahramRelation,
        companion?.relation,
        companion?.relationship,
      ].find(Boolean);
      if (explicit) {
        return normalizeCompanionRelation(explicit);
      }
      const companionMember = preferredCompanionMemberFromContext(context);
      const gender = normalizeOption(companionMember?.resolvedProfile?.gender || companionMember?.passportExtracted?.gender || companion?.gender || "");
      if (gender.includes("female") || gender === "f") {
        return "Mother";
      }
      return "Father";
    }

    function normalizeCompanionRelation(value) {
      const normalized = normalizeOption(value);
      const options = [
        "Mother",
        "Daughter",
        "Sister",
        "Grandmother",
        "Granddaughter",
        "Maternal Aunt",
        "Niece (Sister side)",
        "Niece (Brother side)",
        "Nephew (Brother side)",
        "Nephew (Sister side)",
        "Mother in law",
        "Women Set",
        "Daughter in law",
        "Step Mother",
        "Paternal Aunt",
        "Wife",
        "Husband's mother",
        "Husband's father",
        "Father",
        "Son",
        "Brother",
        "Grandfather",
        "Grandson",
        "Maternal Uncle",
        "Wife's Father",
        "Brother in law (Wife's brother)",
        "Brother in law (Husband's brother)",
        "Son in law",
        "Step Father",
        "Father in law",
        "Paternal Uncle",
        "Husband",
        "Other"
      ];
      return options.find((option) => normalizeOption(option) === normalized)
        || options.find((option) => normalizeOption(option).includes(normalized) || normalized.includes(normalizeOption(option)))
        || value;
    }

    function preferredCompanionMemberFromContext(context) {
      const target = preferredCompanionTarget(context);
      const members = Array.isArray(context?.members) ? context.members : [];
      return members.find((member) => {
        const candidate = memberToCompanionTarget(member, "");
        return candidate.tokens.some((token) => target.tokens.includes(token));
      }) || null;
    }

    function findCompanionRelationRoot() {
      const cards = queryAll(".companion-card, .card, section, div")
        .filter((node) => node instanceof HTMLElement && isVisible(node))
        .filter((node) => {
          const text = normalizeOption(node.textContent || "");
          return text.includes("companion information") && text.includes("relation");
        });
      return cards.find((node) => findCompanionRelationTrigger(node)) || null;
    }

    function findCompanionRelationTrigger(rootNode) {
      const relationBlocks = Array.from(rootNode.querySelectorAll(".companion-relation, .form-group, .field, .row, div"))
        .filter((node) => node instanceof HTMLElement && isVisible(node))
        .filter((node) => normalizeOption(node.textContent || "").includes("relation"));
      for (const block of relationBlocks) {
        const trigger = block.querySelector([
          ".dropdown-trigger",
          ".p-dropdown",
          "p-dropdown",
          "[role='combobox']",
          ".dropdown",
          "button",
        ].join(", "));
        if (trigger instanceof HTMLElement && isVisible(trigger) && isEnabled(trigger)) {
          return trigger;
        }
      }
      return null;
    }

    function findCompanionRelationOption(relation) {
      const expected = normalizeOption(relation);
      return queryAll([
        ".dropdown-menu .dropdown-item",
        ".dropdown-list .dropdown-item",
        ".p-dropdown-panel .p-dropdown-item",
        ".p-select-panel .p-select-option",
        "[role='listbox'] [role='option']",
        "li",
      ].join(", ")).find((node) => node instanceof HTMLElement
        && isVisible(node)
        && normalizeOption(node.textContent || "") === expected) || null;
    }

    function companionRelationAlreadySelected(rootNode, relation) {
      const expected = normalizeOption(relation);
      const labels = Array.from(rootNode.querySelectorAll(".dropdown-label, .p-dropdown-label, .p-select-label, [aria-selected='true']"))
        .filter((node) => node instanceof HTMLElement && isVisible(node));
      return labels.some((node) => normalizeOption(node.textContent || "") === expected);
    }

    function looksLikeAddCompanionControl(element) {
      const text = normalizeOption([
        element.textContent || "",
        element.getAttribute("aria-label") || "",
        element.getAttribute("title") || "",
        element.getAttribute("data-testid") || "",
        element.getAttribute("class") || "",
      ].join(" "));
      if (!text) {
        return false;
      }
      const hasCompanion = text.includes("companion")
        || text.includes("accompany")
        || text.includes("accompanying")
        || text.includes("dependent");
      const hasAdd = text.includes("add") || text.includes("new") || text.includes("+");
      return text.includes("add companion")
        || text.includes("add new companion")
        || text.includes("add accompanying")
        || text.includes("add dependent")
        || (hasCompanion && hasAdd);
    }

    function isMinorMember(member) {
      const dob = String(member?.resolvedProfile?.dob || member?.passportExtracted?.dob || "").trim();
      const birthDate = parseIsoDate(dob);
      if (!birthDate) {
        return true;
      }
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const beforeBirthday = today.getMonth() < birthDate.getMonth()
        || (today.getMonth() === birthDate.getMonth() && today.getDate() < birthDate.getDate());
      if (beforeBirthday) {
        age -= 1;
      }
      return age < 18;
    }

    function parseIsoDate(value) {
      const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) {
        return null;
      }
      const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      return Number.isNaN(date.getTime()) ? null : date;
    }

    function isMutamerListVisible() {
      return queryAll(".mutamer-header-title h2, h1, h2, .title")
        .some((node) => {
          if (!(node instanceof HTMLElement) || !isVisible(node)) {
            return false;
          }
          const text = normalizeOption(node.textContent || "");
          return text.includes("mutamer list")
            || text.includes("mutamers list")
            || text.includes("pilgrim list")
            || text.includes("applicant list");
        });
    }

    function describeVisibleMutamerOpenCandidates() {
      const candidates = queryAll("button, a, [role='button']")
        .filter((element) => element instanceof HTMLElement && isVisible(element) && isEnabled(element))
        .map((element) => compactText(element.textContent || element.getAttribute("aria-label") || element.getAttribute("title") || ""))
        .filter(Boolean)
        .slice(0, 6);
      return candidates.join(" | ");
    }

    function compactText(text) {
      return String(text || "").replace(/\s+/g, " ").trim();
    }

    return {
      handleWaitForSelector,
      handleWaitForEnabled,
      handleWait,
      handleWaitForNusukPageReady,
      handleOpenMutamerForm,
      handleClick,
      handleClickAddCompanion,
      handleFill,
      handleFillArabicMinimal,
      handleClickSuccessPopupAction,
    };
  }

  root.stepBasicActions = Object.freeze({
    createStepBasicActions,
  });
})();
