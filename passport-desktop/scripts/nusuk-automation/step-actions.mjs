import path from "node:path";
import { deepValue, interpolate, normalizeDateToIso, normalizeOption, pickFirstNonEmpty } from "./core-utils.mjs";
import { runSetCalendarDate } from "./calendar-utils.mjs";
import { findPrimeNgDropdownOption, trySelectNativeByText } from "./dropdown-utils.mjs";

const NEXT_BUTTON_CANDIDATE_SELECTORS = [
  ".d-flex.justify-content-end.align-items-center.gap-3 > button.btn.btn-primary:has-text('Next')",
  "action-btns.custom-action-buttons .d-flex.justify-content-end.align-items-center.gap-3 > button.btn.btn-primary:has-text('Next')",
  "action-btns.custom-action-buttons button.btn.btn-primary:has-text('Next')",
  "action-btns button.btn.btn-primary:has-text('Next')",
  ".action-buttons .navigation-buttons button:has-text('Next')",
];
const VERBOSE_STEP_LOG = false;
const VACCINATION_FILE_INPUT_SELECTOR = [
  "input[type='file'][formcontrolname*='vaccination' i]",
  "input[type='file'][name*='vaccination' i]",
  "input[type='file'][id*='vaccination' i]",
  "input[type='file'][formcontrolname*='vaccine' i]",
  "input[type='file'][name*='vaccine' i]",
  "input[type='file'][id*='vaccine' i]",
  "input[type='file'][formcontrolname*='vaccin' i]",
  "input[type='file'][name*='vaccin' i]",
  "input[type='file'][id*='vaccin' i]",
  "input[type='file'][formcontrolname*='immun' i]",
  "input[type='file'][name*='immun' i]",
  "input[type='file'][id*='immun' i]",
].join(", ");
const LAST_PERSONAL_AUTOFILL_AT = new WeakMap();

function fallbackValueForField(action, selector, context) {
  const member = context?.member ?? {};
  const rs = member?.resolvedProfile ?? {};
  const pe = member?.passportExtracted ?? {};
  const normalizedSelector = String(selector ?? "").toLowerCase();

  if (action === "fill") {
    if (normalizedSelector.includes("first name (arabic)")) {
      return pickFirstNonEmpty(rs?.arabic?.firstName, rs?.firstName, pe?.firstName);
    }
    if (normalizedSelector.includes("family name (arabic)")) {
      return pickFirstNonEmpty(rs?.arabic?.familyName, rs?.familyName, pe?.familyName);
    }
    if (normalizedSelector.includes("profession")) {
      return pickFirstNonEmpty(rs?.profession, "BUSINESS");
    }
    if (normalizedSelector.includes("birth city")) {
      return pickFirstNonEmpty(rs?.birthCity, pe?.birthCity, pe?.cityOfIssued, rs?.cityOfIssued, "UNKNOWN");
    }
    if (normalizedSelector.includes("placeholder='email'") || normalizedSelector.includes("formcontrolname='email'")) {
      return pickFirstNonEmpty(rs?.email, "example@gmail.com");
    }
  }

  if (action === "select_primeng_dropdown") {
    if (normalizedSelector.includes("birthcountryid")) {
      return pickFirstNonEmpty(rs?.birthCountry, rs?.nationality, pe?.nationality, "INDONESIA");
    }
    if (normalizedSelector.includes("martialstatusid") || normalizedSelector.includes("maritalstatusid")) {
      return pickFirstNonEmpty(rs?.maritalStatus, "SINGLE");
    }
  }

  if (action === "set_phone_fields") {
    return pickFirstNonEmpty(rs?.mobileNumber, "+628123456789");
  }

  return "";
}

