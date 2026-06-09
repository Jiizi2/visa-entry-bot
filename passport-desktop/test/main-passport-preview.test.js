import assert from "node:assert/strict";
import test from "node:test";

import {
  PASSPORT_PREVIEW_ZOOM_DEFAULT,
  clampPassportPreviewZoom,
  createPassportPreviewController,
} from "../src/features/passport/preview.js";

function fakeElement() {
  const classes = new Set();
  const attributes = new Map();
  return {
    textContent: "",
    disabled: false,
    src: "",
    alt: "",
    scrollLeft: 0,
    scrollTop: 0,
    scrollWidth: 100,
    scrollHeight: 100,
    clientWidth: 50,
    clientHeight: 50,
    className: "",
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, force) => {
        if (force) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
      },
    },
    style: {
      values: new Map(),
      setProperty(name, value) {
        this.values.set(name, value);
      },
    },
    getAttribute(name) {
      if (name === "src") {
        return this.src || attributes.get(name) || "";
      }
      return attributes.get(name) || "";
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
      if (name === "src") {
        this.src = String(value);
      }
    },
    removeAttribute(name) {
      attributes.delete(name);
      if (name === "src") {
        this.src = "";
      }
    },
  };
}

function previewDom() {
  return {
    passportPreviewFrame: fakeElement(),
    passportPreviewImage: fakeElement(),
    passportPreviewEmpty: fakeElement(),
    passportPreviewName: fakeElement(),
    passportPreviewFile: fakeElement(),
    passportPreviewStatus: fakeElement(),
    passportPreviewCropStatus: fakeElement(),
    passportCropButton: fakeElement(),
    passportZoomOutButton: fakeElement(),
    passportZoomInButton: fakeElement(),
    passportZoomResetButton: fakeElement(),
    passportZoomLabel: fakeElement(),
  };
}

test("clampPassportPreviewZoom clamps and rounds preview zoom", () => {
  assert.equal(clampPassportPreviewZoom(0.1), 0.85);
  assert.equal(clampPassportPreviewZoom(3), 2.5);
  assert.equal(clampPassportPreviewZoom(1.234), 1.23);
  assert.equal(clampPassportPreviewZoom("bad"), PASSPORT_PREVIEW_ZOOM_DEFAULT);
});

test("passport preview renders empty state when no member is active", () => {
  const dom = previewDom();
  const state = {
    passportImageCache: new Map(),
    passportPreviewZoom: 2,
  };
  const controller = createPassportPreviewController({
    state,
    dom,
    requestFrame: (callback) => callback(),
    activeMember: () => null,
    isMemberReviewConfirmed: () => false,
    loadPassportImageData: async () => ({}),
  });

  controller.render();

  assert.equal(dom.passportPreviewEmpty.textContent, "Belum ada passport dipilih.");
  assert.equal(dom.passportPreviewName.textContent, "Belum ada data");
  assert.equal(state.passportPreviewZoom, PASSPORT_PREVIEW_ZOOM_DEFAULT);
});

test("passport preview loads and displays active member image", async () => {
  const dom = previewDom();
  let loadPayload = null;
  const member = {
    id: "m1",
    fileName: "passport.jpg",
    passportImagePath: "data/original.jpg",
    croppedPassportImagePath: "data/crop.jpg",
    resolvedProfile: { firstName: "Ali" },
  };
  const state = {
    manifestPath: "manifest.json",
    passportImageCache: new Map(),
    passportPreviewZoom: PASSPORT_PREVIEW_ZOOM_DEFAULT,
  };
  const controller = createPassportPreviewController({
    state,
    dom,
    requestFrame: (callback) => callback(),
    activeMember: () => member,
    isMemberReviewConfirmed: () => true,
    loadPassportImageData: async (payload) => {
      loadPayload = payload;
      return { dataUrl: "data:image/png;base64,abc", path: "passport.jpg" };
    },
  });

  controller.render();
  await Promise.resolve();

  assert.equal(dom.passportPreviewName.textContent, "Ali");
  assert.equal(dom.passportPreviewStatus.textContent, "Sudah direview");
  assert.equal(dom.passportPreviewCropStatus.textContent, "Crop Nusuk siap");
  assert.equal(dom.passportPreviewImage.src, "data:image/png;base64,abc");
  assert.equal(loadPayload.imagePath, "data/crop.jpg");
  assert.equal(state.passportImageCache.get("m1").status, "ready");
});
