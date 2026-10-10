(function () {
  const root = window.NusukAutofill = window.NusukAutofill || {};
  const {
    PASSPORT_UPLOAD_SELECTOR,
    VACCINATION_UPLOAD_SELECTOR,
    MOBILE_NUMBER_SELECTOR,
  } = root.constants || {};
  if (!PASSPORT_UPLOAD_SELECTOR) {
    throw new Error("NusukAutofill constants were not loaded.");
  }

  function buildPerMemberSteps(nextButtonSelector) {
    const { nameSelector } = root.identityGuard;
    return [
      {
        action: "wait_for_nusuk_page_ready",
        page: "upload",
        timeout_ms: 30000,
      },
      {
        action: "set_files",
        selector: PASSPORT_UPLOAD_SELECTOR,
        upload_kind: "passport",
        value: "{{member.passportImagePath}}",
      },
      {
        action: "wait_for_selector",
        selector: ".popup .popup-actions button:has-text('Proceed'):visible",
        timeout_ms: 120000,
      },
      {
        action: "click",
        selector: ".popup .popup-actions button:has-text('Proceed'):visible",
        timeout_ms: 30000,
      },
      {
        action: "wait_for_nusuk_page_ready",
        page: "passport_details",
        timeout_ms: 30000,
      },
      { action: "verify_passport_identity" },
      {
        action: "select_primeng_dropdown",
        selector: "p-dropdown[formcontrolname='previousNationalityId'] .p-dropdown:not(.p-disabled)",
        option_text: "{{member.resolvedProfile.previousNationality}}",
        skip_when_empty: true,
      },
      {
        action: "select_primeng_dropdown",
        selector: "p-dropdown[formcontrolname='passportTypeId'] .p-dropdown:not(.p-disabled)",
        option_text: "{{member.resolvedProfile.passportType}}",
        option_kind: "passport_type",
      },
      {
        action: "set_calendar_date",
        selector: "p-calendar[formcontrolname='passportIssueDate'] input[type='text']",
        popup_selector: ".p-datepicker",
        value: "{{entryReleaseDate}}",
      },
      {
        action: "fill",
        selector: "input[formcontrolname='issueCityName']",
        value: "{{member.resolvedProfile.cityOfIssued}}",
      },
      {
        action: "wait_for_enabled",
        selector: nextButtonSelector,
        timeout_ms: 30000,
      },
      {
        action: "click",
        selector: nextButtonSelector,
        timeout_ms: 30000,
      },
      {
        action: "wait_for_nusuk_page_ready",
        page: "member_form",
        timeout_ms: 120000,
      },
      {
        action: "wait_for_selector",
        selector: "div[formgroupname='firstName'] input[formcontrolname='ar'], input[placeholder*='Arabic'][placeholder*='First'], input[formcontrolname='profession'], input[placeholder='Profession']",
        timeout_ms: 120000,
      },
      { action: "verify_passport_name" },
      {
        action: "fill_arabic_minimal",
        first_value: "{{member.resolvedProfile.arabic.firstName}}",
        family_value: "{{member.resolvedProfile.arabic.familyName}}",
      },
      {
        action: "fill",
        selector: nameSelector(0, "ar"),
        value: "{{member.resolvedProfile.arabic.firstName}}",
      },
      {
        action: "fill",
        selector: nameSelector(1, "ar"),
        value: "{{member.resolvedProfile.arabic.fatherName}}",
        clear_when_empty: true,
      },
      {
        action: "fill",
        selector: nameSelector(2, "ar"),
        value: "{{member.resolvedProfile.arabic.grandfatherName}}",
        clear_when_empty: true,
      },
      {
        action: "fill",
        selector: nameSelector(3, "ar"),
        value: "{{member.resolvedProfile.arabic.familyName}}",
      },
      {
        action: "fill",
        selector: nameSelector(0, "en"),
        value: "{{member.resolvedProfile.firstName}}",
      },
      {
        action: "fill",
        selector: nameSelector(1, "en"),
        value: "{{member.resolvedProfile.fatherName}}",
        clear_when_empty: true,
      },
      {
        action: "fill",
        selector: nameSelector(2, "en"),
        value: "{{member.resolvedProfile.grandfatherName}}",
        clear_when_empty: true,
      },
      {
        action: "fill",
        selector: nameSelector(3, "en"),
        value: "{{member.resolvedProfile.familyName}}",
      },
      {
        action: "fill",
        selector: "input[formcontrolname='profession'], input[name='profession'], input[placeholder='Profession']",
        value: "{{member.resolvedProfile.profession}}",
      },
      {
        action: "select_primeng_dropdown",
        selector: "select[formcontrolname='birthCountryId'], p-dropdown[formcontrolname='birthCountryId'] .p-dropdown:not(.p-disabled), p-dropdown[formcontrolname='birthCountryId'] .p-dropdown",
        option_text: "{{member.resolvedProfile.birthCountry}}",
        option_kind: "birth_country",
      },
      {
        action: "fill",
        selector: "input[formcontrolname='birthCityName'], input[name='birthCityName'], input[placeholder='Birth City']",
        value: "{{member.resolvedProfile.birthCity}}",
      },
      {
        action: "select_labeled_dropdown",
        label_text: "Marital Status",
        option_text: "{{member.resolvedProfile.maritalStatus}}",
        option_kind: "marital_status",
      },
      {
        action: "set_files",
        selector: VACCINATION_UPLOAD_SELECTOR,
        upload_kind: "vaccination",
        optional_selector: true,
        timeout_ms: 8000,
        value: "{{member.passportImagePath}}",
      },
      {
        action: "fill",
        selector: "input[formcontrolname='email'], input[name='email'], input[placeholder='Email'], input[type='email'][placeholder='Email']",
        value: "{{member.resolvedProfile.email}}",
      },
      {
        action: "set_phone_fields",
        selector: MOBILE_NUMBER_SELECTOR,
        value: "{{member.resolvedProfile.mobileNumber}}",
      },
      {
        action: "click_add_companion",
        minor_only: true,
        selector: [
          ".companion button",
          ".companion a",
          ".companion [role='button']",
          "[class*='companion' i] button",
          "[class*='companion' i] a",
          "[class*='companion' i] [role='button']",
          "button:has-text('Add Companion')",
          "button:has-text('Companion')",
          "a:has-text('Add Companion')",
          "[role='button']:has-text('Add Companion')",
        ].join(", "),
        optional_selector: true,
        timeout_ms: 10000,
      },
      {
        action: "wait_for_enabled",
        selector: nextButtonSelector,
        timeout_ms: 30000,
      },
      {
        action: "click",
        selector: nextButtonSelector,
        timeout_ms: 30000,
      },
      {
        action: "wait_for_selector",
        selector: ".card .title:has-text('Disclosure Form')",
        timeout_ms: 30000,
      },
      {
        action: "wait_for_nusuk_page_ready",
        page: "disclosure",
        timeout_ms: 30000,
      },
      {
        action: "set_disclosure_all_no",
        selector: ".card",
        timeout_ms: 10000,
      },
      {
        action: "wait_for_enabled",
        selector: nextButtonSelector,
        timeout_ms: 30000,
      },
      {
        action: "click",
        selector: nextButtonSelector,
        timeout_ms: 30000,
      },
      {
        action: "wait_for_nusuk_page_ready",
        page: "summary",
        timeout_ms: 30000,
      },
      {
        action: "wait_for_enabled",
        selector: nextButtonSelector,
        timeout_ms: 30000,
      },
      {
        action: "click",
        selector: nextButtonSelector,
        timeout_ms: 30000,
      },
      {
        action: "wait_for_selector",
        selector: ".popup h3:has-text('Mutamer has been added successfully')",
        timeout_ms: 30000,
      },
      {
        action: "click_success_popup_action",
        timeout_ms: 15000,
      },
    ];
  }

  root.automationSteps = Object.freeze({
    buildPerMemberSteps,
  });
})();
