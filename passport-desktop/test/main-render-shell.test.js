import assert from "node:assert/strict";
import test from "node:test";

import {
  createMainRenderer,
  currentTopbarStatus,
  renderNavigation,
  topbarDescriptor,
} from "../src/main-render-shell.js";

function createClassList() {
  const classes = new Set();
  return {
    toggle(className, force) {
      if (force) {
        classes.add(className);
      } else {
        classes.delete(className);
      }
    },
    contains(className) {
      return classes.has(className);
    },
  };
}

function createNavButton(page) {
  const badge = { textContent: "" };
  const subtitle = { textContent: "" };
  return {
    attrs: {},
    badge,
    classList: createClassList(),
    dataset: { page },
    subtitle,
    querySelector(selector) {
      if (selector === "[data-step-badge]") {
        return badge;
      }
      if (selector === "[data-step-subtitle]") {
        return subtitle;
      }
      return null;
    },
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
  };
}

function createDomShell() {
  return {
    navButtons: [],
    navConnectors: [],
    pageImport: { classList: createClassList() },
    pageValidation: { classList: createClassList() },
    pageEntry: { classList: createClassList() },
    topbarEyebrow: { classList: createClassList(), textContent: "" },
    topbarTitle: { textContent: "" },
    topbarStatus: { className: "", textContent: "" },
  };
}

test("topbar status and descriptor reflect app state", () => {
  assert.deepEqual(currentTopbarStatus({ isStoppingScan: true }), {
    label: "Menghentikan",
    tone: "warn",
  });
  assert.deepEqual(currentTopbarStatus({ statusHeadline: "Scan gagal dimulai" }), {
    label: "Perlu Perhatian",
    tone: "danger",
  });
  assert.deepEqual(topbarDescriptor({ currentPage: "entry", manifestPath: "manifest.json" }), {
    eyebrow: "",
    title: "Preview & Export JSON",
    statusLabel: "Siap",
    statusTone: "ready",
    compact: true,
    hidden: false,
  });
});

test("renderNavigation updates step states and subtitles", () => {
  const importButton = createNavButton("import");
  const validationButton = createNavButton("validation");
  const entryButton = createNavButton("entry");
  const firstConnector = { classList: createClassList() };
  const secondConnector = { classList: createClassList() };
  const dom = {
    navButtons: [importButton, validationButton, entryButton],
    navConnectors: [firstConnector, secondConnector],
  };

  renderNavigation({
    dom,
    state: { currentPage: "validation", manifestPath: "manifest.json" },
    reviewCompletionState: () => ({ remaining: 2 }),
    isEntryAccessible: () => false,
  });

  assert.equal(importButton.classList.contains("is-complete"), true);
  assert.equal(importButton.badge.textContent, "OK");
  assert.equal(importButton.subtitle.textContent, "Selesai");
  assert.equal(validationButton.classList.contains("is-active"), true);
  assert.equal(validationButton.attrs["aria-current"], "page");
  assert.equal(validationButton.badge.textContent, "2");
  assert.equal(validationButton.subtitle.textContent, "Sisa review: 2 data");
  assert.equal(entryButton.classList.contains("is-upcoming"), true);
  assert.equal(entryButton.subtitle.textContent, "Selesaikan review dulu");
  assert.equal(firstConnector.classList.contains("is-complete"), true);
  assert.equal(secondConnector.classList.contains("is-complete"), false);
});

test("createMainRenderer coalesces scheduled render work", () => {
  const calls = [];
  let frameCallback = null;
  let frameRequests = 0;
  const topbarNode = { classList: createClassList(), style: {} };
  const renderer = createMainRenderer({
    dom: createDomShell(),
    state: { currentPage: "import", statusHeadline: "", selectedDir: "" },
    documentRef: { querySelector: () => topbarNode },
    requestFrame: (callback) => {
      frameRequests += 1;
      frameCallback = callback;
      return 1;
    },
    cancelFrame: () => calls.push("cancel"),
    refreshCompactLogs: () => calls.push("refreshCompactLogs"),
    ensureVisibleActiveMember: () => calls.push("ensureVisibleActiveMember"),
    renderImportPage: () => calls.push("renderImportPage"),
    renderProgressPanel: () => calls.push("renderProgressPanel"),
    renderScanLogs: () => calls.push("renderScanLogs"),
    renderPassportList: () => calls.push("renderPassportList"),
    renderPassportPreview: () => calls.push("renderPassportPreview"),
    renderWorkspace: () => calls.push("renderWorkspace"),
    renderReviewExportModal: () => calls.push("renderReviewExportModal"),
    renderEntryPage: () => calls.push("renderEntryPage"),
    updateActionAvailability: () => calls.push("updateActionAvailability"),
    reviewCompletionState: () => ({ remaining: 0 }),
    isEntryAccessible: () => false,
  });

  renderer.scheduleRenderAll();
  renderer.scheduleRenderAll();
  assert.equal(frameRequests, 1);

  frameCallback();

  assert.deepEqual(calls, [
    "refreshCompactLogs",
    "ensureVisibleActiveMember",
    "renderImportPage",
    "renderProgressPanel",
    "renderScanLogs",
    "renderPassportList",
    "renderPassportPreview",
    "renderWorkspace",
    "renderReviewExportModal",
    "renderEntryPage",
    "updateActionAvailability",
  ]);
  assert.equal(topbarNode.style.display, "flex");
});
