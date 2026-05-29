import assert from "node:assert/strict";
import test from "node:test";

import { createImportViewController } from "../src/main-import-view.js";

class FakeInput {
  constructor(value, checked = false) {
    this.checked = checked;
    this.disabled = false;
    this.value = value;
  }
}

function createFixture(overrides = {}) {
  const speedInput = new FakeInput("speed");
  const heavyInput = new FakeInput("heavy", true);
  const state = {
    isScanning: false,
    manifestPath: "",
    ocrMode: "speed",
    selectedDir: "C:/batch",
    statusDetail: "",
    statusHeadline: "",
    ...overrides.state,
  };
  const calls = {
    updateActionAvailability: 0,
    updateOcrMode: [],
  };
  const controller = createImportViewController({
    dom: {
      ocrModeInputs: [speedInput, heavyInput],
      systemOcrStatus: {
        className: "",
        textContent: "",
      },
    },
    state,
    hasAnyScanResult: overrides.hasAnyScanResult ?? (() => false),
    hasScanResultForSelectedDir: overrides.hasScanResultForSelectedDir ?? (() => false),
    updateActionAvailability: () => {
      calls.updateActionAvailability += 1;
    },
    updateOcrMode: (value) => {
      calls.updateOcrMode.push(value);
      state.ocrMode = value;
    },
    inputElementClass: FakeInput,
  });

  return {
    calls,
    controller,
    heavyInput,
    speedInput,
    state,
  };
}

test("import view controller updates OCR mode from checked input", () => {
  const { calls, controller, heavyInput, speedInput, state } = createFixture();

  controller.handleOcrModeChange({ target: heavyInput });

  assert.deepEqual(calls.updateOcrMode, ["heavy"]);
  assert.equal(calls.updateActionAvailability, 1);
  assert.equal(state.ocrMode, "heavy");
  assert.equal(state.statusHeadline, "Mode OCR: Heavy");
  assert.equal(state.statusDetail, "Mode akan dipakai saat scan berikutnya dimulai.");
  assert.equal(speedInput.checked, false);
  assert.equal(heavyInput.checked, true);
});

test("import view controller only refreshes selector while scanning", () => {
  const { calls, controller, heavyInput, speedInput, state } = createFixture({
    state: {
      isScanning: true,
      ocrMode: "speed",
    },
  });

  controller.handleOcrModeChange({ target: heavyInput });

  assert.deepEqual(calls.updateOcrMode, []);
  assert.equal(calls.updateActionAvailability, 0);
  assert.equal(state.ocrMode, "speed");
  assert.equal(speedInput.checked, true);
  assert.equal(heavyInput.checked, false);
  assert.equal(speedInput.disabled, true);
  assert.equal(heavyInput.disabled, true);
});

test("import view controller exposes OCR status descriptor", () => {
  const { controller } = createFixture({
    hasAnyScanResult: () => true,
    hasScanResultForSelectedDir: () => false,
    state: {
      selectedDir: "C:/new-batch",
    },
  });

  assert.deepEqual(controller.ocrStatusDescriptor(), {
    label: "Data Lama Aktif",
    tone: "warn",
  });
});