async function runStep(page, rawStep, context, defaultTimeout) {
  const step = rawStep && typeof rawStep === "object" ? rawStep : {};
  const action = String(step.action ?? "").trim().toLowerCase();
  const selector = interpolate(step.selector ?? "", context);
  const timeout = Number(step.timeout_ms ?? defaultTimeout);
  const speedFactor = resolveSpeedFactor(context?.speedFactor);
  const nth = Number.isInteger(Number(step.nth)) ? Number(step.nth) : null;
  const skipWhenEmpty = Boolean(step.skip_when_empty);
  const stepIndex = Number(context?.index ?? -1);

  if (action && VERBOSE_STEP_LOG) {
    const selectorPreview = String(selector || "-").slice(0, 140);
    console.log(`step[${stepIndex}] start action=${action} selector="${selectorPreview}"`);
  }

  if (!action) {
    return;
  }

  if (action === "fill_arabic_minimal") {
    const firstValue = interpolate(step.first_value ?? "", context).trim()
      || pickFirstNonEmpty(context?.member?.resolvedProfile?.firstName, context?.member?.passportExtracted?.firstName);
    const familyValue = interpolate(step.family_value ?? "", context).trim()
      || pickFirstNonEmpty(context?.member?.resolvedProfile?.familyName, context?.member?.passportExtracted?.familyName);

    if (!firstValue || !familyValue) {
      throw new Error("fill_arabic_minimal butuh first_value dan family_value.");
    }

    const result = await page.evaluate((payload) => {
      const normalize = (value) => String(value ?? "").trim().toLowerCase();
      const findInput = (matcher) => {
        const inputs = Array.from(document.querySelectorAll("input"));
        for (const input of inputs) {
          const placeholder = normalize(input.getAttribute("placeholder"));
          const name = normalize(input.getAttribute("name"));
          const formControlName = normalize(input.getAttribute("formcontrolname"));
          const visible = input.offsetParent !== null;
          if (!visible) {
            continue;
          }
          if (matcher({ placeholder, name, formControlName })) {
            return input;
          }
        }
        return null;
      };

      const firstInput = findInput(({ placeholder, name, formControlName }) =>
        placeholder.includes("first name (arabic)")
        || (placeholder.includes("first") && placeholder.includes("arabic"))
        || (name === "ar" && formControlName === "ar")
      );
      const familyInput = findInput(({ placeholder, name, formControlName }) =>
        placeholder.includes("family name (arabic)")
        || (placeholder.includes("family") && placeholder.includes("arabic"))
        || (name === "ar" && formControlName === "ar")
      );

      const apply = (input, value) => {
        if (!input) {
          return false;
        }
        input.focus();
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.dispatchEvent(new Event("blur", { bubbles: true }));
        return true;
      };

      const firstOk = apply(firstInput, payload.firstValue);
      const familyOk = apply(familyInput, payload.familyValue);
      return { firstOk, familyOk };
    }, { firstValue, familyValue });

    console.log(`fill_arabic_minimal: firstOk=${result?.firstOk ? "yes" : "no"} familyOk=${result?.familyOk ? "yes" : "no"}`);
    if (!result?.firstOk || !result?.familyOk) {
      throw new Error("fill_arabic_minimal gagal menemukan input Arabic yang visible.");
    }
    return;
  }

  if (action === "wait") {
    const waitMs = Number(step.ms ?? 500);
    await page.waitForTimeout(Math.max(0, Math.round(waitMs * speedFactor)));
    return;
  }

  if (action === "wait_for_selector") {
    if (!selector) {
      throw new Error("Step wait_for_selector butuh selector.");
    }
    const locator = nth === null ? page.locator(selector).first() : page.locator(selector).nth(nth);
    const configuredState = String(step.wait_state ?? "").trim().toLowerCase();
    const isFileInput = /input\s*\[\s*type\s*=\s*['"]?file['"]?\s*\]/i.test(selector);
    const waitState = configuredState || (isFileInput ? "attached" : "visible");
    await locator.waitFor({ timeout, state: waitState });
    if (waitState === "visible" || waitState === "attached") {
      await waitForPageReady(page, Math.min(timeout, 7000), speedFactor);
      await waitForFormSettle(page, Math.min(timeout, 5000), speedFactor);
    }
    return;
  }

  if (!["wait", "wait_for_selector"].includes(action)) {
    await waitForPageReady(page, Math.min(timeout, 10000), speedFactor);
    if (["fill", "select_primeng_dropdown", "set_phone_fields", "set_files", "set_calendar_date"].includes(action)) {
      await waitForFormSettle(page, Math.min(timeout, 7000), speedFactor);
    }
    await humanDelayBeforeAction(page, action, speedFactor);
  }

  if (action === "wait_for_enabled") {
    if (!selector) {
      throw new Error("Step wait_for_enabled butuh selector.");
    }
    if (isLikelyNextSelector(selector)) {
      await attemptFillRequiredFieldsForCurrentPage(page, context, timeout);
      const nextButton = await findUsableNextButton(page, timeout);
      if (!nextButton) {
        throw new Error("Tombol Next tidak ditemukan dalam kondisi aktif.");
      }
      return;
    }
    const locator = nth === null ? page.locator(selector).first() : page.locator(selector).nth(nth);
    await locator.waitFor({ timeout });
    await waitForElementEnabled(locator, timeout);
    return;
  }

  if (action === "click") {
    if (!selector) {
      throw new Error("Step click butuh selector.");
    }
    if (isLikelyNextSelector(selector)) {
      await attemptFillRequiredFieldsForCurrentPage(page, context, timeout);
      const clicked = await clickNextButtonRobust(page, timeout);
      if (!clicked) {
        throw new Error("Klik tombol Next gagal walau tombol ditemukan.");
      }
      return;
    }
    if (isLikelyProceedSelector(selector)) {
      const clicked = await clickProceedButtonRobust(page, timeout);
      if (!clicked) {
        throw new Error("Klik tombol Proceed gagal walau tombol ditemukan.");
      }
      return;
    }
    const locator = nth === null ? page.locator(selector).first() : page.locator(selector).nth(nth);
    await locator.click({ timeout });
    return;
  }

  if (action === "fill") {
    if (!selector) {
      throw new Error("Step fill butuh selector.");
    }
    let value = interpolate(step.value ?? "", context);
    if (!String(value ?? "").trim()) {
      value = fallbackValueForField(action, selector, context);
    }
    if (!String(value ?? "").trim() && skipWhenEmpty) {
      return;
    }
    if (!String(value ?? "").trim()) {
      throw new Error(`Nilai kosong untuk field wajib selector: ${selector}`);
    }
    const locator = await pickFirstVisibleLocator(page, selector, nth, timeout);
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await locator.waitFor({ timeout, state: "visible" });
    await locator.fill(value, { timeout });
    let after = String(await locator.inputValue().catch(() => "")).trim();
    if (!after) {
      await waitForFormSettle(page, Math.min(timeout, 5000), speedFactor);
      await locator.fill(value, { timeout }).catch(() => {});
      after = String(await locator.inputValue().catch(() => "")).trim();
    }
    if (after) {
      await sleep(page, Math.max(80, Math.round(260 * speedFactor)));
      const persisted = String(await locator.inputValue().catch(() => "")).trim();
      if (!persisted) {
        await waitForFormSettle(page, Math.min(timeout, 5000), speedFactor);
        await locator.fill(value, { timeout }).catch(() => {});
        after = String(await locator.inputValue().catch(() => "")).trim();
      }
    }
    if (!after && !skipWhenEmpty) {
      throw new Error(`Field tidak tersimpan setelah diisi: ${selector}`);
    }
    return;
  }

  if (action === "set_phone_fields") {
    let rawValue = interpolate(step.value ?? "", context).trim();
    if (!rawValue) {
      rawValue = fallbackValueForField(action, selector, context);
    }
    if (!rawValue && skipWhenEmpty) {
      return;
    }
    if (!rawValue) {
      throw new Error("Step set_phone_fields butuh value nomor telepon.");
    }
    const inputSelector = selector
      || "input[formcontrolname='phone'], input[name='phone'], input[formcontrolname='mobileNumber'], input[name='mobileNumber'], input[placeholder='Mobile Number'], input[placeholder='Phone Number'], input[placeholder*='Phone'], input[placeholder*='Mobile'], input[type='tel'], ngx-intl-tel-input input";
    const filled = await fillPhoneFields(page, inputSelector, rawValue, timeout);
    if (!filled?.ok) {
      throw new Error(String(filled?.reason || "Gagal set phone fields."));
    }
    console.log(`phone_fields: selectedCode=${filled.selectedCode || "-"} local=${filled.localNumber || "-"}`);
    return;
  }

  if (action === "press") {
    if (!selector) {
      throw new Error("Step press butuh selector.");
    }
    const key = String(step.key ?? "Enter");
    const locator = nth === null ? page.locator(selector).first() : page.locator(selector).nth(nth);
    await locator.press(key, { timeout });
    return;
  }

  if (action === "select") {
    if (!selector) {
      throw new Error("Step select butuh selector.");
    }
    const value = interpolate(step.value ?? "", context);
    const locator = nth === null ? page.locator(selector).first() : page.locator(selector).nth(nth);
    await locator.selectOption({ value }, { timeout });
    return;
  }

  if (action === "set_files") {
    if (!selector) {
      throw new Error("Step set_files butuh selector.");
    }
    const rawValue = interpolate(step.value ?? "", context).trim();
    if (!rawValue && skipWhenEmpty) {
      return;
    }
    if (!rawValue) {
      throw new Error("Step set_files butuh path file di value.");
    }
    const absoluteFilePath = resolveUploadFilePath(rawValue, context);
    const isInitialPassportUploadSelector = selector.includes("container__notes__upload__button");
    const effectiveSelector = isInitialPassportUploadSelector
      ? ".container__notes__upload__button input[type='file']"
      : selector;
    const targetKind = /vaccin|vaccine|immun/i.test(effectiveSelector)
      ? "vaccination"
      : (/personalpicture/i.test(effectiveSelector) ? "personal" : "");
    const locator = await pickFileInputLocator(page, effectiveSelector, nth, targetKind, timeout);
    await locator.waitFor({ timeout, state: "attached" });
    const pickedInputMeta = await locator.evaluate((el) => ({
      name: String(el.getAttribute("name") || ""),
      id: String(el.getAttribute("id") || ""),
      formcontrolname: String(el.getAttribute("formcontrolname") || ""),
      className: String(el.getAttribute("class") || ""),
      nearbyLabel: String(
        el.closest("div, td, tr, form")?.querySelector("label")?.textContent
        || el.closest("label")?.textContent
        || ""
      ).replace(/\s+/g, " ").trim(),
    })).catch(() => ({}));
    console.log(`set_files: kind=${targetKind || "generic"} target=${JSON.stringify(pickedInputMeta)}`);
    await locator.setInputFiles(absoluteFilePath, { timeout });
    if (targetKind === "vaccination") {
      await commitScopedUpload(page, targetKind, timeout).catch(() => {});
    }
    await waitForFormSettle(page, Math.min(timeout, 6000), speedFactor).catch(() => {});
    return;
  }

  if (action === "set_calendar_date") {
    const rawValue = interpolate(step.value ?? "", context).trim();
    await runSetCalendarDate({
      page,
      selector,
      nth,
      rawValue,
      popupSelector: String(step.popup_selector ?? ".p-datepicker").trim() || ".p-datepicker",
      timeout,
      skipWhenEmpty,
      normalizeDateToIso,
      waitForPageReady,
    });
    return;
  }

  if (action === "select_primeng_dropdown") {
    if (!selector) {
      throw new Error("Step select_primeng_dropdown butuh selector.");
    }

    let optionText = interpolate(step.option_text ?? "", context).trim();
    if (!optionText) {
      optionText = fallbackValueForField(action, selector, context);
    }
    const skipWhenEmpty = Boolean(step.skip_when_empty);
    if (!optionText) {
      if (skipWhenEmpty) {
        return;
      }
      throw new Error("Step select_primeng_dropdown butuh option_text.");
    }

    const optionKind = String(step.option_kind ?? "");
    const nativeSelected = await trySelectNativeByText(page, selector, optionText, optionKind, nth);
    if (nativeSelected) {
      return;
    }

    const trigger = await pickFirstVisibleLocator(page, selector, nth, timeout);
    await trigger.waitFor({ timeout, state: "visible" });

    const currentLabel = String(await trigger.locator(".p-dropdown-label").first().innerText().catch(() => ""))
      .trim()
      .toLowerCase();
    const normalizedTarget = normalizeOption(optionText);
    const looksPlaceholder = !currentLabel
      || currentLabel.includes("select")
      || currentLabel.includes("previous nationality")
      || currentLabel.includes("passport type")
      || currentLabel.includes("birth country")
      || currentLabel.includes("marital status")
      || currentLabel.includes("martial status");
    if (!looksPlaceholder && normalizeOption(currentLabel) === normalizedTarget) {
      return;
    }

    await page.keyboard.press("Escape").catch(() => {});
    await sleep(page, 80);

    let triggerClicked = false;
    for (const clicker of [
      async () => trigger.click({ timeout }),
      async () => trigger.click({ timeout, force: true }),
      async () => trigger.evaluate((el) => el?.click?.()),
    ]) {
      try {
        await clicker();
        triggerClicked = true;
        break;
      } catch {
        // try next strategy
      }
    }
    if (!triggerClicked) {
      throw new Error(`Gagal membuka dropdown untuk selector: ${selector}`);
    }

    const optionLocator = await findPrimeNgDropdownOption(page, optionText, optionKind, timeout).catch(() => null);
    if (!optionLocator) {
      const clickedByDom = await clickPrimeNgOptionDom(page, optionText, optionKind, timeout);
      if (clickedByDom) {
        return;
      }

      const currentLabelAfter = String(await trigger.locator(".p-dropdown-label").first().innerText().catch(() => ""))
        .trim();
      const afterNorm = normalizeOption(currentLabelAfter);
      const targetNorm = normalizeOption(optionText);
      if (afterNorm && afterNorm === targetNorm) {
        console.log(`dropdown: nilai sudah sesuai "${currentLabelAfter}", lanjut.`);
        return;
      }

      if (optionKind === "passport_type") {
        const fallbackOption = page.locator(
          ".p-dropdown-panel .p-dropdown-item:not(.p-disabled):not(.p-hidden):not(.p-dropdown-empty-message), .p-dropdown-panel [role='option']:not(.p-disabled)"
        ).first();
        if ((await fallbackOption.count()) > 0) {
          const fallbackText = String(await fallbackOption.innerText().catch(() => "")).trim();
          if (fallbackText && !/no results found/i.test(fallbackText) && !/select/i.test(fallbackText)) {
            await fallbackOption.click({ timeout }).catch(() => {});
            console.log(`dropdown: passport_type fallback pakai opsi pertama "${fallbackText}"`);
            return;
          }
        }
        throw new Error(`passport_type wajib, tapi opsi tidak tersedia. Target "${optionText}" tidak ditemukan.`);
      }

      // Jangan hentikan seluruh flow ketika panel dropdown kosong sesaat.
      console.log(`dropdown: panel kosong untuk target "${optionText}", step dilewati sementara.`);
      await page.keyboard.press("Escape").catch(() => {});
      return;
    }
    await optionLocator.waitFor({ timeout }).catch(() => {});
    try {
      await optionLocator.click({ timeout });
    } catch {
      const clickedByDom = await clickPrimeNgOptionDom(page, optionText, optionKind, timeout);
      if (!clickedByDom) {
        throw new Error(`Gagal memilih opsi dropdown "${optionText}" karena elemen tidak stabil.`);
      }
    }
    return;
  }

  if (action === "check") {
    if (!selector) {
      throw new Error("Step check butuh selector.");
    }
    const locator = nth === null ? page.locator(selector).first() : page.locator(selector).nth(nth);
    await locator.check({ timeout });
    return;
  }

  if (action === "uncheck") {
    if (!selector) {
      throw new Error("Step uncheck butuh selector.");
    }
    const locator = nth === null ? page.locator(selector).first() : page.locator(selector).nth(nth);
    await locator.uncheck({ timeout });
    return;
  }

  if (action === "select_native_by_text") {
    if (!selector) {
      throw new Error("Step select_native_by_text butuh selector.");
    }
    const optionText = interpolate(step.option_text ?? "", context).trim();
    const optionKind = String(step.option_kind ?? "");
    if (!optionText && skipWhenEmpty) {
      return;
    }
    if (!optionText) {
      throw new Error("Step select_native_by_text butuh option_text.");
    }

    const selected = await trySelectNativeByText(page, selector, optionText, optionKind, nth);

    if (!selected) {
      throw new Error(`Opsi select native tidak ditemukan: ${optionText}`);
    }
    return;
  }

  if (action === "set_disclosure_all_no") {
    const baseSelector = selector || ".card";
    const applied = await page.evaluate((rawSelector) => {
      const cards = Array.from(document.querySelectorAll(rawSelector));
      const targetCard = cards.find((card) => {
        const title = card.querySelector(".title");
        return String(title?.textContent ?? "")
          .trim()
          .toLowerCase()
          .includes("disclosure form");
      });

      if (!targetCard) {
        return { ok: false, reason: "Disclosure Form card tidak ditemukan." };
      }

      const groups = {};
      const radios = Array.from(targetCard.querySelectorAll("input[type='radio'][name]"));
      for (const radio of radios) {
        const name = String(radio.getAttribute("name") ?? "").trim();
        if (!name) {
          continue;
        }
        if (!groups[name]) {
          groups[name] = [];
        }
        groups[name].push(radio);
      }

      const failed = [];
      for (const [name, groupRadios] of Object.entries(groups)) {
        let picked = false;
        for (const radio of groupRadios) {
          const labelText = String(radio.closest("label")?.textContent ?? "")
            .trim()
            .toLowerCase();
          if (labelText === "no" || labelText.includes(" no")) {
            radio.click();
            picked = true;
            break;
          }
        }

        if (!picked && groupRadios.length >= 2) {
          groupRadios[1].click();
          picked = true;
        }

        const active = groupRadios.some((radio) => radio.checked);
        if (!picked || !active) {
          failed.push(name);
        }
      }

      if (failed.length) {
        return { ok: false, reason: `Gagal set No pada: ${failed.join(", ")}` };
      }
      return { ok: true, total: Object.keys(groups).length };
    }, baseSelector);

    if (!applied?.ok) {
      throw new Error(String(applied?.reason || "Gagal mengisi Disclosure Form."));
    }
    return;
  }

  if (action === "click_success_popup_action") {
    const remaining = Number(context.totalMembers ?? 0) - (Number(context.memberIndex ?? 0) + 1);
    const useAddAnother = remaining > 0;
    const buttonSelector = useAddAnother
      ? ".popup .popup-actions button:has-text('Add Another Mutamer')"
      : ".popup .popup-actions button:has-text('Go To Mutamer List')";

    const locator = page.locator(buttonSelector).first();
    await locator.waitFor({ timeout });
    await waitForElementEnabled(locator, timeout);
    await locator.click({ timeout });
    return;
  }

  if (action === "goto") {
    const url = interpolate(step.url ?? "", context);
    if (!url) {
      throw new Error("Step goto butuh url.");
    }
    await page.goto(url, { waitUntil: "domcontentloaded", timeout });
    return;
  }

  throw new Error(`Action tidak dikenal: ${action}`);
}

function resolveSpeedFactor(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.min(1.2, Math.max(0.5, parsed));
}

async function waitForPageReady(page, timeoutMs, speedFactor = 1) {
  const safeFactor = resolveSpeedFactor(speedFactor);
  const maxWait = Math.max(900, Number(timeoutMs) || 5000);
  const deadline = Date.now() + maxWait;

  await page.waitForLoadState("domcontentloaded", { timeout: maxWait }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: Math.min(4000, maxWait) }).catch(() => {});

  let stableHit = 0;
  let previousSig = "";
  while (Date.now() < deadline) {
    const snapshot = await readUiStabilitySnapshot(page);
    const signature = `${snapshot.readyState}|${snapshot.blockingOverlays}|${snapshot.busyNodes}|${snapshot.visibleControls}|${snapshot.ngInvalidForms}|${snapshot.path}`;
    const readyStateOk = snapshot.readyState === "complete" || snapshot.readyState === "interactive";
    const blockingOk = snapshot.blockingOverlays === 0 && snapshot.busyNodes === 0;

    if (readyStateOk && blockingOk && signature === previousSig) {
      stableHit += 1;
      if (stableHit >= 2) {
        return;
      }
    } else {
      stableHit = 0;
      previousSig = signature;
    }
    await sleep(page, Math.max(90, Math.round(220 * safeFactor)));
  }
}

async function sleep(page, ms) {
  await page.waitForTimeout(Math.max(0, Number(ms) || 0));
}

async function waitForFormSettle(page, timeoutMs, speedFactor = 1) {
  const safeFactor = resolveSpeedFactor(speedFactor);
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 3500);
  let stableHit = 0;
  let previousMetric = "";
  while (Date.now() < deadline) {
    const snapshot = await readUiStabilitySnapshot(page);
    const metric = `${snapshot.blockingOverlays}|${snapshot.busyNodes}|${snapshot.visibleControls}|${snapshot.ngInvalidForms}|${snapshot.path}`;
    const blocking = snapshot.blockingOverlays + snapshot.busyNodes;

    if (blocking === 0 && metric && metric === previousMetric) {
      stableHit += 1;
      if (stableHit >= 3) {
        return;
      }
    } else {
      stableHit = 0;
      previousMetric = metric;
    }
    await sleep(page, Math.max(100, Math.round(260 * safeFactor)));
  }
}

