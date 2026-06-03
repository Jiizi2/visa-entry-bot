(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const { DROPDOWN_SETTLE_DELAY_MS } = root.constants || {};
  const { normalizeOption } = root.valueUtils || {};
  const {
    clickElement,
    queryAll,
    findFirstVisible,
    isVisible,
    isEnabled,
  } = root.domUtils || {};
  const {
    buildOptionAliases,
    debugLabeledDropdownOptions,
    findLabeledDropdownOption,
    findPrimeNgDropdownOption,
    isDropdownValueSelected,
    isRequiredDropdownKind,
    selectNativeByText,
  } = root.dropdownOptions || {};
  if (!normalizeOption || !clickElement || !queryAll || !buildOptionAliases) {
    throw new Error("NusukAutofill dropdown dependencies were not loaded.");
  }

  function createDropdownActions({
    state,
    checkpoint,
    waitForSelector,
    waitUntil,
    sleep,
    markActiveElement,
    appendLog,
  }) {
    async function selectPrimengDropdown(selector, optionText, optionKind, timeoutMs, runId = state.runToken) {
      let lastError = null;
      const attempts = isRequiredDropdownKind(optionKind) ? 3 : 2;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const nativeSelect = findFirstVisible(selector);
        if (nativeSelect && nativeSelect.tagName.toLowerCase() === "select") {
          markActiveElement(nativeSelect);
          if (selectNativeByText(nativeSelect, optionText, optionKind)) {
            return;
          }
        }

        const trigger = await waitForSelector(selector, { timeoutMs, state: "visible" }, runId);
        markActiveElement(trigger);
        if (isDropdownValueSelected(trigger, optionText, optionKind)) {
          return;
        }

        await closeOpenDropdownPanels(runId);
        const beforePanels = collectVisibleDropdownPanels();
        await clickDropdownTrigger(trigger, runId);
        const panel = await waitForActiveDropdownPanel(beforePanels, 3000, runId);
        if (!panel) {
          lastError = new Error(`Dropdown panel tidak terbuka: ${optionText}`);
          continue;
        }

        const option = await waitForPrimeNgDropdownOption(optionText, optionKind, panel, 2500, runId);
        if (!option) {
          lastError = new Error(`Dropdown option not found: ${optionText}`);
          await closeOpenDropdownPanels(runId);
          if (!isRequiredDropdownKind(optionKind)) {
            return;
          }
          continue;
        }

        markActiveElement(option);
        await clickDropdownOption(option);
        await sleep(DROPDOWN_SETTLE_DELAY_MS, runId);

        const refreshedTrigger = findFirstVisible(selector) || trigger;
        if (!isRequiredDropdownKind(optionKind) || await waitForDropdownSelection(refreshedTrigger, optionText, optionKind, 4500, runId)) {
          return;
        }

        lastError = new Error(`Dropdown option not selected: ${optionText}`);
        await closeOpenDropdownPanels(runId);
      }
      throw lastError || new Error(`Dropdown option not selected: ${optionText}`);
    }

    async function selectLabeledDropdown(labelText, optionText, optionKind, timeoutMs, runId = state.runToken) {
      let lastError = null;
      const attempts = String(optionKind || "") === "marital_status" ? 3 : 2;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const rootNode = await waitUntil(() => resolveLabeledFieldRoot(labelText, optionKind), timeoutMs, `Dropdown label tidak ditemukan: ${labelText}`, runId);
        const nativeSelect = rootNode.querySelector("select");
        if (nativeSelect && selectNativeByText(nativeSelect, optionText, optionKind)) {
          nativeSelect.dispatchEvent(new Event("blur", { bubbles: true }));
          return;
        }

        const trigger = findLabeledDropdownTrigger(rootNode);
        if (!trigger) {
          throw new Error(`Dropdown trigger tidak ditemukan: ${labelText}`);
        }

        markActiveElement(trigger);
        if (isLabeledDropdownSelected(rootNode, optionText, optionKind)) {
          return;
        }

        await closeOpenDropdownPanels(runId);
        const beforePanels = collectVisibleDropdownPanels();
        await clickLabeledDropdownTrigger(trigger, runId);
        const panel = await waitForActiveDropdownPanel(beforePanels, 3000, runId);
        if (!panel) {
          lastError = new Error(`Dropdown panel tidak terbuka: ${labelText}`);
          continue;
        }

        const option = await waitForLabeledDropdownOption(rootNode, optionText, optionKind, panel, 2500, runId);
        if (!option) {
          lastError = new Error(`Dropdown option not found: ${optionText}`);
          if (attempt === attempts) {
            appendLog("warning", `Opsi dropdown terlihat tetapi tidak terbaca: ${debugLabeledDropdownOptions(rootNode, panel)}`);
          }
          await closeOpenDropdownPanels(runId);
          continue;
        }

        markActiveElement(option);
        await clickDropdownOption(option);
        await sleep(DROPDOWN_SETTLE_DELAY_MS, runId);

        const refreshedRoot = resolveLabeledFieldRoot(labelText, optionKind) || rootNode;
        if (await waitForLabeledDropdownSelection(refreshedRoot, optionText, optionKind, 3500, runId, labelText)) {
          return;
        }

        lastError = new Error(`Dropdown option not selected: ${optionText}`);
        await closeOpenDropdownPanels(runId);
      }
      throw lastError || new Error(`Dropdown option not selected: ${optionText}`);
    }

    function resolveLabeledFieldRoot(labelText, optionKind) {
      if (String(optionKind || "") === "marital_status") {
        return findMaritalStatusFieldRoot() || findLabeledFieldRoot(labelText);
      }
      return findLabeledFieldRoot(labelText);
    }

    function findMaritalStatusFieldRoot() {
      const trigger = findFirstVisible([
        "select[formcontrolname*='marital' i]",
        "select[name*='marital' i]",
        "p-dropdown[formcontrolname*='marital' i]",
        "p-select[formcontrolname*='marital' i]",
        "[formcontrolname*='marital' i] .p-dropdown",
        "[formcontrolname*='marital' i] .p-select",
        "[name*='marital' i] .p-dropdown",
        "[name*='marital' i] .p-select",
      ].join(", "));
      if (!(trigger instanceof HTMLElement)) {
        return null;
      }
      return trigger.closest(".form-group, .field, .form-field, .row, [formgroupname], .col, div") || trigger.parentElement || trigger;
    }

    function findLabeledFieldRoot(labelText) {
      const expected = normalizeOption(labelText);
      let fallback = null;
      for (const label of queryAll("label")) {
        const text = normalizeOption(label.textContent || "");
        if (!text.includes(expected) || !isVisible(label)) {
          continue;
        }
        for (const rootNode of collectLabeledFieldRoots(label)) {
          if (!(rootNode instanceof HTMLElement) || !isVisible(rootNode)) {
            continue;
          }
          const triggers = findLabeledDropdownTriggers(rootNode);
          if (triggers.length === 1) {
            return rootNode;
          }
          if (triggers.length > 1 && !fallback) {
            fallback = rootNode;
          }
          fallback = fallback || rootNode;
        }
      }
      return fallback;
    }

    function collectLabeledFieldRoots(label) {
      const roots = [];
      for (const selector of [".form-group", ".field", ".form-field", ".row", "[formgroupname]", ".col", "div"]) {
        const rootNode = label.closest(selector);
        if (rootNode instanceof HTMLElement && !roots.includes(rootNode)) {
          roots.push(rootNode);
        }
      }
      let current = label.parentElement;
      for (let depth = 0; current && depth < 5; depth += 1) {
        if (current instanceof HTMLElement && !roots.includes(current)) {
          roots.push(current);
        }
        current = current.parentElement;
      }
      return roots;
    }

    async function closeOpenDropdownPanels(runId = state.runToken) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (!isLabeledDropdownPanelOpen()) {
          return;
        }
        const eventInit = {
          key: "Escape",
          code: "Escape",
          keyCode: 27,
          which: 27,
          bubbles: true,
          cancelable: true,
        };
        document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", eventInit));
        document.dispatchEvent(new KeyboardEvent("keydown", eventInit));
        document.activeElement?.dispatchEvent(new KeyboardEvent("keyup", eventInit));
        document.dispatchEvent(new KeyboardEvent("keyup", eventInit));
        await sleep(180, runId);
      }
    }

    async function waitForLabeledDropdownPanelOpen(timeoutMs, runId = state.runToken) {
      const deadline = Date.now() + Math.max(500, Number(timeoutMs || 0));
      while (Date.now() < deadline) {
        await checkpoint(runId);
        if (isLabeledDropdownPanelOpen()) {
          return true;
        }
        await sleep(100, runId);
      }
      return isLabeledDropdownPanelOpen();
    }

    async function waitForActiveDropdownPanel(previousPanels = [], timeoutMs, runId = state.runToken) {
      const deadline = Date.now() + Math.max(500, Number(timeoutMs || 0));
      let fallback = null;
      while (Date.now() < deadline) {
        await checkpoint(runId);
        const panels = collectVisibleDropdownPanels();
        const fresh = panels.find((panel) => !previousPanels.includes(panel));
        if (fresh) {
          return fresh;
        }
        fallback = panels[panels.length - 1] || fallback;
        if (fallback && previousPanels.length === 0) {
          return fallback;
        }
        await sleep(100, runId);
      }
      return collectVisibleDropdownPanels().find((panel) => !previousPanels.includes(panel)) || fallback || null;
    }

    async function waitForPrimeNgDropdownOption(optionText, optionKind, panel, timeoutMs, runId = state.runToken) {
      const deadline = Date.now() + Math.max(500, Number(timeoutMs || 0));
      while (Date.now() < deadline) {
        await checkpoint(runId);
        const option = findPrimeNgDropdownOption(optionText, optionKind, panel);
        if (option) {
          return option;
        }
        await sleep(120, runId);
      }
      return findPrimeNgDropdownOption(optionText, optionKind, panel);
    }

    async function waitForLabeledDropdownOption(rootNode, optionText, optionKind, panel, timeoutMs, runId = state.runToken) {
      const deadline = Date.now() + Math.max(500, Number(timeoutMs || 0));
      while (Date.now() < deadline) {
        await checkpoint(runId);
        const option = findLabeledDropdownOption(rootNode, optionText, optionKind, panel);
        if (option) {
          return option;
        }
        await sleep(120, runId);
      }
      return findLabeledDropdownOption(rootNode, optionText, optionKind, panel);
    }

    function collectVisibleDropdownPanels() {
      return queryAll(dropdownPanelSelector()).filter((panel) => panel instanceof HTMLElement && isVisible(panel));
    }

    function dropdownPanelSelector() {
      return ".p-dropdown-panel, .p-select-overlay, .p-select-panel, .p-overlay, p-overlay, .dropdown-panel";
    }

    async function waitForLabeledDropdownSelection(rootNode, optionText, optionKind, timeoutMs, runId = state.runToken, labelText = "") {
      const deadline = Date.now() + Math.max(500, Number(timeoutMs || 0));
      while (Date.now() < deadline) {
        await checkpoint(runId);
        const currentRoot = labelText ? resolveLabeledFieldRoot(labelText, optionKind) || rootNode : rootNode;
        if (isLabeledDropdownSelected(currentRoot, optionText, optionKind)) {
          return true;
        }
        await sleep(180, runId);
      }
      return false;
    }

    function findLabeledDropdownTrigger(rootNode) {
      return findLabeledDropdownTriggers(rootNode)[0] || null;
    }

    function findLabeledDropdownTriggers(rootNode) {
      const selector = [
        "p-dropdown",
        "p-dropdown .p-dropdown",
        "p-dropdown [role='combobox']",
        "p-dropdown .p-dropdown-label",
        "p-dropdown span",
        "p-dropdown button",
        "p-select",
        "p-select .p-select",
        "p-select [role='combobox']",
        "p-select .p-select-label",
        "p-select span",
        "p-select button",
        "button[aria-haspopup='listbox']",
        ".dropdown-trigger",
        "[role='combobox']",
        ".p-dropdown",
        ".p-select",
        "button",
      ].join(", ");
      const nodes = [
        rootNode,
        ...Array.from(rootNode.querySelectorAll(selector)),
      ].filter((element) => element instanceof HTMLElement && (element === rootNode && element.matches?.(selector) || element !== rootNode));
      const triggers = [];
      for (const element of nodes) {
        const trigger = element.closest?.("p-dropdown, p-select")
          || element.closest?.(".p-dropdown, .p-select, [role='combobox'], button")
          || element;
        if (trigger instanceof HTMLElement && isVisible(trigger) && isEnabled(trigger) && !triggers.includes(trigger)) {
          triggers.push(trigger);
        }
      }
      return triggers;
    }

    function isLabeledDropdownSelected(rootNode, optionText, optionKind) {
      const aliases = buildOptionAliases(normalizeOption(optionText), optionKind);
      const trigger = findLabeledDropdownTrigger(rootNode);
      const selected = Array.from(rootNode.querySelectorAll("[aria-selected='true'], .selected, .active"))
        .map((node) => normalizeOption(node.textContent || ""));
      const texts = [
        normalizeOption(trigger?.textContent || ""),
        normalizeOption(rootNode.querySelector("p-dropdown .p-dropdown-label, p-dropdown span, p-select .p-select-label, p-select span")?.textContent || ""),
        normalizeOption(rootNode.querySelector("input[type='hidden'], input[readonly]")?.value || ""),
        ...selected,
      ].filter(Boolean);
      return texts.some((text) => aliases.some((candidate) => text.includes(candidate)));
    }

    async function clickLabeledDropdownTrigger(trigger, runId = state.runToken) {
      await clickDropdownTrigger(trigger, runId);
    }

    async function clickDropdownTrigger(trigger, runId = state.runToken) {
      if (!(trigger instanceof HTMLElement)) {
        await clickElement(trigger);
        return;
      }
      const clickTargets = [
        trigger,
        trigger.closest("p-dropdown, p-select"),
        trigger.querySelector?.(".p-dropdown, .p-select, [role='combobox'], button"),
        trigger.closest(".dropdown")?.querySelector(".dropdown-trigger, button[aria-haspopup='listbox'], [role='combobox'], button"),
      ].filter(Boolean);
      const seen = new Set();
      for (const target of clickTargets) {
        if (!(target instanceof HTMLElement) || seen.has(target)) {
          continue;
        }
        seen.add(target);
        target.scrollIntoView({ block: "center", inline: "nearest" });
        target.focus?.();
        target.click();
        await sleep(180, runId);
        if (isLabeledDropdownPanelOpen()) {
          return;
        }
      }
    }

    async function clickDropdownOption(option) {
      if (!(option instanceof HTMLElement)) {
        await clickElement(option);
        return;
      }
      option.scrollIntoView({ block: "center", inline: "nearest" });
      option.focus?.();
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
        option.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
        }));
      }
      try {
        option.click();
      } catch {
        option.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
        }));
      }
    }

    async function waitForDropdownSelection(trigger, optionText, optionKind, timeoutMs, runId = state.runToken) {
      const deadline = Date.now() + Math.max(500, Number(timeoutMs || 0));
      while (Date.now() < deadline) {
        await checkpoint(runId);
        if (isDropdownValueSelected(trigger, optionText, optionKind)) {
          return true;
        }
        await sleep(180, runId);
      }
      return false;
    }

    function isDropdownPanelOpen() {
      return isLabeledDropdownPanelOpen();
    }

    function isLabeledDropdownPanelOpen() {
      return collectVisibleDropdownPanels().length > 0;
    }

    return {
      selectPrimengDropdown,
      selectLabeledDropdown,
      findLabeledFieldRoot,
      clickLabeledDropdownTrigger,
      clickDropdownOption,
    };
  }

  root.dropdownActions = Object.freeze({
    createDropdownActions,
  });
})();
