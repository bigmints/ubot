const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const source = fs.readFileSync(path.join(__dirname, '../public/session-transport.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness({ push = true, fetchHistory, fetchHealth } = {}) {
  const sockets = [], calls = [], timers = new Map(), intervals = new Map(), events = {}, histories = [];
  let nextId = 0;
  class WebSocket {
    constructor(url) { this.url = url; sockets.push(this); }
    sent = [];
    send(data) { this.sent.push(data); }
    close() { this.onclose?.(); }
    notify(type) { this.onmessage({ data: JSON.stringify({ type }) }); }
  }
  const window = { crypto, addEventListener: (name, fn) => { events[name] = fn; }, removeEventListener: name => { delete events[name]; } };
  const document = { hidden: false, addEventListener: window.addEventListener, removeEventListener: window.removeEventListener };
  vm.runInNewContext(source, {
    window, document, URL, Uint8Array, WebSocket, AbortController,
    fetch: async (url, options) => {
      calls.push(url);
      if (url.endsWith('/health')) return fetchHealth ? fetchHealth(options) : { ok: true, json: async () => ({ capabilities: { asyncMessages: push } }) };
      return fetchHistory ? fetchHistory(options) : { ok: true, json: async () => ({ messages: [], pending: [] }) };
    },
    setTimeout: (fn, delay) => { const id = ++nextId; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => { const id = ++nextId; intervals.set(id, { fn, delay }); return id; },
    clearInterval: id => intervals.delete(id),
  });
  const transport = window.YoubotSessionTransport.create({ base: 'https://relay.test/tenant', session: 'wc_secret&unsafe', onHistory: data => histories.push(data) });
  return { window, document, sockets, calls, timers, intervals, events, histories, transport };
}

test('push capability uses websocket notifications and never starts HTTP history polling', async () => {
  const h = harness();
  await flush();
  assert.equal(h.intervals.size, 0);
  assert.equal(h.calls.length, 1);
  assert.equal(new URL(h.sockets[0].url).searchParams.get('session'), 'wc_secret&unsafe');
  assert.equal(new URL(h.sockets[0].url).protocol, 'wss:');
  for (const event of ['ready', 'history_changed', 'message_completed']) { h.sockets[0].notify(event); await flush(); }
  assert.equal(h.histories.length, 3);
  assert.equal(h.calls.length, 4);
  h.transport.stop();
});

test('reconnects with bounded backoff and reconciles history after ready', async () => {
  const h = harness(); await flush();
  for (let n = 0; n < 8; n++) {
    h.sockets.at(-1).close();
    const [id, timer] = [...h.timers][0];
    assert.ok(timer.delay >= 1000 && timer.delay < 30500);
    h.timers.delete(id); timer.fn();
  }
  h.sockets.at(-1).notify('ready'); await flush();
  assert.equal(h.histories.length, 1);
  h.transport.stop();
  assert.equal(h.timers.size, 0);
});

test('notifications arriving during a history request trigger one follow-up reconciliation', async () => {
  let release;
  const h = harness({ fetchHistory: () => new Promise(resolve => { release = () => resolve({ ok: true, json: async () => ({ messages: [] }) }); }) });
  await flush();
  h.sockets[0].notify('ready');
  h.sockets[0].notify('history_changed');
  h.sockets[0].notify('history_changed');
  release(); await flush();
  assert.equal(h.calls.length, 3);
  release(); await flush();
  assert.equal(h.histories.length, 2);
  h.transport.stop();
});

test('legacy relay retains history polling and stop removes listeners and timers', async () => {
  const h = harness({ push: false }); await flush();
  assert.equal(h.sockets.length, 0);
  assert.equal(h.intervals.size, 1);
  assert.equal(h.histories.length, 1);
  h.transport.stop();
  assert.equal(h.intervals.size, 0);
  assert.equal(Object.keys(h.events).length, 0);
});

function pageHarness(kind) {
  const page = fs.readFileSync(path.join(__dirname, '../public/', kind === 'page' ? 'index.html' : 'widget.js'), 'utf8');
  const start = page.indexOf('  function applyHistory(');
  const end = page.indexOf(kind === 'page' ? '\n    let transport;' : '\n  async function sendMessage', start);
  const messages = kind === 'page' ? [{ r: 'u', t: 'hello', requestId: 'req', pending: true }] : [{ role: 'user', text: 'hello', requestId: 'req', pending: true }];
  const context = { messages, receivedReplies: [], sending: false, loading: true, isLoading: true, SK_RECEIVED: 'received', localStorage: { setItem() {} }, saveHist() {}, render() {}, saveHistory() {}, renderMessages() {} };
  vm.createContext(context);
  vm.runInContext(page.slice(start, end), context);
  return { context, apply: context.applyHistory };
}
for (const kind of ['page', 'widget']) {
  test(`${kind}: assistant events deduplicate and pending state clears after reconnect or empty completion`, () => {
    const h = pageHarness(kind);
    const reply = { id: 'reply-1', role: 'assistant', delivery: 'session', content: 'Hello!', timestamp: new Date().toISOString(), requestId: 'req' };
    h.apply({ messages: [reply], pending: [] }, true);
    h.apply({ messages: [reply], pending: [] }, true);
    assert.equal(h.context.messages.length, 2);
    assert.equal(h.context.messages[0].pending, false);
    assert.equal(kind === 'page' ? h.context.loading : h.context.isLoading, false);
    h.apply({ messages: [reply], pending: [{ requestId: 'req', messageId: 'm1' }] }, true);
    assert.equal(kind === 'page' ? h.context.loading : h.context.isLoading, true);
    h.apply({ messages: [reply], pending: [] }, true);
    assert.equal(kind === 'page' ? h.context.loading : h.context.isLoading, false);
  });
}

for (const kind of ['page', 'widget']) {
  test(`${kind}: ambiguous delivery retries with the same request UUID and preserves a newer draft`, async () => {
    const page = fs.readFileSync(path.join(__dirname, '../public/', kind === 'page' ? 'index.html' : 'widget.js'), 'utf8');
    const start = page.indexOf('  async function sendMessage(');
    const end = page.indexOf(kind === 'page' ? '\n    // ── Text send' : '\n  function escapeHtml', start);
    const input = { value: 'a newer unsent draft' }, feedback = { textContent: '' }, bodies = [];
    let failures = 1, uuidCalls = 0;
    const context = {
      messages: [], loading: false, isLoading: false, sending: false, transportMode: 'push',
      AbortController, setTimeout, clearTimeout,
      window: {}, document: { getElementById: id => id === 'feedback' ? feedback : input },
      localStorage: { setItem() {} }, SK_HISTORY: 'history', STORAGE_KEY: 'widget',
      YoubotSessionTransport: { id: () => { uuidCalls++; return 'stable-request-uuid'; } },
      BASE: 'https://relay.test/t', BASE_URL: 'https://relay.test/t', sid: 's', sessionId: 's', OWNER_KEY: '',
      stopPlayback() {}, saveHist() {}, render() {}, saveHistory() {}, renderMessages() {}, resizeInput() {},
      transport: { refresh() {} },
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(init.body));
        if (failures--) throw new Error('Response lost');
        return { ok: true, status: 202, json: async () => ({ accepted: true, messageId: 'm1' }) };
      },
    };
    vm.createContext(context);
    vm.runInContext(page.slice(start, end), context);
    await context.sendMessage('hello');
    assert.equal(input.value, 'a newer unsent draft');
    assert.equal(context.messages[0].failed, true);
    await context.sendMessage('hello');
    assert.equal(uuidCalls, 1);
    assert.equal(bodies[0].requestId, bodies[1].requestId);
    assert.equal(context.messages.length, 1);
    assert.equal(context.messages[0].pending, true);
    assert.equal(context.messages[0].messageId, 'm1');
    assert.equal(kind === 'page' ? context.loading : context.isLoading, true);
  });
}

