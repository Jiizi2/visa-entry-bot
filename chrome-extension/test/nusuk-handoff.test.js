const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function harness(tabs, target = null, session = false, options = {}) {
  const mutations = [];
  const chrome = {
    tabs: {
      query: async () => tabs,
      get: async id => tabs.find(item => item.id === id),
      sendMessage: async () => ({ pageStatus: 'ready' }),
      update: async (id, options) => mutations.push({ type: 'focus', id, options }),
      create: async options => { mutations.push({ type: 'create', options }); return { id: 99, windowId: 2, url: options.url }; },
    },
    windows: { update: async (id, options) => mutations.push({ type: 'window', id, options }) },
  };
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, 'nusuk-handoff.js'), 'utf8'), ctx);
  const handoff = ctx.createNusukHandoff({ chrome, getTarget: () => target, setTarget: id => { target = id; }, hasSession: () => session, ...options });
  return { handoff, chrome, mutations, target: () => target };
}
const tab = id => ({ id, windowId: 1, status: 'complete', url: 'https://masar.nusuk.sa/umrah/mutamer/mutamer-list', title: 'Daftar Jamaah' });
const groupTab = () => ({ ...tab(10), url: 'https://masar.nusuk.sa/umrah/mutamer-group/group-list' });

function navigationHarness() {
  let time = 0, ticks = 0;
  const current = groupTab();
  const h = harness([current], 10, true, { now: () => time, sleep: async ms => { time += ms; ticks++; } });
  h.chrome.tabs.update = async (id, options) => {
    h.mutations.push({ type: 'navigate', id, options });
    Object.assign(current, { url: options.url, status: 'complete' });
    return current;
  };
  h.chrome.tabs.sendMessage = async () => current.url === groupTab().url
    ? { pageStatus: 'navigate_required', canNavigateToEntry: true }
    : { pageStatus: 'ready', contentReady: true };
  return { ...h, current, ticks: () => ticks };
}

test('starting from Group List navigates the same tab to Mutamer List', async () => {
  const h = navigationHarness();
  const result = await h.handoff.prepareEntry(h.current);
  assert.equal(result.id, 10);
  assert.equal(result.url, tab(10).url);
  assert.deepEqual(JSON.parse(JSON.stringify(h.mutations)), [{ type: 'navigate', id: 10, options: { url: tab(10).url, active: true } }]);
  assert.equal(h.target(), 10);
});

test('navigation waits for both the new document and batch recovery before allowing a start', async () => {
  const h = navigationHarness();
  let checks = 0;
  h.chrome.tabs.get = async () => ({ ...h.current, status: checks++ === 0 ? 'loading' : 'complete' });
  h.chrome.tabs.sendMessage = async () => h.current.url === groupTab().url
    ? { pageStatus: 'navigate_required', canNavigateToEntry: true }
    : { pageStatus: 'ready', contentReady: checks >= 3 };
  await h.handoff.prepareEntry(h.current);
  assert.equal(h.ticks(), 2);
  assert.equal(checks, 3);
});

test('Mutamer List and an existing Add Mutamer form stay on their current document', async () => {
  for (const url of [tab(10).url, 'https://masar.nusuk.sa/umrah/mutamer/add-mutamer']) {
    const current = { ...tab(10), url };
    const h = harness([current]);
    assert.equal((await h.handoff.prepareEntry(current)).url, url);
    assert.equal(h.mutations.length, 0);
  }
});

test('an entry document still recovering its batch is waited on without another navigation', async () => {
  const h = navigationHarness(); h.current.url = tab(10).url;
  h.chrome.tabs.sendMessage = async () => ({ pageStatus: 'ready', contentReady: h.ticks() > 0 });
  await h.handoff.prepareEntry(h.current);
  assert.equal(h.ticks(), 1);
  assert.equal(h.mutations.length, 0);
});

test('login requirements stop navigation and also stop a login redirect after navigation', async () => {
  const h = navigationHarness();
  h.chrome.tabs.sendMessage = async () => ({ pageStatus: 'login_required' });
  await assert.rejects(h.handoff.prepareEntry(h.current), /Login.*Data batch tetap tersimpan/);
  assert.equal(h.mutations.length, 0);
  const redirected = navigationHarness();
  redirected.chrome.tabs.get = async () => ({ ...redirected.current, url: 'https://masar.nusuk.sa/login' });
  redirected.chrome.tabs.sendMessage = async () => redirected.current.url === groupTab().url
    ? { pageStatus: 'navigate_required', canNavigateToEntry: true }
    : { pageStatus: 'login_required' };
  await assert.rejects(redirected.handoff.prepareEntry(redirected.current), /Login.*Data batch tetap tersimpan/);
  assert.equal(redirected.mutations.length, 1);
  const external = navigationHarness();
  external.chrome.tabs.get = async () => ({ ...external.current, url: 'https://sso.example.test/login' });
  await assert.rejects(external.handoff.prepareEntry(external.current), /Selesaikan login/);
});