async function readUiStabilitySnapshot(page) {
  return page.evaluate(() => {
    const isVisible = (el) => {
      if (!(el instanceof HTMLElement)) {
        return false;
      }
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };

    const blockingSelectors = [
      ".p-component-overlay",
      ".loading",
      ".spinner",
      ".ngx-spinner-overlay",
      "[aria-busy='true']",
      ".cdk-overlay-backdrop.cdk-overlay-backdrop-showing",
    ];
    let blockingOverlays = 0;
    for (const sel of blockingSelectors) {
      const nodes = Array.from(document.querySelectorAll(sel)).filter((n) => isVisible(n));
      blockingOverlays += nodes.length;
    }

    const busyNodes = Array.from(document.querySelectorAll("[aria-busy='true']")).filter((n) => isVisible(n)).length;
    const visibleControls = Array.from(document.querySelectorAll("form input, form select, form textarea"))
      .filter((el) => isVisible(el))
      .length;
    const ngInvalidForms = document.querySelectorAll("form.ng-invalid").length;

    return {
      readyState: String(document.readyState || ""),
      blockingOverlays,
      busyNodes,
      visibleControls,
      ngInvalidForms,
      path: `${location.pathname || ""}${location.hash || ""}`,
    };
  }).catch(() => ({
    readyState: "unknown",
    blockingOverlays: 0,
    busyNodes: 0,
    visibleControls: 0,
    ngInvalidForms: 0,
    path: "",
  }));
}

async function humanDelayBeforeAction(page, action, speedFactor = 1) {
  const safeFactor = resolveSpeedFactor(speedFactor);
  const name = String(action ?? "").trim().toLowerCase();
  if (!name || name === "wait" || name === "wait_for_selector") {
    return;
  }

  let base = 160;
  let jitter = 180;
  if (name === "click" || name === "select_primeng_dropdown" || name === "set_calendar_date") {
    base = 260;
    jitter = 260;
  } else if (name === "set_files") {
    base = 380;
    jitter = 320;
  }
  const randomizedMs = base + Math.floor(Math.random() * jitter);
  await sleep(page, Math.max(60, Math.round(randomizedMs * safeFactor)));
}

async function waitForElementEnabled(locator, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await locator.isEnabled()) {
        return;
      }
    } catch {
      // Ignore transient detached node during UI rerender.
    }
    await locator.page().waitForTimeout(250);
  }
  throw new Error("Elemen tetap disabled sampai timeout.");
}

async function pickFirstVisibleLocator(page, selector, nth, timeoutMs) {
  if (nth !== null) {
    return page.locator(selector).nth(nth);
  }

  const locator = page.locator(selector);
  const deadline = Date.now() + Math.max(800, Number(timeoutMs) || 2000);
  while (Date.now() < deadline) {
    const count = await locator.count().catch(() => 0);
    for (let i = 0; i < count; i += 1) {
      const candidate = locator.nth(i);
      const visible = await candidate.isVisible().catch(() => false);
      if (visible) {
        return candidate;
      }
    }
    await sleep(page, 120);
  }

  return locator.first();
}

