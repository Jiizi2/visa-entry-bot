(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const {
    SLOW_MODE_ENABLED,
    STEP_BEFORE_DELAY_MS,
    STEP_AFTER_DELAY_MS,
    CLICK_SETTLE_DELAY_MS,
    FILL_SETTLE_DELAY_MS,
    WAIT_SETTLE_DELAY_MS,
    WAIT_POLL_INTERVAL_MS,
    PAGE_READY_POLL_INTERVAL_MS,
    PAGE_READY_STABLE_MS,
    HUMAN_DEFAULT_DELAY_MS,
    HUMAN_DEFAULT_JITTER_MS,
    HUMAN_CLICK_DELAY_MS,
    HUMAN_CLICK_JITTER_MS,
    HUMAN_UPLOAD_DELAY_MS,
    HUMAN_UPLOAD_JITTER_MS,
  } = root.constants || {};
  const {
    queryAll,
    findFirstVisible,
    isVisible,
    isEnabled,
  } = root.domUtils || {};
  if (!queryAll) {
    throw new Error("NusukAutofill DOM utils were not loaded.");
  }

  function createWaitUtils({ state, checkpoint, sleep }) {
    const waitPollMs = Math.max(50, Number(WAIT_POLL_INTERVAL_MS || 120));
    const pageReadyPollMs = Math.max(50, Number(PAGE_READY_POLL_INTERVAL_MS || waitPollMs));

    async function waitForInput(selector, timeoutMs, runId = state.runToken) {
      const element = await waitForSelector(selector, { timeoutMs, state: "visible" }, runId);
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
        throw new Error(`Selector is not an input: ${selector}`);
      }
      return element;
    }

    async function waitForEnabled(selector, timeoutMs, runId = state.runToken) {
      return waitUntil(() => {
        const element = findFirstVisible(selector);
        return element && isEnabled(element) ? element : null;
      }, timeoutMs, "", runId);
    }

    async function waitForSelector(selector, options = {}, runId = state.runToken) {
      const timeoutMs = Number(options.timeoutMs || 10000);
      const expectedState = String(options.state || "visible").toLowerCase();

      return waitUntil(() => {
        if (expectedState === "attached") {
          const attached = queryAll(selector);
          return attached[0] || null;
        }
        return findFirstVisible(selector);
      }, timeoutMs, `Timed out waiting for selector: ${selector}`, runId);
    }

    async function waitUntil(check, timeoutMs, errorMessage, runId = state.runToken) {
      const deadline = Date.now() + Math.max(300, Number(timeoutMs || 0));
      while (Date.now() < deadline) {
        await checkpoint(runId);
        const value = await Promise.resolve(check());
        if (value) {
          return value;
        }
        await sleep(waitPollMs, runId);
      }
      throw new Error(errorMessage || "Timed out waiting for condition.");
    }

    async function waitForPageReady(timeoutMs, runId = state.runToken) {
      const deadline = Date.now() + Math.max(500, Number(timeoutMs || 0));
      const stableMs = Math.max(0, Number(PAGE_READY_STABLE_MS || 0));
      let readySince = 0;
      while (Date.now() < deadline) {
        await checkpoint(runId);
        const ready = document.readyState === "interactive" || document.readyState === "complete";
        const busy = queryAll(".loading-overlay, .loading-spinner, img[src*='ajaxloadingbar'], .p-component-overlay, .loading, .spinner, .ngx-spinner-overlay, .p-progress-spinner, .p-skeleton, [aria-busy='true']")
          .some((node) => isVisible(node));
        const appStable = isAngularStable();
        if (ready && !busy && appStable) {
          readySince = readySince || Date.now();
          if (Date.now() - readySince >= stableMs) {
            return;
          }
        } else {
          readySince = 0;
        }
        await sleep(pageReadyPollMs, runId);
      }
    }

    function isAngularStable() {
      const testabilityGetter = window.getAllAngularTestabilities;
      if (typeof testabilityGetter !== "function") {
        return true;
      }
      try {
        const testabilities = testabilityGetter();
        return !Array.isArray(testabilities) || testabilities.every((item) => !item || typeof item.isStable !== "function" || item.isStable());
      } catch {
        return true;
      }
    }

    async function slowModeDelayBeforeStep(action, runId = state.runToken) {
      if (!SLOW_MODE_ENABLED) {
        return;
      }
      const delayMs = action === "wait_for_selector" || action === "wait_for_enabled"
        ? Math.round(STEP_BEFORE_DELAY_MS / 2)
        : STEP_BEFORE_DELAY_MS;
      await sleep(delayMs, runId);
    }

    async function slowModeDelayAfterStep(step, runId = state.runToken) {
      if (!SLOW_MODE_ENABLED) {
        return;
      }
      const action = String(step?.action || "").trim().toLowerCase();
      if (actionHasInternalSettle(action)) {
        return;
      }
      let delayMs = STEP_AFTER_DELAY_MS;
      if (action === "click" || action === "click_success_popup_action") {
        delayMs = CLICK_SETTLE_DELAY_MS;
      } else if (action === "fill" || action === "fill_arabic_minimal") {
        delayMs = FILL_SETTLE_DELAY_MS;
      } else if (action === "wait_for_selector" || action === "wait_for_enabled") {
        delayMs = WAIT_SETTLE_DELAY_MS;
      }
      await sleep(delayMs, runId);
    }

    function actionHasInternalSettle(action) {
      return [
        "set_files",
        "set_phone_fields",
        "set_calendar_date",
        "select_primeng_dropdown",
        "select_labeled_dropdown",
        "set_disclosure_all_no",
      ].includes(action);
    }

    async function humanDelayBeforeAction(action, runId = state.runToken) {
      let base = Number(HUMAN_DEFAULT_DELAY_MS || (SLOW_MODE_ENABLED ? 450 : 120));
      let jitter = Number(HUMAN_DEFAULT_JITTER_MS || (SLOW_MODE_ENABLED ? 250 : 120));
      if (["click", "select_primeng_dropdown", "set_calendar_date"].includes(action)) {
        base = Number(HUMAN_CLICK_DELAY_MS || (SLOW_MODE_ENABLED ? 700 : 220));
        jitter = Number(HUMAN_CLICK_JITTER_MS || jitter);
      }
      if (action === "set_files") {
        base = Number(HUMAN_UPLOAD_DELAY_MS || (SLOW_MODE_ENABLED ? 900 : 120));
        jitter = Number(HUMAN_UPLOAD_JITTER_MS || jitter);
      }
      await sleep(base + Math.floor(Math.random() * Math.max(0, jitter)), runId);
    }

    return {
      waitForInput,
      waitForEnabled,
      waitForSelector,
      waitUntil,
      waitForPageReady,
      slowModeDelayBeforeStep,
      slowModeDelayAfterStep,
      humanDelayBeforeAction,
    };
  }

  root.waitUtils = Object.freeze({
    createWaitUtils,
  });
})();
