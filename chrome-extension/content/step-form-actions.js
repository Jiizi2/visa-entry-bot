(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const { interpolate, normalizeOption } = root.valueUtils || {};
  const {
    cssEscape,
    queryAll,
    isVisible,
    isEnabled,
  } = root.domUtils || {};
  if (!interpolate || !normalizeOption || !cssEscape || !queryAll || !isVisible || !isEnabled) {
    throw new Error("NusukAutofill step form action dependencies were not loaded.");
  }

  function createStepFormActions({
    sleep,
    appendLog,
    finishStep,
    waitForPageReady,
    clearFields,
    clearResidencyInfo,
    deleteLabeledAttachment,
    confirmDeleteIfShown,
    setPhoneFields,
    setCalendarDate,
    selectPrimengDropdown,
    selectLabeledDropdown,
  }) {
    function handleClearFields(step, selector) {
      const cleared = clearFields(selector);
      if (!cleared && !step?.optional_selector) {
        throw new Error(`No fields found to clear: ${selector}`);
      }
      appendLog(cleared ? "success" : "info", cleared ? "Iqama fields dikosongkan." : "Iqama fields tidak muncul, dilewati.");
      finishStep(step, selector);
    }

    async function handleClearResidencyInfo(step, selector, runId) {
      const cleared = await clearResidencyInfo(runId);
      if (!cleared && !step?.optional_selector) {
        throw new Error("Residency/Iqama section tidak ditemukan.");
      }
      appendLog(cleared ? "success" : "info", cleared ? "Residency/Iqama information dikosongkan." : "Residency/Iqama information tidak muncul, dilewati.");
      finishStep(step, selector || "Residency/Iqama");
    }

    async function handleDeleteLabeledAttachment(step, context, selector, runId) {
      const labelText = interpolate(step?.label_text || "", context).trim();
      const deleted = deleteLabeledAttachment(labelText);
      if (deleted) {
        await confirmDeleteIfShown(runId);
      }
      if (!deleted && !step?.optional_selector) {
        throw new Error(`Attachment tidak ditemukan: ${labelText}`);
      }
      appendLog(deleted ? "success" : "info", deleted ? `${labelText} attachment dihapus.` : `${labelText} attachment tidak muncul, dilewati.`);
      finishStep(step, selector || labelText);
    }

    async function handleSetPhoneFields(step, context, selector, timeoutMs, skipWhenEmpty, runId) {
      const value = interpolate(step?.value || "", context).trim();
      if (!value && skipWhenEmpty) {
        appendLog("warning", "Skipping empty phone field.");
        finishStep(step, selector);
        return;
      }
      if (!value) {
        throw new Error("Phone number is empty.");
      }
      await setPhoneFields(selector, value, timeoutMs, runId);
      await settleFormAction(timeoutMs, runId);
      appendLog("success", "Phone number updated.");
      finishStep(step, selector);
    }

    async function handleSetCalendarDate(step, context, selector, timeoutMs, skipWhenEmpty, runId) {
      const value = interpolate(step?.value || "", context).trim();
      await setCalendarDate({
        selector,
        rawValue: value,
        popupSelector: String(step?.popup_selector || ".p-datepicker").trim() || ".p-datepicker",
        timeoutMs,
        skipWhenEmpty,
        runId,
      });
      await settleFormAction(timeoutMs, runId);
      appendLog("success", `Date set for ${selector}.`);
      finishStep(step, selector);
    }

    async function handleSelectPrimengDropdown(step, context, selector, timeoutMs, skipWhenEmpty, runId) {
      const optionText = interpolate(step?.option_text || "", context).trim();
      if (!optionText && skipWhenEmpty) {
        appendLog("warning", `Skipping empty dropdown ${selector}`);
        finishStep(step, selector);
        return;
      }
      if (!optionText) {
        throw new Error(`Dropdown option is empty for selector: ${selector}`);
      }
      await selectPrimengDropdown(selector, optionText, String(step?.option_kind || ""), timeoutMs, runId);
      await settleFormAction(timeoutMs, runId);
      appendLog("success", `Dropdown selected: ${optionText}`);
      finishStep(step, selector);
    }

    async function handleSelectLabeledDropdown(step, context, selector, timeoutMs, skipWhenEmpty, runId) {
      const optionText = interpolate(step?.option_text || "", context).trim();
      const labelText = interpolate(step?.label_text || "", context).trim();
      if (!optionText && skipWhenEmpty) {
        appendLog("warning", `Skipping empty dropdown ${labelText || selector}`);
        finishStep(step, selector);
        return;
      }
      if (!optionText || !labelText) {
        throw new Error("Labeled dropdown requires label_text and option_text.");
      }
      await selectLabeledDropdown(labelText, optionText, String(step?.option_kind || ""), timeoutMs, runId);
      await settleFormAction(timeoutMs, runId);
      appendLog("success", `${labelText} selected: ${optionText}`);
      finishStep(step, selector || labelText);
    }

    async function handleSetDisclosureAllNo(step, selector, runId) {
      const ok = await waitAndSetDisclosureAllNo(selector || ".card", Number(step?.timeout_ms || 8000), runId, sleep);
      if (!ok) {
        throw new Error("Failed to set Disclosure Form to No.");
      }
      await settleFormAction(Number(step?.timeout_ms || 3000), runId);
      appendLog("success", "Disclosure form set to No.");
      finishStep(step, selector);
    }

    async function settleFormAction(timeoutMs, runId) {
      if (typeof waitForPageReady !== "function") {
        return;
      }
      await waitForPageReady(Math.min(Math.max(1200, Number(timeoutMs || 3000)), 4500), runId);
    }

    return {
      handleClearFields,
      handleClearResidencyInfo,
      handleDeleteLabeledAttachment,
      handleSetPhoneFields,
      handleSetCalendarDate,
      handleSelectPrimengDropdown,
      handleSelectLabeledDropdown,
      handleSetDisclosureAllNo,
    };
  }

  async function waitAndSetDisclosureAllNo(baseSelector, timeoutMs, runId, sleepFn) {
    const deadline = Date.now() + Math.max(800, Number(timeoutMs || 0));
    while (Date.now() < deadline) {
      const result = setDisclosureAllNo(baseSelector);
      if (result.verified) {
        return true;
      }
      if (result.clicked && typeof sleepFn === "function") {
        await sleepFn(260, runId);
        if (isDisclosureNoSelectionSettled(result.targets)) {
          return true;
        }
      }
      if (typeof sleepFn === "function") {
        await sleepFn(160, runId);
      } else {
        await new Promise((resolve) => window.setTimeout(resolve, 160));
      }
    }
    return Boolean(setDisclosureAllNo(baseSelector).verified);
  }

  function setDisclosureAllNo(baseSelector) {
    const targetCard = findDisclosureCard(baseSelector);
    if (!targetCard) {
      return { clicked: false, verified: false, targets: [] };
    }

    const noTargets = collectDisclosureNoTargets(targetCard);
    for (const target of noTargets) {
      clickDisclosureChoice(target);
    }
    return {
      clicked: noTargets.length > 0,
      verified: noTargets.length > 0 && isDisclosureNoSelectionSettled(noTargets),
      targets: noTargets,
    };
  }

  function findDisclosureCard(baseSelector) {
    const selectors = [baseSelector || ".card", ".card"].filter(Boolean);
    const cards = [];
    for (const selector of selectors) {
      for (const card of queryAll(selector)) {
        if (card instanceof HTMLElement && !cards.includes(card)) {
          cards.push(card);
        }
      }
    }
    const disclosureCards = cards.filter((card) => normalizeOption(card.querySelector(".title")?.textContent || "").includes("disclosure form"));
    return disclosureCards.find((card) => isVisible(card) || isVisible(card.querySelector(".title"))) || disclosureCards[0] || null;
  }

  function collectDisclosureNoTargets(targetCard) {
    const targets = [];
    const addTarget = (element) => {
      const target = findClickableDisclosureTarget(element);
      if (target instanceof HTMLElement && isDisclosureTargetUsable(target) && !targets.includes(target)) {
        targets.push(target);
      }
    };

    for (const question of findDisclosureQuestionRoots(targetCard)) {
      const noChoice = findNoChoiceInDisclosureQuestion(question);
      if (noChoice) {
        addTarget(noChoice);
      }
    }

    for (const input of Array.from(targetCard.querySelectorAll("input[type='radio'], input[type='checkbox']"))) {
      if (!(input instanceof HTMLInputElement)) {
        continue;
      }
      const text = normalizeOption(disclosureControlText(input));
      const value = normalizeOption(`${input.value || ""} ${input.getAttribute("ng-reflect-value") || ""}`);
      if (text === "no" || text.includes(" no ") || value === "no" || value === "false") {
        addTarget(input);
      }
    }

    for (const label of Array.from(targetCard.querySelectorAll("label"))) {
      const text = normalizeOption(label.textContent || label.getAttribute("aria-label") || "");
      if (isNoDisclosureText(text)) {
        addTarget(label);
      }
    }

    for (const option of Array.from(targetCard.querySelectorAll([
      "p-radiobutton",
      "p-radioButton",
      ".p-radiobutton",
      ".p-radiobutton-box",
      "[role='radio']",
      ".form-check",
      ".custom-control",
      ".form-check-label",
      ".custom-radio",
      "button",
      "[role='button']",
    ].join(", ")))) {
      if (!(option instanceof HTMLElement)) {
        continue;
      }
      const text = normalizeOption(disclosureOptionText(option));
      const value = normalizeOption([
        option.getAttribute("value"),
        option.getAttribute("ng-reflect-value"),
        option.getAttribute("data-value"),
      ].filter(Boolean).join(" "));
      if (isNoDisclosureText(text) || isNoDisclosureValue(value)) {
        addTarget(option);
      }
    }

    if (targets.length) {
      return targets;
    }

    return fallbackDisclosureSecondRadios(targetCard);
  }

  function findNoChoiceInDisclosureQuestion(question) {
    if (!(question instanceof HTMLElement)) {
      return null;
    }

    for (const input of Array.from(question.querySelectorAll("input[type='radio'], input[type='checkbox']"))) {
      if (!(input instanceof HTMLInputElement)) {
        continue;
      }
      const text = normalizeOption(disclosureControlText(input));
      const value = normalizeOption(`${input.value || ""} ${input.getAttribute("ng-reflect-value") || ""}`);
      if (isNoDisclosureText(text) || isNoDisclosureValue(value)) {
        return input;
      }
    }

    return Array.from(question.querySelectorAll("label, [role='radio'], button, [role='button']"))
      .find((option) => option instanceof HTMLElement && isNoDisclosureText(normalizeOption(disclosureOptionText(option)))) || null;
  }

  function fallbackDisclosureSecondRadios(targetCard) {
    const groups = new Map();
    for (const option of findDisclosureRadioOptions(targetCard)) {
      const key = disclosureGroupKey(option);
      if (!key) {
        continue;
      }
      const current = groups.get(key) || [];
      current.push(option);
      groups.set(key, current);
    }

    const targets = [];
    for (const options of groups.values()) {
      const usableOptions = options
        .map((option) => findClickableDisclosureTarget(option))
        .filter((target) => target instanceof HTMLElement && isDisclosureTargetUsable(target));
      if (usableOptions.length > 1 && !targets.includes(usableOptions[1])) {
        targets.push(usableOptions[1]);
      }
    }
    return targets;
  }

  function findDisclosureQuestionRoots(targetCard) {
    const selectors = [
      ".form-questions .question",
      ".question",
      "[class*='question' i]",
      ".form-group",
      ".field",
      ".form-field",
      ".row",
      "[formgroupname]",
      "li",
    ].join(", ");
    const roots = Array.from(targetCard.querySelectorAll(selectors))
      .filter((node) => node instanceof HTMLElement && node.querySelector("input[type='radio'], input[type='checkbox'], p-radiobutton, p-radioButton, [role='radio']"));
    return roots.length ? uniqueElements(roots) : [targetCard];
  }

  function findDisclosureRadioOptions(targetCard) {
    const options = [
      ...Array.from(targetCard.querySelectorAll("input[type='radio'], input[type='checkbox']")),
      ...Array.from(targetCard.querySelectorAll("p-radiobutton, p-radioButton, .p-radiobutton, [role='radio']")),
    ].filter((option) => option instanceof HTMLElement);
    return uniqueElements(options);
  }

  function disclosureGroupKey(element) {
    const input = element instanceof HTMLInputElement
      ? element
      : element.querySelector?.("input[type='radio'], input[type='checkbox']");
    const direct = String(
      input?.getAttribute("name")
        || input?.getAttribute("formcontrolname")
        || input?.getAttribute("ng-reflect-name")
        || element.getAttribute?.("name")
        || element.getAttribute?.("formcontrolname")
        || element.getAttribute?.("ng-reflect-name")
        || ""
    ).trim();
    if (direct) {
      return direct;
    }
    const row = element.closest(".form-group, .field, .form-field, .row, [formgroupname], [class*='question' i], li");
    if (row instanceof HTMLElement) {
      const text = normalizeOption(row.textContent || "");
      if (text) {
        return text;
      }
      return uniqueElementPath(row);
    }
    return "";
  }

  function disclosureControlText(input) {
    const labelTexts = [];
    for (const label of Array.from(input.labels || [])) {
      labelTexts.push(label.textContent || "");
    }
    if (input.id) {
      labelTexts.push(document.querySelector(`label[for='${cssEscape(input.id)}']`)?.textContent || "");
    }
    labelTexts.push(
      input.closest("label")?.textContent || "",
      input.closest("p-radiobutton, .p-radiobutton, .form-check, .custom-control")?.textContent || "",
      siblingLabelText(input),
      input.getAttribute("aria-label") || "",
      input.getAttribute("title") || "",
      input.getAttribute("value") || "",
      input.getAttribute("ng-reflect-value") || ""
    );
    return labelTexts.join(" ");
  }

  function disclosureOptionText(option) {
    const input = option.querySelector?.("input[type='radio'], input[type='checkbox']");
    return [
      option.textContent || "",
      option.getAttribute("aria-label") || "",
      option.getAttribute("title") || "",
      option.getAttribute("value") || "",
      option.getAttribute("ng-reflect-value") || "",
      option.getAttribute("data-value") || "",
      input instanceof HTMLInputElement ? disclosureControlText(input) : "",
      siblingLabelText(option),
    ].join(" ");
  }

  function findClickableDisclosureTarget(element) {
    if (!(element instanceof HTMLElement)) {
      return null;
    }
    const input = element instanceof HTMLInputElement
      ? element
      : element.querySelector?.("input[type='radio'], input[type='checkbox']");
    if (input instanceof HTMLInputElement && input.id) {
      const label = document.querySelector(`label[for='${cssEscape(input.id)}']`);
      if (label instanceof HTMLElement && isVisible(label) && isEnabled(label)) {
        return label;
      }
    }
    const visibleRadioBox = element.querySelector?.(".p-radiobutton-box, .p-radiobutton-icon")
      || input?.closest?.("p-radiobutton, p-radioButton, .p-radiobutton")?.querySelector?.(".p-radiobutton-box, .p-radiobutton-icon");
    if (visibleRadioBox instanceof HTMLElement && isVisible(visibleRadioBox) && isEnabled(visibleRadioBox)) {
      return visibleRadioBox;
    }
    const wrapper = element.closest("p-radiobutton, p-radioButton, .p-radiobutton, label, .form-check, .custom-control, .custom-radio, [role='radio']");
    if (wrapper instanceof HTMLElement) {
      return wrapper;
    }
    return element;
  }

  function clickDisclosureChoice(target) {
    const input = findDisclosureInputForTarget(target);

    dispatchMouseClick(target);
    if (input instanceof HTMLInputElement && !input.checked) {
      setChecked(input, true);
      dispatchMouseClick(input);
    }
  }

  function isDisclosureNoSelectionSettled(targets) {
    const status = disclosureTargetSelectionStatus(targets);
    if (!status.total) {
      return false;
    }
    return status.verifiable === 0 || status.selected === status.verifiable;
  }

  function disclosureTargetSelectionStatus(targets) {
    const result = { total: 0, verifiable: 0, selected: 0 };
    for (const target of uniqueElements(targets)) {
      if (!(target instanceof HTMLElement)) {
        continue;
      }
      result.total += 1;
      if (!isDisclosureTargetVerifiable(target)) {
        continue;
      }
      result.verifiable += 1;
      if (isDisclosureTargetChecked(target)) {
        result.selected += 1;
      }
    }
    return result;
  }

  function isDisclosureTargetVerifiable(target) {
    return Boolean(findDisclosureInputForTarget(target))
      || target.matches?.("[role='radio'], [role='checkbox'], .p-radiobutton, .p-radiobutton-box")
      || target.closest?.("[role='radio'], [role='checkbox'], p-radiobutton, p-radioButton, .p-radiobutton");
  }

  function isDisclosureTargetChecked(target) {
    const input = findDisclosureInputForTarget(target);
    if (input instanceof HTMLInputElement && input.checked) {
      return true;
    }
    const nodes = [
      target,
      target.closest?.("[role='radio'], [role='checkbox'], p-radiobutton, p-radioButton, .p-radiobutton"),
      target.querySelector?.(".p-radiobutton-box, .p-checkbox-box"),
    ].filter((node) => node instanceof HTMLElement);
    return nodes.some((node) => {
      const ariaChecked = String(node.getAttribute("aria-checked") || "").toLowerCase();
      const className = String(node.className || "").toLowerCase();
      return ariaChecked === "true"
        || className.includes("checked")
        || className.includes("p-highlight")
        || className.includes("p-radiobutton-checked")
        || className.includes("p-checkbox-checked");
    });
  }

  function findDisclosureInputForTarget(target) {
    if (!(target instanceof HTMLElement)) {
      return null;
    }
    if (target instanceof HTMLInputElement && ["radio", "checkbox"].includes(String(target.type || "").toLowerCase())) {
      return target;
    }
    const nested = target.querySelector?.("input[type='radio'], input[type='checkbox']");
    if (nested instanceof HTMLInputElement) {
      return nested;
    }
    if (target instanceof HTMLLabelElement && target.htmlFor) {
      const labeled = document.getElementById(target.htmlFor);
      if (labeled instanceof HTMLInputElement) {
        return labeled;
      }
    }
    const wrapper = target.closest("p-radiobutton, p-radioButton, .p-radiobutton, label, .form-check, .custom-control, .custom-radio, [role='radio'], [role='checkbox']");
    const wrapped = wrapper?.querySelector?.("input[type='radio'], input[type='checkbox']");
    return wrapped instanceof HTMLInputElement ? wrapped : null;
  }

  function dispatchMouseClick(element) {
    if (!(element instanceof HTMLElement)) {
      return;
    }
    element.scrollIntoView({ block: "center", inline: "nearest" });
    element.focus?.();
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      element.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
      }));
    }
    try {
      element.click();
    } catch {
      element.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
      }));
    }
  }

  function setChecked(input, value) {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "checked");
    if (descriptor?.set) {
      descriptor.set.call(input, value);
    } else {
      input.checked = value;
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function isDisclosureTargetUsable(target) {
    if (isVisible(target) && isEnabled(target)) {
      return true;
    }
    const visibleChild = target.querySelector?.(".p-radiobutton-box, .p-radiobutton-icon, label, button, [role='radio']");
    return visibleChild instanceof HTMLElement && isVisible(visibleChild) && isEnabled(visibleChild);
  }

  function isNoDisclosureText(text) {
    const normalized = normalizeOption(text);
    return normalized === "no"
      || normalized === "false"
      || normalized === "not applicable"
      || normalized.startsWith("no ")
      || normalized.endsWith(" no")
      || normalized.includes(" no ")
      || normalized.includes("tidak");
  }

  function isNoDisclosureValue(value) {
    const normalized = normalizeOption(value);
    return normalized === "no"
      || normalized === "false"
      || normalized === "0"
      || normalized.includes("false")
      || normalized.includes("no");
  }

  function siblingLabelText(element) {
    const texts = [];
    let node = element instanceof Element ? element.previousElementSibling : null;
    if (node instanceof HTMLElement && node.matches("label, span, div")) {
      texts.push(node.textContent || "");
    }
    node = element instanceof Element ? element.nextElementSibling : null;
    if (node instanceof HTMLElement && node.matches("label, span, div")) {
      texts.push(node.textContent || "");
    }
    const parent = element instanceof Element ? element.parentElement : null;
    for (const child of Array.from(parent?.children || [])) {
      if (child !== element && child instanceof HTMLElement && child.matches("label, span, div")) {
        texts.push(child.textContent || "");
      }
    }
    return texts.join(" ");
  }

  function uniqueElements(elements) {
    const result = [];
    for (const element of elements) {
      if (element instanceof HTMLElement && !result.includes(element)) {
        result.push(element);
      }
    }
    return result;
  }

  function uniqueElementPath(element) {
    const parts = [];
    let current = element;
    for (let depth = 0; current && depth < 4; depth += 1) {
      const index = Array.from(current.parentElement?.children || []).indexOf(current);
      parts.push(`${current.tagName.toLowerCase()}:${index}`);
      current = current.parentElement;
    }
    return parts.join("/");
  }

  root.stepFormActions = Object.freeze({
    createStepFormActions,
  });
})();