async function pickFileInputLocator(page, selector, nth, targetKind, timeoutMs) {
  if (nth !== null) {
    return page.locator(selector).nth(nth);
  }

  // Strict targeting for personal/vaccination to avoid accidental upload to Iqama.
  if (targetKind === "vaccination" || targetKind === "personal") {
    const strictSelector = targetKind === "vaccination"
      ? VACCINATION_FILE_INPUT_SELECTOR
      : "input[type='file'][formcontrolname*='passport' i], input[type='file'][name*='passport' i], input[type='file'][id*='passport' i], input[type='file'][formcontrolname*='personal' i], input[type='file'][name*='personal' i], input[type='file'][id*='personal' i]";
    const strictLocator = page.locator(strictSelector);
    const strictCount = await strictLocator.count().catch(() => 0);
    if (strictCount > 0) {
      return strictLocator.first();
    }

    const markerId = `nusuk-file-target-${targetKind}-${Date.now()}`;
    const marked = await page.evaluate((payload) => {
      const kind = String(payload?.targetKind || "");
      const marker = String(payload?.markerId || "");

      for (const old of Array.from(document.querySelectorAll("[data-nusuk-file-target]"))) {
        old.removeAttribute("data-nusuk-file-target");
      }

      const normalize = (v) => String(v || "").toLowerCase().replace(/\s+/g, " ").trim();
      const classifyInput = (input) => {
        const own = normalize([
          input.getAttribute("name"),
          input.getAttribute("id"),
          input.getAttribute("formcontrolname"),
          input.className,
        ].filter(Boolean).join(" "));
        const ctx = input.closest("div, td, tr, form");
        const labelText = normalize(
          input.closest("label")?.textContent
          || ctx?.querySelector("label")?.textContent
          || ""
        );
        const all = `${own} ${labelText}`;
        if (/iqama|residency/.test(all)) {
          return "iqama";
        }
        if (/vaccination/.test(all)) {
          return "vaccination";
        }
        if (/personal picture|passport image|passport|personal/.test(all)) {
          return "personal";
        }
        return "unknown";
      };

      const pickByDistance = (inputs, labelNode) => {
        if (!inputs.length) {
          return null;
        }
        const labelRect = labelNode.getBoundingClientRect();
        let best = null;
        let bestScore = Number.POSITIVE_INFINITY;
        for (const input of inputs) {
          const rect = input.getBoundingClientRect();
          const dy = Math.abs((rect.top + rect.height / 2) - (labelRect.top + labelRect.height / 2));
          const dx = Math.abs((rect.left + rect.width / 2) - (labelRect.left + labelRect.width / 2));
          const score = (dy * 1.3) + dx;
          if (score < bestScore) {
            best = input;
            bestScore = score;
          }
        }
        return best;
      };

      const firstFileInputAfterNode = (root, startNode) => {
        if (!root || !startNode) {
          return null;
        }
        const all = Array.from(root.querySelectorAll("input[type='file']"));
        for (const input of all) {
          const pos = startNode.compareDocumentPosition(input);
          // Node appears after startNode in document order
          if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
            return input;
          }
        }
        return null;
      };

      const labels = Array.from(document.querySelectorAll("label, .dynamic-field__label, .field-label"));
      const wanted = kind === "vaccination"
        ? /(vaccination\s*certificate|vaccination)/i
        : /(personal\s*picture|passport\s*image)/i;
      const labelNode = labels.find((node) => wanted.test(String(node.textContent || "")));
      const form = labelNode?.closest("form") || document;
      const allInputs = Array.from(form.querySelectorAll("input[type='file']"))
        .filter((input) => input instanceof HTMLInputElement);
      if (!allInputs.length) {
        return false;
      }

      const typed = allInputs.map((input) => ({ input, type: classifyInput(input) }));
      const wantedExact = kind === "vaccination" ? "vaccination" : "personal";
      const exactMatches = typed.filter((row) => row.type === wantedExact).map((row) => row.input);
      const nonIqama = typed.filter((row) => row.type !== "iqama").map((row) => row.input);

      let picked = null;

      // Strong rule for vaccination: choose the first file input that appears
      // AFTER "Vaccination Certificate" label in DOM order.
      if (kind === "vaccination" && labelNode) {
        const afterLabel = firstFileInputAfterNode(form, labelNode);
        if (afterLabel instanceof HTMLInputElement) {
          const t = classifyInput(afterLabel);
          if (t !== "iqama") {
            picked = afterLabel;
          }
        }
      }

      if (labelNode) {
        if (!(picked instanceof HTMLInputElement)) {
          picked = pickByDistance(exactMatches.length ? exactMatches : nonIqama, labelNode);
        }
      }

      // Positional fallback: with 3 upload slots, middle is usually Iqama (skip it).
      if (!(picked instanceof HTMLInputElement)) {
        const safeList = nonIqama.length ? nonIqama : allInputs;
        if (safeList.length >= 3) {
          picked = kind === "vaccination" ? safeList[safeList.length - 1] : safeList[0];
        } else if (safeList.length >= 2) {
          picked = kind === "vaccination" ? safeList[safeList.length - 1] : safeList[0];
        } else {
          picked = safeList[0] || allInputs[0] || null;
        }
      }

      if (picked instanceof HTMLInputElement) {
        picked.setAttribute("data-nusuk-file-target", marker);
        return true;
      }
      return false;
    }, { targetKind, markerId }).catch(() => false);

    if (marked) {
      const markedLocator = page.locator(`input[type='file'][data-nusuk-file-target='${markerId}']`).first();
      if ((await markedLocator.count().catch(() => 0)) > 0) {
        const debugSnapshot = await page.evaluate(() => {
          const normalize = (v) => String(v || "").toLowerCase().replace(/\s+/g, " ").trim();
          const classifyInput = (input) => {
            const own = normalize([
              input.getAttribute("name"),
              input.getAttribute("id"),
              input.getAttribute("formcontrolname"),
              input.className,
            ].filter(Boolean).join(" "));
            const ctx = input.closest("div, td, tr, form");
            const labelText = normalize(
              input.closest("label")?.textContent
              || ctx?.querySelector("label")?.textContent
              || ""
            );
            const all = `${own} ${labelText}`;
            if (/iqama|residency/.test(all)) return "iqama";
            if (/vaccination/.test(all)) return "vaccination";
            if (/personal picture|passport image|passport|personal/.test(all)) return "personal";
            return "unknown";
          };
          const inputs = Array.from(document.querySelectorAll("input[type='file']")).map((input, idx) => ({
            idx,
            classType: classifyInput(input),
            name: String(input.getAttribute("name") || ""),
            id: String(input.getAttribute("id") || ""),
            formcontrolname: String(input.getAttribute("formcontrolname") || ""),
            hasMarker: input.hasAttribute("data-nusuk-file-target"),
          }));
          return inputs.slice(0, 12);
        }).catch(() => []);
        console.log(`set_files_candidates: ${JSON.stringify(debugSnapshot)}`);
        return markedLocator;
      }
    }

    throw new Error(
      targetKind === "vaccination"
        ? "Input upload Vaccination Certificate tidak ditemukan (strict mode)."
        : "Input upload Personal/Passport Picture tidak ditemukan (strict mode)."
    );
  }

  const direct = page.locator(selector);
  const directCount = await direct.count().catch(() => 0);
  if (directCount > 0) {
    return direct.first();
  }

  const specificSelector = targetKind === "vaccination"
    ? VACCINATION_FILE_INPUT_SELECTOR
    : (targetKind === "personal"
      ? "input[type='file'][formcontrolname*='personal' i], input[type='file'][name*='personal' i]"
      : "");
  if (specificSelector) {
    const specific = page.locator(specificSelector);
    const specificCount = await specific.count().catch(() => 0);
    if (specificCount > 0) {
      return targetKind === "vaccination" ? specific.last() : specific.first();
    }
  }

  const allInputs = page.locator("input[type='file']");
  const allCount = await allInputs.count().catch(() => 0);
  if (allCount > 0) {
    return allInputs.first();
  }

  const fallback = page.locator(selector).first();
  await fallback.waitFor({ timeout: Math.max(1500, timeoutMs), state: "attached" });
  return fallback;
}

async function commitScopedUpload(page, targetKind, timeoutMs) {
  const kind = String(targetKind || "").trim().toLowerCase();
  if (!kind) {
    return false;
  }

  const marker = `nusuk-upload-commit-${kind}-${Date.now()}`;
  const marked = await page.evaluate((payload) => {
    const kindLocal = String(payload?.kind || "");
    const markerLocal = String(payload?.marker || "");
    for (const old of Array.from(document.querySelectorAll("[data-nusuk-upload-commit]"))) {
      old.removeAttribute("data-nusuk-upload-commit");
    }

    const labels = Array.from(document.querySelectorAll("label, .dynamic-field__label, .field-label"));
    const wanted = kindLocal === "vaccination"
      ? /(vaccination\s*certificate|vaccination)/i
      : /(personal\s*picture|passport\s*image|passport)/i;
    const labelNode = labels.find((node) => wanted.test(String(node.textContent || "")));
    if (!labelNode) {
      return false;
    }

    const scopes = [
      labelNode.closest("div"),
      labelNode.parentElement,
      labelNode.parentElement?.parentElement,
      labelNode.closest("form"),
    ].filter(Boolean);
    for (const scope of scopes) {
      const buttons = Array.from(scope.querySelectorAll("button, .btn"));
      const uploadButton = buttons.find((btn) => /upload\s*file/i.test(String(btn.textContent || "")));
      if (uploadButton instanceof HTMLElement) {
        uploadButton.setAttribute("data-nusuk-upload-commit", markerLocal);
        return true;
      }
    }
    return false;
  }, { kind, marker }).catch(() => false);

  if (!marked) {
    return false;
  }

  const button = page.locator(`[data-nusuk-upload-commit='${marker}']`).first();
  if ((await button.count().catch(() => 0)) === 0) {
    return false;
  }

  const visible = await button.isVisible().catch(() => false);
  const enabled = await button.isEnabled().catch(() => false);
  if (!visible || !enabled) {
    return false;
  }

  await button.scrollIntoViewIfNeeded().catch(() => {});
  await button.click({ timeout: Math.min(timeoutMs, 2000) }).catch(async () => {
    await button.click({ timeout: Math.min(timeoutMs, 2000), force: true }).catch(() => {});
  });
  await sleep(page, 220);
  return true;
}

function isLikelyNextSelector(selector) {
  const text = String(selector ?? "").toLowerCase();
  return text.includes("next") && (text.includes("btn-primary") || text.includes("navigation-buttons") || text.includes("action-btns"));
}

function isLikelyProceedSelector(selector) {
  const text = String(selector ?? "").toLowerCase();
  return text.includes("proceed")
    || (text.includes("popup-small") && text.includes("popup-actions"));
}

async function findUsableProceedButton(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const locator = page.locator(".popup.popup-small .popup-actions button").filter({ hasText: "Proceed" }).first();
    const count = await locator.count().catch(() => 0);
    if (count > 0) {
      const visible = await locator.isVisible().catch(() => false);
      const enabled = await locator.isEnabled().catch(() => false);
      if (visible && enabled) {
        return locator;
      }
    }
    await sleep(page, 120);
  }
  return null;
}

async function clickProceedButtonRobust(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    const remaining = Math.max(1200, deadline - Date.now());
    const proceedButton = await findUsableProceedButton(page, Math.min(remaining, 2500));
    if (!proceedButton) {
      await sleep(page, 200);
      continue;
    }

    await proceedButton.scrollIntoViewIfNeeded().catch(() => {});
    const strategies = [
      async () => proceedButton.click({ timeout: Math.min(remaining, 1600) }),
      async () => proceedButton.click({ timeout: Math.min(remaining, 1600), force: true }),
      async () => proceedButton.evaluate((el) => el?.click?.()),
      async () => proceedButton.press("Enter", { timeout: Math.min(remaining, 1200) }),
    ];

    let clicked = false;
    for (const strategy of strategies) {
      try {
        await strategy();
        clicked = true;
        break;
      } catch {
        // try next
      }
    }

    if (!clicked) {
      await sleep(page, 180);
      continue;
    }

    await sleep(page, 280);
    const popupStillVisible = await page
      .locator(".popup.popup-small .popup-actions button")
      .filter({ hasText: "Proceed" })
      .first()
      .isVisible()
      .catch(() => false);
    if (!popupStillVisible) {
      return true;
    }
    console.log(`proceed_click: attempt ${attempt} klik dilakukan tapi popup masih tampil, retry...`);
    await sleep(page, 220);
  }
  return false;
}

