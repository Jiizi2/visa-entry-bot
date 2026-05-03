export async function runSetCalendarDate({
  page,
  selector,
  nth,
  rawValue,
  popupSelector = ".p-datepicker",
  timeout,
  skipWhenEmpty,
  normalizeDateToIso,
  waitForPageReady,
}) {
  if (!selector) {
    throw new Error("Step set_calendar_date butuh selector.");
  }
  if (!rawValue && skipWhenEmpty) {
    return;
  }
  if (!rawValue) {
    throw new Error("Step set_calendar_date butuh value tanggal.");
  }

  const isoDate = normalizeDateToIso(rawValue);
  if (!isoDate) {
    throw new Error(`Format tanggal tidak dikenali: ${rawValue}`);
  }

  const popup = String(popupSelector ?? ".p-datepicker").trim() || ".p-datepicker";
  const inputLocator = nth === null ? page.locator(selector).first() : page.locator(selector).nth(nth);
  await inputLocator.waitFor({ timeout, state: "visible" });
  const targetParts = isoDateParts(isoDate);
  console.log(`set_calendar_date: target ${isoDate}`);

  const preferredValues = [
    isoToSlashDate(isoDate),
    isoDate,
    isoToDisplayDMY(isoDate),
  ].filter(Boolean);
  const directApplied = await setDateInputDirectly(inputLocator, preferredValues, targetParts, timeout);
  if (directApplied) {
    console.log(`set_calendar_date: direct input applied (${directApplied})`);
    return;
  }

  for (let retry = 0; retry < 5; retry += 1) {
    await waitForPageReady(page, Math.min(timeout, 12000));
    await inputLocator.scrollIntoViewIfNeeded().catch(() => {});
    await inputLocator.click({ timeout });
    await sleep(page, 250);
    await page.locator(popup).first().waitFor({ timeout, state: "attached" });
    await sleep(page, 250);

    const navigated = await navigateCalendarToDate(page, popup, isoDate, timeout);
    if (!navigated) {
      console.log(`set_calendar_date: target day not found on attempt ${retry + 1}`);
      await sleep(page, 300);
      continue;
    }

    const dayLocator = locateEnabledCalendarDay(page, popup, isoDate).first();
    if ((await dayLocator.count()) === 0) {
      await sleep(page, 300);
      continue;
    }

    await dayLocator.scrollIntoViewIfNeeded().catch(() => {});
    await dayLocator.waitFor({ timeout, state: "visible" });
    await dayLocator.click({ timeout });
    await sleep(page, 350);

    const inputValue = String(await inputLocator.inputValue().catch(() => "")).trim();
    if (isPickedDateMatch(inputValue, targetParts)) {
      console.log(`set_calendar_date: selected ${inputValue}`);
      return;
    }
    console.log(`set_calendar_date: mismatch after click, got "${inputValue}", retrying...`);
  }

  await inputLocator.click({ timeout }).catch(() => {});
  await inputLocator.fill(preferredValues[0] || isoDate, { timeout }).catch(() => {});
  await inputLocator.press("Enter", { timeout }).catch(() => {});
  await inputLocator.dispatchEvent("input").catch(() => {});
  await inputLocator.dispatchEvent("change").catch(() => {});
  await inputLocator.dispatchEvent("blur").catch(() => {});
  await sleep(page, 250);
  const finalValue = String(await inputLocator.inputValue().catch(() => "")).trim();
  if (isPickedDateMatch(finalValue, targetParts)) {
    console.log(`set_calendar_date: fallback selected ${finalValue}`);
    return;
  }

  throw new Error(`Gagal set tanggal. Target ${isoDate}, nilai input saat ini "${finalValue || "-"}".`);
}