test('navigation never redirects an unrelated Nusuk service or a missing content script', async () => {
  const h = navigationHarness(); h.current.url = 'https://hajj.nusuk.sa/dashboard';
  h.chrome.tabs.sendMessage = async () => ({ pageStatus: 'navigate_required', canNavigateToEntry: true });
  await assert.rejects(h.handoff.prepareEntry(h.current), /Buka Masar Nusuk/);
  assert.equal(h.mutations.length, 0);
  const missing = navigationHarness();
  missing.chrome.tabs.sendMessage = async () => { throw Error('no receiver'); };
  await assert.rejects(missing.handoff.prepareEntry(missing.current), /Muat ulang/);
  assert.equal(missing.mutations.length, 0);
});

test('navigation timeout, cancellation and closing the tab do not permit a start', async () => {
  const timed = navigationHarness();
  timed.chrome.tabs.get = async () => ({ ...timed.current, status: 'loading' });
  await assert.rejects(timed.handoff.prepareEntry(timed.current), /belum siap.*Data batch tetap tersimpan/);
  assert.equal(timed.ticks(), 80);
  const cancelled = navigationHarness();
  cancelled.chrome.tabs.get = async () => ({ ...cancelled.current, status: 'loading' });
  await assert.rejects(cancelled.handoff.prepareEntry(cancelled.current, { isCancelled: () => cancelled.ticks() > 0 }), /dibatalkan/);
  const closed = navigationHarness();
  closed.chrome.tabs.get = async () => { throw Error('Tab closed'); };
  await assert.rejects(closed.handoff.prepareEntry(closed.current), /Tab closed/);
});

test('reuse an open logged-in document without changing URL, reloading or creating tabs', async () => {
  const h = harness([tab(10)]);
  assert.equal((await h.handoff.open()).status, 'ready');
  assert.equal(h.target(), 10);
  assert.deepEqual(JSON.parse(JSON.stringify(h.mutations)), [{ type: 'focus', id: 10, options: { active: true } }, { type: 'window', id: 1, options: { focused: true } }]);
});
test('multiple unassociated tabs require a choice before any focus or navigation', async () => {
  const h = harness([tab(10), tab(20)]);
  assert.equal((await h.handoff.open()).status, 'choose_tab');
  assert.equal(h.mutations.length, 0);
  await h.handoff.open(20); assert.equal(h.target(), 20);
});
test('bound session wins over active tab and cannot be switched accidentally', async () => {
  const h = harness([tab(10), { ...tab(20), active: true }], 10, true);
  await h.handoff.open(); assert.equal(h.target(), 10);
  await assert.rejects(h.handoff.open(20), /tab Nusuk lain/);
});
test('create a tab in the connected browser only when no Nusuk tab exists', async () => {
  const h = harness([]);
  const result = await h.handoff.open();
  assert.equal(result.status, 'loading'); assert.equal(result.selectedTabId, 99);
  assert.equal(h.mutations.filter(m => m.type === 'create').length, 1);
});
test('missing content script focuses existing tab and requests refresh without replacing it', async () => {
  const h = harness([tab(10)]);
  h.chrome.tabs.sendMessage = async () => { throw Error('no receiver'); };
  assert.equal((await h.handoff.open()).status, 'needs_refresh');
  assert.equal(h.mutations.some(m => m.type === 'create' || m.options.url), false);
});
test('closing the bound tab requires an explicit choice before using another open tab', async () => {
  const h = harness([tab(20)], 10, true);
  assert.equal((await h.handoff.open()).status, 'choose_tab');
  assert.equal(h.mutations.length, 0);
  await assert.rejects(h.handoff.open(10), /sudah ditutup/);
});
test('page readiness distinguishes login, loading and the correct entry route', () => {
  const ctx = vm.createContext({ window: { NusukAutofill: {} } });
  vm.runInContext(fs.readFileSync(path.join(root, 'content/page-context.js'), 'utf8'), ctx);
  const read = ctx.window.NusukAutofill.pageContext.readPageContext;
  const document = { readyState: 'complete', body: { innerText: '' }, querySelector: () => null };
  const check = (url, doc = document) => read({ document: doc, location: { href: `https://masar.nusuk.sa${url}` } }).pageStatus;
  assert.equal(check('/login'), 'login_required');
  assert.equal(check('/umrah/mutamer/add-mutamer', { ...document, querySelector: () => ({}) }), 'login_required');
  assert.equal(check('/umrah/mutamer/add-mutamer', { ...document, readyState: 'loading' }), 'loading');
  assert.equal(check('/umrah/mutamer/mutamer-list'), 'ready');
  assert.equal(check('/dashboard'), 'navigate_required');
  assert.equal(read({ document, location: { href: groupTab().url } }).canNavigateToEntry, true);
  assert.equal(read({ document, location: { href: 'https://hajj.nusuk.sa/dashboard' } }).canNavigateToEntry, false);
  assert.equal(read({ document, location: { href: 'https://masar.nusuk.sa.fake.test/dashboard' } }).canNavigateToEntry, false);
  assert.equal(read({ document, location: { href: 'https://masar.nusuk.sa/login' } }).canNavigateToEntry, undefined);
  ctx.window.document = document; ctx.window.location = { href: 'https://masar.nusuk.sa/login' };
  assert.equal(read().pageStatus, 'login_required');
});

