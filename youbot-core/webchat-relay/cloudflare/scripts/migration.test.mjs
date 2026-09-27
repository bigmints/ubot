import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalize, sessionKey, readSnapshot, validateTopology } from './migration-lib.mjs';
import { exportSnapshot } from './export-firestore.mjs';
import { migrateSnapshot, destinationUrl } from './import-snapshot.mjs';

const timestamp = { toDate: () => new Date('2026-09-27T00:00:00.000Z') };
function fakeDatabase({ changed = false, interrupt = false } = {}) {
  const collections = {
    relay_tenants: [['tenant-1', { config: { title: changed ? 'Changed' : 'Original' }, slug: 'hello', createdAt: timestamp }]],
    'relay_tenants/tenant-1/sessions': [[sessionKey('session-private'), { sessionId: 'session-private', lastMessageAt: timestamp }]],
    [`relay_tenants/tenant-1/sessions/${sessionKey('session-private')}/events`]: [['event-doc', { id: 'event-public', role: 'user', content: 'Private content', createdAt: timestamp }]],
    'relay_tenants/tenant-1/messages': [['message-1', { sessionId: 'session-private', status: 'pending', claimedUntil: timestamp }]],
    'relay_tenants/tenant-1/sent_replies': [['reply-1', { sessionId: 'session-private', content: 'Reply', createdAt: timestamp }]],
    relay_slugs: [['hello', { tenantId: 'tenant-1', createdAt: timestamp }]],
  };
  const collection = path => ({
    orderBy() { return this; }, limit() { return this; },
    async get() {
      if (interrupt && path.endsWith('/messages')) throw new Error('simulated interruption');
      return { docs: (collections[path] || []).map(([id, data]) => ({ id, data: () => data, ref: { collection: child => collection(`${path}/${id}/${child}`) } })) };
    },
  });
  return { collection };
}
async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), 'relay-migration-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'snapshot.jsonl');
}
test('normalizes timestamps recursively and rejects unsupported Firestore types', () => {
  assert.deepEqual(normalize({ values: [timestamp, new Date(0)] }), { values: ['2026-09-27T00:00:00.000Z', '1970-01-01T00:00:00.000Z'] });
  assert.throws(() => normalize({ bytes: Buffer.from('secret') }), /Unsupported/);
});
test('default export scans without writing; snapshot retains all record types and identifiers', async t => {
  const output = await temporary(t);
  const options = { db: fakeDatabase(), project: 'test-project', output, frozen: true };
  assert.equal((await exportSnapshot(options)).mode, 'dry-run');
  await assert.rejects(readFile(output), { code: 'ENOENT' });
  await exportSnapshot({ ...options, write: true });
  const { records, manifest } = await readSnapshot(output);
  assert.deepEqual(manifest.counts, { tenant: 1, slug: 1, session: 1, event: 1, message: 1, receipt: 1 });
  assert.equal(records.find(r => r.kind === 'event').id, 'event-doc');
  assert.equal(records.find(r => r.kind === 'event').data.id, 'event-public');
  assert.equal(records.find(r => r.kind === 'message').data.claimedUntil, '2026-09-27T00:00:00.000Z');
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  await assert.rejects(exportSnapshot({ ...options, write: true }), /exists/);
});
test('export resumes interrupted source scans without duplicate records and rejects changed sources', async t => {
  const output = await temporary(t);
  const options = { project: 'test-project', output, frozen: true, write: true };
  await assert.rejects(exportSnapshot({ ...options, db: fakeDatabase({ interrupt: true }) }), /interruption/);
  await assert.rejects(exportSnapshot({ ...options, db: fakeDatabase({ changed: true }), resume: true }), /Source changed/);
  await exportSnapshot({ ...options, db: fakeDatabase(), resume: true });
  assert.equal((await readSnapshot(output)).records.length, 6);
});
test('import defaults to offline validation, checks integrity and requires freeze before network', async t => {
  const input = await temporary(t);
  await exportSnapshot({ db: fakeDatabase(), project: 'test-project', output: input, write: true });
  const fetchImpl = () => { throw new Error('network should not run'); };
  assert.equal((await migrateSnapshot({ input, fetchImpl })).mode, 'dry-run');
  await assert.rejects(migrateSnapshot({ input, apply: true, fetchImpl }), /source-frozen/);
  const content = await readFile(input, 'utf8');
  await writeFile(input, content.replace('Original', 'Tampered'));
  await assert.rejects(migrateSnapshot({ input, fetchImpl }), /checksum/);
});
test('import resumes after response loss, verifies every record, refuses wrong destination checkpoint', async t => {
  const input = await temporary(t);
  await exportSnapshot({ db: fakeDatabase(), project: 'test-project', output: input, frozen: true, write: true });
  const writes = [];
  const options = { input, url: 'http://localhost:8787', secret: 'a'.repeat(32), apply: true };
  await assert.rejects(migrateSnapshot({ ...options, fetchImpl: async (url, req) => {
    const record = JSON.parse(req.body);
    writes.push(record.kind);
    assert.equal(req.redirect, 'error');
    if (record.kind === 'event') throw new Error('lost response');
    return Response.json({ imported: true });
  } }), /lost response/);
  assert.deepEqual(writes, ['tenant', 'slug', 'session', 'event']);
  const resumed = [];
  await migrateSnapshot({ ...options, resume: true, fetchImpl: async (url, req) => {
    resumed.push(JSON.parse(req.body).kind);
    return Response.json({ imported: true });
  } });
  assert.deepEqual(resumed, ['event', 'message', 'receipt']);
  await assert.rejects(migrateSnapshot({ ...options, resume: true, url: 'https://other.example' }), /different snapshot or destination/);
  let verified = 0;
  await migrateSnapshot({ ...options, apply: false, verify: true, fetchImpl: async url => {
    assert.ok(url.endsWith('/verify')); verified++;
    return Response.json({ matches: true });
  } });
  assert.equal(verified, 6);
  await assert.rejects(migrateSnapshot({ ...options, apply: false, verify: true, fetchImpl: async () => Response.json({ matches: false }) }), /mismatch/);
});
test('rejects unsafe origins and broken tenant routing topology', () => {
  for (const value of ['http://relay.example', 'https://user:secret@relay.example', 'https://relay.example/?key=secret']) assert.throws(() => destinationUrl(value));
  assert.throws(() => validateTopology([{ kind: 'slug', tenantId: 'missing', id: 'hello', data: { tenantId: 'missing' } }]), /missing tenant/);
  assert.throws(() => validateTopology([{ kind: 'tenant', tenantId: 'id', id: 'id', data: { slug: 'lost' } }]), /slug missing/);
});
