const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness(initial = {}) {
  let time = 0;
  let nextId = 1;
  const scheduled = new Map();
  const sockets = [];
  const delivered = [];
  const saves = [];
  const timers = {
    setTimeout(fn, delay) { const id = nextId++; scheduled.set(id, { fn, at: time + delay }); return id; },
    clearTimeout(id) { scheduled.delete(id); },
    setInterval(fn, delay) { const id = nextId++; scheduled.set(id, { fn, at: time + delay, delay }); return id; },
    clearInterval(id) { scheduled.delete(id); },
  };
  class FakeWebSocket {
    static OPEN = 1;
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(text) { assert.equal(this.readyState, 1); this.sent.push(JSON.parse(text)); }
    close() { this.readyState = 3; this.onclose?.({ code: 1006 }); }
    open() { this.readyState = 1; this.onopen?.(); }
    async receive(type, payload = {}, extra = {}) {
      this.incomingSequence = (this.incomingSequence || 0) + 1;
      this.onmessage?.({ data: JSON.stringify({ type, payload, sequence: this.incomingSequence, ...extra }) });
      await settle();
    }
  }
  const context = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(path.join(root, 'desktop-transport.js'), 'utf8'), context);
  const client = context.createDesktopTransport({
    WebSocket: FakeWebSocket, version: 'test', initial, timers, now: () => time,
    uuid: () => `message-${nextId++}`,
    getUrl: async () => 'https://masar.nusuk.sa/umrah/mutamer/add-mutamer',
    save: async value => saves.push(JSON.parse(JSON.stringify(value))),
    notify: () => {}, deliver: async envelope => delivered.push(envelope),
  });
  async function advance(ms) {
    const until = time + ms;
    while (true) {
      const due = [...scheduled.entries()].filter(([, item]) => item.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, item] = due;
      time = item.at;
      if (item.delay) item.at += item.delay; else scheduled.delete(id);
      item.fn();
      await settle();
    }
    time = until;
  }
  async function ready() {
    client.connect();
    const ws = sockets.at(-1);
    ws.open();
    await ws.receive('HELLO_ACK');
    const ready = ws.sent.find(message => message.type === 'READY');
    await ws.receive('ACK', {}, { replyToMessageId: ready.messageId });
    return ws;
  }
  return { client, context, FakeWebSocket, timers, sockets, delivered, saves, advance, ready, jump: ms => { time += ms; } };
}

test('generated protocol includes every shared message, including recovery and failures', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, 'content/protocol-types.js'), 'utf8'), context);
  const shared = fs.readFileSync(path.join(root, '../shared-protocol/MessageType.ts'), 'utf8');
  for (const [, name, value] of shared.matchAll(/(\w+)\s*=\s*'([^']+)'/g)) {
    assert.equal(context.MessageType[name], value);
  }
});

test('panel opens and alarm wakeups reuse one live connection; idle still sends keepalives', async () => {
  const h = harness();
  const ws = await h.ready();
  h.client.connect(); h.client.connect();
  assert.equal(h.sockets.length, 1);
  await h.advance(10000);
  assert.equal(ws.sent.at(-1).type, 'PING');
  await ws.receive('PONG');
  await h.advance(10000);
  assert.equal(ws.sent.at(-1).type, 'PING');
  assert.equal(h.client.getState().connectionState, 'ready');
});

test('stalled connection scans another port and ignores late callbacks from old sockets', async () => {
  const h = harness();
  h.client.connect();
  const first = h.sockets[0];
  const staleClose = first.onclose;
  await h.advance(8250);
  assert.equal(first.readyState, 3);
  assert.equal(h.sockets[1].url, 'ws://127.0.0.1:9002');
  staleClose(); h.client.connect();
  await h.advance(3000);
  assert.equal(h.sockets.length, 2);
});

test('missing HELLO_ACK times out rather than leaving startup stuck', async () => {
  const h = harness();
  h.client.connect(); h.sockets[0].open();
  await h.advance(8250);
  assert.equal(h.sockets[0].readyState, 3);
  assert.equal(h.sockets.length, 2);
});

test('reconnect tries the successful port before scanning other ports', async () => {
  const h = harness({ port: 9003 });
  const ws = await h.ready();
  ws.close();
  await h.advance(500);
  assert.equal(h.sockets[1].url, 'ws://127.0.0.1:9003');
  h.sockets[1].close();
  await h.advance(250);
  assert.equal(h.sockets[2].url, 'ws://127.0.0.1:9004');
});

