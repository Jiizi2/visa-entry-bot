(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const { normalizeOption } = root.valueUtils || {};
  const {
    queryAll,
    isVisible,
    isEnabled,
  } = root.domUtils || {};
  if (!normalizeOption || !queryAll || !isVisible || !isEnabled) {
    throw new Error("NusukAutofill dropdown option dependencies were not loaded.");
  }

  function findLabeledDropdownOption(rootNode, optionText, optionKind, panelRoot = null) {
    const aliases = buildOptionAliases(normalizeOption(optionText), optionKind);
    const candidates = collectLabeledDropdownCandidates(rootNode, panelRoot);

    let partial = null;
    for (const option of candidates) {
      const label = normalizeOption(option.textContent || "");
      const value = normalizeOption(option.getAttribute("data-value") || option.getAttribute("value") || "");
      if (aliases.includes(label) || aliases.includes(value)) {
        return option;
      }
      if (!partial && aliases.some((candidate) => label.includes(candidate) || candidate.includes(label))) {
        partial = option;
      }
    }
    return partial || findOptionByKnownOrder(candidates, optionText, optionKind);
  }

  function findOptionByKnownOrder(candidates, optionText, optionKind) {
    if (String(optionKind || "") !== "marital_status") {
      return null;
    }
    const compact = normalizeOption(optionText).replace(/\s+/g, "");
    const order = { single: 0, married: 1, divorced: 2, divorce: 2, widowed: 3, widow: 3, other: 4 };
    const index = order[compact];
    if (!Number.isInteger(index)) {
      return null;
    }
    const dropdownItems = candidates.filter((option) => {
      const text = normalizeOption(option.textContent || "");
      return text && !text.includes("marital status");
    });
    return dropdownItems[index] || null;
  }

  function debugLabeledDropdownOptions(rootNode, panelRoot = null) {
    return collectLabeledDropdownCandidates(rootNode, panelRoot)
      .slice(0, 8)
      .map((option) => normalizeOption(option.textContent || option.getAttribute("data-value") || ""))
      .filter(Boolean)
      .join(" | ") || "tidak ada kandidat option";
  }

  function collectLabeledDropdownCandidates(rootNode, panelRoot = null) {
    const visiblePanels = panelRoot instanceof HTMLElement
      ? [panelRoot]
      : Array.from(document.querySelectorAll([
        ".p-dropdown-panel",
        ".p-select-overlay",
        ".p-select-panel",
        ".p-overlay",
        "p-overlay",
        ".dropdown-panel",
      ].join(", "))).filter((panel) => panel instanceof HTMLElement && isVisible(panel));

    const rootOptions = Array.from(rootNode?.querySelectorAll?.("[role='option'], li, .dropdown-item, .dropdown-option, option") || []);
    const globalOptions = panelRoot instanceof HTMLElement
      ? []
      : Array.from(document.querySelectorAll("[role='option'], li[role='option'], .dropdown-list li, .dropdown-item, .dropdown-option"))
        .filter((element) => element instanceof HTMLElement && isVisible(element));

    return uniqueElements([
      ...visiblePanels.flatMap((panel) => Array.from(panel.querySelectorAll([
        "[role='option']",
        ".p-dropdown-item",
        ".p-select-option",
        ".p-dropdown-items li",
        "li",
        ".dropdown-item",
        ".dropdown-option",
      ].join(", ")))),
      ...rootOptions,
      ...globalOptions,
    ]).filter(isUsableDropdownOption);
  }

  function isUsableDropdownOption(option) {
    if (!(option instanceof HTMLElement) || !isVisible(option) || !isEnabled(option)) {
      return false;
    }
    const className = String(option.className || "").toLowerCase();
    if (className.includes("disabled") || className.includes("p-disabled")) {
      return false;
    }
    return String(option.getAttribute("aria-disabled") || "").toLowerCase() !== "true";
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

  function findPrimeNgDropdownOption(optionText, optionKind, panelRoot = null) {
    const expected = normalizeOption(optionText);
    const aliases = buildOptionAliases(expected, optionKind);
    const optionSelector = [
      ".p-dropdown-items .p-dropdown-item",
      ".p-dropdown-item",
      ".p-select-option",
      "[role='option']",
      "li[role='option']",
      "li",
    ].join(", ");
    const items = panelRoot instanceof HTMLElement
      ? Array.from(panelRoot.querySelectorAll(optionSelector)).filter(isUsableDropdownOption)
      : queryAll(".p-dropdown-panel .p-dropdown-items .p-dropdown-item, .p-dropdown-panel [role='option'], .p-select-overlay .p-select-option, .p-select-panel .p-select-option, .p-select-overlay [role='option'], .p-select-panel [role='option'], li[role='option']")
        .filter(isUsableDropdownOption);

    let partial = null;
    for (const item of items) {
      const label = normalizeOption(item.textContent || "");
      if (aliases.includes(label)) {
        return item;
      }
      if (!partial && aliases.some((candidate) => label.includes(candidate) || candidate.includes(label))) {
        partial = item;
      }
    }
    return partial;
  }

  function isRequiredDropdownKind(optionKind) {
    return ["passport_type", "marital_status"].includes(String(optionKind || ""));
  }

  function isDropdownValueSelected(trigger, optionText, optionKind) {
    const aliases = buildOptionAliases(normalizeOption(optionText), optionKind);
    const label = normalizeOption([
      trigger.querySelector(".p-dropdown-label")?.textContent || "",
      trigger.querySelector(".p-select-label")?.textContent || "",
      trigger.textContent || "",
    ].join(" "));
    return aliases.some((candidate) => label.includes(candidate));
  }

  function buildOptionAliases(normalizedValue, optionKind) {
    const aliases = new Set([normalizedValue]);
    const compact = normalizedValue.replace(/\s+/g, "");

    if (optionKind === "passport_type") {
      const map = {
        normal: ["normal"],
        diplomatic: ["diplomatic"],
        other: ["other"],
        traveldocuments: ["travel documents", "travel document", "traveldocuments"],
        unpassport: ["un passport", "unpassport"],
        privatepassport: ["private passport", "privatepassport"],
      };
      for (const value of map[compact] || []) {
        aliases.add(normalizeOption(value));
      }
    }

    if (optionKind === "birth_country") {
      const map = {
        indonesia: ["indonesia", "republic of indonesia"],
        chinaprc: ["china prc", "china (prc)", "prc", "china"],
      };
      for (const value of map[compact] || []) {
        aliases.add(normalizeOption(value));
      }
    }

    if (optionKind === "marital_status") {
      const map = {
        single: ["single", "unmarried", "not married", "never married", "belum menikah", "lajang"],
        married: ["married", "menikah", "kawin"],
        divorce: ["divorced", "cerai", "divorce"],
        divorced: ["divorced", "cerai", "divorce"],
        widow: ["widowed", "widow", "janda", "duda"],
        widowed: ["widowed", "widow", "janda", "duda"],
      };
      for (const value of map[compact] || []) {
        aliases.add(normalizeOption(value));
      }
    }

    return Array.from(aliases);
  }

  function selectNativeByText(select, optionText, optionKind) {
    const expectedAliases = buildOptionAliases(normalizeOption(optionText), optionKind);
    for (const option of Array.from(select.options || [])) {
      const label = normalizeOption(option.textContent || "");
      const value = normalizeOption(option.value || "");
      if (
        expectedAliases.includes(label)
        || expectedAliases.includes(value)
        || expectedAliases.some((candidate) => label.includes(candidate) || value.includes(candidate))
      ) {
        select.value = option.value;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
    return false;
  }

  root.dropdownOptions = Object.freeze({
    buildOptionAliases,
    debugLabeledDropdownOptions,
    findLabeledDropdownOption,
    findPrimeNgDropdownOption,
    isDropdownValueSelected,
    isRequiredDropdownKind,
    selectNativeByText,
  });
})();
