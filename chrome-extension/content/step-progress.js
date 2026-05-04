(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};

  function createStepProgress({
    state,
    postProgress,
    postToPanel,
    clearActiveHighlight,
  }) {
    function finishStep(step, selector) {
      if (countsForProgress(step)) {
        state.progressCurrent = Math.min(state.progressCurrent + 1, state.progressTotal);
        postProgress();
      }
      clearActiveHighlight();
      if (selector) {
        postToPanel("NUSUK_PANEL_STEP", { selector, action: String(step?.action || "") });
      }
    }

    return {
      finishStep,
      countsForProgress,
    };
  }

  function countsForProgress(step) {
    const action = String(step?.action || "").trim().toLowerCase();
    return [
      "wait_for_selector",
      "wait_for_enabled",
      "wait_for_nusuk_page_ready",
      "click",
      "open_mutamer_form",
      "fill",
      "fill_arabic_minimal",
      "clear_fields",
      "clear_residency_info",
      "delete_labeled_attachment",
      "set_phone_fields",
      "set_calendar_date",
      "select_primeng_dropdown",
      "select_labeled_dropdown",
      "set_files",
      "set_disclosure_all_no",
      "click_success_popup_action",
    ].includes(action);
  }

  root.stepProgress = Object.freeze({
    createStepProgress,
    countsForProgress,
  });
})();