async function navigateCalendarToDate(page, popupSelector, isoDate, timeoutMs) {
  const target = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(target.getTime())) {
    return false;
  }
  const targetYear = target.getFullYear();
  const targetMonth = target.getMonth();

  for (let attempt = 0; attempt < 36; attempt += 1) {
    const yearPanelVisible = await isPanelVisible(page, `${popupSelector} .p-yearpicker`);
    if (yearPanelVisible) {
      const pickedYear = await pickCalendarYearFromOpenPanel(page, popupSelector, targetYear, timeoutMs);
      if (pickedYear) {
        await sleep(page, 220);
        continue;
      }
    }

    const dayLocator = locateEnabledCalendarDay(page, popupSelector, isoDate);
    if ((await dayLocator.count()) > 0) {
      return true;
    }

    const [monthText, yearText] = await Promise.all([
      firstText(page, [
        `${popupSelector} .p-datepicker-header .p-datepicker-title .p-datepicker-month`,
        `${popupSelector} .datepicker-header .title .month`,
      ]),
      firstText(page, [
        `${popupSelector} .p-datepicker-header .p-datepicker-title .p-datepicker-year`,
        `${popupSelector} .datepicker-header .title .year`,
      ]),
    ]);

    const currentMonth = monthNameToIndex(monthText);
    const currentYear = Number(String(yearText ?? "").trim());
    console.log(`set_calendar_date: calendar header "${String(monthText).trim()}" "${String(yearText).trim()}"`);
    if (currentMonth < 0 || !Number.isFinite(currentYear)) {
      break;
    }

    if (currentYear !== targetYear) {
      const pickedYear = await pickCalendarYear(page, popupSelector, targetYear, timeoutMs);
      if (pickedYear) {
        await sleep(page, 260);
        continue;
      }
    }

    if (currentMonth !== targetMonth) {
      const pickedMonth = await pickCalendarMonth(page, popupSelector, targetMonth, timeoutMs);
      if (pickedMonth) {
        await sleep(page, 260);
        continue;
      }
    }

    const nextDayLocator = locateEnabledCalendarDay(page, popupSelector, isoDate);
    if ((await nextDayLocator.count()) > 0) {
      return true;
    }

    const beforeIndex = currentYear * 12 + currentMonth;
    const targetIndex = targetYear * 12 + targetMonth;
    const moveForward = targetIndex > beforeIndex;
    const navSelectors = moveForward
      ? [
        `${popupSelector} .p-datepicker-header .p-datepicker-next:not([disabled])`,
        `${popupSelector} .datepicker-header .nav.next`,
      ]
      : [
        `${popupSelector} .p-datepicker-header .p-datepicker-prev:not([disabled])`,
        `${popupSelector} .datepicker-header .nav.prev`,
      ];
    let navButton = null;
    for (const selector of navSelectors) {
      const locator = page.locator(selector).first();
      if ((await locator.count()) > 0) {
        navButton = locator;
        break;
      }
    }
    if (!navButton) {
      break;
    }
    await navButton.waitFor({ timeout: timeoutMs, state: "visible" });
    await navButton.click({ timeout: timeoutMs });
    await sleep(page, 260);
  }

  return (await locateEnabledCalendarDay(page, popupSelector, isoDate).count()) > 0;
}

async function sleep(page, ms) {
  await page.waitForTimeout(Math.max(0, Number(ms) || 0));
}

function monthNameToIndex(value) {
  const key = String(value ?? "").trim().toLowerCase();
  const map = {
    january: 0, jan: 0,
    february: 1, feb: 1,
    march: 2, mar: 2,
    april: 3, apr: 3,
    may: 4,
    june: 5, jun: 5,
    july: 6, jul: 6,
    august: 7, aug: 7,
    september: 8, sep: 8,
    october: 9, oct: 9,
    november: 10, nov: 10,
    december: 11, dec: 11,
  };
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : -1;
}

function monthIndexToName(index) {
  return [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ][index] || "";
}

function parseDecadeRange(value) {
  const match = String(value ?? "")
    .replace(/\u2013/g, "-")
    .match(/(\d{4})\s*-\s*(\d{4})/);
  if (!match) {
    return null;
  }
  return { min: Number(match[1]), max: Number(match[2]) };
}

