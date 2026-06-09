import assert from "node:assert/strict";
import test from "node:test";

import { createPassportPreviewActions } from "../src/features/passport/preview-actions.js";

test("passport preview actions initialize and proxy controller calls", () => {
  const calls = [];
  const controller = {
    changeZoom: (delta) => calls.push(["changeZoom", delta]),
    handleKeydown: (event) => calls.push(["handleKeydown", event.key]),
    handleWheel: (event) => calls.push(["handleWheel", event.deltaY]),
    isImageReady: () => true,
    render: () => calls.push(["render"]),
    renderZoomControls: () => calls.push(["renderZoomControls"]),
    resetZoom: () => calls.push(["resetZoom"]),
    resetZoomState: () => calls.push(["resetZoomState"]),
  };
  const actions = createPassportPreviewActions({
    state: {},
    dom: {},
    requestFrame: (callback) => callback(),
    activeMember: () => null,
    isMemberReviewConfirmed: () => false,
    loadPassportImageData: async () => ({}),
    createController: () => controller,
  });

  actions.initializePassportPreviewController();
  actions.renderPassportPreview();
  actions.changePassportPreviewZoom(0.25);
  actions.resetPassportPreviewZoom();
  actions.resetPassportPreviewZoomState();
  actions.handlePassportPreviewWheel({ deltaY: 120 });
  actions.handlePassportPreviewKeydown({ key: "+" });
  actions.renderPassportPreviewZoomControls();

  assert.equal(actions.isPassportPreviewImageReady(), true);
  assert.deepEqual(calls, [
    ["render"],
    ["changeZoom", 0.25],
    ["resetZoom"],
    ["resetZoomState"],
    ["handleWheel", 120],
    ["handleKeydown", "+"],
    ["renderZoomControls"],
  ]);
});

test("passport preview actions are safe before initialization", () => {
  const actions = createPassportPreviewActions({
    state: {},
    dom: {},
    requestFrame: (callback) => callback(),
    activeMember: () => null,
    isMemberReviewConfirmed: () => false,
    loadPassportImageData: async () => ({}),
  });

  actions.renderPassportPreview();

  assert.equal(actions.isPassportPreviewImageReady(), false);
});