test('failed notification reconciliation retries and stops retrying when history succeeds', async () => {
  let attempts = 0;
  const h = harness({ fetchHistory: async () => ({ ok: ++attempts > 1, json: async () => ({ messages: [], pending: [] }) }) });
  await flush();
  h.sockets[0].notify('ready'); await flush();
  assert.equal([...h.timers.values()].filter(timer => timer.delay !== 60000).length, 1);
  const [id, timer] = [...h.timers].find(([, timer]) => timer.delay !== 60000);
  h.timers.delete(id); timer.fn(); await flush();
  assert.equal(h.histories.length, 1);
  assert.equal([...h.timers.values()].filter(timer => timer.delay !== 60000).length, 0);
  assert.equal(h.intervals.size, 0);
  h.transport.stop();
});

function fireTimer(h, predicate) {
  const entry = [...h.timers].find(([, timer]) => predicate(timer));
  assert.ok(entry, 'Expected matching timer');
  h.timers.delete(entry[0]); entry[1].fn();
}
function untilAborted(signal) {
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
  });
}
test('stalled discovery aborts and retries without switching to idle polling', async () => {
  let attempts = 0, signal;
  const h = harness({ fetchHealth: options => {
    if (++attempts === 1) { signal = options.signal; return untilAborted(signal); }
    return { ok: true, json: async () => ({ capabilities: { asyncMessages: true } }) };
  } });
  await flush();
  fireTimer(h, t => t.delay === 10000); await flush();
  assert.equal(signal.aborted, true);
  fireTimer(h, t => t.delay < 1500); await flush();
  assert.equal(h.sockets.length, 1); assert.equal(h.intervals.size, 0);
  h.transport.stop();
});
test('stalled history is aborted and queued notifications reconcile afterward', async () => {
  let attempts = 0, signal;
  const h = harness({ fetchHistory: options => {
    if (++attempts === 1) { signal = options.signal; return untilAborted(signal); }
    return { ok: true, json: async () => ({ messages: [{ id: 'recovered-reply' }], pending: [] }) };
  } });
  await flush(); h.sockets[0].notify('ready'); await flush();
  h.sockets[0].notify('history_changed');
  fireTimer(h, t => t.delay === 10000); await flush();
  assert.equal(signal.aborted, true); assert.equal(attempts, 2);
  assert.equal(h.histories[0].messages[0].id, 'recovered-reply');
  assert.equal([...h.timers.values()].filter(timer => timer.delay !== 60000).length, 0); assert.equal(h.intervals.size, 0);
  h.transport.stop();
});
test('socket without a ready event times out and reconnects, then clears its deadline', async () => {
  const h = harness(); await flush(); const abandoned = h.sockets[0];
  fireTimer(h, t => t.delay === 10000);
  fireTimer(h, t => t.delay < 1500);
  assert.equal(h.sockets.length, 2);
  abandoned.notify('ready'); await flush(); assert.equal(h.histories.length, 0);
  h.sockets[1].notify('ready'); await flush();
  assert.equal(h.histories.length, 1); assert.equal([...h.timers.values()].filter(timer => timer.delay !== 60000).length, 0);
  h.transport.stop();
});
test('stop aborts an active history body read and cannot restart recovery', async () => {
  let signal;
  const h = harness({ fetchHistory: options => {
    signal = options.signal;
    return { ok: true, json: () => untilAborted(signal) };
  } });
  await flush(); h.sockets[0].notify('ready'); await flush();
  h.transport.stop(); await flush();
  assert.equal(signal.aborted, true); assert.equal(h.timers.size, 0);
  assert.equal(h.histories.length, 0); assert.equal(h.intervals.size, 0);
});
test('stop aborts discovery; online events cannot start a second concurrent discovery', async () => {
  let signal, attempts = 0;
  const h = harness({ fetchHealth: options => { attempts++; signal = options.signal; return untilAborted(signal); } });
  await flush(); h.events.online(); await flush();
  assert.equal(attempts, 1);
  h.transport.stop(); await flush();
  assert.equal(signal.aborted, true); assert.equal(h.timers.size, 0); assert.equal(h.sockets.length, 0);
});