async function findUsableNextButton(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastReason = "unknown";
  while (Date.now() < deadline) {
    for (const selector of NEXT_BUTTON_CANDIDATE_SELECTORS) {
      const locator = page.locator(selector);
      const count = await locator.count();
      if (!count) {
        lastReason = `selector "${selector}" tidak ditemukan`;
      }
      for (let i = 0; i < count; i += 1) {
        const candidate = locator.nth(i);
        const visible = await candidate.isVisible().catch(() => false);
        if (!visible) {
          lastReason = `candidate ${selector}[${i}] tidak visible`;
          continue;
        }
        const textContent = String(await candidate.innerText().catch(() => ""))
          .trim()
          .toLowerCase();
        if (textContent !== "next") {
          lastReason = `candidate ${selector}[${i}] text "${textContent}" bukan Next`;
          continue;
        }
        const enabled = await candidate.isEnabled().catch(() => false);
        if (!enabled) {
          lastReason = `candidate ${selector}[${i}] disabled`;
          continue;
        }
        const className = String(await candidate.getAttribute("class").catch(() => ""));
        if (className.includes("p-disabled")) {
          lastReason = `candidate ${selector}[${i}] class p-disabled`;
          continue;
        }
        if (className.includes("disabled")) {
          lastReason = `candidate ${selector}[${i}] class disabled`;
          continue;
        }
        const disabledAttr = await candidate.getAttribute("disabled").catch(() => null);
        if (disabledAttr !== null) {
          lastReason = `candidate ${selector}[${i}] punya attr disabled`;
          continue;
        }
        const ariaDisabled = String(await candidate.getAttribute("aria-disabled").catch(() => "")).trim().toLowerCase();
        if (ariaDisabled === "true") {
          lastReason = `candidate ${selector}[${i}] aria-disabled=true`;
          continue;
        }
        const pointerEvents = await candidate.evaluate((el) => window.getComputedStyle(el).pointerEvents).catch(() => "");
        if (String(pointerEvents).toLowerCase() === "none") {
          lastReason = `candidate ${selector}[${i}] pointer-events none`;
          continue;
        }
        return candidate;
      }
    }
    await sleep(page, 200);
  }
  console.log(`next_button_wait: timeout - ${lastReason}`);
  await logNextDiagnostics(page);
  await logInvalidFieldDiagnostics(page);
  return null;
}

async function clickNextButtonRobust(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    const remaining = Math.max(1200, deadline - Date.now());
    const stageBeforeClick = await detectNusukStage(page);
    const isPersonalToDisclosure = stageBeforeClick === 2;
    const nextButton = await findUsableNextButton(page, Math.min(remaining, isPersonalToDisclosure ? 1800 : 3000));
    if (!nextButton) {
      await sleep(page, isPersonalToDisclosure ? 140 : 300);
      continue;
    }

    await nextButton.scrollIntoViewIfNeeded().catch(() => {});

    const clickStrategies = [
      async () => nextButton.click({ timeout: Math.min(remaining, 2000) }),
      async () => nextButton.click({ timeout: Math.min(remaining, 2000), force: true }),
      async () => nextButton.evaluate((element) => {
        if (element && typeof element.click === "function") {
          element.click();
        }
      }),
      async () => nextButton.press("Enter", { timeout: Math.min(remaining, 1500) }),
      async () => {
        const box = await nextButton.boundingBox();
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        }
      },
      async () => {
        await page.evaluate(() => {
          const candidates = Array.from(
            document.querySelectorAll("action-btns.custom-action-buttons button.btn.btn-primary, action-btns button.btn.btn-primary"),
          );
          const target = candidates.find((button) => {
            const text = String(button.textContent || "").trim().toLowerCase();
            const className = String(button.className || "").toLowerCase();
            const ariaDisabled = String(button.getAttribute("aria-disabled") || "").toLowerCase();
            const disabledAttr = button.hasAttribute("disabled");
            const pointerEvents = window.getComputedStyle(button).pointerEvents;
            return text === "next"
              && !disabledAttr
              && ariaDisabled !== "true"
              && !className.includes("disabled")
              && pointerEvents !== "none";
          });
          if (target) {
            target.scrollIntoView({ block: "center" });
            target.click();
          } else {
            throw new Error("DOM fallback tidak menemukan tombol Next yang usable.");
          }
        });
      },
    ];

    let clicked = false;
    for (const strategy of clickStrategies) {
      try {
        await strategy();
        clicked = true;
        break;
      } catch {
        // Try next strategy.
      }
    }

    if (!clicked) {
      console.log(`next_click: attempt ${attempt} gagal pada semua strategi click`);
      await logNextDiagnostics(page);
      await logInvalidFieldDiagnostics(page);
      await sleep(page, isPersonalToDisclosure ? 180 : 350);
      continue;
    }

    // Fast-path transisi PAGE 2 -> PAGE 3: biasanya tidak butuh settle panjang.
    if (isPersonalToDisclosure) {
      await sleep(page, 180);
      const quickChanged = await waitForStageChange(page, stageBeforeClick, Math.min(2600, remaining)).catch(() => false);
      if (quickChanged) {
        return true;
      }
      await waitForPageReady(page, 2400).catch(() => {});
    } else {
      await sleep(page, 500);
      await waitForPageReady(page, 5000).catch(() => {});
    }

    const changed = await waitForStageChange(
      page,
      stageBeforeClick,
      Math.min(isPersonalToDisclosure ? 3800 : 7000, remaining),
    ).catch(() => false);
    if (changed || stageBeforeClick === 0) {
      return true;
    }

    const rateLimited = await detectRateLimitUiSignal(page);
    if (rateLimited) {
      const cooldownMs = 14000 + Math.floor(Math.random() * 9000);
      console.log(`next_click: rate-limit terdeteksi, cooldown ${Math.round(cooldownMs / 1000)}s`);
      await sleep(page, cooldownMs);
      continue;
    }

    console.log(`next_click: attempt ${attempt} sudah click tapi stage belum berubah`);
    await logNextDiagnostics(page);
    await sleep(page, 350);
  }

  return false;
}

async function detectRateLimitUiSignal(page) {
  return page.evaluate(() => {
    const text = String(document.body?.innerText || "").toLowerCase();
    return text.includes("too many request")
      || text.includes("too many requests")
      || text.includes("rate limit")
      || text.includes("429");
  }).catch(() => false);
}

async function detectNusukStage(page) {
  const hasSuccessPopup = await page.locator(".popup h3:has-text('Mutamer has been added successfully')").first()
    .isVisible()
    .catch(() => false);
  if (hasSuccessPopup) {
    return 4;
  }

  const hasDisclosureTitle = await page.locator(".card .title:has-text('Disclosure Form')").first()
    .isVisible()
    .catch(() => false);
  if (hasDisclosureTitle) {
    return 3;
  }

  const hasPersonalInputs = await page
    .locator(
      "div[formgroupname='firstName'] input[formcontrolname='ar'], input[placeholder='First Name (Arabic)'], input[placeholder='First name (Arabic)'], input[placeholder='Profession'], input[formcontrolname='email']",
    )
    .first()
    .isVisible()
    .catch(() => false);
  if (hasPersonalInputs) {
    return 2;
  }

  const hasIdentityInputs = await page
    .locator(
      ".container__notes__upload__button input[type='file'], p-dropdown[formcontrolname='passportTypeId'], input[formcontrolname='issueCityName']",
    )
    .first()
    .isVisible()
    .catch(() => false);
  if (hasIdentityInputs) {
    return 1;
  }

  return 0;
}

async function waitForStageChange(page, previousStage, timeoutMs) {
  if (!previousStage) {
    return true;
  }

  const deadline = Date.now() + Math.max(500, Number(timeoutMs) || 0);
  while (Date.now() < deadline) {
    const currentStage = await detectNusukStage(page);
    if (currentStage !== previousStage) {
      return true;
    }
    await sleep(page, 250);
  }
  return false;
}

async function attemptFillRequiredFieldsForCurrentPage(page, context, timeoutMs) {
  const onPersonalPage = await page.locator(
    "div[formgroupname='firstName'] input[formcontrolname='ar'], input[placeholder='First Name (Arabic)'], input[placeholder='First name'], input[placeholder='First Name'], input[placeholder='Profession']"
  ).count().catch(() => 0);
  if (!onPersonalPage) {
    return;
  }
  const lastAttemptAt = Number(LAST_PERSONAL_AUTOFILL_AT.get(page) || 0);
  const now = Date.now();
  if (now - lastAttemptAt < 1800) {
    return;
  }
  LAST_PERSONAL_AUTOFILL_AT.set(page, now);

  const member = context?.member ?? {};
  const rs = member?.resolvedProfile ?? {};
  const pe = member?.passportExtracted ?? {};

  const arabicFirst = pickFirstNonEmpty(rs?.arabic?.firstName, rs?.firstName, pe?.firstName);
  const arabicFamily = pickFirstNonEmpty(rs?.arabic?.familyName, rs?.familyName, pe?.familyName);
  const profession = pickFirstNonEmpty(rs?.profession, "BUSINESS");
  const birthCity = pickFirstNonEmpty(rs?.birthCity, pe?.birthCity, pe?.cityOfIssued, rs?.cityOfIssued, "UNKNOWN");
  const birthCountry = pickFirstNonEmpty(rs?.birthCountry, rs?.nationality, pe?.nationality, "INDONESIA");
  const maritalStatus = pickFirstNonEmpty(rs?.maritalStatus, "SINGLE");
  const email = pickFirstNonEmpty(rs?.email, "example@gmail.com");
  const mobile = pickFirstNonEmpty(rs?.mobileNumber, "+628123456789");

  await setFirstVisibleInputIfEmpty(page, [
    "input[formcontrolname='firstName.ar']",
    "input[name='firstName.ar']",
    "div[formgroupname='firstName'] input[formcontrolname='ar']",
    "input[placeholder='First Name (Arabic)']",
    "input[placeholder='First name (Arabic)']",
    "input[placeholder*='Arabic'][placeholder*='First']",
  ], arabicFirst, timeoutMs);

  await setFirstVisibleInputIfEmpty(page, [
    "input[formcontrolname='familyName.ar']",
    "input[name='familyName.ar']",
    "div[formgroupname='familyName'] input[formcontrolname='ar']",
    "input[placeholder='Family Name (Arabic)']",
    "input[placeholder*='Arabic'][placeholder*='Family']",
  ], arabicFamily, timeoutMs);

  await setFirstVisibleInputIfEmpty(page, [
    "input[formcontrolname='profession']",
    "input[name='profession']",
    "input[placeholder='Profession']",
  ], profession, timeoutMs);

  await setFirstVisibleInputIfEmpty(page, [
    "input[formcontrolname='birthCityName']",
    "input[name='birthCityName']",
    "input[placeholder='Birth City']",
  ], birthCity, timeoutMs);

  await setFirstVisibleInputIfEmpty(page, [
    "input[formcontrolname='email']",
    "input[name='email']",
    "input[placeholder='Email']",
    "input[type='email'][placeholder='Email']",
  ], email, timeoutMs);

  await selectPrimeNgDropdownIfEmpty(
    page,
    [
      "select[formcontrolname='birthCountryId']",
      "p-dropdown[formcontrolname='birthCountryId'] .p-dropdown:not(.p-disabled)",
      "p-dropdown[formcontrolname='birthCountryId'] .p-dropdown",
    ],
    birthCountry,
    "birth_country",
    timeoutMs,
  );

  await selectPrimeNgDropdownIfEmpty(
    page,
    [
      "select[formcontrolname='martialStatusId']",
      "select[formcontrolname='maritalStatusId']",
      "p-dropdown[formcontrolname='martialStatusId'] .p-dropdown:not(.p-disabled)",
      "p-dropdown[formcontrolname='maritalStatusId'] .p-dropdown:not(.p-disabled)",
      "p-dropdown[formcontrolname='martialStatusId'] .p-dropdown",
      "p-dropdown[formcontrolname='maritalStatusId'] .p-dropdown",
    ],
    maritalStatus,
    "marital_status",
    timeoutMs,
  );

  await fillPhoneFields(page, "input[formcontrolname='phone'], input[name='phone'], input[formcontrolname='mobileNumber'], input[name='mobileNumber'], input[placeholder='Mobile Number'], input[placeholder='Phone Number'], input[placeholder*='Phone'], input[placeholder*='Mobile'], input[type='tel'], ngx-intl-tel-input input", mobile, timeoutMs).catch(() => null);
  await ensurePhoneCountryCodeLocked(page, timeoutMs).catch(() => null);
  await healRemainingInvalidFields(page, {
    arabicFirst,
    arabicFamily,
    profession,
    birthCountry,
    birthCity,
    maritalStatus,
    email,
    mobile,
  }, timeoutMs);
}

