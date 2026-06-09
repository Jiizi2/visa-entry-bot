import assert from "node:assert/strict";
import test from "node:test";

import {
  errorMessage,
  startRendererHeartbeat,
  tauriBindings,
} from "../src/core/system.js";

test("errorMessage normalizes thrown values", () => {
  assert.equal(errorMessage(new Error("boom")), "boom");
  assert.equal(errorMessage("plain"), "plain");
  assert.equal(errorMessage(null), "Terjadi error yang tidak diketahui.");
});

test("tauriBindings returns required desktop bridge methods", () => {
  const invoke = () => {};
  const listen = () => {};
  const open = () => {};
  const convertFileSrc = () => {};
  assert.deepEqual(tauriBindings({
    __TAURI__: {
      core: { invoke, convertFileSrc },
      event: { listen },
      dialog: { open },
    },
  }), {
    invoke,
    listen,
    open,
    convertFileSrc,
  });
});

test("startRendererHeartbeat invokes heartbeat immediately and schedules interval", async () => {
  const calls = [];
  const intervals = [];
  startRendererHeartbeat({
    __TAURI__: {
      core: {
        invoke: (command) => {
          calls.push(command);
          return Promise.resolve();
        },
      },
    },
    setInterval: (callback, intervalMs) => {
      intervals.push({ callback, intervalMs });
    },
  }, 25);

  assert.deepEqual(calls, ["renderer_heartbeat"]);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].intervalMs, 25);
  intervals[0].callback();
  await Promise.resolve();
  assert.deepEqual(calls, ["renderer_heartbeat", "renderer_heartbeat"]);
});
