import assert from "node:assert/strict";
import test from "node:test";

import { transliterateName } from "../src/main-transliterator.js";

test("transliterateName uses common and batch overrides", () => {
  assert.equal(transliterateName("MUHAMMAD"), "\u0645\u062d\u0645\u062f");
  assert.equal(transliterateName("AHMAD"), "\u0623\u062d\u0645\u062f");
  assert.equal(transliterateName("FATIMAH"), "\u0641\u0627\u0637\u0645\u0629");
  assert.equal(transliterateName("NURHIDAYAH"), "\u0646\u0648\u0631 \u0647\u062f\u0627\u064a\u0629");
});

test("transliterateName handles particles and apostrophes", () => {
  assert.equal(
    transliterateName("ABDUL ALLAH BIN UMAR"),
    "\u0639\u0628\u062f \u0627\u0644\u0644\u0647 \u0628\u0646 \u0639\u0645\u0631",
  );
  assert.equal(
    transliterateName("AL FARISI BINTI AISYAH"),
    "\u0627\u0644 \u0641\u0627\u0631\u0633\u064a \u0628\u0646\u062a \u0639\u0627\u0626\u0634\u0629",
  );
  assert.equal(transliterateName("SYAFI'I"), "\u0634\u0627\u0641\u0639\u064a");
  assert.equal(transliterateName("'ALI"), "\u0639\u0644\u064a");
});
