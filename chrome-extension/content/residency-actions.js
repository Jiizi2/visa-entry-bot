(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const { IQAMA_FIELD_SELECTOR } = root.constants || {};
  const { normalizeOption } = root.valueUtils || {};
  const {
    cssEscape,
    setInputValue,
    dispatchBlur,
    queryAll,
    isVisible,
    isEnabled,
  } = root.domUtils || {};
  const { inputSearchText } = root.formFieldUtils || {};
  if (!normalizeOption || !queryAll || !inputSearchText) {
    throw new Error("NusukAutofill residency dependencies were not loaded.");
  }

  function isResidencyText(value) {
    return /\biqama\b|\bresidency\b|\bresidence\b|\bresident\b/.test(normalizeOption(value));
  }

  function createResidencyActions({
    state,
    sleep,
    markActiveElement,
    deleteLabeledAttachment,
    notifyUploadWidget,
    clickLabeledDropdownTrigger,
    clickDropdownOption,
  }) {
    function clearFields(selector) {
      const fields = queryAll(selector)
        .filter((element) => (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && isResidencyField(element));
      let cleared = false;
      for (const field of fields) {
        markActiveElement(field);
        setInputValue(field, "");
        field.removeAttribute("value");
        dispatchBlur(field);
        cleared = true;
      }
      return cleared;
    }

    async function clearResidencyInfo(runId = state.runToken) {
      const roots = findResidencyRoots();
      let changed = false;

      for (const rootNode of roots) {
        changed = clearResidencyControlsInRoot(rootNode) || changed;
        changed = clickDeleteButtonsInRoot(rootNode) || changed;
      }

      changed = clearFields(IQAMA_FIELD_SELECTOR) || changed;
      changed = deleteLabeledAttachment("Iqama") || changed;
      changed = deleteLabeledAttachment("Residency") || changed;
      changed = clickResidencyNoOptions() || changed;
      changed = await selectResidencyNegativeOptions(roots, runId) || changed;
      await confirmDeleteIfShown(runId);
      return changed;
    }

    function findResidencyRoots() {
      const roots = [];
      const addRoot = (node) => {
        const rootNode = node?.closest?.(".attachment, .form-group, .field, .form-field, [formgroupname], [class*='iqama' i], [class*='residency' i], [class*='residence' i], section, div");
        if (rootNode instanceof HTMLElement && !roots.includes(rootNode)) {
          roots.push(rootNode);
        }
      };

      for (const label of queryAll("label")) {
        if (isResidencyText(label.textContent || "")) {
          addRoot(label);
        }
      }
      for (const node of queryAll(IQAMA_FIELD_SELECTOR)) {
        addRoot(node);
      }
      for (const node of queryAll("[class*='iqama' i], [class*='residency' i], [class*='residence' i], [id*='iqama' i], [id*='residency' i], [id*='residence' i]")) {
        addRoot(node);
      }
      return roots;
    }

    function clearResidencyControlsInRoot(rootNode) {
      let changed = false;
      for (const input of Array.from(rootNode.querySelectorAll("input, textarea"))) {
        if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) {
          continue;
        }
        const type = String(input.type || "").toLowerCase();
        if (type === "file") {
          if (input.files?.length || input.value) {
            input.value = "";
            notifyUploadWidget?.(input);
            dispatchBlur(input);
            changed = true;
          }
          continue;
        }
        if (type === "button" || type === "submit") {
          continue;
        }
        if (type === "checkbox") {
          if (input.checked) {
            input.checked = false;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
            changed = true;
          }
          continue;
        }
        if (type === "radio") {
          continue;
        }
        markActiveElement(input);
        setInputValue(input, "");
        input.removeAttribute("value");
        dispatchBlur(input);
        changed = true;
      }

      for (const select of Array.from(rootNode.querySelectorAll("select"))) {
        if (!(select instanceof HTMLSelectElement)) {
          continue;
        }
        const blank = Array.from(select.options || []).find((option) => !String(option.value || option.textContent || "").trim());
        if (blank) {
          select.value = blank.value;
        } else {
          select.selectedIndex = -1;
        }
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        select.dispatchEvent(new Event("blur", { bubbles: true }));
        changed = true;
      }

      const noRadio = Array.from(rootNode.querySelectorAll("input[type='radio']"))
        .find((radio) => normalizeOption(controlLabelText(radio)).includes("no"));
      if (noRadio instanceof HTMLInputElement && !noRadio.checked) {
        noRadio.click();
        changed = true;
      }
      return changed;
    }

    async function selectResidencyNegativeOptions(roots, runId = state.runToken) {
      let changed = false;
      for (const rootNode of roots || []) {
        if (!(rootNode instanceof HTMLElement)) {
          continue;
        }
        for (const select of Array.from(rootNode.querySelectorAll("select"))) {
          if (!(select instanceof HTMLSelectElement)) {
            continue;
          }
          const option = Array.from(select.options || []).find((item) => {
            const text = normalizeOption(`${item.value || ""} ${item.textContent || ""}`);
            return !text || text === "no" || text === "none" || text.includes("not applicable") || text.includes("not resident");
          });
          if (option && select.value !== option.value) {
            select.value = option.value;
            select.dispatchEvent(new Event("input", { bubbles: true }));
            select.dispatchEvent(new Event("change", { bubbles: true }));
            select.dispatchEvent(new Event("blur", { bubbles: true }));
            changed = true;
          }
        }

        const trigger = findResidencyDropdownTrigger(rootNode);
        if (!trigger) {
          continue;
        }
        await closeOpenResidencyDropdownPanels(runId);
        await clickLabeledDropdownTrigger(trigger, runId);
        await waitForResidencyDropdownPanel(2500, runId);
        const option = findResidencyNegativeOption(rootNode);
        if (option) {
          await clickDropdownOption(option);
          await sleep(450, runId);
          changed = true;
        }
      }
      return changed;
    }

    function findResidencyDropdownTrigger(rootNode) {
      return Array.from(rootNode.querySelectorAll([
        "p-dropdown .p-dropdown",
        "p-dropdown [role='combobox']",
        "p-select .p-select",
        "p-select [role='combobox']",
        "button[aria-haspopup='listbox']",
        ".dropdown-trigger",
        "[role='combobox']",
      ].join(", "))).find((element) => element instanceof HTMLElement && isVisible(element) && isEnabled(element)) || null;
    }

    function findResidencyNegativeOption(rootNode) {
      const visiblePanels = queryAll([
        ".p-dropdown-panel",
        ".p-select-overlay",
        ".p-select-panel",
        ".p-overlay",
        "p-overlay",
        ".dropdown-panel",
        "[role='listbox']",
      ].join(", ")).filter((panel) => panel instanceof HTMLElement && isVisible(panel));
      const candidates = [
        ...visiblePanels.flatMap((panel) => Array.from(panel.querySelectorAll("[role='option'], .p-dropdown-item, .p-select-option, li, .dropdown-item, .dropdown-option"))),
        ...Array.from(rootNode.querySelectorAll("[role='option'], li, .dropdown-item, .dropdown-option")),
      ].filter((element, index, items) => element instanceof HTMLElement && items.indexOf(element) === index);

      return candidates.find((element) => {
        const text = normalizeOption(element.textContent || element.getAttribute("aria-label") || element.getAttribute("data-value") || "");
        return isVisible(element)
          && (text === "no" || text === "none" || text.includes("not applicable") || text.includes("not resident"));
      }) || null;
    }

    async function closeOpenResidencyDropdownPanels(runId = state.runToken) {
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
      await sleep(160, runId);
    }

    async function waitForResidencyDropdownPanel(timeoutMs, runId = state.runToken) {
      const deadline = Date.now() + Math.max(500, Number(timeoutMs || 0));
      while (Date.now() < deadline) {
        if (queryAll(".p-dropdown-panel, .p-select-overlay, .p-select-panel, .p-overlay, p-overlay, .dropdown-panel, [role='listbox']")
          .some((panel) => panel instanceof HTMLElement && isVisible(panel))) {
          return true;
        }
        await sleep(100, runId);
      }
      return false;
    }

    function clickDeleteButtonsInRoot(rootNode) {
      let clicked = false;
      for (const button of Array.from(rootNode.querySelectorAll("button, [role='button']"))) {
        const text = normalizeOption(button.textContent || button.getAttribute("aria-label") || "");
        if (!text.includes("delete") && !text.includes("remove")) {
          continue;
        }
        if (button instanceof HTMLElement && isVisible(button) && isEnabled(button)) {
          button.click();
          clicked = true;
        }
      }
      return clicked;
    }

    function clickResidencyNoOptions() {
      let changed = false;
      for (const rootNode of findResidencyRoots()) {
        for (const input of Array.from(rootNode.querySelectorAll("input[type='radio'], input[type='checkbox']"))) {
          if (!(input instanceof HTMLInputElement)) {
            continue;
          }
          const label = normalizeOption(controlLabelText(input));
          if (!label.includes("no")) {
            continue;
          }
          if (!input.checked) {
            input.click();
            changed = true;
          }
        }
        for (const option of Array.from(rootNode.querySelectorAll("[role='option'], li, button, [role='button']"))) {
          if (!(option instanceof HTMLElement) || !isVisible(option) || !isEnabled(option)) {
            continue;
          }
          const text = normalizeOption(option.textContent || option.getAttribute("aria-label") || "");
          if (text === "no" || text.includes(" no")) {
            option.click();
            changed = true;
          }
        }
      }
      for (const label of queryAll("label")) {
        const text = normalizeOption(label.textContent || "");
        if (!isResidencyText(text) || !text.includes("no")) {
          continue;
        }
        const input = label.querySelector("input[type='radio'], input[type='checkbox']");
        if (input instanceof HTMLInputElement && !input.checked) {
          input.click();
          changed = true;
        }
      }
      return changed;
    }

    function controlLabelText(input) {
      if (!(input instanceof HTMLInputElement)) {
        return "";
      }
      const ownLabel = input.closest("label")?.textContent || "";
      const forLabel = input.id
        ? document.querySelector(`label[for='${cssEscape(input.id)}']`)?.textContent || ""
        : "";
      const aria = input.getAttribute("aria-label") || input.getAttribute("title") || "";
      const parentText = input.parentElement?.textContent || "";
      return `${ownLabel} ${forLabel} ${aria} ${parentText}`;
    }

    async function confirmDeleteIfShown(runId = state.runToken) {
      await sleep(250, runId);
      const confirmButton = queryAll("button, [role='button']")
        .find((button) => {
          const text = normalizeOption(button.textContent || button.getAttribute("aria-label") || "");
          return isVisible(button) && isEnabled(button) && ["yes", "confirm", "delete", "remove", "ok"].some((word) => text === word || text.includes(word));
        });
      if (confirmButton instanceof HTMLElement) {
        confirmButton.click();
        await sleep(350, runId);
      }
    }

    function isResidencyField(element) {
      const text = inputSearchText(element);
      return isResidencyText(text);
    }

    return {
      clearFields,
      clearResidencyInfo,
      confirmDeleteIfShown,
    };
  }

  root.residencyActions = Object.freeze({
    createResidencyActions,
    isResidencyText,
  });
})();
