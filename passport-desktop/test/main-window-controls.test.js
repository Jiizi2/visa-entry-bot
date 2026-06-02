import assert from "node:assert/strict";
import test from "node:test";

import {
  bindWindowControls,
  updateMaximizeButton,
} from "../src/main-window-controls.js";

function fakeButton() {
  const listeners = new Map();
  const classes = new Set();
  const attrs = new Map();
  return {
    listeners,
    classList: {
      toggle(name, force) {
        if (force) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
      },
      contains(name) {
        return classes.has(name);
      },
    },
    addEventListener(eventName, handler) {
      listeners.set(eventName, handler);
    },
    setAttribute(name, value) {
      attrs.set(name, String(value));
    },
    getAttribute(name) {
      return attrs.get(name) || "";
    },
  };
}

test("bindWindowControls hides custom frame in browser fallback", () => {
  const titlebar = fakeButton();
  const bodyClasses = new Set();

  const result = bindWindowControls({
    dom: { windowTitlebar: titlebar },
    appWindow: { __PASSPORT_BROWSER_BRIDGE__: true },
    documentRef: {
      body: {
        classList: {
          toggle(name, force) {
            if (force) {
              bodyClasses.add(name);
            } else {
              bodyClasses.delete(name);
            }
          },
        },
      },
    },
  });

  assert.deepEqual(result, { isBrowserHost: true, controlsEnabled: false });
  assert.equal(titlebar.getAttribute("aria-hidden"), "true");
  assert.equal(bodyClasses.has("is-browser-host"), true);
});

test("bindWindowControls invokes desktop window commands", async () => {
  const calls = [];
  const dom = {
    windowTitlebar: fakeButton(),
    windowMinimizeButton: fakeButton(),
    windowMaximizeButton: fakeButton(),
    windowCloseButton: fakeButton(),
  };
  const result = bindWindowControls({
    dom,
    appWindow: {},
    documentRef: { body: { classList: { toggle() {} } } },
    invoke: async (command) => {
      calls.push(command);
      return command === "window_toggle_maximize";
    },
  });

  dom.windowTitlebar.listeners.get("mousedown")({
    button: 0,
    detail: 1,
    target: { closest: () => null },
  });
  dom.windowMinimizeButton.listeners.get("click")();
  dom.windowMaximizeButton.listeners.get("click")();
  dom.windowCloseButton.listeners.get("click")();
  await Promise.resolve();

  assert.deepEqual(result, { isBrowserHost: false, controlsEnabled: true });
  assert.deepEqual(calls, [
    "window_start_dragging",
    "window_minimize",
    "window_toggle_maximize",
    "window_close",
  ]);
  assert.equal(dom.windowMaximizeButton.classList.contains("is-restorable"), true);
});

test("bindWindowControls does not drag when double clicking titlebar controls", async () => {
  const calls = [];
  const dom = {
    windowTitlebar: fakeButton(),
    windowMinimizeButton: fakeButton(),
    windowMaximizeButton: fakeButton(),
    windowCloseButton: fakeButton(),
  };
  bindWindowControls({
    dom,
    appWindow: {},
    documentRef: { body: { classList: { toggle() {} } } },
    invoke: async (command) => {
      calls.push(command);
      return false;
    },
  });

  dom.windowTitlebar.listeners.get("mousedown")({
    button: 0,
    detail: 2,
    target: { closest: () => null },
  });
  dom.windowTitlebar.listeners.get("mousedown")({
    button: 0,
    detail: 1,
    target: { closest: () => ({ tagName: "BUTTON" }) },
  });
  await Promise.resolve();

  assert.deepEqual(calls, []);
});

test("updateMaximizeButton toggles restore affordance", () => {
  const button = fakeButton();

  updateMaximizeButton(button, true);

  assert.equal(button.classList.contains("is-restorable"), true);
  assert.equal(button.getAttribute("aria-label"), "Restore");

  updateMaximizeButton(button, false);

  assert.equal(button.classList.contains("is-restorable"), false);
  assert.equal(button.getAttribute("title"), "Maximize");
});
