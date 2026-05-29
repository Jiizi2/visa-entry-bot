import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeController } from "../src/main-runtime.js";

function createFixture(overrides = {}) {
  const state = {
    isChoosingFolder: true,
    isStartingScan: true,
    statusDetail: "",
    statusHeadline: "",
  };
  const calls = {
    appendScanLog: [],
    renderAll: 0,
  };
  const documentRef = {
    body: {
      innerHTML: "",
    },
  };
  const controller = createRuntimeController({
    state,
    appendScanLog: (message) => {
      calls.appendScanLog.push(message);
    },
    renderAll: overrides.renderAll ?? (() => {
      calls.renderAll += 1;
    }),
    documentRef,
  });

  return {
    calls,
    controller,
    documentRef,
    state,
  };
}

test("runtime controller reports synchronous action failures", () => {
  const { calls, controller, state } = createFixture();

  controller.runAction(() => {
    throw new Error("boom");
  }, "Scan");

  assert.equal(state.statusHeadline, "Scan gagal");
  assert.equal(state.statusDetail, "boom");
  assert.equal(state.isChoosingFolder, false);
  assert.equal(state.isStartingScan, false);
  assert.deepEqual(calls.appendScanLog, ["[APP] Scan gagal | boom"]);
  assert.equal(calls.renderAll, 1);
});

test("runtime controller reports asynchronous action failures", async () => {
  const { calls, controller, state } = createFixture();

  controller.runAction(Promise.reject(new Error("async boom")), "Export");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(state.statusHeadline, "Export gagal");
  assert.equal(state.statusDetail, "async boom");
  assert.deepEqual(calls.appendScanLog, ["[APP] Export gagal | async boom"]);
  assert.equal(calls.renderAll, 1);
});

test("runtime controller shows escaped fatal screen when rendering fails", () => {
  const { controller, documentRef } = createFixture({
    renderAll: () => {
      throw new Error("render <failed>");
    },
  });

  controller.reportRuntimeError("<bad>", "Review");

  assert.match(documentRef.body.innerHTML, /Halaman gagal dimuat/);
  assert.match(documentRef.body.innerHTML, /Review: &lt;bad&gt;/);
  assert.match(documentRef.body.innerHTML, /Render: render &lt;failed&gt;/);
});