test('batch credentials survive a worker restart and recover the complete manifest', async () => {
  const h = harness();
  const ws = await h.ready();
  const members = [{ id: 'a', resolvedProfile: { firstName: 'TEST' } }];
  await ws.receive('LOAD_BATCH', { members, resumeToken: 'token', manifestPath: 'batch.json' }, { sessionId: 'session' });
  assert.equal(ws.sent.at(-1).type, 'BATCH_LOADED');
  const restarted = harness(h.saves.at(-1));
  restarted.client.connect();
  const newWs = restarted.sockets[0]; newWs.open();
  await newWs.receive('HELLO_ACK');
  assert.equal(newWs.sent.at(-1).payload.sessionId, 'session');
  assert.equal(newWs.sent.at(-1).payload.resumeToken, 'token');
  await newWs.receive('SESSION_SNAPSHOT', { sessionId: 'session', resumeToken: 'token', manifestMembers: members, status: 'RUNNING' });
  assert.equal(restarted.client.getState().connectionState, 'ready');
  assert.deepEqual(JSON.parse(JSON.stringify(restarted.client.getSnapshot().manifestMembers)), members);
  assert.equal(restarted.delivered.at(-1).type, 'SESSION_SNAPSHOT');
});

test('stale credentials after desktop restart clear recovery without a reconnect loop', async () => {
  const h = harness({ activeSessionId: 'old', resumeToken: 'old-token', pending: [{ type: 'SESSION_COMPLETED', payload: {} }] });
  h.client.connect(); const ws = h.sockets[0]; ws.open();
  await ws.receive('HELLO_ACK');
  await ws.receive('ACK', { sessionReset: true }, { replyToMessageId: ws.sent.at(-1).messageId });
  assert.equal(h.client.getState().activeSessionId, '');
  assert.equal(h.client.getState().connectionState, 'ready');
  assert.equal(ws.sent.some(message => message.type === 'SESSION_COMPLETED'), false);
  await h.advance(20000);
  assert.equal(h.sockets.length, 1);
});

test('reset clears cached execution and credentials so page reload cannot resume the old batch', async () => {
  const h = harness(); const ws = await h.ready();
  await ws.receive('LOAD_BATCH', { members: [{ id: 'a' }], resumeToken: 'token' }, { sessionId: 'session' });
  h.client.sendEvent({ eventType: 'STOP' });
  assert.equal(ws.sent.at(-1).type, 'STOP');
  assert.equal(ws.sent.at(-1).sessionId, 'session');
  assert.equal(h.client.getSnapshot(), null);
  assert.equal(h.client.getState().activeSessionId, '');
  const count = ws.sent.length;
  h.client.sendEvent({ eventType: 'CURRENT_MEMBER', memberId: 'manual-json' });
  assert.equal(ws.sent.length, count);
});

test('offline progress replays before execution recovery, including completion', async () => {
  const h = harness({ activeSessionId: 'session', resumeToken: 'token' });
  h.client.sendEvent({ eventType: 'PROGRESS', current: 1, total: 2, revision: 3 });
  h.client.sendEvent({ eventType: 'PROGRESS', current: 2, total: 2, revision: 4 });
  h.client.sendEvent({ eventType: 'SESSION_COMPLETED' });
  const ws = h.sockets[0]; ws.open(); await ws.receive('HELLO_ACK');
  await ws.receive('SESSION_SNAPSHOT', { sessionId: 'session', resumeToken: 'token', status: 'RUNNING' });
  assert.equal(h.delivered.length, 0);
  assert.deepEqual(ws.sent.slice(-3).map(message => message.type), ['PROGRESS', 'SESSION_COMPLETED', 'READY']);
  assert.equal(ws.sent.find(message => message.type === 'PROGRESS').payload.current, 2);
  await ws.receive('SESSION_SNAPSHOT', { sessionId: 'session', resumeToken: 'token', status: 'COMPLETED' });
  assert.equal(h.delivered.length, 1);
  assert.equal(h.delivered[0].payload.status, 'COMPLETED');
});

test('a silent established connection is detected, while waking from sleep gets a grace period', async () => {
  const h = harness(); const ws = await h.ready();
  await h.advance(50000);
  assert.equal(ws.readyState, 3);
  // Invoke a delayed interval at the wall-clock time after Windows wakes.
  const slept = harness();
  let tick;
  const setInterval = slept.timers.setInterval;
  slept.timers.setInterval = (fn, ms) => { tick = fn; return setInterval(fn, ms); };
  const sleptWs = await slept.ready(); slept.jump(120000); tick();
  assert.equal(sleptWs.readyState, 1);
  assert.equal(sleptWs.sent.at(-1).type, 'PING');
});

