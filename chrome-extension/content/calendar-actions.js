(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const {
    normalizeDateToIso,
    isoDateParts,
    isoDateCandidates,
    isoToSlashDate,
    isoToDisplayDMY,
    isPickedDateMatch,
    monthNameToIndex,
  } = root.dateUtils || {};
  const {
    clickElement,
    setInputValue,
    dispatchBlur,
    queryAll,
    isVisible,
    isEnabled,
  } = root.domUtils || {};
  if (!normalizeDateToIso || !clickElement || !queryAll) {
    throw new Error("NusukAutofill calendar dependencies were not loaded.");
  }

  function createCalendarActions({
    state,
    waitForInput,
    waitForSelector,
    sleep,
    markActiveElement,
  }) {
    async function setCalendarDate({ selector, rawValue, popupSelector, timeoutMs, skipWhenEmpty, runId = state.runToken }) {
      if (!rawValue && skipWhenEmpty) {
        return;
      }
      const isoDate = normalizeDateToIso(rawValue);
      if (!isoDate) {
        throw new Error(`Unrecognized date format: ${rawValue}`);
      }

      const input = await waitForInput(selector, timeoutMs, runId);
      markActiveElement(input);
      const preferredValues = [isoToSlashDate(isoDate), isoDate, isoToDisplayDMY(isoDate)].filter(Boolean);
      for (const candidate of preferredValues) {
        setInputValue(input, candidate);
        dispatchBlur(input);
        await sleep(120, runId);
        if (isPickedDateMatch(input.value, isoDateParts(isoDate))) {
          return;
        }
      }

      await closeOpenCalendarPanels(popupSelector, runId);
      const beforePanels = collectVisibleCalendarPanels(popupSelector);
      await clickElement(input);
      const panel = await waitForCalendarPopup(popupSelector, timeoutMs, runId, beforePanels);
      await navigateCalendarToDate(popupSelector, isoDate, timeoutMs, runId, panel);
      const day = await waitForCalendarDay(popupSelector, isoDate, Math.min(timeoutMs, 4000), runId, panel);
      if (day) {
        markActiveElement(day);
        await clickElement(day);
        await sleep(240, runId);
        if (isPickedDateMatch(input.value, isoDateParts(isoDate))) {
          return;
        }
      }

      setInputValue(input, preferredValues[0] || isoDate);
      dispatchBlur(input);
      await sleep(120, runId);
      if (!isPickedDateMatch(input.value, isoDateParts(isoDate))) {
        throw new Error(`Failed to set calendar date ${isoDate}.`);
      }
    }

    async function waitForCalendarPopup(popupSelector, timeoutMs, runId = state.runToken, previousPanels = []) {
      const deadline = Date.now() + Math.max(500, Number(timeoutMs || 0));
      let attachedPanel = null;
      while (Date.now() < deadline) {
        const visiblePanels = collectVisibleCalendarPanels(popupSelector);
        const freshPanel = visiblePanels.find((item) => !previousPanels.includes(item));
        if (freshPanel) {
          return freshPanel;
        }
        const visiblePanel = visiblePanels[visiblePanels.length - 1] || null;
        if (visiblePanel && previousPanels.length === 0) {
          return visiblePanel;
        }
        const attachedPanels = collectAttachedCalendarPanels(popupSelector);
        attachedPanel = attachedPanels.find((item) => !previousPanels.includes(item))
          || attachedPanels[attachedPanels.length - 1]
          || attachedPanel;
        await sleep(120, runId);
      }
      if (attachedPanel) {
        return attachedPanel;
      }
      return waitForSelector(popupSelector, { timeoutMs: 500, state: "attached" }, runId);
    }

    async function closeOpenCalendarPanels(popupSelector, runId = state.runToken) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (!collectVisibleCalendarPanels(popupSelector).length) {
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
        await sleep(140, runId);
      }
    }

    function collectVisibleCalendarPanels(popupSelector) {
      return queryAll(popupSelector).filter((node) => node instanceof HTMLElement && isVisible(node));
    }

    function collectAttachedCalendarPanels(popupSelector) {
      return queryAll(popupSelector).filter((node) => node instanceof HTMLElement);
    }

    async function navigateCalendarToDate(popupSelector, isoDate, timeoutMs, runId = state.runToken, panelRoot = null) {
      const targetParts = isoDateParts(isoDate);
      if (!targetParts) {
        return;
      }

      if (locateEnabledCalendarDay(popupSelector, isoDate, panelRoot)) {
        return;
      }

      await chooseCalendarYear(popupSelector, targetParts.year, timeoutMs, runId, panelRoot);
      await chooseCalendarMonth(popupSelector, targetParts.month - 1, timeoutMs, runId, panelRoot);
      if (locateEnabledCalendarDay(popupSelector, isoDate, panelRoot)) {
        return;
      }

      await navigateCalendarByArrows(popupSelector, targetParts, timeoutMs, runId, panelRoot);
    }

    async function chooseCalendarYear(popupSelector, targetYear, timeoutMs, runId = state.runToken, panelRoot = null) {
      const header = readCalendarHeader(popupSelector, panelRoot);
      if (header.year === targetYear) {
        return true;
      }

      if (!hasYearPicker(popupSelector, panelRoot)) {
        const yearButton = findCalendarHeaderButton(popupSelector, ".p-datepicker-year", panelRoot);
        if (!yearButton) {
          return false;
        }
        await clickElement(yearButton);
        if (!await waitForYearPicker(popupSelector, Math.min(timeoutMs, 3000), runId, panelRoot)) {
          return false;
        }
      }

      const deadline = Date.now() + Math.max(800, Number(timeoutMs || 0));
      while (Date.now() < deadline) {
        const yearOption = findYearOption(popupSelector, targetYear, panelRoot);
        if (yearOption) {
          await clickElement(yearOption);
          await sleep(260, runId);
          return true;
        }

        const range = readVisibleYearRange(popupSelector, panelRoot);
        let direction = "next";
        if (range) {
          if (targetYear < range.start) {
            direction = "prev";
          } else if (targetYear > range.end) {
            direction = "next";
          } else {
            return false;
          }
        }
        const nav = findCalendarNavButton(popupSelector, direction, "decade", panelRoot);
        if (!nav) {
          return false;
        }
        await clickElement(nav);
        await waitForYearPicker(popupSelector, Math.min(timeoutMs, 3000), runId, panelRoot);
      }
      return false;
    }

    async function chooseCalendarMonth(popupSelector, targetMonth, timeoutMs, runId = state.runToken, panelRoot = null) {
      const header = readCalendarHeader(popupSelector, panelRoot);
      if (header.month === targetMonth) {
        return true;
      }

      if (!hasMonthPicker(popupSelector, panelRoot)) {
        const monthButton = findCalendarHeaderButton(popupSelector, ".p-datepicker-month", panelRoot);
        if (!monthButton) {
          return false;
        }
        await clickElement(monthButton);
        if (!await waitForMonthPicker(popupSelector, Math.min(timeoutMs, 3000), runId, panelRoot)) {
          return false;
        }
      }

      const deadline = Date.now() + Math.max(800, Number(timeoutMs || 0));
      while (Date.now() < deadline) {
        const monthOption = findMonthOption(popupSelector, targetMonth, panelRoot);
        if (monthOption) {
          await clickElement(monthOption);
          await sleep(260, runId);
          return true;
        }
        await sleep(120, runId);
      }
      return false;
    }

    async function navigateCalendarByArrows(popupSelector, targetParts, timeoutMs, runId = state.runToken, panelRoot = null) {
      const deadline = Date.now() + Math.max(800, Number(timeoutMs || 0));
      const targetIso = formatIsoDate(targetParts);

      while (Date.now() < deadline) {
        if (locateEnabledCalendarDay(popupSelector, targetIso, panelRoot)) {
          return;
        }

        const { month: currentMonth, year: currentYear } = readCalendarHeader(popupSelector, panelRoot);
        if (currentMonth < 0 || !Number.isFinite(currentYear)) {
          break;
        }

        const targetIndex = targetParts.year * 12 + (targetParts.month - 1);
        const currentIndex = currentYear * 12 + currentMonth;
        const nav = findCalendarNavButton(popupSelector, targetIndex > currentIndex ? "next" : "prev", "month", panelRoot);
        if (!nav) {
          break;
        }
        await clickElement(nav);
        await sleep(220, runId);
      }
    }

    async function waitForCalendarDay(popupSelector, isoDate, timeoutMs, runId = state.runToken, panelRoot = null) {
      const deadline = Date.now() + Math.max(500, Number(timeoutMs || 0));
      while (Date.now() < deadline) {
        const day = locateEnabledCalendarDay(popupSelector, isoDate, panelRoot);
        if (day) {
          return day;
        }
        await sleep(120, runId);
      }
      return locateEnabledCalendarDay(popupSelector, isoDate, panelRoot);
    }

    function locateEnabledCalendarDay(popupSelector, isoDate, panelRoot = null) {
      const panel = findCalendarPanel(popupSelector, true, panelRoot);
      if (!panel) {
        return null;
      }
      const candidates = isoDateCandidates(isoDate);
      for (const candidate of candidates) {
        const day = Array.from(panel.querySelectorAll([
          `td:not(.p-datepicker-other-month) span[data-date='${candidate}']:not(.p-disabled)`,
          `td:not(.disabled) [data-date='${candidate}']:not(.disabled)`,
        ].join(", "))).find((node) => node instanceof HTMLElement && isVisible(node));
        if (day && isCalendarDayEnabled(day)) {
          return day;
        }
      }
      const parts = isoDateParts(isoDate);
      if (!panel || !parts) {
        return null;
      }
      const header = readCalendarHeaderFromPanel(panel);
      if (header.month !== parts.month - 1 || header.year !== parts.year) {
        return null;
      }
      const dayText = String(parts.day);
      return Array.from(panel.querySelectorAll("table td:not(.p-datepicker-other-month) span, table td:not(.p-datepicker-other-month) button, table td:not(.p-datepicker-other-month) a"))
        .find((node) => node instanceof HTMLElement
          && normalizeCalendarCellText(node.textContent) === dayText
          && isCalendarDayEnabled(node)) || null;
    }

    function findCalendarPanel(popupSelector, allowAttached, preferredPanel = null) {
      if (preferredPanel instanceof HTMLElement && (allowAttached || isVisible(preferredPanel))) {
        return preferredPanel;
      }
      const panels = queryAll(popupSelector).filter((node) => node instanceof HTMLElement);
      const visiblePanels = panels.filter((node) => isVisible(node));
      return visiblePanels[visiblePanels.length - 1] || (allowAttached ? panels[panels.length - 1] : null) || null;
    }

    function findCalendarHeaderButton(popupSelector, selector, panelRoot = null) {
      const panel = findCalendarPanel(popupSelector, true, panelRoot);
      return Array.from(panel?.querySelectorAll(selector) || [])
        .find((node) => node instanceof HTMLElement && isVisible(node) && isEnabled(node)) || null;
    }

    function findCalendarNavButton(popupSelector, direction, mode, panelRoot = null) {
      const panel = findCalendarPanel(popupSelector, true, panelRoot);
      const selector = direction === "next" ? ".p-datepicker-next" : ".p-datepicker-prev";
      const buttons = Array.from(panel?.querySelectorAll(selector) || [])
        .filter((node) => node instanceof HTMLElement && isVisible(node) && isEnabled(node));
      const expected = String(mode || "").toLowerCase();
      if (!expected) {
        return buttons[0] || null;
      }
      const labeled = buttons.find((button) => String(button.getAttribute("aria-label") || "").toLowerCase().includes(expected));
      if (labeled) {
        return labeled;
      }
      return buttons.every((button) => !String(button.getAttribute("aria-label") || "").trim()) ? buttons[0] || null : null;
    }

    function findYearOption(popupSelector, targetYear, panelRoot = null) {
      const panel = findCalendarPanel(popupSelector, true, panelRoot);
      return Array.from(panel?.querySelectorAll(".p-yearpicker-year") || [])
        .find((node) => node instanceof HTMLElement
          && normalizeCalendarCellText(node.textContent) === String(targetYear)
          && isEnabled(node)
          && isVisible(node)) || null;
    }

    function findMonthOption(popupSelector, targetMonth, panelRoot = null) {
      const panel = findCalendarPanel(popupSelector, true, panelRoot);
      return Array.from(panel?.querySelectorAll(".p-monthpicker-month") || [])
        .find((node) => node instanceof HTMLElement
          && monthNameToIndex(node.textContent || "") === targetMonth
          && isEnabled(node)
          && isVisible(node)) || null;
    }

    function hasYearPicker(popupSelector, panelRoot = null) {
      const panel = findCalendarPanel(popupSelector, true, panelRoot);
      return Array.from(panel?.querySelectorAll(".p-yearpicker-year") || [])
        .some((node) => node instanceof HTMLElement && isVisible(node));
    }

    function hasMonthPicker(popupSelector, panelRoot = null) {
      const panel = findCalendarPanel(popupSelector, true, panelRoot);
      return Array.from(panel?.querySelectorAll(".p-monthpicker-month") || [])
        .some((node) => node instanceof HTMLElement && isVisible(node));
    }

    async function waitForYearPicker(popupSelector, timeoutMs, runId = state.runToken, panelRoot = null) {
      const deadline = Date.now() + Math.max(500, Number(timeoutMs || 0));
      while (Date.now() < deadline) {
        if (hasYearPicker(popupSelector, panelRoot)) {
          return true;
        }
        await sleep(100, runId);
      }
      return hasYearPicker(popupSelector, panelRoot);
    }

    async function waitForMonthPicker(popupSelector, timeoutMs, runId = state.runToken, panelRoot = null) {
      const deadline = Date.now() + Math.max(500, Number(timeoutMs || 0));
      while (Date.now() < deadline) {
        if (hasMonthPicker(popupSelector, panelRoot)) {
          return true;
        }
        await sleep(100, runId);
      }
      return hasMonthPicker(popupSelector, panelRoot);
    }

    function readCalendarHeader(popupSelector, panelRoot = null) {
      return readCalendarHeaderFromPanel(findCalendarPanel(popupSelector, true, panelRoot));
    }

    function readCalendarHeaderFromPanel(panel) {
      const monthNode = panel?.querySelector(".p-datepicker-month");
      const yearNode = panel?.querySelector(".p-datepicker-year");
      return {
        month: monthNameToIndex(monthNode?.textContent || ""),
        year: Number(String(yearNode?.textContent || "").trim()),
      };
    }

    function readVisibleYearRange(popupSelector, panelRoot = null) {
      const panel = findCalendarPanel(popupSelector, true, panelRoot);
      const decadeText = String(panel?.querySelector(".p-datepicker-decade")?.textContent || "");
      const decadeMatch = decadeText.match(/(\d{4})\s*-\s*(\d{4})/);
      if (decadeMatch) {
        return { start: Number(decadeMatch[1]), end: Number(decadeMatch[2]) };
      }
      const years = Array.from(panel?.querySelectorAll(".p-yearpicker-year") || [])
        .map((node) => Number(String(node.textContent || "").trim()))
        .filter((year) => Number.isFinite(year));
      if (!years.length) {
        return null;
      }
      return { start: Math.min(...years), end: Math.max(...years) };
    }

    function isCalendarDayEnabled(node) {
      const cell = node.closest?.("td");
      const nodes = [node, cell].filter(Boolean);
      return nodes.every((item) => item instanceof HTMLElement
        && isVisible(item)
        && isEnabled(item)
        && String(item.className || "").toLowerCase().indexOf("p-disabled") === -1
        && String(item.className || "").toLowerCase().indexOf("disabled") === -1
        && String(item.getAttribute("aria-disabled") || "").toLowerCase() !== "true");
    }

    function normalizeCalendarCellText(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    }

    function formatIsoDate(parts) {
      return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
    }

    return {
      setCalendarDate,
    };
  }

  root.calendarActions = Object.freeze({
    createCalendarActions,
  });
})();
