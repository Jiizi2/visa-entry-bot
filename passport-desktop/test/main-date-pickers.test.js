import assert from "node:assert/strict";
import test from "node:test";

import { createWorkspaceDatePickerController } from "../src/shared/date-pickers.js";

class FakeEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.bubbles = Boolean(options.bubbles);
  }
}

function createInput({ fieldKey, value = "" }) {
  return {
    dataset: { fieldKey },
    dispatchedEvents: [],
    value,
    dispatchEvent(event) {
      this.dispatchedEvents.push(event);
    },
  };
}

test("workspace date picker initializes date inputs and normalizes picker updates", () => {
  const dateInput = createInput({ fieldKey: "dob", value: "1980-1-2" });
  const textInput = createInput({ fieldKey: "firstName", value: "Adult" });
  let destroyCount = 0;
  dateInput._flatpickr = {
    destroy() {
      destroyCount += 1;
    },
  };
  const factoryCalls = [];
  function flatpickr(input, options) {
    factoryCalls.push({ input, options });
  }
  flatpickr.l10ns = { id: "id-locale" };
  const controller = createWorkspaceDatePickerController({
    dom: {
      fieldReviewRows: {
        querySelectorAll: () => [dateInput, textInput],
      },
    },
    appWindow: {
      Event: FakeEvent,
      flatpickr,
    },
    documentRef: {
      body: { nodeName: "BODY" },
    },
  });

  controller.initializeWorkspaceDatePickers();

  assert.equal(destroyCount, 1);
  assert.equal(factoryCalls.length, 1);
  assert.equal(factoryCalls[0].input, dateInput);
  assert.equal(dateInput.value, "1980/01/02");
  assert.equal(factoryCalls[0].options.locale, "id-locale");
  assert.equal(factoryCalls[0].options.defaultDate, "1980/01/02");
  assert.equal(factoryCalls[0].options.appendTo.nodeName, "BODY");

  factoryCalls[0].options.onValueUpdate([], "1990-2-3", { input: dateInput });

  assert.equal(dateInput.value, "1990/02/03");
  assert.equal(dateInput.dispatchedEvents.length, 1);
  assert.equal(dateInput.dispatchedEvents[0].type, "change");
  assert.equal(dateInput.dispatchedEvents[0].bubbles, true);
});

test("workspace date picker does not dispatch when the normalized value is unchanged", () => {
  const input = createInput({ fieldKey: "dob", value: "1990/02/03" });
  const controller = createWorkspaceDatePickerController({
    dom: {},
    appWindow: {
      Event: FakeEvent,
    },
    documentRef: {
      body: {},
    },
  });

  controller.syncDatePickerValue({ input }, "1990-02-03");

  assert.equal(input.value, "1990/02/03");
  assert.equal(input.dispatchedEvents.length, 0);
});