async function ensurePhoneCountryCodeLocked(page, timeoutMs) {
  const selector = "input[formcontrolname='phone'], input[name='phone'], input[formcontrolname='mobileNumber'], input[name='mobileNumber'], input[placeholder='Mobile Number'], input[placeholder='Phone Number'], input[placeholder*='Phone'], input[placeholder*='Mobile'], input[type='tel'], ngx-intl-tel-input input";
  const inputLocator = await tryResolvePhoneInputLocator(page, selector, Math.min(timeoutMs, 3500));
  if (!inputLocator) {
    return false;
  }
  const current = await readPhoneCountryCodeState(inputLocator).catch(() => "");
  if (/(^|\s)\+?62(\s|$)|indonesia/i.test(String(current || ""))) {
    return true;
  }
  const selected = await selectPhoneCountryCode(page, inputLocator, "62", timeoutMs).catch(() => "");
  return Boolean(selected);
}

async function setFirstVisibleInputIfEmpty(page, selectors, value, timeoutMs) {
  const text = String(value ?? "").trim();
  if (!text) {
    return false;
  }
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();
    for (let i = 0; i < count; i += 1) {
      const input = locator.nth(i);
      const visible = await input.isVisible().catch(() => false);
      if (!visible) {
        continue;
      }
      const current = String(await input.inputValue().catch(() => "")).trim();
      if (current) {
        return true;
      }
      await input.scrollIntoViewIfNeeded().catch(() => {});
      await input.fill(text, { timeout: timeoutMs }).catch(() => {});
      await input.dispatchEvent("input").catch(() => {});
      await input.dispatchEvent("change").catch(() => {});
      await input.dispatchEvent("blur").catch(() => {});
      const after = String(await input.inputValue().catch(() => "")).trim();
      if (after) {
        return true;
      }
    }
  }
  return false;
}

async function selectPrimeNgDropdownIfEmpty(page, triggerSelectors, optionText, optionKind, timeoutMs) {
  const text = String(optionText ?? "").trim();
  if (!text) {
    return false;
  }

  for (const selector of triggerSelectors) {
    const dropdown = page.locator(selector).first();
    if ((await dropdown.count()) === 0) {
      continue;
    }
    const visible = await dropdown.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }

    const tagName = String(await dropdown.evaluate((el) => el?.tagName || "").catch(() => "")).toLowerCase();
    if (tagName === "select") {
      const selected = await trySelectNativeByText(page, selector, text, optionKind, null);
      if (selected) {
        return true;
      }
      continue;
    }

    const currentLabel = String(await dropdown.locator(".p-dropdown-label").first().innerText().catch(() => ""))
      .trim()
      .toLowerCase();
    const looksEmpty = !currentLabel
      || currentLabel.includes("select")
      || currentLabel.includes("birth country")
      || currentLabel.includes("marital status")
      || currentLabel.includes("martial status");
    if (!looksEmpty) {
      return true;
    }

    await dropdown.scrollIntoViewIfNeeded().catch(() => {});
    await dropdown.click({ timeout: timeoutMs }).catch(() => {});
    const optionLocator = await findPrimeNgDropdownOption(page, text, optionKind).catch(() => null);
    if (!optionLocator) {
      continue;
    }
    await optionLocator.waitFor({ timeout: timeoutMs }).catch(() => {});
    await optionLocator.click({ timeout: timeoutMs }).catch(() => {});
    await sleep(page, 150);
    return true;
  }
  return false;
}

async function clickPrimeNgOptionDom(page, optionText, optionKind, timeoutMs) {
  const target = normalizeOption(optionText);
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 8000);
  while (Date.now() < deadline) {
    const clicked = await page.evaluate((payload) => {
      const normalize = (value) =>
        String(value ?? "")
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .trim()
          .toLowerCase()
          .replace(/[().,-]/g, " ")
          .replace(/\s+/g, " ");

      const targetNorm = normalize(payload?.target || "");
      if (!targetNorm) {
        return false;
      }

      const aliasSet = new Set([targetNorm, targetNorm.replace(/\s+/g, "")]);
      if (String(payload?.kind || "") === "marital_status") {
        const map = {
          single: ["single", "unmarried"],
          married: ["married"],
          divorced: ["divorced", "divorce"],
          widowed: ["widowed"],
          other: ["other"],
        };
        const compact = targetNorm.replace(/\s+/g, "");
        for (const raw of map[compact] || []) {
          const n = normalize(raw);
          aliasSet.add(n);
          aliasSet.add(n.replace(/\s+/g, ""));
        }
      }

      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) {
          return false;
        }
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== "none"
          && style.visibility !== "hidden"
          && rect.width > 0
          && rect.height > 0;
      };

      const panels = Array.from(document.querySelectorAll(".p-dropdown-panel"))
        .filter((panel) => isVisible(panel));
      if (!panels.length) {
        return false;
      }

      // Prioritize the top-most rendered panel (usually last in DOM order).
      const panel = panels[panels.length - 1];
      const options = Array.from(panel.querySelectorAll(".p-dropdown-item, [role='option']"));
      for (const option of options) {
        if (!(option instanceof HTMLElement)) {
          continue;
        }
        const className = String(option.className || "").toLowerCase();
        const ariaDisabled = String(option.getAttribute("aria-disabled") || "").toLowerCase();
        const pDisabled = String(option.getAttribute("data-p-disabled") || "").toLowerCase();
        if (className.includes("disabled") || ariaDisabled === "true" || pDisabled === "true") {
          continue;
        }

        const labelRaw = String(option.textContent || "").trim();
        if (!labelRaw) {
          continue;
        }
        const labelNorm = normalize(labelRaw);
        const compactLabel = labelNorm.replace(/\s+/g, "");
        const matched = aliasSet.has(labelNorm)
          || aliasSet.has(compactLabel)
          || Array.from(aliasSet).some((alias) => labelNorm.includes(alias) || alias.includes(labelNorm));
        if (!matched) {
          continue;
        }

        option.scrollIntoView({ block: "center" });
        option.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
        option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        option.click();
        option.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return true;
      }

      return false;
    }, { target, kind: optionKind });

    if (clicked) {
      return true;
    }
    await sleep(page, 120);
  }
  return false;
}

async function healRemainingInvalidFields(page, values, timeoutMs) {
  const invalidInputs = page.locator("input.ng-invalid, textarea.ng-invalid");
  const inputCount = await invalidInputs.count();
  for (let i = 0; i < inputCount; i += 1) {
    const input = invalidInputs.nth(i);
    const visible = await input.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }
    const current = String(await input.inputValue().catch(() => "")).trim();
    if (current) {
      continue;
    }

    const placeholder = String(await input.getAttribute("placeholder").catch(() => "")).trim().toLowerCase();
    const name = String(await input.getAttribute("name").catch(() => "")).trim().toLowerCase();
    let fillValue = "";
    if (placeholder.includes("first name (arabic)")) {
      fillValue = values.arabicFirst;
    } else if (placeholder.includes("family name (arabic)")) {
      fillValue = values.arabicFamily;
    } else if (placeholder.includes("profession") || name === "profession") {
      fillValue = values.profession;
    } else if (placeholder.includes("birth city") || name === "birthcityname") {
      fillValue = values.birthCity;
    } else if (placeholder.includes("email") || name === "email") {
      fillValue = values.email;
    } else if (placeholder.includes("mobile") || placeholder.includes("phone") || name === "phone") {
      fillValue = values.mobile.replace(/[^\d]/g, "");
      if (fillValue.startsWith("62")) {
        fillValue = fillValue.slice(2);
      }
      if (!fillValue) {
        fillValue = "8123456789";
      }
    }

    if (!String(fillValue ?? "").trim()) {
      continue;
    }
    await input.scrollIntoViewIfNeeded().catch(() => {});
    await input.fill(fillValue, { timeout: timeoutMs }).catch(() => {});
    await input.dispatchEvent("input").catch(() => {});
    await input.dispatchEvent("change").catch(() => {});
    await input.dispatchEvent("blur").catch(() => {});
  }

  const invalidDropdowns = page.locator(".p-dropdown.ng-invalid, p-dropdown.ng-invalid .p-dropdown, .p-dropdown.is-invalid");
  const dropdownCount = Math.min(await invalidDropdowns.count(), 8);
  for (let i = 0; i < dropdownCount; i += 1) {
    const dropdown = invalidDropdowns.nth(i);
    const visible = await dropdown.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }

    const labelContext = String(await dropdown.evaluate((el) => {
      const parent = el.closest("div, td, tr, form");
      const label = parent?.querySelector("label");
      return String(label?.textContent || "");
    }).catch(() => "")).trim().toLowerCase();

    let targetText = "";
    let optionKind = "";
    let allowFallbackOption = false;
    if (labelContext.includes("birth country")) {
      targetText = values.birthCountry;
      optionKind = "birth_country";
      allowFallbackOption = true;
    } else if (labelContext.includes("marital") || labelContext.includes("martial")) {
      targetText = values.maritalStatus;
      optionKind = "marital_status";
      allowFallbackOption = true;
    } else if (labelContext.includes("mobile") || labelContext.includes("country code")) {
      targetText = "+62";
      optionKind = "mobile_country_code";
      allowFallbackOption = false;
    }

    if (!targetText) {
      // Jangan ubah dropdown yang konteksnya tidak jelas.
      continue;
    }

    await dropdown.scrollIntoViewIfNeeded().catch(() => {});
    await dropdown.click({ timeout: timeoutMs }).catch(() => {});
    await sleep(page, 180);

    let picked = false;
    if (targetText) {
      const preferred = await findPrimeNgDropdownOption(page, targetText, optionKind, 2500).catch(() => null);
      if (preferred) {
        await preferred.click({ timeout: timeoutMs }).catch(() => {});
        picked = true;
      }
    }
    if (!picked && allowFallbackOption) {
      const fallbackOption = page.locator(".p-dropdown-panel .p-dropdown-item:not(.p-disabled), .p-dropdown-panel [role='option']:not(.p-disabled)").first();
      if ((await fallbackOption.count()) > 0) {
        const text = String(await fallbackOption.innerText().catch(() => "")).trim().toLowerCase();
        if (text && !text.includes("select")) {
          await fallbackOption.click({ timeout: timeoutMs }).catch(() => {});
          picked = true;
        }
      }
    }
    if (!picked) {
      await page.keyboard.press("Escape").catch(() => {});
    }
    await sleep(page, 120);
  }
}

