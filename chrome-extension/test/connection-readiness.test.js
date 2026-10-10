const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const missingReceiver = () => new Error('Could not establish connection. Receiving end does not exist.');

function backgroundHarness(sendMessage) {
  const messages = [], waits = [];
  let listener;
  const chrome = {
    runtime: { sendMessage: async () => {}, onMessage: { addListener: fn => { listener = fn; } } },
    storage: {
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      session: { get: async () => ({ entrymateFileSession: 'test' }) },
    },
    sidePanel: { setPanelBehavior: async () => {} },
    tabs: {
      query: async () => [{ id: 10, status: 'complete', active: true, url: 'https://masar.nusuk.sa/umrah/mutamer/mutamer-list' }],
      onRemoved: { addListener() {} },
      sendMessage: async (id, message) => { messages.push({ id, message }); return sendMessage(message); },
    },
  };
  const context = vm.createContext({ chrome, console, setTimeout: (fn, ms) => { waits.push(ms); fn(); } });
  context.importScripts = file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context);
  return {
    messages, waits,
    command: type => new Promise(resolve => listener({ type: 'NUSUK_PANEL_COMMAND', payload: { type, tabId: 10 } }, {}, resolve)),
  };
}

test('the panel connects when the content listener becomes ready shortly after the document', async () => {
  let attempts = 0;
  const h = backgroundHarness(() => {
    if (++attempts <= 3) throw missingReceiver();
    return { ok: true, panelState: { manifest: null } };
  });
  const response = await h.command('NUSUK_PANEL_READY');
  assert.equal(response.ok, true);
  assert.equal(response.tabId, 10);
  assert.equal(attempts, 4);
  assert.deepEqual(h.waits, [250, 250, 250]);
  assert.ok(h.messages.every(({ id, message }) => id === 10 && message.type === 'NUSUK_PANEL_READY'));
});

test('a tab without a content listener gets a bounded wait and a refresh instruction', async () => {
  const h = backgroundHarness(() => { throw missingReceiver(); });
  const response = await h.command('NUSUK_PANEL_READY');
  assert.equal(response.ok, false);
  assert.match(response.error, /Muat ulang tab Nusuk.*buka kembali panel/);
  assert.doesNotMatch(response.error, /Receiving end|Could not establish/);
  assert.equal(h.messages.length, 9);
  assert.equal(h.waits.reduce((sum, ms) => sum + ms, 0), 2000);
});

test('batch changes and automation commands are never replayed by connection recovery', async () => {
  for (const type of ['NUSUK_PANEL_UPLOAD_MANIFEST', 'NUSUK_PANEL_START_AUTOFILL', 'NUSUK_PANEL_RESTART_FAILED', 'NUSUK_PANEL_RESET_AUTOFILL']) {
    const h = backgroundHarness(message => {
      if (message.type === 'NUSUK_QUERY_CONTEXT') return { pageStatus: 'ready', contentReady: true, hasManifest: true };
      throw missingReceiver();
    });
    const response = await h.command(type);
    assert.equal(response.ok, false);
    assert.match(response.error, /Muat ulang tab Nusuk/);
    assert.equal(h.messages.filter(({ message }) => message.type === type).length, 1);
    assert.deepEqual(h.waits, []);
  }
});

test('a lost response is not treated as a missing receiver or retried', async () => {
  const error = new Error('The message port closed before a response was received.');
  const h = backgroundHarness(() => { throw error; });
  const response = await h.command('NUSUK_PANEL_READY');
  assert.equal(response.error, error.message);
  assert.equal(h.messages.length, 1);
  assert.deepEqual(h.waits, []);
});

function panelHarness(sendMessage) {
  const source = fs.readFileSync(path.join(root, 'panel.js'), 'utf8');
  const bridge = source.slice(source.indexOf('async function postToParent('), source.indexOf('chrome.tabs.onActivated.addListener'));
  const importStatus = { textContent: '', className: '', setAttribute(name, value) { this[name] = value; } };
  const context = vm.createContext({
    currentTabId: 10, panelTargetReady: false, panelConnectionError: null, importStatus,
    chrome: { runtime: { sendMessage } }, updateRunControls() {}, applyIncomingState() {},
  });
  vm.runInContext(bridge, context);
  return { context, importStatus, ready: () => context.postToParent('NUSUK_PANEL_READY') };
}

test('a missing worker produces an actionable panel error that clears after reconnection', async () => {
  let connected = false;
  const h = panelHarness(async () => {
    if (!connected) throw missingReceiver();
    return { ok: true, tabId: 10 };
  });
  assert.equal((await h.ready()).ok, false);
  assert.match(h.importStatus.textContent, /Muat ulang extension di chrome:\/\/extensions\//);
  assert.equal(h.importStatus.role, 'alert');
  connected = true;
  assert.equal((await h.ready()).ok, true);
  assert.equal(h.context.panelTargetReady, true);
  assert.equal(h.importStatus.textContent, '');
  assert.equal(h.importStatus.role, 'status');
});

test('reconnection preserves an unrelated file validation error', async () => {
  let connected = false;
  const h = panelHarness(async () => {
    if (!connected) throw missingReceiver();
    return { ok: true, tabId: 10 };
  });
  await h.ready();
  h.importStatus.textContent = 'JSON tidak valid.';
  connected = true;
  await h.ready();
  assert.equal(h.importStatus.textContent, 'JSON tidak valid.');
});

test('a delayed connection failure from another tab cannot overwrite the active panel', async () => {
  let reject;
  const h = panelHarness(() => new Promise((resolve, fail) => { reject = fail; }));
  const pending = h.ready();
  h.context.currentTabId = 12;
  h.context.panelTargetReady = true;
  h.importStatus.textContent = 'Batch tab 12 siap.';
  reject(missingReceiver());
  assert.equal((await pending).ok, false);
  assert.equal(h.context.panelTargetReady, true);
  assert.equal(h.importStatus.textContent, 'Batch tab 12 siap.');
});