test('background connects without any panel and forwards content events to one Nusuk tab', async () => {
  const h = harness();
  const listeners = {};
  const commands = [];
  const storage = {};
  const tabs = [{ id: 11, active: true, url: 'https://masar.nusuk.sa/' }, { id: 12, active: false, url: 'https://masar.nusuk.sa/' }];
  const chrome = {
    runtime: { getManifest: () => ({ version: 'test' }), sendMessage: async () => {}, onMessage: { addListener: fn => { listeners.message = fn; } } },
    storage: { local: { get: async () => storage, set: async value => Object.assign(storage, value) } },
    sidePanel: { setPanelBehavior: async () => {} },
    alarms: { create: async () => {}, onAlarm: { addListener: fn => { listeners.alarm = fn; } } },
    tabs: { query: async () => tabs, sendMessage: async (id, message) => { commands.push({ id, message }); return message.type === 'NUSUK_QUERY_CONTEXT' ? { pageStatus: 'ready' } : { ok: true }; }, onRemoved: { addListener: () => {} } },
  };
  const context = vm.createContext({ chrome, console, WebSocket: h.FakeWebSocket, crypto: { randomUUID: () => String(Math.random()) }, ...h.timers });
  context.importScripts = file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context);
  await settle();
  assert.equal(h.sockets.length, 1);
  const ws = h.sockets[0]; ws.open(); await ws.receive('HELLO_ACK');
  await ws.receive('ACK', {}, { replyToMessageId: ws.sent.at(-1).messageId });
  await ws.receive('LOAD_BATCH', { members: [{ id: 'a' }], resumeToken: 'token' }, { sessionId: 'session' });
  assert.equal(commands.at(-1).id, 11);
  tabs[0].active = false; tabs[1].active = true;
  await ws.receive('START');
  assert.equal(commands.at(-1).id, 11);
  assert.equal(commands.filter(item => item.message.type === 'NUSUK_WS_START').length, 1);
  const result = await new Promise(resolve => listeners.message({ type: 'NUSUK_WS_EVENT', payload: { eventType: 'PROGRESS', current: 1, total: 2, revision: 3 } }, { tab: { id: 11 } }, resolve));
  assert.equal(result.ok, true);
  assert.equal(ws.sent.at(-1).type, 'PROGRESS');
  const paused = await new Promise(resolve => listeners.message({ type: 'NUSUK_PANEL_STATE', payload: { executionState: 'paused', progress: { current: 1, total: 2 }, revision: 4 } }, { tab: { id: 11 } }, resolve));
  assert.equal(paused.ok, true);
  assert.equal(ws.sent.at(-1).payload.status, 'PAUSED');
  const count = ws.sent.length;
  const wrongTab = await new Promise(resolve => listeners.message({ type: 'NUSUK_WS_EVENT', payload: { eventType: 'SESSION_COMPLETED' } }, { tab: { id: 12 } }, resolve));
  assert.equal(wrongTab.ok, false);
  assert.equal(ws.sent.length, count);
  listeners.alarm({ name: 'entrymate-desktop-reconnect' }); await settle();
  assert.equal(h.sockets.length, 1);
});

test('page recovery skips completed members and does not restart an active runner', async () => {
  let listener;
  const runs = [];
  const state = { executionState: 'idle', revision: 100, activeSessionId: 'session' };
  const context = vm.createContext({
    window: { NusukAutofill: {} }, console: { log: () => {}, warn: () => {}, error: () => {} },
    chrome: { runtime: { onMessage: { addListener: fn => { listener = fn; } } } },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'content/panel-bridge.js'), 'utf8'), context);
  const bridge = context.window.NusukAutofill.panelBridge.createPanelBridge({
    state, persistState: async () => {}, postPanelState: () => {}, postToPanel: () => {},
    runAutomation: payload => { runs.push(payload); return new Promise(() => {}); },
  });
  bridge.bindWindowBridge();
  const message = { type: 'NUSUK_WS_SESSION_SNAPSHOT', payload: {
    sessionId: 'session', status: 'RUNNING', revision: 10,
    currentMemberId: null, completedMemberIds: ['a'], failures: [],
    manifestMembers: [{ id: 'a' }, { id: 'b' }], manifestPath: 'batch.json',
  } };
  listener(message, {}, () => {});
  await settle();
  assert.equal(runs.length, 1);
  assert.deepEqual(Array.from(runs[0].members, member => member.id), ['b']);
  listener(message, {}, () => {});
  await settle();
  assert.equal(runs.length, 1);
});