async function logNextDiagnostics(page) {
  const diagnostics = await page.evaluate(() => {
    const selectors = [
      "action-btns.custom-action-buttons button",
      ".action-buttons .navigation-buttons button",
      "button.btn.btn-primary",
    ];
    const rows = [];
    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      for (const node of nodes) {
        const text = String(node.textContent || "").trim().replace(/\s+/g, " ");
        const className = String(node.className || "").trim();
        const disabledAttr = node.hasAttribute("disabled");
        const ariaDisabled = String(node.getAttribute("aria-disabled") || "").trim();
        const style = window.getComputedStyle(node);
        const visible = style.display !== "none" && style.visibility !== "hidden" && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
        rows.push({
          selector,
          text,
          className,
          disabled: disabledAttr,
          ariaDisabled,
          pointerEvents: style.pointerEvents,
          visible,
        });
      }
    }
    const invalidCount = document.querySelectorAll("form.ng-invalid").length;
    return { rows, invalidCount };
  }).catch(() => null);

  if (!diagnostics) {
    console.log("next_diagnostics: tidak bisa membaca kondisi DOM.");
    return;
  }

  console.log(`next_diagnostics: form.ng-invalid=${diagnostics.invalidCount}`);
  for (const row of diagnostics.rows.slice(0, 12)) {
    console.log(
      `next_diagnostics: [${row.selector}] text="${row.text}" visible=${row.visible} disabled=${row.disabled} ariaDisabled="${row.ariaDisabled}" pointerEvents="${row.pointerEvents}" class="${row.className}"`,
    );
  }
}

async function logInvalidFieldDiagnostics(page) {
  const diagnostics = await page.evaluate(() => {
    const pickLabel = (el) => {
      const withId = el.id ? document.querySelector(`label[for="${el.id}"]`) : null;
      if (withId) {
        return String(withId.textContent || "").trim();
      }
      const directLabel = el.closest("label");
      if (directLabel) {
        return String(directLabel.textContent || "").trim();
      }
      const parent = el.closest("div, td, tr, form");
      const nearby = parent ? parent.querySelector("label") : null;
      return String(nearby?.textContent || "").trim();
    };

    const rawNodes = Array.from(
      document.querySelectorAll(
        "form .ng-invalid, form [aria-invalid='true'], form input:invalid, form select:invalid, form textarea:invalid"
      ),
    );
    const uniqueNodes = [];
    const seen = new Set();
    for (const node of rawNodes) {
      if (!(node instanceof HTMLElement)) {
        continue;
      }
      if (seen.has(node)) {
        continue;
      }
      seen.add(node);
      uniqueNodes.push(node);
    }

    const rows = uniqueNodes.slice(0, 20).map((el) => {
      const input = el.matches("input, select, textarea") ? el : el.querySelector("input, select, textarea") || el;
      const className = String(input.className || "").trim().replace(/\s+/g, " ");
      const tag = String(input.tagName || "").toLowerCase();
      const type = String(input.getAttribute?.("type") || "").trim();
      const name = String(input.getAttribute?.("name") || input.getAttribute?.("formcontrolname") || "").trim();
      const placeholder = String(input.getAttribute?.("placeholder") || "").trim();
      const value = "value" in input ? String(input.value || "").trim() : "";
      const required = input.hasAttribute?.("required") || false;
      return {
        tag,
        type,
        name,
        placeholder,
        value,
        required,
        label: pickLabel(input),
        className,
      };
    });
    return { total: uniqueNodes.length, rows };
  }).catch(() => null);

  if (!diagnostics) {
    console.log("invalid_fields: gagal baca invalid field diagnostics");
    return;
  }

  console.log(`invalid_fields: total=${diagnostics.total}`);
  for (const row of diagnostics.rows) {
    console.log(
      `invalid_fields: label="${row.label || "-"}" tag=${row.tag} type="${row.type}" name="${row.name}" placeholder="${row.placeholder}" required=${row.required} value="${row.value}" class="${row.className}"`,
    );
  }
}

async function fillPhoneFields(page, inputSelector, rawValue, timeoutMs) {
  const fallbackSelector = "input[formcontrolname='phone'], input[name='phone'], input[formcontrolname='mobileNumber'], input[name='mobileNumber'], input[placeholder='Mobile Number'], input[placeholder='Phone Number'], input[placeholder*='Phone'], input[placeholder*='Mobile'], input[type='tel'], ngx-intl-tel-input input";
  const combinedSelector = uniqueSelectorList([inputSelector, fallbackSelector].filter(Boolean).join(", "));
  let inputLocator = await tryResolvePhoneInputLocator(page, combinedSelector, timeoutMs);
  if (!inputLocator) {
    throw new Error("Field Mobile Number tidak ditemukan pada halaman saat ini.");
  }

  const parsed = parseMobileRaw(rawValue);
  let selectedCode = await selectPhoneCountryCode(page, inputLocator, parsed.countryCode, timeoutMs).catch(() => "");
  if (!selectedCode) {
    // Second chance: ensure default +62 for Nusuk phone country code.
    selectedCode = await selectPhoneCountryCode(page, inputLocator, "62", timeoutMs).catch(() => "");
  }
  const localNumber = parsed.countryCode && parsed.digitsOnly.startsWith(parsed.countryCode) && parsed.digitsOnly.length > parsed.countryCode.length
    ? parsed.digitsOnly.slice(parsed.countryCode.length)
    : parsed.localNumber;

  const result = await inputLocator.evaluate((inputNode, payload) => {
    const local = String(payload?.local ?? "").trim();
    if (!local) {
      return { ok: false, reason: "Nomor lokal kosong." };
    }
    inputNode.focus();
    inputNode.value = local;
    inputNode.dispatchEvent(new Event("input", { bubbles: true }));
    inputNode.dispatchEvent(new Event("change", { bubbles: true }));
    inputNode.dispatchEvent(new Event("blur", { bubbles: true }));
    return { ok: true };
  }, { local: localNumber });

  const countryState = await readPhoneCountryCodeState(inputLocator).catch(() => "");
  const countryOk = /(^|\s)\+?62(\s|$)|indonesia/i.test(String(countryState || selectedCode || ""));
  if (!countryOk) {
    return {
      ok: false,
      reason: `Kode negara mobile belum terpilih +62 (terbaca: "${countryState || "-"}").`,
      selectedCode: selectedCode || "",
      localNumber,
    };
  }

  return {
    ok: Boolean(result?.ok),
    reason: result?.reason,
    selectedCode: "62",
    localNumber,
  };
}

