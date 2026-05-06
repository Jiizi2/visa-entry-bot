(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const { interpolate } = root.valueUtils || {};
  const { createStepProgress } = root.stepProgress || {};
  const { createStepBasicActions } = root.stepBasicActions || {};
  const { createStepFormActions } = root.stepFormActions || {};
  const { createStepUploadActions } = root.stepUploadActions || {};
  if (!interpolate || !createStepProgress || !createStepBasicActions || !createStepFormActions || !createStepUploadActions) {
    throw new Error("NusukAutofill step runner dependencies were not loaded.");
  }

  function createStepRunner({
    state,
    checkpoint,
    sleep,
    waitForInput,
    waitForEnabled,
    waitForSelector,
    waitForPageReady,
    slowModeDelayBeforeStep,
    humanDelayBeforeAction,
    markActiveElement,
    clearActiveHighlight,
    appendLog,
    postProgress,
    postToPanel,
    waitForProceedOrPassportDetails,
    waitForNusukPageReady,
    clickProceedButtonRobust,
    waitForEnabledNextButton,
    clickNextButtonRobust,
    attemptFillRequiredFieldsForCurrentPage,
    clearFields,
    clearResidencyInfo,
    deleteLabeledAttachment,
    confirmDeleteIfShown,
    setPhoneFields,
    setCalendarDate,
    selectPrimengDropdown,
    selectLabeledDropdown,
    upload,
  }) {
    const {
      finishStep,
      countsForProgress,
    } = createStepProgress({
      state,
      postProgress,
      postToPanel,
      clearActiveHighlight,
    });
    const basicActions = createStepBasicActions({
      sleep,
      waitForInput,
      waitForEnabled,
      waitForSelector,
      waitForPageReady,
      markActiveElement,
      appendLog,
      finishStep,
      waitForProceedOrPassportDetails,
      waitForNusukPageReady,
      clickProceedButtonRobust,
      waitForEnabledNextButton,
      clickNextButtonRobust,
      attemptFillRequiredFieldsForCurrentPage,
    });
    const formActions = createStepFormActions({
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
    });
    const { handleSetFiles } = createStepUploadActions({
      sleep,
      markActiveElement,
      appendLog,
      finishStep,
      upload,
    });

    async function runStep(step, context) {
      const action = String(step?.action || "").trim().toLowerCase();
      const selector = interpolate(step?.selector || "", context);
      const timeoutMs = Number(step?.timeout_ms || 30000);
      const skipWhenEmpty = Boolean(step?.skip_when_empty);
      const runId = Number(context?.runId || state.runToken);

      await checkpoint(runId);
      await slowModeDelayBeforeStep(action, runId);

      if (action === "wait_for_selector") {
        await basicActions.handleWaitForSelector(step, selector, timeoutMs, runId);
        return;
      }

      if (action === "wait_for_enabled") {
        await basicActions.handleWaitForEnabled(step, context, selector, timeoutMs, runId);
        return;
      }

      if (action === "wait") {
        await basicActions.handleWait(step, selector, runId);
        return;
      }

      if (action === "wait_for_nusuk_page_ready") {
        await basicActions.handleWaitForNusukPageReady(step, selector, timeoutMs, runId);
        return;
      }

      if (action === "open_mutamer_form") {
        await basicActions.handleOpenMutamerForm(step, selector, timeoutMs, runId);
        return;
      }

      if (shouldWaitForPageBeforeAction(action)) {
        await waitForPageReady(Math.min(timeoutMs, 5000), runId);
      }
      await humanDelayBeforeAction(action, runId);

      if (action === "click") {
        await basicActions.handleClick(step, context, selector, timeoutMs, runId);
        return;
      }

      if (action === "click_add_companion") {
        await basicActions.handleClickAddCompanion(step, context, selector, timeoutMs, runId);
        return;
      }

      if (action === "fill") {
        await basicActions.handleFill(step, context, selector, timeoutMs, skipWhenEmpty, runId);
        return;
      }

      if (action === "fill_arabic_minimal") {
        basicActions.handleFillArabicMinimal(step, context, selector);
        return;
      }

      if (action === "clear_fields") {
        formActions.handleClearFields(step, selector);
        return;
      }

      if (action === "clear_residency_info") {
        await formActions.handleClearResidencyInfo(step, selector, runId);
        return;
      }

      if (action === "delete_labeled_attachment") {
        await formActions.handleDeleteLabeledAttachment(step, context, selector, runId);
        return;
      }

      if (action === "set_phone_fields") {
        await formActions.handleSetPhoneFields(step, context, selector, timeoutMs, skipWhenEmpty, runId);
        return;
      }

      if (action === "set_calendar_date") {
        await formActions.handleSetCalendarDate(step, context, selector, timeoutMs, skipWhenEmpty, runId);
        return;
      }

      if (action === "select_primeng_dropdown") {
        await formActions.handleSelectPrimengDropdown(step, context, selector, timeoutMs, skipWhenEmpty, runId);
        return;
      }

      if (action === "select_labeled_dropdown") {
        await formActions.handleSelectLabeledDropdown(step, context, selector, timeoutMs, skipWhenEmpty, runId);
        return;
      }

      if (action === "set_files") {
        await handleSetFiles(step, context, selector, timeoutMs, skipWhenEmpty, runId);
        return;
      }

      if (action === "set_disclosure_all_no") {
        await formActions.handleSetDisclosureAllNo(step, selector, runId);
        return;
      }

      if (action === "click_success_popup_action") {
        await basicActions.handleClickSuccessPopupAction(step, context, selector, timeoutMs, runId);
        return;
      }

      throw new Error(`Unsupported action: ${action}`);
    }

    function shouldWaitForPageBeforeAction(action) {
      return [
        "click",
        "click_add_companion",
        "set_files",
        "set_phone_fields",
        "set_calendar_date",
        "select_primeng_dropdown",
        "select_labeled_dropdown",
        "set_disclosure_all_no",
        "click_success_popup_action",
      ].includes(action);
    }

    return {
      runStep,
      countsForProgress,
    };
  }

  root.stepRunner = Object.freeze({
    createStepRunner,
  });
})();
