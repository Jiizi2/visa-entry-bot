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
      {
        action: "fill_arabic_minimal",
        first_value: "{{member.resolvedProfile.arabic.firstName}}",
        family_value: "{{member.resolvedProfile.arabic.familyName}}",
      },
      {
        action: "fill",
        selector: "div[formgroupname='firstName'] input[formcontrolname='ar'], input[formcontrolname='firstName.ar'], input[name='firstName.ar'], input[placeholder='First Name (Arabic)'], input[placeholder='First name (Arabic)'], input[placeholder*='Arabic'][placeholder*='First']",
        value: "{{member.resolvedProfile.arabic.firstName}}",
      },
      {
        action: "fill",
        selector: "div[formgroupname='secondName'] input[formcontrolname='ar'], input[placeholder=\"Father's Name (Arabic)\"], input[placeholder='Father Name (Arabic)'], input[placeholder*='Arabic'][placeholder*='Father']",
        value: "{{member.resolvedProfile.arabic.fatherName}}",
        skip_when_empty: true,
      },
      {
        action: "fill",
        selector: "div[formgroupname='thirdName'] input[formcontrolname='ar'], input[placeholder='Grandfather Name (Arabic)'], input[placeholder*='Arabic'][placeholder*='Grand']",
        value: "{{member.resolvedProfile.arabic.grandfatherName}}",
        skip_when_empty: true,
      },
      {
        action: "fill",
        selector: "div[formgroupname='familyName'] input[formcontrolname='ar'], input[formcontrolname='familyName.ar'], input[name='familyName.ar'], input[placeholder='Family Name (Arabic)'], input[placeholder*='Arabic'][placeholder*='Family']",
        value: "{{member.resolvedProfile.arabic.familyName}}",
      },
      {
        action: "fill",
        selector: "div[formgroupname='firstName'] input[formcontrolname='en'], input[formcontrolname='firstName.en'], input[name='firstName.en'], input[placeholder='First name'], input[placeholder='First Name'], input[placeholder*='First'][placeholder]:not([placeholder*='Arabic'])",
        value: "{{member.resolvedProfile.firstName}}",
      },
      {
        action: "fill",
        selector: "div[formgroupname='secondName'] input[formcontrolname='en'], input[placeholder='Father name'], input[placeholder='Father Name'], input[placeholder*='Father'][placeholder]:not([placeholder*='Arabic'])",
        value: "{{member.resolvedProfile.fatherName}}",
        skip_when_empty: true,
      },
      {
        action: "fill",
        selector: "div[formgroupname='thirdName'] input[formcontrolname='en'], input[placeholder='Grand father'], input[placeholder='Grandfather Name'], input[placeholder*='Grand'][placeholder]:not([placeholder*='Arabic'])",
        value: "{{member.resolvedProfile.grandfatherName}}",
        skip_when_empty: true,
      },
      {
        action: "fill",
        selector: "div[formgroupname='familyName'] input[formcontrolname='en'], input[formcontrolname='familyName.en'], input[name='familyName.en'], input[placeholder='Family Name'], input[placeholder*='Family'][placeholder]:not([placeholder*='Arabic'])",
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
