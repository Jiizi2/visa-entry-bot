(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const {
    clickElement,
    setInputValue,
    findByText,
    isVisible,
    isEnabled,
  } = root.domUtils || {};
  const { normalizeOption } = root.valueUtils || {};
  if (!clickElement || !setInputValue || !findByText || !isVisible || !isEnabled || !normalizeOption) {
    throw new Error("NusukAutofill phone country dependencies were not loaded.");
  }

  function createPhoneCountryFields({
    state,
    waitUntil,
    sleep,
    checkpoint,
    markActiveElement,
    appendLog,
    clickDropdownOption,
  }) {
    function setNativeSelectValue(select, expectedValue, dispatchMouse = false) {
      const normalizedExpected = normalizeOption(expectedValue);
      const option = Array.from(select.options || []).find((item) => {
        const value = normalizeOption(item.value || "");
        const label = normalizeOption(item.textContent || "");
        return value === normalizedExpected || label === normalizedExpected || value.includes(normalizedExpected) || label.includes(normalizedExpected);
      });
      if (option) {
        if (dispatchMouse) {
          option.selected = true;
          option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, composed: true, view: window }));
          option.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, composed: true, view: window }));
          option.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, view: window }));
        }
        select.value = option.value;
      } else {
        select.value = expectedValue;
      }
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      select.dispatchEvent(new Event("blur", { bubbles: true }));
    }

    async function setCustomCountryCode(rootNode, countryCode, timeoutMs, runId = state.runToken) {
      const trigger = findCountryCodeTrigger(rootNode);
      if (!trigger) {
        return false;
      }
      await closeOpenCountryDropdown(runId);
      await clickElement(trigger);
      await sleep(350, runId);
      await filterCountryCodeDropdown(rootNode, countryCode, runId);
      const option = await findCountryCodeOptionWithScroll(rootNode, countryCode, timeoutMs, runId);
      if (!option) {
        appendLog("warning", `Country code option tidak ditemukan: ${countryCode}. Terbaca: ${debugCountryCodeOptions(rootNode)}`);
        return false;
      }
      markActiveElement(option);
      await clickDropdownOption(option);
      await sleep(500, runId);
      return true;
    }

    async function filterCountryCodeDropdown(rootNode, countryCode, runId = state.runToken) {
      const search = findCountryCodeSearchInput(rootNode);
      if (!search) {
        return false;
      }
      markActiveElement(search);
      setInputValue(search, countryCode);
      await sleep(650, runId);
      if (findCountryCodeOption(rootNode, countryCode)) {
        return true;
      }
      setInputValue(search, "Indonesia");
      await sleep(650, runId);
      return true;
    }

    function findCountryCodeSearchInput(rootNode) {
      const candidates = [
        ...Array.from(rootNode.querySelectorAll(".dropdown-search, input[placeholder*='country code' i], input[placeholder*='country' i], input[type='search'], .dropdown-header input")),
        ...Array.from(document.querySelectorAll(".dropdown-panel .dropdown-search, .dropdown-panel input[placeholder*='country code' i], .dropdown-panel input[placeholder*='country' i], .dropdown-header input, input[type='search']")),
      ].filter((element, index, items) => element instanceof HTMLInputElement && isVisible(element) && !element.disabled && items.indexOf(element) === index);
      return candidates[0] || null;
    }

    function findCountryCodeTrigger(rootNode) {
      const selectors = [
        ".country-code-dropdown button[aria-haspopup='listbox']",
        ".country-code-dropdown .dropdown-trigger",
        "button[aria-label*='Country code' i]",
        "[aria-label*='Country code' i][aria-haspopup='listbox']",
        ".country-code button",
        "[class*='country-code' i] button",
        "[class*='country' i] button[aria-haspopup='listbox']",
        "[role='combobox']",
        "button.dropdown-trigger",
        "button",
      ];
      for (const selector of selectors) {
        const trigger = Array.from(rootNode.querySelectorAll(selector))
          .find((element) => element instanceof HTMLElement && isVisible(element) && isEnabled(element));
        if (trigger) {
          return trigger;
        }
      }
      return null;
    }

    async function findCountryCodeOptionWithScroll(rootNode, countryCode, timeoutMs, runId = state.runToken) {
      const deadline = Date.now() + Math.min(Math.max(1200, Number(timeoutMs || 0)), 8000);
      const lists = findCountryCodeLists(rootNode);
      for (const list of lists) {
        if (list instanceof HTMLElement) {
          list.scrollTop = 0;
        }
      }
      while (Date.now() < deadline) {
        await checkpoint(runId);
        const option = findCountryCodeOption(rootNode, countryCode);
        if (option) {
          return option;
        }
        let moved = false;
        for (const list of findCountryCodeLists(rootNode)) {
          if (!(list instanceof HTMLElement)) {
            continue;
          }
          const before = list.scrollTop;
          list.scrollTop = before + Math.max(80, Math.round(list.clientHeight * 0.85));
          moved = moved || list.scrollTop !== before;
        }
        if (!moved) {
          await sendCountryCodeTypeahead(countryCode, runId);
        }
        await sleep(220, runId);
      }
      return null;
    }

    function findCountryCodeOption(rootNode, countryCode) {
      const expected = normalizeOption(countryCode);
      const candidates = [
        ...Array.from(rootNode.querySelectorAll(".country-code-dropdown option, .country-code-dropdown [role='option'], .country-code-dropdown li, option, [role='option'], li, .dropdown-item, .dropdown-option")),
        ...Array.from(document.querySelectorAll(".country-code-dropdown option, .country-code-dropdown [role='option'], .country-code-dropdown li, [aria-label*='Country code' i] [role='option'], [role='option'], li[role='option'], .dropdown-list li, .dropdown-item, .dropdown-option")),
      ].filter((element, index, items) => element instanceof HTMLElement && isVisible(element) && isEnabled(element) && items.indexOf(element) === index);
      return candidates.find((element) => {
        const label = normalizeOption(element.textContent || "");
        const value = normalizeOption(element.getAttribute("value") || element.getAttribute("data-value") || "");
        return label === expected || value === expected || label.includes(expected) || value.includes(expected);
      }) || null;
    }

    function findCountryCodeLists(rootNode) {
      return [
        ...Array.from(rootNode.querySelectorAll(".country-code-dropdown .dropdown-list, .country-code-dropdown [role='listbox'], [class*='country' i] [role='listbox'], [class*='country' i] .dropdown-list")),
        ...Array.from(document.querySelectorAll(".country-code-dropdown .dropdown-list, .country-code-dropdown [role='listbox'], [aria-label*='Country code' i] ~ [role='listbox'], [role='listbox'], .dropdown-list")),
      ].filter((element, index, items) => element instanceof HTMLElement && isVisible(element) && items.indexOf(element) === index);
    }

    async function sendCountryCodeTypeahead(countryCode, runId = state.runToken) {
      const text = String(countryCode || "");
      for (const char of text) {
        await checkpoint(runId);
        document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true, cancelable: true, composed: true }));
        document.activeElement?.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true, cancelable: true, composed: true }));
        await sleep(30, runId);
      }
    }

    function debugCountryCodeOptions(rootNode) {
      return [
        ...Array.from(rootNode.querySelectorAll("option, [role='option'], li, .dropdown-item, .dropdown-option")),
        ...Array.from(document.querySelectorAll("[role='option'], li[role='option'], .dropdown-list li, .dropdown-item, .dropdown-option")),
      ]
        .filter((element) => element instanceof HTMLElement && isVisible(element))
        .slice(0, 12)
        .map((element) => normalizeOption(element.textContent || element.getAttribute("value") || element.getAttribute("data-value") || ""))
        .filter(Boolean)
        .join(" | ") || "tidak ada option";
    }

    function findClosestPhoneCountryTrigger(input) {
      const scope = input.closest("ngx-intl-tel-input, .iti, .form-group, div");
      if (!scope) {
        return null;
      }
      return scope.querySelector(".iti__selected-flag, .country-code, [role='combobox'], button");
    }

    async function selectPhoneCountry(trigger, label, timeoutMs, runId = state.runToken) {
      await closeOpenCountryDropdown(runId);
      await clickElement(trigger);
      await waitUntil(() => {
        const option = findByText(".iti__country-list li:visible, .country-dropdown li:visible, [role='option']:visible", label);
        return option || null;
      }, timeoutMs, "", runId);
      const option = findByText(".iti__country-list li:visible, .country-dropdown li:visible, [role='option']:visible", label);
      if (option) {
        await clickElement(option);
      }
    }

    async function closeOpenCountryDropdown(runId = state.runToken) {
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
      await sleep(120, runId);
    }

    return {
      findClosestPhoneCountryTrigger,
      selectPhoneCountry,
      setCustomCountryCode,
      setNativeSelectValue,
    };
  }

  root.phoneCountry = Object.freeze({
    createPhoneCountryFields,
  });
})();
