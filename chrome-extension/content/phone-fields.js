(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const {
    setInputValue,
    dispatchBlur,
    queryAll,
    findFirstVisible,
    isVisible,
  } = root.domUtils || {};
  const { normalizeOption } = root.valueUtils || {};
  const {
    inputSearchText,
    isWritableInput,
  } = root.formFieldUtils || {};
  const { createPhoneCountryFields } = root.phoneCountry || {};
  if (!setInputValue || !normalizeOption || !inputSearchText || !isWritableInput || !createPhoneCountryFields) {
    throw new Error("NusukAutofill phone dependencies were not loaded.");
  }

  function createPhoneFields({
    state,
    waitUntil,
    sleep,
    checkpoint,
    markActiveElement,
    appendLog,
    findLabeledFieldRoot,
    clickDropdownOption,
  }) {
    const {
      findClosestPhoneCountryTrigger,
      selectPhoneCountry,
      setCustomCountryCode,
      setNativeSelectValue,
    } = createPhoneCountryFields({
      state,
      waitUntil,
      sleep,
      checkpoint,
      markActiveElement,
      appendLog,
      clickDropdownOption,
    });

    async function setPhoneFields(selector, rawValue, timeoutMs, runId = state.runToken) {
      const { countryCode, localNumber, normalized } = normalizePhoneForNusuk(rawValue);

      if (await setLabeledPhoneFields(countryCode, localNumber || normalized, timeoutMs, runId)) {
        return;
      }

      const input = await waitForPhoneInput(selector, timeoutMs, runId);
      markActiveElement(input);
      const countryTrigger = findClosestPhoneCountryTrigger(input);
      if (countryTrigger && /\+?62/.test(normalized)) {
        await selectPhoneCountry(countryTrigger, "Indonesia", timeoutMs, runId).catch(() => {});
      }

      setInputValue(input, localNumber || normalized);
    }

    function normalizePhoneForNusuk(rawValue) {
      const normalized = String(rawValue || "").replace(/[^\d+]/g, "");
      if (normalized.startsWith("+62")) {
        return { countryCode: "+62", localNumber: normalized.slice(3).replace(/^0+/, ""), normalized };
      }
      if (normalized.startsWith("62")) {
        return { countryCode: "+62", localNumber: normalized.slice(2).replace(/^0+/, ""), normalized };
      }
      if (normalized.startsWith("0")) {
        return { countryCode: "+62", localNumber: normalized.replace(/^0+/, ""), normalized };
      }
      return { countryCode: "+62", localNumber: normalized, normalized };
    }

    async function setLabeledPhoneFields(countryCode, phoneNumber, timeoutMs, runId = state.runToken) {
      const rootNode = findLabeledFieldRoot("Mobile Number");
      if (!rootNode) {
        return false;
      }
      const select = rootNode.querySelector("select.country-code, select[name*='country' i], select");
      const input = rootNode.querySelector("input.phone-input, .phone-field input:not([type='hidden']), input:not([type='hidden'])");
      if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) {
        return false;
      }

      if (select instanceof HTMLSelectElement) {
        setNativeSelectValue(select, countryCode, true);
        markActiveElement(select);
      } else {
        const countrySelected = await setCustomCountryCode(rootNode, countryCode, timeoutMs, runId);
        if (!countrySelected) {
          appendLog("warning", `Country code belum terpilih: ${countryCode}`);
        }
      }
      markActiveElement(input);
      setInputValue(input, phoneNumber);
      dispatchBlur(input);
      return true;
    }

    async function waitForPhoneInput(selector, timeoutMs, runId = state.runToken) {
      return waitUntil(() => {
        const direct = findFirstVisible(selector);
        if (isWritableInput(direct)) {
          return direct;
        }
        const byContext = findPhoneInputByContext();
        if (byContext) {
          return byContext;
        }
        return null;
      }, timeoutMs, `Phone input tidak ditemukan: ${selector}`, runId);
    }

    function findPhoneInputByContext() {
      const inputs = queryAll("input")
        .filter((input) => isWritableInput(input) && isVisible(input));
      const scored = inputs
        .map((input) => ({ input, score: scorePhoneInput(input) }))
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score);
      return scored[0]?.input || null;
    }

    function scorePhoneInput(input) {
      const text = inputSearchText(input);
      let score = 0;
      if (/\bmobile\b|\bphone\b|\btel\b/.test(text)) {
        score += 10;
      }
      if (input.type === "tel" || normalizeOption(input.getAttribute("inputmode") || "") === "tel") {
        score += 5;
      }
      if (/\bnumber\b|\bno\b/.test(text)) {
        score += 2;
      }
      if (/\bpassport\b|\biqama\b|\bemail\b|\bname\b|\bcity\b|\bprofession\b/.test(text)) {
        score -= 8;
      }
      return score;
    }

    return {
      setPhoneFields,
      normalizePhoneForNusuk,
    };
  }

  root.phoneFields = Object.freeze({
    createPhoneFields,
  });
})();
