import assert from "node:assert/strict";
import test from "node:test";

import { bindDom } from "../src/main-dom.js";

function fakeRoot() {
  const singleNodes = new Map();
  const listNodes = new Map();
  return {
    singleNodes,
    listNodes,
    querySelector(selector) {
      if (!singleNodes.has(selector)) {
        singleNodes.set(selector, { selector });
      }
      return singleNodes.get(selector);
    },
    querySelectorAll(selector) {
      if (!listNodes.has(selector)) {
        listNodes.set(selector, [{ selector, index: 0 }, { selector, index: 1 }]);
      }
      return listNodes.get(selector);
    },
  };
}

test("bindDom maps app selectors onto the shared dom object", () => {
  const root = fakeRoot();
  const dom = {};

  assert.equal(bindDom(dom, root), dom);
  assert.equal(dom.pageImport.selector, "#page-import");
  assert.equal(dom.folderPath.selector, "#folder-path");
  assert.equal(dom.prepareEntryButton.selector, "#prepare-entry-button");
  assert.equal(dom.passportPreviewImage.selector, "#passport-preview-image");
  assert.equal(dom.fieldReviewRows.selector, "#field-review-rows");
  assert.equal(dom.navButtons.length, 2);
  assert.equal(dom.filterButtons.length, 2);
  assert.deepEqual(dom.workspacePrevButtons, [root.singleNodes.get("#workspace-prev-button-top")]);
});
