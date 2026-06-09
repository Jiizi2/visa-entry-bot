import { isDateFieldKey } from "./fields.js";
import { normalizeDateToNusuk } from "./utils.js";

export function createWorkspaceDatePickerController({
  dom,
  appWindow = window,
  documentRef = document,
}) {
  function initializeWorkspaceDatePickers() {
    const factory = appWindow.flatpickr;
    if (typeof factory !== "function" || !dom.fieldReviewRows) {
      return;
    }

    const dateInputs = [...dom.fieldReviewRows.querySelectorAll("input.js-date-input[data-field-key]")];
    for (const input of dateInputs) {
      const fieldKey = String(input.dataset.fieldKey ?? "");
      if (!isDateFieldKey(fieldKey)) {
        continue;
      }

      const normalized = normalizeDateToNusuk(input.value);
      input.value = normalized;

      if (input._flatpickr) {
        input._flatpickr.destroy();
      }

      factory(input, {
        locale: factory?.l10ns?.id || "default",
        dateFormat: "Y/m/d",
        altInput: false,
        allowInput: true,
        disableMobile: true,
        defaultDate: normalized || null,
        appendTo: documentRef.body,
        positionElement: input,
        position: "below left",
        monthSelectorType: "static",
        onValueUpdate: (_selectedDates, dateStr, instance) => {
          syncDatePickerValue(instance, dateStr);
        },
      });
    }
  }

  function syncDatePickerValue(instance, dateStr) {
    if (!instance?.input) {
      return;
    }

    const nextValue = normalizeDateToNusuk(dateStr || instance.input.value || "");
    const currentValue = String(instance.input.value ?? "").trim();
    if (nextValue === currentValue) {
      return;
    }

    const EventCtor = appWindow.Event || globalThis.Event;
    instance.input.value = nextValue;
    instance.input.dispatchEvent(new EventCtor("change", { bubbles: true }));
  }

  return {
    initializeWorkspaceDatePickers,
    syncDatePickerValue,
  };
}
