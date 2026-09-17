const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.RELAY_SIGNING_SECRET = 'test-signing-secret-that-is-long-enough';
process.env.POLL_TIMEOUT_MS = '20';
process.env.MESSAGE_TIMEOUT_MS = '1000';

const { createServer } = require('../server.js');

let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function register(installationId, requestedSlug) {
  const response = await fetch(`${base}/api/tenants/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ installationId, ...(requestedSlug ? { requestedSlug } : {}) }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

async function registrationResponse(installationId, requestedSlug) {
  return fetch(`${base}/api/tenants/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ installationId, requestedSlug }),
  });
}

test('manual replies persist after the visitor request ends and retry without duplicates', async () => {
  const tenant = await register('installation-manual-reply-0001');
  const headers = { 'Content-Type': 'application/json', 'X-Bot-Secret': tenant.botSecret };
  assert.equal((await (await fetch(`${tenant.relayUrl}/health`)).json()).capabilities.sessionReplies, true);
  const waiting = fetch(`${tenant.relayUrl}/api/message`, {
    method: 'POST', headers, body: JSON.stringify({ session: 'manual-visitor', message: 'Freelance inquiry' }),
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  const [incoming] = (await (await fetch(`${tenant.relayUrl}/api/bot/poll`, { headers })).json()).messages;
  await fetch(`${tenant.relayUrl}/api/bot/reply`, { method: 'POST', headers, body: JSON.stringify({ messageId: incoming.id, response: '' }) });
  assert.equal((await (await waiting).json()).response, '');
  const body = { session: 'manual-visitor', response: 'Thanks — I can discuss the project tomorrow.', requestId: 'manual-request-00001' };
  const send = payload => fetch(`${tenant.relayUrl}/api/bot/send`, { method: 'POST', headers, body: JSON.stringify(payload) });
  const [first, retry] = await Promise.all([send(body), send(body)]);
  assert.equal(first.status, 200);
  assert.equal(retry.status, 200);
  assert.equal((await first.json()).requestId, body.requestId);
  const history = (await (await fetch(`${tenant.relayUrl}/api/history?session=manual-visitor`)).json()).messages;
  assert.equal(history.filter(event => event.id === body.requestId).length, 1);
  assert.deepEqual(history.map(event => event.content), ['Freelance inquiry', body.response]);
  assert.equal(history[1].delivery, 'session');
  assert.equal((await send({ ...body, response: 'Different message' })).status, 409);
  assert.equal((await send({ ...body, session: 'missing-session', requestId: 'manual-request-00002' })).status, 404);
});

test('manual reply route rejects foreign credentials, foreign sessions and malformed requests', async () => {
  const alpha = await register('installation-manual-alpha-0001');
  const beta = await register('installation-manual-beta-00001');
  const body = { session: 'foreign-visitor', response: 'Hello', requestId: 'manual-request-00003' };
  const send = (tenant, secret, payload) => fetch(`${tenant.relayUrl}/api/bot/send`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bot-Secret': secret }, body: JSON.stringify(payload),
  });
  assert.equal((await send(alpha, beta.botSecret, body)).status, 401);
  assert.equal((await send(beta, beta.botSecret, body)).status, 404);
  for (const invalid of [{ ...body, requestId: '../../bad' }, { ...body, session: '' }, { ...body, response: ' ' }, { ...body, response: 'x'.repeat(50001) }]) {
    assert.equal((await send(alpha, alpha.botSecret, invalid)).status, 400);
  }
});

test('registration is stable and returns a tenant-scoped relay credential', async () => {
  const first = await register('installation-stable-0001');
  const second = await register('installation-stable-0001');
  assert.equal(first.tenantId, second.tenantId);
  assert.equal(first.botSecret, second.botSecret);
  assert.match(first.relayUrl, new RegExp(`/${first.tenantId}$`));

  const health = await fetch(`${first.relayUrl}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).tenant, first.tenantId);
});

test('configuration and message queues remain isolated between tenants', async () => {
  const alpha = await register('installation-alpha-0001');
  const beta = await register('installation-beta-00001');

  const configResponse = await fetch(`${alpha.relayUrl}/api/bot/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bot-Secret': alpha.botSecret },
    body: JSON.stringify({ title: 'Alpha Concierge', color: '#123456' }),
  });
  assert.equal(configResponse.status, 200);
  assert.equal((await (await fetch(`${alpha.relayUrl}/api/config`)).json()).title, 'Alpha Concierge');
  assert.equal((await (await fetch(`${beta.relayUrl}/api/config`)).json()).title, 'Chat with us');

  const visitorResponse = fetch(`${alpha.relayUrl}/api/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: 'visitor-1', name: 'Visitor', message: 'Hello' }),
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  const betaPoll = await fetch(`${beta.relayUrl}/api/bot/poll`, {
    headers: { 'X-Bot-Secret': beta.botSecret },
  });
  assert.deepEqual((await betaPoll.json()).messages, []);
  assert.equal((await (await fetch(`${beta.relayUrl}/health`)).json()).connected, true);

  const alphaPoll = await fetch(`${alpha.relayUrl}/api/bot/poll`, {
    headers: { 'X-Bot-Secret': alpha.botSecret },
  });
  const [message] = (await alphaPoll.json()).messages;
  assert.equal(message.message, 'Hello');

  const wrongTenantReply = await fetch(`${beta.relayUrl}/api/bot/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bot-Secret': beta.botSecret },
    body: JSON.stringify({ messageId: message.id, response: 'Wrong tenant' }),
  });
  assert.equal(wrongTenantReply.status, 404);

  const reply = await fetch(`${alpha.relayUrl}/api/bot/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bot-Secret': alpha.botSecret },
    body: JSON.stringify({ messageId: message.id, response: 'Welcome' }),
  });
  assert.equal(reply.status, 200);
  assert.equal((await (await visitorResponse).json()).response, 'Welcome');
});

test('invalid tenant URLs and credentials are rejected', async () => {
  assert.equal((await fetch(`${base}/not-a-tenant/api/config`)).status, 404);
  const tenant = await register('installation-secure-0001');
  const poll = await fetch(`${tenant.relayUrl}/api/bot/poll`, {
    headers: { 'X-Bot-Secret': 'wrong' },
  });
  assert.equal(poll.status, 401);
});

test('a friendly slug resolves to the signed tenant and keeps the signed fallback working', async () => {
  const tenant = await register('installation-friendly-0001', 'north-star');
  assert.equal(tenant.slug, 'north-star');
  assert.equal(tenant.relayUrl, `${base}/north-star`);
  assert.match(tenant.tenantRelayUrl, new RegExp(`/${tenant.tenantId}$`));

  const friendlyHealth = await (await fetch(`${tenant.relayUrl}/health`)).json();
  const signedHealth = await (await fetch(`${tenant.tenantRelayUrl}/health`)).json();
  assert.equal(friendlyHealth.tenant, tenant.tenantId);
  assert.equal(friendlyHealth.slug, 'north-star');
  assert.equal(signedHealth.tenant, tenant.tenantId);

  const widget = await fetch(`${tenant.relayUrl}/widget.js`);
  assert.equal(widget.status, 200);
});

test('slug claims are idempotent and isolated between installations', async () => {
  const first = await register('installation-slug-owner-0001', 'bright-desk');
  const again = await register('installation-slug-owner-0001', 'bright-desk');
  assert.equal(again.tenantId, first.tenantId);
  assert.equal(again.relayUrl, first.relayUrl);

  const collision = await registrationResponse('installation-slug-other-0001', 'bright-desk');
  assert.equal(collision.status, 409);
  assert.match((await collision.json()).error, /already in use/i);
});

test('slug availability rejects reserved and malformed names', async () => {
  const available = await (await fetch(`${base}/api/slugs/availability?slug=clear-path`)).json();
  assert.deepEqual(available, { slug: 'clear-path', available: true, reason: '' });

  await register('installation-availability-0001', 'clear-path');
  const taken = await (await fetch(`${base}/api/slugs/availability?slug=clear-path`)).json();
  assert.equal(taken.available, false);
  assert.match(taken.reason, /already in use/i);

  for (const slug of ['api', 'docs', 'health', 'two--hyphens', '-leading', 'ab']) {
    const result = await (await fetch(`${base}/api/slugs/availability?slug=${encodeURIComponent(slug)}`)).json();
    assert.equal(result.available, false, slug);
    assert.ok(result.reason, slug);
    const response = await registrationResponse(`installation-invalid-${slug.padEnd(16, 'x')}`, slug);
    assert.equal(response.status, 400, slug);
  }
});
