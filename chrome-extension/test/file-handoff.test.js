const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const load = (context, file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
const settle = () => new Promise(resolve => setImmediate(resolve));
const batch = (folder = 'a') => ({ schemaVersion: 'nusuk-entry-batch-v1', manifestPath: `C:/${folder}/manifest.json`, members: [{
  id: folder + '-4', reviewStatus: 'VALID', reviewConfirmed: true, passportImagePath: `C:/${folder}/4.jpg`,
  resolvedProfile: { firstName: 'ALI', familyName: 'BUDI', passportNumber: folder + '000004', nationality: 'INDONESIA', gender: 'MALE',
    dob: '1980-01-01', issueDate: '2025-01-01', expiryDate: '2030-01-01', passportType: 'NORMAL', cityOfIssued: 'JAKARTA', birthCountry: 'INDONESIA',
    birthCity: 'JAKARTA', maritalStatus: 'MARRIED', profession: 'BUSINESS', email: 'ali@example.com', mobileNumber: '+628123456789', arabic: { firstName: 'ALI', familyName: 'BUDI' } },
}] });
const file = (manifest, name = 'nusuk-entry-batch.json') => ({ name, text: async () => JSON.stringify(manifest) });

function importerHarness(options = {}) {
  const accepted = [], notices = [], busy = [];
  const context = vm.createContext({ window: { NusukAutofill: {} } });
  load(context, 'content/manifest-validator.js'); load(context, 'batch-file-import.js');
  const importer = context.createBatchFileImporter({ validate: context.window.NusukAutofill.manifestValidator.validateManifestForEntry,
    accept: async manifest => { accepted.push(manifest); return { ok: true }; }, notify: (message, tone) => notices.push({ message, tone }), busy: value => busy.push(value), ...options });
  return { importer, accepted, notices, busy };
}

test('a v1.0.19 JSON file without batchId still loads the profile and image from the same member', async () => {
  const h = importerHarness();
  assert.equal(await h.importer.importFiles([file(batch())]), true);
  assert.equal(h.accepted[0].members[0].passportImagePath, 'C:/a/4.jpg');
  assert.equal(h.accepted[0].members[0].resolvedProfile.passportNumber, 'a000004');
  assert.equal(h.notices.at(-1).tone, 'success'); assert.deepEqual(h.busy, [true, false]);
});

test('multiple files, invalid JSON, unreviewed data, and raw OCR manifests leave the accepted batch alone', async () => {
  const h = importerHarness();
  const unreviewed = batch(); unreviewed.members[0].reviewConfirmed = false;
  for (const files of [[file(batch()), file(batch('b'))], [file(batch(), '4.jpg')], [{ name: 'bad.json', text: async () => '{' }],
    [file(unreviewed)], [file({ ...batch(), schemaVersion: 'passport-manifest-v1' })]]) {
    assert.equal(await h.importer.importFiles(files), false);
  }
  assert.equal(h.accepted.length, 0); assert.equal(h.notices.at(-1).tone, 'error');
});

test('a missing or rejected content acknowledgement is never reported as a successful import', async () => {
  for (const response of [undefined, { ok: false, error: 'active batch' }]) {
    const h = importerHarness({ accept: async () => response });
    assert.equal(await h.importer.importFiles([file(batch())]), false);
    assert.equal(h.notices.at(-1).tone, 'error'); assert.equal(h.importer.isImporting(), false);
  }
});

test('double drops and a run starting while a file is read cannot replace a batch', async () => {
  let finish, active = false;
  const reading = new Promise(resolve => { finish = resolve; });
  const h = importerHarness({ blocked: () => active });
  const first = h.importer.importFiles([{ name: 'entry.json', text: () => reading }]);
  assert.equal(await h.importer.importFiles([file(batch('b'))]), false);
  active = true; finish(JSON.stringify(batch()));
  assert.equal(await first, false); assert.equal(h.accepted.length, 0);
});

test('a native file drop anywhere in the panel is accepted and browser navigation is prevented', async () => {
  const handlers = {}, classes = new Set(); let prevented = 0;
  const h = importerHarness();
  h.importer.bindDropTarget({ addEventListener: (type, fn) => { handlers[type] = fn; } }, { classList: { add: name => classes.add(name), remove: name => classes.delete(name) } });
  const event = { preventDefault: () => { prevented++; }, dataTransfer: { types: ['Files'], files: [file(batch())] } };
  handlers.dragenter(event); handlers.dragover(event); assert.equal(event.dataTransfer.dropEffect, 'copy');
  assert.equal(classes.has('is-drag-over'), true); handlers.drop(event); await settle();
  assert.equal(classes.size, 0); assert.equal(prevented, 3); assert.equal(h.accepted.length, 1);
});

function bridgeHarness(persistState = async () => {}) {
  const state = { manifest: batch('old'), selectedMemberId: 'old-4', executionState: 'completed', currentRunPayload: { members: ['old'] },
    activeSessionId: 'old', completedMemberIds: ['old-4'], autofillFailures: ['old'], autofillNameCorrections: [{ memberId: 'old-4', observedName: 'LUZERMAN' }], revision: 5 };
  let listener; const files = [];
  const context = vm.createContext({ window: { NusukAutofill: {} }, chrome: { runtime: { onMessage: { addListener: fn => { listener = fn; } } } } });
  load(context, 'content/manifest-validator.js'); load(context, 'content/panel-bridge.js');
  context.window.NusukAutofill.panelBridge.createPanelBridge({ state, persistState, postPanelState: () => ({ manifest: state.manifest }), postToPanel() {}, registerUploadFiles: selected => files.push(selected) }).bindWindowBridge();
  const dispatch = (type, payload) => new Promise(resolve => listener({ type, payload }, {}, resolve));
  return { state, dispatch, files };
}

test('an accepted replacement clears the entire previous run and manual photo selection', async () => {
  const h = bridgeHarness();
  assert.equal((await h.dispatch('NUSUK_PANEL_UPLOAD_MANIFEST', { manifest: batch('b') })).ok, true);
  assert.equal(h.state.manifest.members[0].resolvedProfile.passportNumber, 'b000004');
  assert.equal(h.state.selectedMemberId, 'b-4'); assert.equal(h.state.currentRunPayload, null);
  assert.equal(h.state.activeSessionId, ''); assert.equal(h.state.executionState, 'idle');
  assert.equal(h.state.completedMemberIds.length, 0); assert.equal(h.state.autofillFailures.length, 0);
  assert.equal(h.state.autofillNameCorrections.length, 0);
  assert.equal(h.files.length, 1); assert.equal(h.files[0].length, 0);
});

test('failed storage restores the previous batch; an import in progress blocks replacement and direct entry', async () => {
  let reject; const pending = new Promise((_, fail) => { reject = fail; });
  const h = bridgeHarness(() => pending); const before = JSON.stringify(h.state);
  const first = h.dispatch('NUSUK_PANEL_UPLOAD_MANIFEST', { manifest: batch() });
  assert.equal((await h.dispatch('NUSUK_PANEL_UPLOAD_MANIFEST', { manifest: batch('b') })).ok, false);
  assert.equal((await h.dispatch('NUSUK_AUTOFILL_MEMBER', { member: batch('b').members[0] })).ok, false);
  reject(new Error('storage failed')); assert.equal((await first).ok, false);
  assert.equal(JSON.stringify(h.state), before); assert.equal(h.files.length, 0);
});

test('tab checkpoints and submission locks never overwrite another tab', async () => {
  const saved = {}; const chrome = { storage: { local: { set: async values => Object.assign(saved, values) } } };
  const context = vm.createContext({ chrome, window: { NusukAutofill: { constants: { STORAGE_KEY: 'nusukAutofillState' } } } });
  load(context, 'content/panel-state-store.js');
  for (const [id, folder] of [[11, 'a'], [12, 'b']]) {
    const state = { storageKey: 'nusukAutofillState:' + id, manifest: batch(folder), pendingSubmission: { memberId: folder + '-4' } };
    await context.window.NusukAutofill.panelStateStore.createPanelStateStore({ state }).persistState({ required: true, submissionCheckpoint: true });
  }
  assert.equal(saved['nusukAutofillState:11'].manifest.manifestPath, 'C:/a/manifest.json');
  assert.equal(saved['nusukAutofillState:12'].manifest.manifestPath, 'C:/b/manifest.json');
  assert.equal(saved['nusukAutofillState:11:pending'].memberId, 'a-4');
  assert.equal(saved['nusukAutofillState:12:pending'].memberId, 'b-4'); assert.equal(saved.nusukAutofillState, undefined);
});

test('background binds commands to the acknowledged tab and has no desktop connection', async () => {
  const listeners = {}, commands = [], removed = [], messages = [];
  const tabs = [{ id: 11, active: true }, { id: 12, active: false }];
  const chrome = { runtime: { sendMessage: async message => messages.push(message), onMessage: { addListener: fn => { listeners.message = fn; } } },
    storage: { local: { get: async () => ({}), set: async () => {}, remove: async keys => removed.push(keys) }, session: { get: async () => ({ entrymateFileSession: 'browser-test' }), set: async () => {} } }, sidePanel: { setPanelBehavior: async () => {} },
    tabs: { query: async () => tabs, sendMessage: async (id, message) => { commands.push({ id, message }); return { ok: true }; }, onRemoved: { addListener: fn => { listeners.removed = fn; } } } };
  const context = vm.createContext({ chrome, console, WebSocket: class { constructor() { throw new Error('WebSocket is forbidden'); } } });
  context.importScripts = name => load(context, name); load(context, 'background.js');
  const dispatch = (message, sender = {}) => new Promise(resolve => listeners.message(message, sender, resolve));
  const ready = await dispatch({ type: 'NUSUK_PANEL_COMMAND', payload: { type: 'NUSUK_PANEL_READY' } });
  assert.equal(ready.tabId, 11); tabs[0].active = false; tabs[1].active = true;
  await dispatch({ type: 'NUSUK_PANEL_COMMAND', payload: { type: 'NUSUK_PANEL_UPLOAD_MANIFEST', payload: { manifest: batch() }, tabId: ready.tabId } });
  assert.equal(commands.at(-1).id, 11);
  const content = await dispatch({ type: 'NUSUK_CONTENT_READY' }, { tab: { id: 12 } });
  assert.equal(content.storageKey, 'nusukAutofillState:12');
  assert.equal(content.browserSessionId, 'browser-test');
  await dispatch({ type: 'NUSUK_CONTENT_PANEL_MESSAGE', payload: { type: 'NUSUK_PANEL_STATE' } }, { tab: { id: 12 } });
  assert.equal(messages.at(-1).tabId, 12);
  listeners.removed(11); assert.ok(removed.some(keys => Array.isArray(keys) && keys.includes('nusukAutofillState:11:pending')));
  const missing = await dispatch({ type: 'NUSUK_PANEL_COMMAND', payload: { type: 'NUSUK_PANEL_UPLOAD_MANIFEST', tabId: 99 } });
  assert.equal(missing.ok, false); assert.equal(commands.length, 2);
});

test('reload restores only this browser session and keeps an unresolved submission lock', async () => {
  const source = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
  const hydrate = source.slice(source.indexOf('  async function hydrateState()'), source.indexOf('  async function readStoredState()'));
  for (const browserSessionId of ['current-browser', 'previous-browser']) {
    const state = { browserSessionId: 'current-browser', storageKey: 'nusukAutofillState:11', manifest: null, currentRunPayload: null, executionState: 'idle' };
    const saved = { browserSessionId, manifest: batch('a'), selectedMemberId: 'a-4', executionState: 'running', currentRunPayload: { members: batch('a').members }, autofillNameCorrections: [{ memberId: 'a-4', observedName: 'LUZERMAN' }] };
    const lock = { memberId: 'a-4', passportNumber: 'a000004' };
    const context = vm.createContext({ state, readStoredState: async () => ({ 'nusukAutofillState:11': saved, 'nusukAutofillState:11:pending': lock }),
      clampPanelWidth: () => 420, isRunnablePayload: value => Array.isArray(value?.members), normalizeHydratedExecutionState: value => value });
    vm.runInContext(hydrate + '\nglobalThis.restore = hydrateState;', context);
    await context.restore();
    assert.equal(state.pendingSubmission, lock);
    if (browserSessionId === 'current-browser') {
      assert.equal(state.manifest, saved.manifest); assert.equal(state.currentRunPayload, saved.currentRunPayload);
      assert.equal(state.autofillNameCorrections, saved.autofillNameCorrections);
    } else { assert.equal(state.manifest, null); assert.equal(state.currentRunPayload, null); assert.equal(state.executionState, 'idle'); }
  }
});