function locateEnabledCalendarDay(page, popupSelector, isoDate) {
  const candidates = isoDateCandidates(isoDate);
  const selector = candidates
    .map((candidate) =>
      `${popupSelector} td:not(.p-datepicker-other-month) span[data-date='${candidate}']:not(.p-disabled), ${popupSelector} td:not(.disabled) [data-date='${candidate}']:not(.disabled)`)
    .join(", ");
  return page.locator(selector);
}

function isoDateCandidates(isoDate) {
  const match = String(isoDate ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return [String(isoDate ?? "").trim()];
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  return [
    `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    `${y}-${m}-${d}`,
  ];
}

function isoDateParts(isoDate) {
  const match = String(isoDate ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function isoToSlashDate(isoDate) {
  const match = String(isoDate ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return "";
  }
  return `${match[1]}/${match[2]}/${match[3]}`;
}

function isoToDisplayDMY(isoDate) {
  const match = String(isoDate ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return "";
  }
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function isPickedDateMatch(value, targetParts) {
  if (!targetParts) {
    return false;
  }
  const text = String(value ?? "").trim();
  if (!text) {
    return false;
  }

  const normalized = text.replace(/\s+/g, "");
  const y = String(targetParts.year);
  const m = String(targetParts.month);
  const d = String(targetParts.day);
  const mm = String(targetParts.month).padStart(2, "0");
  const dd = String(targetParts.day).padStart(2, "0");

  const candidates = [
    `${y}-${m}-${d}`,
    `${y}-${mm}-${dd}`,
    `${y}/${m}/${d}`,
    `${y}/${mm}/${dd}`,
    `${d}-${m}-${y}`,
    `${dd}-${mm}-${y}`,
    `${d}/${m}/${y}`,
    `${dd}/${mm}/${y}`,
  ];
  return candidates.some((candidate) => normalized.includes(candidate));
}

async function setDateInputDirectly(inputLocator, candidateValues, targetParts, timeoutMs) {
  for (const candidate of candidateValues) {
    try {
      await inputLocator.fill(candidate, { timeout: timeoutMs });
      await inputLocator.press("Enter", { timeout: timeoutMs }).catch(() => {});
      await inputLocator.dispatchEvent("input").catch(() => {});
      await inputLocator.dispatchEvent("change").catch(() => {});
      await inputLocator.dispatchEvent("blur").catch(() => {});
      const after = String(await inputLocator.inputValue().catch(() => "")).trim();
      if (isPickedDateMatch(after, targetParts)) {
        return after || candidate;
      }
    } catch {
      // Try next format candidate.
    }
  }
  return "";
}

async function firstText(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0) {
      const text = await locator.textContent().catch(() => "");
      if (String(text ?? "").trim()) {
        return text;
      }
    }
  }
  return "";
}

async function pickCalendarYear(page, popupSelector, targetYear, timeoutMs) {
  const yearButton = page.locator(
    `${popupSelector} .p-datepicker-header .p-datepicker-title .p-datepicker-year, ${popupSelector} .datepicker-header .title .year`
  ).first();
  if ((await yearButton.count()) === 0) {
    return false;
  }

  await yearButton.click({ timeout: timeoutMs }).catch(() => {});
  return pickCalendarYearFromOpenPanel(page, popupSelector, targetYear, timeoutMs);
}

async function pickCalendarMonth(page, popupSelector, targetMonthIndex, timeoutMs) {
  const monthButton = page.locator(
    `${popupSelector} .p-datepicker-header .p-datepicker-title .p-datepicker-month, ${popupSelector} .datepicker-header .title .month`
  ).first();
  if ((await monthButton.count()) === 0) {
    return false;
  }

  await monthButton.click({ timeout: timeoutMs }).catch(() => {});
  const monthPanel = page.locator(`${popupSelector} .p-monthpicker`).first();
  if ((await monthPanel.count()) === 0) {
    return false;
  }
  await monthPanel.waitFor({ timeout: timeoutMs, state: "visible" }).catch(() => {});

  const targetMonthName = monthIndexToName(targetMonthIndex).toLowerCase();
  const monthItems = page.locator(`${popupSelector} .p-monthpicker .p-monthpicker-month`);
  const count = await monthItems.count();
  for (let i = 0; i < count; i += 1) {
    const item = monthItems.nth(i);
    const text = String(await item.textContent().catch(() => "")).trim().toLowerCase();
    const classes = String(await item.getAttribute("class").catch(() => ""));
    const textMonthIndex = monthNameToIndex(text);
    if ((text === targetMonthName || textMonthIndex === targetMonthIndex) && !classes.includes("p-disabled")) {
      await item.click({ timeout: timeoutMs });
      await page.waitForTimeout(120);
      return true;
    }
  }
  return false;
}

async function pickCalendarYearFromOpenPanel(page, popupSelector, targetYear, timeoutMs) {
  const yearPanel = page.locator(`${popupSelector} .p-yearpicker`).first();
  if ((await yearPanel.count()) === 0) {
    return false;
  }
  await yearPanel.waitFor({ timeout: timeoutMs, state: "visible" }).catch(() => {});

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const yearItems = page.locator(`${popupSelector} .p-yearpicker .p-yearpicker-year`);
    const count = await yearItems.count();
    let minYear = Number.POSITIVE_INFINITY;
    let maxYear = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < count; i += 1) {
      const item = yearItems.nth(i);
      const text = String(await item.textContent().catch(() => "")).trim();
      const yearNumber = Number(text);
      if (Number.isFinite(yearNumber)) {
        minYear = Math.min(minYear, yearNumber);
        maxYear = Math.max(maxYear, yearNumber);
      }
      const classes = String(await item.getAttribute("class").catch(() => ""));
      if (text === String(targetYear) && !classes.includes("p-disabled")) {
        await item.click({ timeout: timeoutMs });
        await sleep(page, 150);
        return true;
      }
    }

    const decadeText = String(await page
      .locator(`${popupSelector} .p-datepicker-title .p-datepicker-decade`)
      .first()
      .textContent()
      .catch(() => "")).trim();
    const decadeRange = parseDecadeRange(decadeText);
    const rangeMin = Number.isFinite(decadeRange?.min) ? decadeRange.min : minYear;
    const rangeMax = Number.isFinite(decadeRange?.max) ? decadeRange.max : maxYear;

    if (!Number.isFinite(rangeMin) || !Number.isFinite(rangeMax)) {
      return false;
    }
    if (targetYear >= rangeMin && targetYear <= rangeMax) {
      return false;
    }

    const goNext = targetYear > rangeMax;
    const navSelectors = goNext
      ? [
        `${popupSelector} .p-datepicker-header .p-datepicker-next[aria-label*='Decade']`,
        `${popupSelector} .p-datepicker-header .p-datepicker-next`,
      ]
      : [
        `${popupSelector} .p-datepicker-header .p-datepicker-prev[aria-label*='Decade']`,
        `${popupSelector} .p-datepicker-header .p-datepicker-prev`,
      ];

    let navButton = null;
    for (const selector of navSelectors) {
      const locator = page.locator(selector).first();
      if ((await locator.count()) > 0) {
        navButton = locator;
        break;
      }
    }
    if (!navButton) {
      return false;
    }

    await navButton.waitFor({ timeout: timeoutMs, state: "visible" });
    await navButton.click({ timeout: timeoutMs });
    await sleep(page, 180);
  }

  return false;
}

async function isPanelVisible(page, selector) {
  const locator = page.locator(selector).first();
  if ((await locator.count()) === 0) {
    return false;
  }
  return locator.isVisible().catch(() => false);
}

