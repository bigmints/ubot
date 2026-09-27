import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import '../scripts/build-assets.mjs';

test('built public assets are served through the real Workers asset binding', async t => {
  const mf = new Miniflare({
    name: 'relay-assets-test', modules: true, script: await readFile(new URL('../src/worker.js', import.meta.url), 'utf8'), compatibilityDate: '2026-07-30',
    bindings: { RELAY_SIGNING_SECRET: 'asset-test-signing-secret-at-least-32-characters', MIGRATION_MODE: 'false' },
    durableObjects: { REGISTRY: { className: 'RelayRegistry', useSQLite: true }, TENANTS: { className: 'RelayTenant', useSQLite: true } },
    assets: { workerName: 'relay-assets-test', directory: fileURLToPath(new URL('../dist/assets', import.meta.url)), binding: 'ASSETS', routerConfig: { invoke_user_worker_ahead_of_assets: true, has_user_worker: true } },
  });
  t.after(() => mf.dispose());
  const fetch = (path, options) => mf.dispatchFetch('https://relay.test' + path, options);
  const registration = await fetch('/api/tenants/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ installationId: 'asset-test-installation-001', requestedSlug: 'asset-chat' }) });
  assert.equal(registration.status, 201, await registration.clone().text());
  const tenant = await registration.json();
  for (const route of ['/', '/docs/', '/assets/site.css', '/widget.js', '/session-transport.js', '/sw.js', '/icon-192.svg', '/install.sh', '/asset-chat', '/' + tenant.tenantId, '/asset-chat/k/' + tenant.ownerKey]) {
    const response = await fetch(route);
    assert.equal(response.status, 200, route);
    const text = await response.text();
    assert.ok(text.length > 0, route);
    if (route === '/session-transport.js') assert.match(text, /YoubotSessionTransport/);
    if (route === '/asset-chat') assert.match(text, /src="\/session-transport.js"/);
  }
  const helper = await fetch('/session-transport.js');
  assert.match(helper.headers.get('content-type'), /javascript/);
  assert.equal((await fetch('/asset-chat/api/history?session=private-session')).headers.get('cache-control'), 'no-store');
});