test('batch acceptance waits for durable storage and invalid data does not replace the old batch', async () => {
  let listener, saved, answer;
  const state = { executionState: 'idle', manifest: { members: [{ id: 'old' }] } };
  const ctx = vm.createContext({ window: { NusukAutofill: { manifestValidator: { validateManifestForEntry: manifest => { if(!manifest.members?.length) throw Error('empty'); return { warnings: [] }; }, formatManifestUploadMessage: () => 'loaded' } } }, console, chrome: { runtime: { onMessage: { addListener: fn => { listener = fn; } } } } });
  vm.runInContext(fs.readFileSync(path.join(root, 'content/panel-bridge.js'), 'utf8'), ctx);
  const bridge = ctx.window.NusukAutofill.panelBridge.createPanelBridge({ state, persistState: () => new Promise(resolve => { saved = resolve; }), postPanelState: () => {}, postToPanel: () => {} });
  bridge.bindWindowBridge();
  listener({type:'NUSUK_PANEL_UPLOAD_MANIFEST',payload:{manifest:{members:[]}}},{},value => {answer=value;});
  assert.equal(answer.ok, false); assert.equal(state.manifest.members[0].id, 'old');
  answer = undefined;
  listener({type:'NUSUK_PANEL_UPLOAD_MANIFEST',payload:{manifest:{members:[{id:'new'}]}}},{},value => {answer=value;});
  assert.equal(answer, undefined);
  saved(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(answer.ok, true); assert.equal(state.activeSessionId, '');
});

test('retry runs only failed members, preserves successes, and login blocks all starts', async () => {
  const events = [], runs = [];
  const members = [{id:'a',passportImagePath:'C:/Demo/a.jpg'},{id:'b',passportImagePath:'C:/Demo/b.jpg'}];
  const state = {activeSessionId:'session',executionState:'completed',manifest:{manifestPath:'C:/Demo/manifest.json',members},completedMemberIds:['a'],autofillFailures:[{memberId:'b'}],runToken:0};
  let pageStatus = 'ready';
  const ctx = vm.createContext({ window: { NusukAutofill: { constants:{},manifestValidator:{validateManifestForEntry:()=>true},pageContext:{readPageContext:()=>({pageStatus})} } }, console, chrome: {runtime:{sendMessage:async message=>{events.push(message);}}} });
  vm.runInContext(fs.readFileSync(path.join(root,'content/submission-guard.js'),'utf8'),ctx);
  vm.runInContext(fs.readFileSync(path.join(root,'content/autofill-session.js'),'utf8'),ctx);
  const control = ctx.window.NusukAutofill.autofillSession.createAutofillSession({state,isControlError:()=>false,clearActiveHighlight:()=>{},resetProgress:()=>{},appendLog:()=>{},postPanelState:()=>{},postToPanel:()=>{},persistState:async()=>{},getSelectedMember:()=>members[0],runAutomation:async payload=>{runs.push(payload);}});
  await control.startAutofillFromPanel(); assert.equal(runs.length,0);
  await control.restartFailedFromPanel();
  assert.deepEqual(Array.from(runs[0].members, m=>m.id),['b']); assert.deepEqual(state.completedMemberIds,['a']);
  assert.equal(events[0].payload.eventType,'RUNNING'); assert.equal(events[0].payload.retryFailed,true);
  pageStatus='login_required'; state.executionState='idle';
  await control.startAutofillFromPanel(); await control.restartFailedFromPanel();
  assert.equal(runs.length,1); assert.equal(events.length,1);
});
