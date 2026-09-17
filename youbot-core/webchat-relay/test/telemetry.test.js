const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRelayTelemetry, durationBand, sanitizeRelayRoute } = require('../telemetry.js');

test('relay routes are templated before telemetry leaves the process', () => {
  assert.equal(sanitizeRelayRoute('/north-star/api/message?session=private'), '/:relay/api/message');
  assert.equal(sanitizeRelayRoute('/signed.tenant/k/owner-secret'), '/:relay/k/:owner');
  assert.equal(sanitizeRelayRoute('/api/slugs/availability?slug=private-name'), '/api/slugs/availability');
  assert.equal(sanitizeRelayRoute('/assets/site.js?v=secret'), '/assets/:asset');
});

test('relay telemetry allowlists fields and never emits supplied content or identifiers', async () => {
  const calls = [];
  const telemetry = createRelayTelemetry({
    measurementId: 'G-TEST123',
    apiSecret: 'test-api-secret',
    salt: 'test-signing-secret-that-is-long-enough',
    fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true }; },
  });
  telemetry.emit('relay_message', {
    surface: 'relay_server', route: '/private-slug/api/message?session=private-session',
    outcome: 'accepted', media_kind: 'text', message: 'secret message',
    tenant_id: 'private-tenant', credential: 'private-owner-key',
  }, 'private-tenant:private-session');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0].options.body);
  const serialized = JSON.stringify(payload);
  assert.equal(payload.events[0].params.route, '/:relay/api/message');
  for (const secret of ['secret message', 'private-slug', 'private-session', 'private-tenant', 'private-owner-key']) {
    assert.doesNotMatch(serialized, new RegExp(secret));
  }
  assert.equal(payload.non_personalized_ads, true);
});

test('missing configuration is a no-op and timing is coarse', () => {
  let called = false;
  const telemetry = createRelayTelemetry({ fetchImpl: async () => { called = true; } });
  telemetry.emit('relay_request', { route: '/health' });
  assert.equal(telemetry.enabled, false);
  assert.equal(called, false);
  assert.equal(durationBand(25), 'under_100ms');
  assert.equal(durationBand(65_000), '60s_plus');
});
