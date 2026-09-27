import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac, createHash, randomUUID } from 'node:crypto';
import { Miniflare } from 'miniflare';

const signingSecret = 'runtime-test-signing-secret-at-least-32-characters';
const migrationSecret = 'runtime-test-migration-secret';
const source = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
const hmac = value => createHmac('sha256', signingSecret).update(value).digest('base64url');
function expectedTenant(installation) { const prefix = hmac(`installation:${installation}`).slice(0, 18); return `${prefix}.${hmac(`tenant:${prefix}`).slice(0, 10)}`; }
function runtime(persist, migration = false) {
  return new Miniflare({
    modules: true, script: source, compatibilityDate: '2026-07-30',
    bindings: { RELAY_SIGNING_SECRET: signingSecret, MIGRATION_MODE: String(migration), MIGRATION_SECRET: migrationSecret },
    durableObjects: { REGISTRY: { className: 'RelayRegistry', useSQLite: true }, TENANTS: { className: 'RelayTenant', useSQLite: true } },
    durableObjectsPersist: persist,
    serviceBindings: { ASSETS: request => new Response('fixture asset ' + new URL(request.url).pathname, { headers: { 'Content-Type': 'text/html' } }) },
  });
}
async function call(mf, path, { method = 'GET', body, secret, headers = {} } = {}) {
  const response = await mf.dispatchFetch('https://relay.test' + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(secret ? { 'X-Bot-Secret': secret } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
const post = (mf, path, body, secret, headers) => call(mf, path, { method: 'POST', body, secret, headers });
async function register(mf, installationId, requestedSlug) {
  const result = await post(mf, '/api/tenants/register', { installationId, requestedSlug });
  assert.equal(result.status, 201, JSON.stringify(result)); return result.data;
}
async function socket(mf, path) {
  const response = await mf.dispatchFetch('https://relay.test' + path, { headers: { Upgrade: 'websocket' } });
  assert.equal(response.status, 101);
  const ws = response.webSocket, events = [], waiters = [];
  ws.addEventListener('message', event => {
    let data; try { data = JSON.parse(event.data); } catch { data = event.data; }
    events.push(data);
    for (const waiter of [...waiters]) if (waiter.predicate(data)) { clearTimeout(waiter.timer); waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(data); }
  });
  ws.accept();
  return {
    ws, events,
    wait(type) {
      const prior = events.find(data => data.type === type || data === type); if (prior) return Promise.resolve(prior);
      return new Promise((resolve, reject) => { const waiter = { predicate: data => data.type === type || data === type, resolve }; waiter.timer = setTimeout(() => reject(new Error(`Missing websocket ${type}`)), 5000); waiters.push(waiter); });
    },
  };
}

test('Cloudflare runtime preserves isolation, asynchronous delivery and idempotency', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-runtime-'));
  const mf = runtime(dir), sockets = [];
  t.after(async () => { for (const s of sockets) s.ws.close(1000); await mf.dispose(); await rm(dir, { recursive: true, force: true }); });
  const alice = await register(mf, 'installation-alice-0001', 'alice-concierge');
  const bob = await register(mf, 'installation-bobby-0002', 'bobby-concierge');
  const base = '/' + alice.tenantId, sid = 'wc_' + randomUUID();
  const auth = alice.botSecret;
  let messageId;
  await t.test('registration is stable and retains legacy HMAC credential derivation', async () => {
    assert.equal(alice.tenantId, expectedTenant('installation-alice-0001'));
    assert.equal(auth, hmac(`bot:${alice.tenantId}`));
    assert.equal(alice.ownerKey, hmac(`owner:${alice.tenantId}`).slice(0, 32));
    assert.deepEqual(await register(mf, 'installation-alice-0001'), alice);
    assert.equal((await call(mf, '/alice-concierge/health')).data.tenant, alice.tenantId);
    assert.equal((await call(mf, base + '/health')).data.capabilities.asyncMessages, true);
  });
  await t.test('concurrent registrations grant a slug to exactly one installation', async () => {
    const results = await Promise.all(['installation-slugrace-0001', 'installation-slugrace-0002'].map(installationId => post(mf, '/api/tenants/register', { installationId, requestedSlug: 'only-one-owner' })));
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  });
  await t.test('foreign credentials and public migration bypass are rejected', async () => {
    assert.equal((await call(mf, base + '/api/bot/poll', { secret: bob.botSecret })).status, 401);
    assert.equal((await post(mf, base + '/__migration/import', { kind: 'tenant', tenantId: alice.tenantId, data: {} }, auth, { 'X-Migration-Secret': migrationSecret })).status, 404);
    assert.equal((await post(mf, '/__migration/import', { kind: 'tenant', tenantId: alice.tenantId, data: {} }, null, { 'X-Migration-Secret': migrationSecret })).status, 404);
  });
  const ticket = await post(mf, base + '/api/bot/socket-ticket', {}, auth);
  assert.equal(ticket.status, 200);
  const bot = await socket(mf, base + '/api/bot/events?ticket=' + ticket.data.ticket); sockets.push(bot);
  const visitor = await socket(mf, base + '/api/events?session=' + sid); sockets.push(visitor);
  await t.test('bot tickets are one-use and bot/visitor sockets receive ready', async () => {
    await Promise.all([bot.wait('ready'), visitor.wait('ready')]);
    bot.ws.send('ping'); visitor.ws.send('ping');
    await Promise.all([bot.wait('pong'), visitor.wait('pong')]);
    assert.equal((await call(mf, base + '/health')).data.connected, true);
    const reused = await mf.dispatchFetch('https://relay.test' + base + '/api/bot/events?ticket=' + ticket.data.ticket, { headers: { Upgrade: 'websocket' } });
    assert.equal(reused.status, 401);
  });
  const submission = { session: sid, message: 'Hello cloud relay', requestId: randomUUID() };
  await t.test('submission returns 202, announces work and deduplicates retries', async () => {
    const accepted = await post(mf, base + '/api/message', submission);
    assert.equal(accepted.status, 202); assert.equal(accepted.data.accepted, true); messageId = accepted.data.messageId;
    await Promise.all([bot.wait('messages_available'), visitor.wait('history_changed')]);
    assert.deepEqual(await post(mf, base + '/api/message', submission), accepted);
    assert.equal((await post(mf, base + '/api/message', { ...submission, message: 'different payload' })).status, 409);
    const history = (await call(mf, base + '/api/history?session=' + sid)).data;
    assert.equal(history.messages.length, 1); assert.equal(history.pending.length, 1);
    assert.equal(history.pending[0].requestId, submission.requestId);
  });
  await t.test('poll claims once immediately and reply duplicates do not duplicate history', async () => {
    const polled = await call(mf, base + '/api/bot/poll', { secret: auth });
    assert.equal(polled.data.messages.length, 1); assert.equal(polled.data.messages[0].id, messageId);
    assert.equal((await call(mf, base + '/api/bot/poll', { secret: auth })).data.messages.length, 0);
    assert.equal((await post(mf, base + '/api/bot/reply', { messageId, response: 'Hello visitor' }, auth)).status, 200);
    await visitor.wait('message_completed');
    assert.equal((await post(mf, base + '/api/bot/reply', { messageId, response: 'Hello visitor' }, auth)).data.status, 'duplicate');
    assert.equal((await post(mf, base + '/api/bot/reply', { messageId, response: 'Different reply' }, auth)).status, 409);
    const history = (await call(mf, base + '/api/history?session=' + sid)).data;
    assert.equal(history.pending.length, 0); assert.equal(history.messages.filter(m => m.role === 'assistant').length, 1);
    assert.equal(history.messages.find(m => m.role === 'assistant').requestId, submission.requestId);
    assert.equal((await call(mf, '/' + bob.tenantId + '/api/history?session=' + sid)).data.messages.length, 0);
  });
  await t.test('empty completion removes pending state without creating a blank reply', async () => {
    const second = await post(mf, base + '/api/message', { session: sid, message: 'No reply needed', requestId: randomUUID() });
    assert.equal((await post(mf, base + '/api/bot/reply', { messageId: second.data.messageId, response: '' }, auth)).status, 200);
    const history = (await call(mf, base + '/api/history?session=' + sid)).data;
    assert.equal(history.pending.length, 0); assert.equal(history.messages.filter(m => m.role === 'assistant').length, 1);
  });
  await t.test('manual replies deduplicate and reject foreign or nonexistent sessions', async () => {
    const manual = { session: sid, response: 'Owner follow-up', requestId: randomUUID() };
    assert.equal((await post(mf, base + '/api/bot/send', manual, auth)).data.status, 'sent');
    assert.equal((await post(mf, base + '/api/bot/send', manual, auth)).data.status, 'duplicate');
    assert.equal((await post(mf, base + '/api/bot/send', { ...manual, response: 'changed' }, auth)).status, 409);
    assert.equal((await post(mf, '/' + bob.tenantId + '/api/bot/send', { ...manual, requestId: randomUUID() }, bob.botSecret)).status, 404);
    const history = (await call(mf, base + '/api/history?session=' + sid)).data;
    assert.equal(history.messages.filter(m => m.id === manual.requestId).length, 1);
  });
  await t.test('owner media permission is enforced independently of visitor text', async () => {
    const media = { session: sid, image: 'data:image/png;base64,aGVsbG8=', requestId: randomUUID() };
    assert.equal((await post(mf, base + '/api/message', media)).status, 403);
    assert.equal((await post(mf, base + '/api/message', { ...media, ownerKey: bob.ownerKey })).status, 403);
    assert.equal((await post(mf, base + '/api/message', { ...media, ownerKey: alice.ownerKey })).status, 202);
  });
});

test('SQLite history, pending work and credentials survive runtime restart', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-restart-'));
  let mf = runtime(dir);
  t.after(async () => { await mf.dispose(); await rm(dir, { recursive: true, force: true }); });
  const tenant = await register(mf, 'installation-persistence-0001', 'persistent-chat');
  const base = '/' + tenant.tenantId, sid = 'wc_' + randomUUID();
  const sent = await post(mf, base + '/api/message', { session: sid, message: 'Survive restart', requestId: randomUUID() });
  await mf.dispose(); mf = runtime(dir);
  assert.deepEqual(await register(mf, 'installation-persistence-0001'), tenant);
  const history = await call(mf, '/persistent-chat/api/history?session=' + sid);
  assert.equal(history.data.messages[0].content, 'Survive restart');
  assert.equal(history.data.pending[0].messageId, sent.data.messageId);
  assert.equal((await call(mf, base + '/api/bot/poll', { secret: tenant.botSecret })).data.messages[0].id, sent.data.messageId);
});

test('migration freezes public APIs and verifies imported live projections', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-import-'));
  let mf = runtime(dir, true);
  t.after(async () => { await mf.dispose(); await rm(dir, { recursive: true, force: true }); });
  const tenantId = expectedTenant('installation-migration-0001'), sessionId = 'legacy-session-private';
  const headers = { 'X-Migration-Secret': migrationSecret };
  const records = [
    { kind: 'tenant', tenantId, id: tenantId, data: { slug: 'migrated-chat', config: { title: 'Existing concierge' } } },
    { kind: 'slug', tenantId, id: 'migrated-chat', data: { tenantId } },
    { kind: 'session', tenantId, sessionId, id: createHash('sha256').update(sessionId).digest('base64url'), data: { sessionId, lastMessageAt: '2026-09-27T00:00:00.000Z' } },
    { kind: 'event', tenantId, sessionId, id: 'old-event', data: { id: 'old-event', role: 'assistant', content: 'Preserved conversation', delivery: 'session', createdAt: '2026-09-27T00:00:00.000Z' } },
    { kind: 'receipt', tenantId, id: 'old-reply-request-0001', data: { sessionId, content: 'Existing reply' } },
  ];
  assert.equal((await post(mf, '/api/tenants/register', { installationId: 'installation-blocked-0001' })).status, 503);
  assert.equal((await post(mf, '/__migration/import', records[0])).status, 404);
  for (const record of records) {
    assert.equal((await post(mf, '/__migration/import', record, null, headers)).status, 200);
    assert.equal((await post(mf, '/__migration/verify', record, null, headers)).data.matches, true);
  }
  const altered = { ...records[3], data: { ...records[3].data, content: 'Altered history' } };
  assert.equal((await post(mf, '/__migration/verify', altered, null, headers)).data.matches, false);
  await mf.dispose(); mf = runtime(dir, false);
  assert.equal((await call(mf, '/migrated-chat/api/config')).data.title, 'Existing concierge');
  const history = (await call(mf, '/migrated-chat/api/history?session=' + sessionId)).data;
  assert.equal(history.messages[0].content, 'Preserved conversation');
  assert.equal((await post(mf, '/migrated-chat/api/bot/send', { session: sessionId, requestId: 'old-reply-request-0001', response: 'Existing reply' }, hmac(`bot:${tenantId}`))).data.status, 'duplicate');
  assert.equal((await post(mf, '/__migration/import', records[0], null, headers)).status, 404);
});
