export function buildPerMemberSteps(nextButtonSelector) {
  const vaccinationUploadSelector = [
    "input[type='file'][formcontrolname='vaccinationPicture']",
    "input[type='file'][name='vaccinationPicture']",
    "input[type='file'][formcontrolname*='vaccin' i]",
    "input[type='file'][name*='vaccin' i]",
    "input[type='file'][id*='vaccin' i]",
    "input[type='file'][formcontrolname*='vaccine' i]",
    "input[type='file'][name*='vaccine' i]",
    "input[type='file'][id*='vaccine' i]",
    "input[type='file'][formcontrolname*='immun' i]",
    "input[type='file'][name*='immun' i]",
    "input[type='file'][id*='immun' i]",
  ].join(", ");

  return [
    // PAGE 1 - Passport & Identity
    {
      action: "set_files",
      selector: ".container__notes__upload__button input[type='file']",
      value: "{{member.passportImagePath}}",
    },
    {
      action: "wait_for_selector",
      selector: ".popup.popup-small .popup-actions button:has-text('Proceed'):visible",
      timeout_ms: 120000,
    },
    {
      action: "click",
      selector: ".popup.popup-small .popup-actions button:has-text('Proceed'):visible",
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
      timeout_ms: 10000,
    },

    // PAGE 2 - Personal & Contact
    {
      action: "wait_for_selector",
      selector: "div[formgroupname='firstName'] input[formcontrolname='ar'], input[placeholder*='Arabic'][placeholder*='First'], input[formcontrolname='profession'], input[placeholder='Profession']",
      timeout_ms: 120000,
    },
    {
      action: "fill_arabic_minimal",
      first_value: "{{member.resolvedProfile.arabic.firstName}}",
      family_value: "{{member.resolvedProfile.arabic.familyName}}",
      timeout_ms: 30000,
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
      action: "select_primeng_dropdown",
      selector: "select[formcontrolname='martialStatusId'], select[formcontrolname='maritalStatusId'], p-dropdown[formcontrolname='martialStatusId'] .p-dropdown:not(.p-disabled), p-dropdown[formcontrolname='maritalStatusId'] .p-dropdown:not(.p-disabled), p-dropdown[formcontrolname='martialStatusId'] .p-dropdown, p-dropdown[formcontrolname='maritalStatusId'] .p-dropdown",
      option_text: "{{member.resolvedProfile.maritalStatus}}",
      option_kind: "marital_status",
    },
    {
      action: "set_files",
      selector: vaccinationUploadSelector,
      nth: null,
      value: "{{member.passportImagePath}}",
    },
    {
      action: "fill",
      selector: "input[formcontrolname='email'], input[name='email'], input[placeholder='Email'], input[type='email'][placeholder='Email']",
      value: "{{member.resolvedProfile.email}}",
    },
    {
      action: "set_phone_fields",
      selector: "input[formcontrolname='phone'], input[name='phone'], input[formcontrolname='mobileNumber'], input[name='mobileNumber'], input[placeholder='Mobile Number'], input[placeholder='Phone Number'], input[placeholder*='Phone'], input[placeholder*='Mobile'], input[type='tel'], ngx-intl-tel-input input",
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
      timeout_ms: 10000,
    },

    // PAGE 3 - Disclosure
    {
      action: "wait_for_selector",
      selector: ".card .title:has-text('Disclosure Form')",
      timeout_ms: 30000,
    },
    {
      action: "set_disclosure_all_no",
      selector: ".card",
    },
    {
      action: "wait_for_enabled",
      selector: nextButtonSelector,
      timeout_ms: 30000,
    },
    {
      action: "click",
      selector: nextButtonSelector,
      timeout_ms: 10000,
    },

    // PAGE 4 - Confirmation
    {
      action: "wait_for_enabled",
      selector: nextButtonSelector,
      timeout_ms: 30000,
    },
    {
      action: "click",
      selector: nextButtonSelector,
      timeout_ms: 10000,
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
