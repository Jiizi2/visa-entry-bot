const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function loadBrowserScripts(relativePaths, extra = {}) {
  const chrome = extra.chrome || {
    runtime: {
      getURL: () => "chrome-extension://test/",
    },
  };
  const windowObject = {
    NusukAutofill: {},
    indexedDB: null,
    setTimeout: () => 0,
    clearTimeout: () => {},
    ...extra.window,
  };
  const context = vm.createContext({
    window: windowObject,
    chrome,
    console,
    File: extra.File || class TestFile {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    Date,
    Error,
    Object,
    Array,
    String,
    Number,
    RegExp,
    Set,
    Map,
  });

  for (const relativePath of relativePaths) {
    const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
    vm.runInContext(source, context, { filename: relativePath });
  }
  return context.window.NusukAutofill;
}

function validMember(overrides = {}) {
  const base = {
    id: "member-1",
    fileName: "passport.jpg",
    passportImagePath: "data/group/passports/passport.jpg",
    reviewStatus: "VALID",
    status: "VALID",
    reviewConfirmed: true,
    resolvedProfile: {
      firstName: "ALI",
      familyName: "BUDI",
      passportNumber: "X1234567",
      nationality: "INDONESIA",
      gender: "MALE",
      dob: "1990-01-01",
      issueDate: "2025-01-01",
      expiryDate: "2030-01-01",
      passportType: "NORMAL",
      cityOfIssued: "JAKARTA",
      birthCountry: "INDONESIA",
      birthCity: "JAKARTA",
      maritalStatus: "MARRIED",
      profession: "BUSINESS",
      email: "ali@example.com",
      mobileNumber: "+628123456789",
      arabic: {
        firstName: "ALI",
        familyName: "BUDI",
      },
    },
  };
  return mergeDeep(base, overrides);
}

function mergeDeep(base, overrides) {
  const out = { ...base };
  for (const [key, value] of Object.entries(overrides || {})) {
    if (value && typeof value === "object" && !Array.isArray(value) && base[key] && typeof base[key] === "object") {
      out[key] = mergeDeep(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

test("manifest validator accepts ready entry batch", () => {
  const root = loadBrowserScripts(["content/manifest-validator.js"]);
  const manifest = {
    schemaVersion: "nusuk-entry-batch-v1",
    members: [validMember()],
  };

  const result = root.manifestValidator.validateManifestForEntry(manifest);

  assert.equal(result.valid, true);
  assert.equal(result.memberCount, 1);
  assert.equal(result.warnings.length, 0);
});

test("manifest validator rejects unreviewed or incomplete members", () => {
  const root = loadBrowserScripts(["content/manifest-validator.js"]);
  const manifest = {
    schemaVersion: "nusuk-entry-batch-v1",
    members: [
      validMember({
        reviewStatus: "NEEDS_REVIEW",
        reviewConfirmed: false,
        resolvedProfile: { birthCity: "" },
      }),
    ],
  };

  assert.throws(
    () => root.manifestValidator.validateManifestForEntry(manifest),
    /reviewStatus harus VALID.*belum ditandai sudah dicek.*kota lahir wajib diisi/s,
  );
});

test("manifest validator warns when raw OCR manifest is uploaded", () => {
  const root = loadBrowserScripts(["content/manifest-validator.js"]);
  const result = root.manifestValidator.validateManifestForEntry({
    schemaVersion: "passport-manifest-v1",
    contractVersion: "passport-extracted-resolved-profile-v4",
    members: [validMember()],
  });

  assert.equal(result.valid, true);
  assert.match(result.warnings[0], /manifest OCR mentah/);
});

test("manifest loads validator before scripts that consume it", () => {
  const manifest = readJson("manifest.json");
  const scripts = manifest.content_scripts[0].js;

  assert.ok(scripts.includes("content/manifest-validator.js"));
  assert.ok(scripts.indexOf("content/manifest-validator.js") < scripts.indexOf("content/panel-bridge.js"));
  assert.ok(scripts.indexOf("content/manifest-validator.js") < scripts.indexOf("content.js"));
});

test("panel and popup load shared manifest validator", () => {
  const panelHtml = fs.readFileSync(path.join(ROOT, "panel.html"), "utf8");
  const popupHtml = fs.readFileSync(path.join(ROOT, "popup.html"), "utf8");

  assert.match(panelHtml, /content\/manifest-validator\.js[\s\S]*panel\.js/);
  assert.match(popupHtml, /content\/manifest-validator\.js[\s\S]*popup\.js/);
});

test("panel and popup guard storage access for embedded contexts", () => {
  const panelJs = fs.readFileSync(path.join(ROOT, "panel.js"), "utf8");
  const popupJs = fs.readFileSync(path.join(ROOT, "popup.js"), "utf8");

  assert.doesNotMatch(panelJs, /chrome\.storage\.local/);
  assert.doesNotMatch(popupJs, /chrome\.storage\.local/);
  assert.match(panelJs, /function getStorageLocal\(\)/);
  assert.match(popupJs, /function getStorageLocal\(\)/);
});

test("upload manager notifies file inputs without inline page scripts", () => {
  const uploadManagerJs = fs.readFileSync(path.join(ROOT, "content", "upload-manager.js"), "utf8");

  assert.doesNotMatch(uploadManagerJs, /document\.createElement\(["']script["']\)/);
  assert.doesNotMatch(uploadManagerJs, /script\.textContent/);
  assert.match(uploadManagerJs, /dispatchFileInputEvents\(input\)/);
});

test("panel shell queues messages until the extension iframe is ready", () => {
  const panelShellJs = fs.readFileSync(path.join(ROOT, "content", "panel-shell.js"), "utf8");

  assert.match(panelShellJs, /pendingPanelMessages/);
  assert.match(panelShellJs, /function postToPanel[\s\S]*!isReady\(\)[\s\S]*enqueuePanelMessage/);
  assert.match(panelShellJs, /function setReady[\s\S]*flushPendingPanelMessages/);
});

test("upload path resolution prefers manifest-root relative paths before local repo fallback", () => {
  const root = loadBrowserScripts([
    "content/constants.js",
    "content/path-utils.js",
    "content/upload-file-store.js",
  ]);
  const store = root.uploadFileStore.createUploadFileStore({
    state: {
      manifest: {
        manifestPath: "C:\\visa-entry-bot\\data\\example-group\\passports\\trainingData\\manifest.json",
      },
    },
  });

  assert.equal(
    store.resolveUploadFilePath("data/example-group/passports/trainingData/passport.jpg", {}),
    "C:\\visa-entry-bot\\data\\example-group\\passports\\trainingData\\passport.jpg",
  );
  assert.equal(
    store.resolveUploadFilePath("trainingData/passport.jpg", {}),
    "C:\\visa-entry-bot\\data\\example-group\\passports\\trainingData\\passport.jpg",
  );
});

test("upload file store resolves selected files by basename and rejects duplicates", async () => {
  class TestFile {
    constructor(name, options = {}) {
      this.name = name;
      this.size = Number(options.size || 100);
      this.type = options.type || "image/jpeg";
      this.lastModified = Number(options.lastModified || 1);
      this.webkitRelativePath = options.webkitRelativePath || "";
    }
  }

  const root = loadBrowserScripts([
    "content/constants.js",
    "content/path-utils.js",
    "content/upload-file-store.js",
  ], { File: TestFile });
  const store = root.uploadFileStore.createUploadFileStore({ state: { manifest: {} } });
  const first = new TestFile("passport.jpg", { webkitRelativePath: "batch/passport.jpg" });

  store.registerUploadFiles([first]);

  assert.equal(
    await store.resolveSelectedUploadFile("data/group/passports/passport.jpg", { member: { fileName: "passport.jpg" } }),
    first,
  );

  const duplicateStore = root.uploadFileStore.createUploadFileStore({ state: { manifest: {} } });
  duplicateStore.registerUploadFiles([
    new TestFile("passport.jpg", { webkitRelativePath: "batch-a/passport.jpg" }),
    new TestFile("passport.jpg", { webkitRelativePath: "batch-b/passport.jpg" }),
  ]);

  assert.equal(
    await duplicateStore.resolveSelectedUploadFile("passport.jpg", { member: { fileName: "passport.jpg" } }),
    null,
  );
});
