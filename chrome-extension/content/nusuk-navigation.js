(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const {
    NEXT_BUTTON_CANDIDATE_SELECTORS,
    PASSPORT_UPLOAD_SELECTOR,
    MOBILE_NUMBER_SELECTOR,
  } = root.constants || {};
  const {
    clickElement,
    setInputValue,
    queryAll,
    findFirstVisible,
    findByText,
    isVisible,
    isEnabled,
  } = root.domUtils || {};
  const { normalizeOption, pickFirstNonEmpty } = root.valueUtils || {};
  if (!NEXT_BUTTON_CANDIDATE_SELECTORS || !queryAll || !findFirstVisible || !normalizeOption || !pickFirstNonEmpty) {
    throw new Error("NusukAutofill navigation dependencies were not loaded.");
  }

  function createNusukNavigation({
    state,
    waitUntil,
    sleep,
    markActiveElement,
  }) {
    async function waitForProceedOrPassportDetails(timeoutMs, runId = state.runToken) {
      return waitUntil(() => {
        const proceed = findProceedButton();
        if (proceed && isVisible(proceed)) {
          return proceed;
        }
        if (isPassportDetailsReady()) {
          return true;
        }
        return null;
      }, timeoutMs, "Popup Proceed tidak muncul setelah upload file passport.", runId);
    }

    async function clickProceedButtonRobust(timeoutMs, runId = state.runToken) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (isPassportDetailsReady()) {
          return true;
        }
        const button = findProceedButton();
        if (button && isVisible(button) && isEnabled(button)) {
          markActiveElement(button);
          await clickElement(button);
          await sleep(200, runId);
          const stillVisible = findProceedButton();
          if (!stillVisible || !isVisible(stillVisible) || isPassportDetailsReady()) {
            return true;
          }
        }
        await sleep(140, runId);
      }
      return false;
    }

    function findProceedButton() {
      return findByText([
        ".popup .popup-actions button",
        ".popup button",
        "button.btn",
        "button",
      ].join(", "), "Proceed");
    }

    function findAttachedPassportInput(selector) {
      return queryAll(selector)
        .find((node) => node instanceof HTMLInputElement && node.type === "file")
        || null;
    }

    function isPassportDetailsReady() {
      return Boolean(findPassportDetailsReadySignal());
    }

    function findNusukPageReadySignal(pageKey) {
      if (pageKey === "upload" || pageKey === "passport_upload") {
        return findAttachedPassportInput(PASSPORT_UPLOAD_SELECTOR) || findProceedButton() || null;
      }
      if (pageKey === "passport_details" || pageKey === "passport") {
        return findPassportDetailsReadySignal();
      }
      if (pageKey === "member_form" || pageKey === "form") {
        return findMemberFormReadySignal();
      }
      if (pageKey === "disclosure") {
        return findDisclosureReadySignal();
      }
      if (pageKey === "summary" || pageKey === "review") {
        return findSummaryReadySignal();
      }
      if (pageKey === "success") {
        return findSuccessReadySignal();
      }
      return findPassportDetailsReadySignal()
        || findMemberFormReadySignal()
        || findDisclosureReadySignal()
        || findSummaryReadySignal()
        || findSuccessReadySignal();
    }

    function findPassportDetailsReadySignal() {
      return findFirstVisible([
        "p-dropdown[formcontrolname='passportTypeId'] .p-dropdown:not(.p-disabled)",
        "select[formcontrolname='passportTypeId']",
        "p-calendar[formcontrolname='passportIssueDate'] input[type='text']",
        "input[formcontrolname='issueCityName']",
      ].join(", "));
    }

    function findMemberFormReadySignal() {
      const nameField = findFirstVisible([
        "div[formgroupname='firstName'] input[formcontrolname='ar']",
        "div[formgroupname='firstName'] input[formcontrolname='en']",
        "input[formcontrolname='firstName.ar']",
        "input[formcontrolname='firstName.en']",
        "input[placeholder*='First'][placeholder]",
      ].join(", "));
      const dataField = findFirstVisible([
        "input[formcontrolname='profession']",
        "input[name='profession']",
        "input[placeholder='Profession']",
        "input[formcontrolname='email']",
        "input[name='email']",
        "input[placeholder='Email']",
      ].join(", "));
      return nameField && dataField ? dataField : null;
    }

    function findMemberFormStageSignal() {
      return findFirstVisible([
        "div[formgroupname='firstName'] input[formcontrolname='ar']",
        "div[formgroupname='firstName'] input[formcontrolname='en']",
        "div[formgroupname='familyName'] input[formcontrolname='ar']",
        "div[formgroupname='familyName'] input[formcontrolname='en']",
        "input[formcontrolname='firstName.ar']",
        "input[formcontrolname='firstName.en']",
        "input[formcontrolname='familyName.ar']",
        "input[formcontrolname='familyName.en']",
        "input[placeholder*='Arabic'][placeholder*='First']",
        "input[placeholder*='First'][placeholder]",
        "input[placeholder*='Family'][placeholder]",
        "input[formcontrolname='profession']",
        "input[name='profession']",
        "input[placeholder='Profession']",
        "input[formcontrolname='birthCityName']",
        "input[name='birthCityName']",
        "input[placeholder='Birth City']",
        "input[formcontrolname='email']",
        "input[name='email']",
        "input[placeholder='Email']",
      ].join(", "));
    }

    function findDisclosureReadySignal() {
      const title = findFirstVisible([
        ".card .title:has-text('Disclosure Form')",
        ".title:has-text('Disclosure Form')",
        "h1:has-text('Disclosure Form')",
        "h2:has-text('Disclosure Form')",
        "h3:has-text('Disclosure Form')",
      ].join(", "));
      if (!title) {
        return null;
      }
      const choice = findFirstVisible([
        ".form-questions .question input[type='radio']",
        ".question input[type='radio']",
        ".question-options input[type='radio']",
        "input[type='radio']",
        "p-radiobutton",
        "p-radioButton",
        ".p-radiobutton",
        "[role='radio']",
      ].join(", "));
      const attachedChoice = queryAll([
        ".form-questions .question input[type='radio']",
        ".question input[type='radio']",
        ".question-options input[type='radio']",
        "input[type='radio']",
        "p-radiobutton",
        "p-radioButton",
        ".p-radiobutton",
        "[role='radio']",
      ].join(", "))[0];
      return choice || attachedChoice || null;
    }

    function findSummaryReadySignal() {
      if (findDisclosureReadySignal()) {
        return null;
      }
      const marker = findFirstVisible([
        ".card .title:has-text('Summary')",
        ".card .title:has-text('Review')",
        ".title:has-text('Summary')",
        ".title:has-text('Review')",
        "h1:has-text('Summary')",
        "h2:has-text('Summary')",
        "h3:has-text('Summary')",
        "h1:has-text('Review')",
        "h2:has-text('Review')",
        "h3:has-text('Review')",
        ".card:has-text('Summary')",
        ".card:has-text('Review')",
      ].join(", "));
      if (marker) {
        return marker;
      }
      const submitLike = findByText("button, [role='button']", "Submit")
        || findByText("button, [role='button']", "Save")
        || findByText("button, [role='button']", "Confirm");
      if (submitLike && isVisible(submitLike) && isEnabled(submitLike)) {
        return submitLike;
      }
      if (!findPassportDetailsReadySignal() && !findMemberFormStageSignal() && !findDisclosureReadySignal()) {
        return findUsableNextButton();
      }
      return null;
    }

    function findSuccessReadySignal() {
      return findFirstVisible([
        ".popup h3:has-text('Mutamer has been added successfully')",
        ".popup:has-text('Mutamer has been added successfully')",
      ].join(", "));
    }

    async function waitForEnabledNextButton(timeoutMs, runId = state.runToken, context = {}) {
      const button = await waitUntil(async () => {
        if (isPageBusy()) {
          return null;
        }
        await attemptFillRequiredFieldsForCurrentPage(context);
        if (!isCurrentPageReadyForNext()) {
          return null;
        }
        return findUsableNextButton();
      }, timeoutMs, "Form belum siap untuk tombol Next.", runId);
      if (!button) {
        throw new Error("Next button is not enabled.");
      }
      markActiveElement(button);
      return button;
    }

    async function waitForNusukPageReady(pageName, timeoutMs, runId = state.runToken) {
      const pageKey = normalizePageName(pageName);
      const signal = await waitUntil(
        () => findNusukPageReadySignal(pageKey),
        timeoutMs,
        `Halaman Nusuk belum siap: ${pageName || "unknown"}.`,
        runId
      );
      if (signal instanceof HTMLElement) {
        markActiveElement(signal);
      }
      return signal;
    }

    function findUsableNextButton() {
      for (const selector of NEXT_BUTTON_CANDIDATE_SELECTORS) {
        const button = findFirstVisible(selector);
        if (!button) {
          continue;
        }
        const text = String(button.textContent || "").trim().toLowerCase();
        if (text !== "next") {
          continue;
        }
        if (isEnabled(button)) {
          return button;
        }
      }
      return null;
    }

    async function clickNextButtonRobust(timeoutMs, runId = state.runToken, context = {}) {
      const deadline = Date.now() + timeoutMs;
      const beforeStage = detectNusukStage();
      const beforeUrl = String(location.href || "");

      while (Date.now() < deadline) {
        await attemptFillRequiredFieldsForCurrentPage(context);
        if (isPageBusy() || !isCurrentPageReadyForNext()) {
          await sleep(160, runId);
          continue;
        }
        const button = findUsableNextButton();
        if (!button) {
          await sleep(160, runId);
          continue;
        }
        markActiveElement(button);
        await clickElement(button);
        await sleep(260, runId);
        const moved = await waitForNextPageAfterClick({
          beforeStage,
          beforeUrl,
          clickedButton: button,
          timeoutMs: Math.min(Math.max(4500, timeoutMs), 12000),
          runId,
        });
        if (moved || beforeStage === 0) {
          return true;
        }
      }

      return false;
    }

    async function waitForNextPageAfterClick({ beforeStage, beforeUrl, clickedButton, timeoutMs, runId }) {
      const deadline = Date.now() + Math.max(1200, Number(timeoutMs || 0));
      let idleSince = 0;
      let sawBusy = false;
      while (Date.now() < deadline) {
        const busy = isPageBusy();
        if (busy) {
          sawBusy = true;
          idleSince = 0;
          await sleep(120, runId);
          continue;
        }

        idleSince = idleSince || Date.now();
        const stable = Date.now() - idleSince >= 500;
        const expectedSignal = findExpectedNextPageSignal(beforeStage);
        if (expectedSignal && stable) {
          return true;
        }

        const nextStage = detectNusukStage();
        const urlChanged = String(location.href || "") !== beforeUrl;
        const currentButton = findUsableNextButton();
        const buttonMoved = currentButton !== clickedButton && (!currentButton || !isVisible(currentButton));
        if (stable && (nextStage !== beforeStage || urlChanged || (sawBusy && buttonMoved))) {
          return true;
        }

        await sleep(120, runId);
      }
      return Boolean(findExpectedNextPageSignal(beforeStage));
    }

    function findExpectedNextPageSignal(beforeStage) {
      if (beforeStage === 1) {
        return findMemberFormReadySignal();
      }
      if (beforeStage === 2) {
        return findDisclosureReadySignal();
      }
      if (beforeStage === 3) {
        return findSummaryReadySignal() || findSuccessReadySignal();
      }
      if (beforeStage === 4) {
        return findSuccessReadySignal();
      }
      return findMemberFormReadySignal()
        || findDisclosureReadySignal()
        || findSummaryReadySignal()
        || findSuccessReadySignal();
    }

    function detectNusukStage() {
      if (findFirstVisible(".popup h3:has-text('Mutamer has been added successfully')")) {
        return 5;
      }
      if (findFirstVisible(".card .title:has-text('Disclosure Form')")) {
        return 3;
      }
      if (findMemberFormStageSignal()) {
        return 2;
      }
      if (findFirstVisible(".container__notes__upload__button input[type='file'], p-dropdown[formcontrolname='passportTypeId'], input[formcontrolname='issueCityName']")) {
        return 1;
      }
      if (findSummaryReadySignal()) {
        return 4;
      }
      return 0;
    }

    function isCurrentPageReadyForNext() {
      const stage = detectNusukStage();
      if (stage === 1) {
        return isPassportDetailsCompleteForNext();
      }
      if (stage === 2) {
        return isMemberFormCompleteForNext();
      }
      if (stage === 3) {
        return isDisclosureCompleteForNext();
      }
      return true;
    }

    function isPassportDetailsCompleteForNext() {
      return visibleDropdownHasSelection([
        "select[formcontrolname='passportTypeId']",
        "p-dropdown[formcontrolname='passportTypeId']",
        "p-dropdown[formcontrolname='passportTypeId'] .p-dropdown",
      ].join(", "))
        && visibleInputHasValue([
          "p-calendar[formcontrolname='passportIssueDate'] input[type='text']",
          "input[formcontrolname='passportIssueDate']",
        ].join(", "))
        && visibleInputHasValue("input[formcontrolname='issueCityName']");
    }

    function isMemberFormCompleteForNext() {
      const requiredInputsReady = [
        [
          "div[formgroupname='firstName'] input[formcontrolname='ar']",
          "input[formcontrolname='firstName.ar']",
          "input[name='firstName.ar']",
          "input[placeholder='First Name (Arabic)']",
          "input[placeholder='First name (Arabic)']",
          "input[placeholder*='Arabic'][placeholder*='First']",
        ],
        [
          "div[formgroupname='familyName'] input[formcontrolname='ar']",
          "input[formcontrolname='familyName.ar']",
          "input[name='familyName.ar']",
          "input[placeholder='Family Name (Arabic)']",
          "input[placeholder*='Arabic'][placeholder*='Family']",
        ],
        [
          "div[formgroupname='firstName'] input[formcontrolname='en']",
          "input[formcontrolname='firstName.en']",
          "input[name='firstName.en']",
          "input[placeholder='First name']",
          "input[placeholder='First Name']",
          "input[placeholder*='First'][placeholder]:not([placeholder*='Arabic'])",
        ],
        [
          "div[formgroupname='familyName'] input[formcontrolname='en']",
          "input[formcontrolname='familyName.en']",
          "input[name='familyName.en']",
          "input[placeholder='Family Name']",
          "input[placeholder*='Family'][placeholder]:not([placeholder*='Arabic'])",
        ],
        [
          "input[formcontrolname='profession']",
          "input[name='profession']",
          "input[placeholder='Profession']",
        ],
        [
          "input[formcontrolname='birthCityName']",
          "input[name='birthCityName']",
          "input[placeholder='Birth City']",
        ],
        [
          "input[formcontrolname='email']",
          "input[name='email']",
          "input[placeholder='Email']",
          "input[type='email'][placeholder='Email']",
        ],
      ].every((selectors) => visibleInputHasValue(selectors.join(", ")));

      return requiredInputsReady
        && visibleDropdownHasSelection([
          "select[formcontrolname='birthCountryId']",
          "p-dropdown[formcontrolname='birthCountryId']",
          "p-dropdown[formcontrolname='birthCountryId'] .p-dropdown",
        ].join(", "))
        && visiblePhoneInputHasValue()
        && visibleLabeledDropdownHasSelection("Marital Status");
    }

    function isDisclosureCompleteForNext() {
      const card = findDisclosureCard();
      if (!card) {
        return true;
      }
      const choices = Array.from(card.querySelectorAll([
        "input[type='radio']",
        "input[type='checkbox']",
        "p-radiobutton",
        "p-radioButton",
        ".p-radiobutton",
        "[role='radio']",
      ].join(", "))).filter((choice) => choice instanceof HTMLElement && (isVisible(choice) || choice.querySelector?.("input")));
      if (!choices.length) {
        return false;
      }
      return choices.some((choice) => isDisclosureChoiceChecked(choice));
    }

    function visibleInputHasValue(selector) {
      const input = findFirstVisible(selector);
      if (!input) {
        return true;
      }
      if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) {
        return true;
      }
      return hasMeaningfulValue(input.value);
    }

    function visiblePhoneInputHasValue() {
      if (!MOBILE_NUMBER_SELECTOR) {
        return true;
      }
      const input = queryAll(MOBILE_NUMBER_SELECTOR)
        .find((node) => (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)
          && isVisible(node)
          && String(node.type || "").toLowerCase() !== "hidden");
      return input ? hasMeaningfulValue(input.value) : true;
    }

    function visibleDropdownHasSelection(selector) {
      const target = findFirstVisible(selector);
      if (!target) {
        return true;
      }
      return dropdownNodeHasSelection(target);
    }

    function visibleLabeledDropdownHasSelection(labelText) {
      const rootNode = findLabeledFieldRootByText(labelText);
      if (!rootNode) {
        return true;
      }
      const dropdown = Array.from(rootNode.querySelectorAll([
        "select",
        "p-dropdown",
        "p-dropdown .p-dropdown",
        "p-select",
        "p-select .p-select",
        "[role='combobox']",
        ".p-dropdown",
        ".p-select",
      ].join(", "))).find((node) => node instanceof HTMLElement && isVisible(node));
      return dropdown ? dropdownNodeHasSelection(dropdown) : true;
    }

    function dropdownNodeHasSelection(node) {
      if (node instanceof HTMLSelectElement) {
        const selectedOption = node.options[node.selectedIndex];
        return hasMeaningfulValue(node.value)
          && !isPlaceholderOptionText(selectedOption?.textContent || node.value);
      }

      const label = node.matches?.(".p-dropdown-label, .p-select-label")
        ? node
        : node.querySelector?.(".p-dropdown-label, .p-select-label, [aria-selected='true']");
      if (label instanceof HTMLElement && isVisible(label)) {
        const text = String(label.textContent || "").trim();
        const className = String(label.className || "").toLowerCase();
        return hasMeaningfulValue(text)
          && !className.includes("placeholder")
          && !isPlaceholderOptionText(text);
      }

      const text = String(node.textContent || "").trim();
      return hasMeaningfulValue(text) && !isPlaceholderOptionText(text);
    }

    function findLabeledFieldRootByText(labelText) {
      const expected = normalizeOption(labelText);
      for (const label of queryAll("label")) {
        const text = normalizeOption(label.textContent || "");
        if (!text.includes(expected)) {
          continue;
        }
        const rootNode = label.closest(".form-group, .field, .form-field, .row, div");
        if (rootNode instanceof HTMLElement && isVisible(rootNode)) {
          return rootNode;
        }
      }
      return null;
    }

    function findDisclosureCard() {
      const title = findFirstVisible([
        ".card .title:has-text('Disclosure Form')",
        ".title:has-text('Disclosure Form')",
        "h1:has-text('Disclosure Form')",
        "h2:has-text('Disclosure Form')",
        "h3:has-text('Disclosure Form')",
      ].join(", "));
      return title?.closest?.(".card") || title?.parentElement || null;
    }

    function isDisclosureChoiceChecked(choice) {
      const input = choice instanceof HTMLInputElement
        ? choice
        : choice.querySelector?.("input[type='radio'], input[type='checkbox']");
      if (input instanceof HTMLInputElement && input.checked) {
        return true;
      }
      const ariaChecked = String(choice.getAttribute?.("aria-checked") || "").toLowerCase();
      if (ariaChecked === "true") {
        return true;
      }
      return String(choice.className || "").toLowerCase().includes("checked")
        || String(choice.querySelector?.(".p-radiobutton-box")?.className || "").toLowerCase().includes("highlight");
    }

    function hasMeaningfulValue(value) {
      const normalized = normalizeOption(value);
      return Boolean(normalized && !["null", "undefined", "nan", "-"].includes(normalized));
    }

    function isPlaceholderOptionText(value) {
      const normalized = normalizeOption(value);
      return !normalized
        || normalized === "select"
        || normalized === "choose"
        || normalized === "dropdown"
        || normalized === "please select"
        || normalized === "select option"
        || normalized === "marital status"
        || normalized === "birth country"
        || normalized === "passport type"
        || normalized.startsWith("select ")
        || normalized.startsWith("choose ")
        || normalized.includes("please select");
    }

    function isDisclosureFormReady() {
      return Boolean(findDisclosureReadySignal());
    }

    function isSuccessOrReviewPageReady() {
      return Boolean(findSummaryReadySignal() || findSuccessReadySignal());
    }

    function isPageBusy() {
      return queryAll(".p-component-overlay, .loading, .spinner, .ngx-spinner-overlay, .p-progress-spinner, .p-skeleton, [aria-busy='true']")
        .some((node) => isVisible(node));
    }

    async function attemptFillRequiredFieldsForCurrentPage(context) {
      if (detectNusukStage() !== 2) {
        return;
      }

      const member = context.member || {};
      const rs = member.resolvedProfile || {};
      const pe = member.passportExtracted || {};

      setFirstVisibleInputIfEmpty([
        "div[formgroupname='firstName'] input[formcontrolname='ar']",
        "input[formcontrolname='firstName.ar']",
        "input[name='firstName.ar']",
        "input[placeholder='First Name (Arabic)']",
      ], pickFirstNonEmpty(rs?.arabic?.firstName, rs?.firstName, pe?.firstName));

      setFirstVisibleInputIfEmpty([
        "div[formgroupname='familyName'] input[formcontrolname='ar']",
        "input[formcontrolname='familyName.ar']",
        "input[name='familyName.ar']",
        "input[placeholder='Family Name (Arabic)']",
      ], pickFirstNonEmpty(rs?.arabic?.familyName, rs?.familyName, pe?.familyName));

      setFirstVisibleInputIfEmpty([
        "input[formcontrolname='profession']",
        "input[name='profession']",
        "input[placeholder='Profession']",
      ], pickFirstNonEmpty(rs?.profession, "BUSINESS"));

      setFirstVisibleInputIfEmpty([
        "input[formcontrolname='birthCityName']",
        "input[name='birthCityName']",
        "input[placeholder='Birth City']",
      ], pickFirstNonEmpty(rs?.birthCity, pe?.birthCity, pe?.cityOfIssued, rs?.cityOfIssued));

      setFirstVisibleInputIfEmpty([
        "input[formcontrolname='email']",
        "input[name='email']",
        "input[placeholder='Email']",
        "input[type='email'][placeholder='Email']",
      ], pickFirstNonEmpty(rs?.email, "example@gmail.com"));
    }

    function setFirstVisibleInputIfEmpty(selectors, value) {
      if (!value) {
        return;
      }
      const input = findFirstVisible(selectors.join(", "));
      if (!input) {
        return;
      }
      const currentValue = "value" in input ? String(input.value || "").trim() : "";
      if (currentValue) {
        return;
      }
      markActiveElement(input);
      setInputValue(input, value);
    }

    return {
      waitForProceedOrPassportDetails,
      waitForNusukPageReady,
      clickProceedButtonRobust,
      waitForEnabledNextButton,
      clickNextButtonRobust,
      detectNusukStage,
      attemptFillRequiredFieldsForCurrentPage,
    };
  }

  function isLikelyNextSelector(selector) {
    const text = String(selector || "").toLowerCase();
    return text.includes("next") && (text.includes("btn-primary") || text.includes("navigation-buttons") || text.includes("action-btns"));
  }

  function isLikelyProceedSelector(selector) {
    const text = String(selector || "").toLowerCase();
    return text.includes("proceed") || (text.includes("popup-actions") && text.includes("button"));
  }

  function describeSelectorForLog(selector, step = {}) {
    const action = String(step?.action || "").trim().toLowerCase();
    if (action === "wait_for_nusuk_page_ready") {
      return `${String(step?.page || "halaman").trim() || "halaman"} ready`;
    }
    const uploadKind = String(step?.upload_kind || "").trim().toLowerCase();
    if (uploadKind === "passport") {
      return "upload passport field";
    }
    if (uploadKind === "vaccination") {
      return "upload vaccination field";
    }
    if (isLikelyProceedSelector(selector)) {
      return "Proceed button";
    }
    if (selector === PASSPORT_UPLOAD_SELECTOR) {
      return "upload passport field";
    }
    const text = String(selector || "");
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  }

  function normalizePageName(value) {
    return normalizeOption(value).replace(/\s+/g, "_");
  }

  root.nusukNavigation = Object.freeze({
    createNusukNavigation,
    isLikelyNextSelector,
    isLikelyProceedSelector,
    describeSelectorForLog,
  });
})();