function uniqueSelectorList(selectorText) {
  const parts = String(selectorText || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const seen = new Set();
  const unique = [];
  for (const part of parts) {
    const key = part.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(part);
  }
  return unique.join(", ");
}

async function tryResolvePhoneInputLocator(page, selector, timeoutMs) {
  const bySelector = await pickFirstVisibleLocator(page, selector, null, Math.min(3000, timeoutMs));
  const hasBySelector = await bySelector.count().catch(() => 0);
  if (hasBySelector > 0) {
    const visible = await bySelector.isVisible().catch(() => false);
    if (visible) {
      return bySelector;
    }
  }

  const markerId = `nusuk-phone-target-${Date.now()}`;
  const marked = await page.evaluate((marker) => {
    const isVisible = (el) => {
      if (!(el instanceof HTMLElement)) {
        return false;
      }
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };

    const clean = () => {
      const old = document.querySelectorAll("[data-nusuk-phone-target]");
      for (const node of Array.from(old)) {
        node.removeAttribute("data-nusuk-phone-target");
      }
    };
    clean();

    const labels = Array.from(document.querySelectorAll("label, .dynamic-field__label, .form-label"));
    const phoneLabel = labels.find((node) => /mobile\s*number|phone\s*number|mobile/i.test(String(node.textContent || "")));
    const scopes = [
      phoneLabel?.closest("div, td, tr, form"),
      phoneLabel?.parentElement,
      phoneLabel?.parentElement?.parentElement,
      document.querySelector("form"),
      document.body,
    ].filter(Boolean);

    const tryMarkInScope = (scope) => {
      const candidates = Array.from(scope.querySelectorAll("input"))
        .filter((input) => {
          if (!(input instanceof HTMLInputElement)) {
            return false;
          }
          if (input.disabled || input.readOnly) {
            return false;
          }
          const type = String(input.getAttribute("type") || "text").toLowerCase();
          if (!["text", "tel", ""].includes(type)) {
            return false;
          }
          return isVisible(input);
        });
      for (const input of candidates) {
        const placeholder = String(input.getAttribute("placeholder") || "").toLowerCase();
        const name = String(input.getAttribute("name") || input.getAttribute("formcontrolname") || "").toLowerCase();
        const className = String(input.className || "").toLowerCase();
        if (
          placeholder.includes("phone")
          || placeholder.includes("mobile")
          || name.includes("phone")
          || name.includes("mobile")
          || className.includes("flex-grow")
        ) {
          input.setAttribute("data-nusuk-phone-target", marker);
          return true;
        }
      }
      return false;
    };

    for (const scope of scopes) {
      if (tryMarkInScope(scope)) {
        return true;
      }
    }

    const allInputs = Array.from(document.querySelectorAll("input"))
      .filter((input) => input instanceof HTMLInputElement && !input.disabled && !input.readOnly && isVisible(input));
    for (const input of allInputs) {
      const className = String(input.className || "").toLowerCase();
      if (className.includes("flex-grow")) {
        input.setAttribute("data-nusuk-phone-target", marker);
        return true;
      }
    }
    return false;
  }, markerId).catch(() => false);

  if (!marked) {
    return null;
  }

  const markerLocator = page.locator(`input[data-nusuk-phone-target='${markerId}']`).first();
  const exists = await markerLocator.count().catch(() => 0);
  if (!exists) {
    return null;
  }
  const visible = await markerLocator.isVisible().catch(() => false);
  if (!visible) {
    return null;
  }
  return markerLocator;
}

function parseMobileRaw(rawValue) {
  const mobileRaw = String(rawValue ?? "").trim();
  const digitsOnly = mobileRaw.replace(/[^\d]/g, "");
  if (!digitsOnly) {
    return { countryCode: "62", localNumber: "", digitsOnly: "" };
  }

  // Default selalu Indonesia (+62) sesuai kebutuhan entry Nusuk.
  const countryCode = "62";

  let localNumber = digitsOnly;
  if (digitsOnly.startsWith(countryCode) && digitsOnly.length > countryCode.length) {
    localNumber = digitsOnly.slice(countryCode.length);
  } else if (digitsOnly.startsWith("0") && digitsOnly.length > 1) {
    localNumber = digitsOnly.slice(1);
  }
  if (!localNumber) {
    localNumber = digitsOnly;
  }

  return { countryCode, localNumber, digitsOnly };
}

async function selectPhoneCountryCode(page, inputLocator, countryCode, timeoutMs) {
  const code = "62";
  const codeText = `+${code}`;

  const currentState = await readPhoneCountryCodeState(inputLocator).catch(() => "");
  if (/(^|\s)\+?62(\s|$)|indonesia/i.test(String(currentState || ""))) {
    return code;
  }

  // 1) Native select near input (if exists).
  const nativeSelected = await inputLocator.evaluate((inputNode, payload) => {
    const normalize = (v) => String(v ?? "").trim().toLowerCase();
    const container = inputNode.closest("div, td, tr, form") || document;
    const selectNode = container.querySelector("select")
      || document.querySelector("select[aria-label*='Country Code'], select[name*='country'], select[name*='code']");
    if (!(selectNode instanceof HTMLSelectElement) || !selectNode.options?.length) {
      return false;
    }
    const wanted = normalize(payload?.codeText || "");
    let picked = null;
    for (const opt of Array.from(selectNode.options)) {
      const label = normalize(opt.textContent);
      const value = normalize(opt.value);
      if (
        label.includes(wanted)
        || label.includes("indonesia")
        || value === wanted
        || value === wanted.replace("+", "")
      ) {
        picked = opt;
        break;
      }
    }
    if (!picked) {
      return false;
    }
    selectNode.value = picked.value;
    selectNode.dispatchEvent(new Event("input", { bubbles: true }));
    selectNode.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, { codeText });
  if (nativeSelected) {
    return code;
  }

  // 2) Custom dropdown near phone field (PrimeNG / overlay list).
  const triggerMarker = `nusuk-phone-trigger-${Date.now()}`;
  const triggerMarked = await inputLocator.evaluate((inputNode, payload) => {
    const isVisible = (el) => {
      if (!(el instanceof HTMLElement)) {
        return false;
      }
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };

    for (const old of Array.from(document.querySelectorAll("[data-nusuk-phone-trigger]"))) {
      old.removeAttribute("data-nusuk-phone-trigger");
    }

    // Prefer trigger that sits in the same phone row (usually left "shrink" column).
    const sameRow = inputNode.closest(".d-flex, .row, .input-group, .phone-input") || inputNode.parentElement;
    if (sameRow instanceof HTMLElement) {
      const directShrink = sameRow.querySelector(".shrink .p-dropdown, .shrink [role='combobox'], .shrink .dropdown, .shrink .dropdown-trigger");
      if (directShrink instanceof HTMLElement && isVisible(directShrink)) {
        directShrink.setAttribute("data-nusuk-phone-trigger", String(payload?.marker || ""));
        return true;
      }
      const directCombo = sameRow.querySelector(".p-dropdown, [role='combobox'], .dropdown, .dropdown-trigger");
      if (directCombo instanceof HTMLElement && isVisible(directCombo) && !directCombo.contains(inputNode)) {
        directCombo.setAttribute("data-nusuk-phone-trigger", String(payload?.marker || ""));
        return true;
      }
    }

    const roots = [
      inputNode.closest("form"),
      inputNode.closest(".row"),
      inputNode.closest(".d-flex"),
      document.body,
    ].filter(Boolean);

    const inputRect = inputNode.getBoundingClientRect();
    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const root of roots) {
      const candidates = Array.from(
        root.querySelectorAll(".shrink .p-dropdown, .phone-country-code .p-dropdown, .p-dropdown, [role='combobox'], .dropdown-trigger, .dropdown")
      ).filter((el) => isVisible(el));

      for (const candidate of candidates) {
        if (!(candidate instanceof HTMLElement)) {
          continue;
        }
        if (candidate.contains(inputNode)) {
          continue;
        }
        const rect = candidate.getBoundingClientRect();
        const dx = Math.abs((rect.left + (rect.width / 2)) - (inputRect.left + (inputRect.width / 2)));
        const dy = Math.abs((rect.top + (rect.height / 2)) - (inputRect.top + (inputRect.height / 2)));
        const shrinkBoost = candidate.closest(".shrink") ? -40 : 0;
        const score = dx + dy + shrinkBoost;
        if (score < bestScore) {
          best = candidate;
          bestScore = score;
        }
      }
      if (best) {
        break;
      }
    }

    if (!(best instanceof HTMLElement)) {
      return false;
    }
    best.setAttribute("data-nusuk-phone-trigger", String(payload?.marker || ""));
    return true;
  }, { marker: triggerMarker }).catch(() => false);

  if (!triggerMarked) {
    return "";
  }

  const triggerLocator = page.locator(`[data-nusuk-phone-trigger='${triggerMarker}']`).first();
  const hasTrigger = await triggerLocator.count().catch(() => 0);
  if (!hasTrigger) {
    return "";
  }

  const beforeState = await readPhoneCountryCodeState(inputLocator).catch(() => "");
  let triggerOpened = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await triggerLocator.scrollIntoViewIfNeeded().catch(() => {});
      await triggerLocator.click({ timeout: Math.min(timeoutMs, 1800) });
    } catch {
      await triggerLocator.click({ timeout: Math.min(timeoutMs, 1800), force: true }).catch(() => {});
    }
    await sleep(page, 150);
    const panelVisible = await page.locator(".p-dropdown-panel:visible, .dropdown-overlay:visible, .dropdown-panel:visible").count().catch(() => 0);
    if (panelVisible > 0) {
      triggerOpened = true;
      break;
    }
  }
  if (!triggerOpened) {
    return "";
  }

  let clicked = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const panel = page.locator(".p-dropdown-panel:visible, .dropdown-overlay:visible, .dropdown-panel:visible").last();
    const plus62Option = panel.locator(".p-dropdown-item, [role='option'], .dropdown-item").filter({ hasText: codeText }).first();
    const indoOption = panel.locator(".p-dropdown-item, [role='option'], .dropdown-item").filter({ hasText: /Indonesia/i }).first();

    const plus62Count = await plus62Option.count().catch(() => 0);
    const targetOption = plus62Count > 0 ? plus62Option : indoOption;
    const targetCount = await targetOption.count().catch(() => 0);
    if (!targetCount) {
      await sleep(page, 160);
      continue;
    }

    try {
      await targetOption.scrollIntoViewIfNeeded().catch(() => {});
      await targetOption.click({ timeout: Math.min(timeoutMs, 1800) });
      clicked = true;
      break;
    } catch {
      await targetOption.click({ timeout: Math.min(timeoutMs, 1800), force: true }).catch(() => {});
      const stillOpen = await panel.count().catch(() => 0);
      if (stillOpen === 0) {
        clicked = true;
        break;
      }
    }
  }

  if (!clicked) {
    await page.keyboard.press("Escape").catch(() => {});
    return "";
  }
  await sleep(page, 120);

  const afterState = await readPhoneCountryCodeState(inputLocator).catch(() => "");
  console.log(`phone_country_code: before="${beforeState || "-"}" after="${afterState || "-"}" target="+62"`);
  if (!/(^|\s)\+?62(\s|$)|indonesia/i.test(String(afterState || ""))) {
    return "";
  }
  return code;
}

async function readPhoneCountryCodeState(inputLocator) {
  return inputLocator.evaluate((inputNode) => {
    const normalize = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
    const row = inputNode.closest(".d-flex, .row, .input-group, .phone-input") || inputNode.parentElement;
    const roots = [row, inputNode.closest("form"), document.body].filter(Boolean);

    for (const root of roots) {
      if (!(root instanceof HTMLElement || root instanceof Document)) {
        continue;
      }

      const nearSelect = root.querySelector(".shrink select, select[name*='code' i], select[aria-label*='Country Code' i]");
      if (nearSelect instanceof HTMLSelectElement) {
        const selectedOption = nearSelect.options[nearSelect.selectedIndex];
        const text = normalize(selectedOption?.textContent || nearSelect.value || "");
        if (text) {
          return text;
        }
      }

      const nearLabel = root.querySelector(".shrink .p-dropdown-label, .phone-country-code .p-dropdown-label, .shrink .p-inputtext, .p-dropdown-label");
      if (nearLabel instanceof HTMLElement) {
        const text = normalize(nearLabel.textContent || "");
        if (text && !/^select/i.test(text)) {
          return text;
        }
      }
    }
    return "";
  });
}

function resolveUploadFilePath(rawValue, context) {
  const candidate = path.isAbsolute(rawValue)
    ? rawValue
    : path.resolve(context.repoRoot, rawValue);
  return candidate;
}


export {
  runStep,
  waitForPageReady,
  isLikelyNextSelector,
};
