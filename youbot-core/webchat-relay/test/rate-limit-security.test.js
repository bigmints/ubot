const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.RELAY_SIGNING_SECRET = 'rate-limit-regression-test-secret-32-chars';
process.env.RELAY_TRUSTED_PROXY_HOPS = '0';
const { createServer, clientAddress } = require('../server.js');

const request = (forwarded) => ({ headers: { 'x-forwarded-for': forwarded }, socket: { remoteAddress: '127.0.0.1' } });
test('forwarded identity requires an explicit trusted ingress and ignores spoofed prefixes', () => {
  assert.equal(clientAddress(request('198.51.100.7')), '127.0.0.1');
  assert.equal(clientAddress(request('spoof, 198.51.100.7'), 1), '198.51.100.7');
  assert.equal(clientAddress(request('another-spoof, 198.51.100.7'), 1), '198.51.100.7');
  assert.equal(clientAddress(request('spoof, 198.51.100.7, 192.0.2.1'), 2), '198.51.100.7');
  for (const value of ['', 'not-an-ip', '198.51.100.7:999', 'spoof, bad']) {
    assert.equal(clientAddress(request(value), 1), '127.0.0.1');
  }
  assert.equal(clientAddress(request('spoof, 2001:0db8:0:0:0:0:0:1'), 1), clientAddress(request('2001:db8::1'), 1));
});

test('changing caller-supplied forwarded headers cannot reset the registration quota', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (let i = 0; i < 23; i++) {
      const response = await fetch(`${base}/api/tenants/register`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${i}` },
        body: JSON.stringify({ installationId: 'invalid' }),
      });
      assert.equal(response.status, i < 20 ? 400 : 429);
      await response.text();
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
