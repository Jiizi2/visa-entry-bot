const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

async function harness({ executionState = 'idle', hasManifest = true } = {}) {
  const commands = [], navigations = [];
  let listener, finishNavigation, navigationStarted;
  const navigationReady = new Promise(resolve => { finishNavigation = resolve; });
  const navigating = new Promise(resolve => { navigationStarted = resolve; });
  const current = { id: 10, windowId: 1, status: 'complete', url: 'https://masar.nusuk.sa/umrah/mutamer-group/group-list' };
  const transport = { connect() {}, getState: () => ({ activeSessionId: 'session' }), getSnapshot: () => null };
  const chrome = {
    runtime: { getManifest: () => ({ version: 'test' }), sendMessage: async () => {}, onMessage: { addListener: fn => { listener = fn; } } },
    storage: { local: { get: async () => ({ entrymateDesktopTransport: { targetTabId: 10, targetChosen: true } }) } },
    sidePanel: { setPanelBehavior: async () => {} },
    alarms: { create: async () => {}, onAlarm: { addListener() {} } },
    tabs: {
      query: async () => [current], get: async () => current, onRemoved: { addListener() {} },
      update: async (id, options) => { navigations.push({ id, options }); current.url = options.url; navigationStarted(); return current; },
      sendMessage: async (id, message) => {
        if (message.type === 'NUSUK_QUERY_CONTEXT') {
          if (navigations.length) { await navigationReady; return { pageStatus: 'ready', contentReady: true, executionState, hasManifest }; }
          return { pageStatus: 'navigate_required', canNavigateToEntry: true, contentReady: true, executionState, hasManifest };
        }
        commands.push({ id, type: message.type }); return { ok: true };
      },
    },
  };
  const context = vm.createContext({ chrome, console, setTimeout, WebSocket: class {} });
  context.importScripts = file => {
    if (file === 'desktop-transport.js') { context.createDesktopTransport = () => transport; return; }
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  };
  vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  const command = type => new Promise(resolve => listener({ type: 'NUSUK_PANEL_COMMAND', payload: { type } }, {}, resolve));
  return { command, commands, navigations, navigating, finishNavigation, context };
}

test('double start during navigation delivers one start only after the destination is ready', async () => {
  const h = await harness();
  const first = h.command('NUSUK_PANEL_START_AUTOFILL');
  const second = h.command('NUSUK_PANEL_START_AUTOFILL');
  await h.navigating;
  assert.equal(h.commands.length, 0);
  h.finishNavigation();
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true);
  assert.equal(h.navigations.length, 1);
  assert.deepEqual(h.commands, [{ id: 10, type: 'NUSUK_PANEL_START_AUTOFILL' }]);
});

test('pause and reset while navigating cancel the pending start', async () => {
  for (const type of ['NUSUK_PANEL_PAUSE_AUTOFILL', 'NUSUK_PANEL_RESET_AUTOFILL']) {
    const h = await harness();
    const start = h.command('NUSUK_PANEL_START_AUTOFILL');
    await h.navigating;
    assert.equal((await h.command(type)).ok, true);
    h.finishNavigation();
    assert.equal((await start).ok, false);
    assert.deepEqual(h.commands, [{ id: 10, type }]);
  }
});

test('an active runner and an empty batch cannot trigger a new navigation', async () => {
  const running = await harness({ executionState: 'running' });
  assert.equal((await running.command('NUSUK_PANEL_START_AUTOFILL')).ok, true);
  assert.equal(running.navigations.length, 0); assert.equal(running.commands.length, 0);
  const empty = await harness({ hasManifest: false });
  assert.equal((await empty.command('NUSUK_PANEL_START_AUTOFILL')).ok, false);
  assert.equal(empty.navigations.length, 0); assert.equal(empty.commands.length, 0);
});

test('completed batches require retry and keep the retry command after navigation', async () => {
  const h = await harness({ executionState: 'completed' });
  assert.equal((await h.command('NUSUK_PANEL_START_AUTOFILL')).ok, false);
  assert.equal(h.navigations.length, 0);
  const retry = h.command('NUSUK_PANEL_RESTART_FAILED');
  await h.navigating; h.finishNavigation();
  assert.equal((await retry).ok, true);
  assert.deepEqual(h.commands, [{ id: 10, type: 'NUSUK_PANEL_RESTART_FAILED' }]);
});

test('changing the selected target while navigating prevents the pending start', async () => {
  const h = await harness();
  const start = h.command('NUSUK_PANEL_START_AUTOFILL');
  await h.navigating;
  vm.runInContext('targetTabId = 20', h.context);
  h.finishNavigation();
  assert.equal((await start).ok, false);
  assert.equal(h.commands.length, 0);
});