for (const kind of ['page', 'widget']) {
  test(`${kind}: a stalled submission body times out, clears busy state and retries its original request`, async () => {
    const page = fs.readFileSync(path.join(__dirname, '../public/', kind === 'page' ? 'index.html' : 'widget.js'), 'utf8');
    const start = page.indexOf('  async function sendMessage(');
    const end = page.indexOf(kind === 'page' ? '\n    // ── Text send' : '\n  function escapeHtml', start);
    const input = { value: '' }, timers = new Map(), bodies = [];
    let nextId = 0, attempts = 0, signal, reconciles = 0;
    const context = {
      messages: [], loading: false, isLoading: false, sending: false, transportMode: 'push', AbortController,
      window: {}, document: { getElementById: () => input },
      localStorage: { setItem() {} }, SK_HISTORY: 'history', STORAGE_KEY: 'widget',
      YoubotSessionTransport: { id: () => 'unchanging-request-uuid' },
      BASE: 'https://relay.test/t', BASE_URL: 'https://relay.test/t', sid: 's', sessionId: 's', OWNER_KEY: '',
      stopPlayback() {}, saveHist() {}, render() {}, saveHistory() {}, renderMessages() {}, resizeInput() {},
      transport: { refresh() { reconciles++; } },
      setTimeout: (fn, delay) => { const id = ++nextId; timers.set(id, { fn, delay }); return id; },
      clearTimeout: id => timers.delete(id),
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(init.body)); signal = init.signal;
        if (++attempts === 1) return { ok: true, status: 202, json: () => untilAborted(signal) };
        return { ok: true, status: 202, json: async () => ({ accepted: true, messageId: 'm1' }) };
      },
    };
    vm.createContext(context); vm.runInContext(page.slice(start, end), context);
    const stalled = context.sendMessage('hello'); await flush();
    assert.equal([...timers.values()][0].delay, 15000);
    [...timers.values()][0].fn(); await stalled;
    assert.equal(signal.aborted, true); assert.equal(timers.size, 0);
    assert.equal(context.sending, false);
    assert.equal(kind === 'page' ? context.loading : context.isLoading, false);
    assert.equal(input.value, 'hello'); assert.equal(context.messages[0].failed, true);
    assert.equal(reconciles, 1);
    context.transportMode = 'legacy';
    await context.sendMessage('hello');
    assert.equal(bodies[0].requestId, bodies[1].requestId);
    assert.equal(context.messages.length, 1); assert.equal(context.messages[0].pending, true);
    assert.equal(timers.size, 0);
  });
}

test('healthy idle sockets use only ping/pong, with no recurring HTTP reads', async () => {
  const h = harness(); await flush();
  h.sockets[0].notify('ready'); await flush();
  const requests = h.calls.length;
  for (let n = 0; n < 3; n++) {
    fireTimer(h, timer => timer.delay === 60000);
    assert.equal(h.sockets[0].sent.at(-1), 'ping');
    h.sockets[0].onmessage({ data: 'pong' });
    assert.equal([...h.timers.values()].filter(timer => timer.delay === 10000).length, 0);
  }
  assert.equal(h.calls.length, requests);
  assert.equal(h.intervals.size, 0);
  h.transport.stop(); assert.equal(h.timers.size, 0);
});

test('a socket without a pong is retired and its replacement reconciles missed replies', async () => {
  const h = harness(); await flush();
  h.sockets[0].notify('ready'); await flush();
  fireTimer(h, timer => timer.delay === 60000);
  fireTimer(h, timer => timer.delay === 10000);
  fireTimer(h, timer => timer.delay < 1500);
  assert.equal(h.sockets.length, 2);
  h.sockets[1].notify('ready'); await flush();
  assert.equal(h.histories.length, 2);
  h.transport.stop(); assert.equal(h.timers.size, 0);
});
