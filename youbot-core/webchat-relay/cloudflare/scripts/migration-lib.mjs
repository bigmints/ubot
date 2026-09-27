import { createHash } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';

export const KINDS = ['tenant', 'slug', 'session', 'event', 'message', 'receipt'];
export function normalize(value) {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  }
  throw new Error('Unsupported Firestore field type; export stopped without coercing data');
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const sessionKey = value => createHash('sha256').update(value).digest('base64url');
export const recordKey = record => JSON.stringify([record.kind, record.tenantId, record.sessionId || '', record.id]);
const validId = value => typeof value === 'string' && value.length > 0 && !value.includes('/');
export function validateRecord(record) {
  if (!record || !KINDS.includes(record.kind) || !validId(record.tenantId) || !validId(record.id)
      || !record.data || typeof record.data !== 'object' || Array.isArray(record.data)) throw new Error('Invalid migration record');
  if (['session', 'event'].includes(record.kind) && typeof record.sessionId !== 'string') throw new Error('Missing original session ID');
  if (record.kind === 'tenant' && record.id !== record.tenantId) throw new Error('Tenant identity mismatch');
  if (record.kind === 'slug' && record.data.tenantId !== record.tenantId) throw new Error('Slug ownership mismatch');
  if (record.kind === 'session' && (record.data.sessionId !== record.sessionId || record.id !== sessionKey(record.sessionId))) throw new Error('Session identity mismatch');
  return record;
}
export function validateTopology(records) {
  const tenants = new Map(records.filter(r => r.kind === 'tenant').map(r => [r.id, r]));
  const slugs = new Map(records.filter(r => r.kind === 'slug').map(r => [r.id, r.tenantId]));
  const sessions = new Set(records.filter(r => r.kind === 'session').map(r => JSON.stringify([r.tenantId, r.sessionId])));
  const seen = new Set();
  for (const record of records) {
    validateRecord(record);
    const key = recordKey(record);
    if (seen.has(key)) throw new Error('Duplicate record in snapshot');
    seen.add(key);
    if (!tenants.has(record.tenantId)) throw new Error('Orphan record references a missing tenant');
    if (record.kind === 'tenant' && record.data.slug && slugs.get(record.data.slug) !== record.id) throw new Error('Tenant slug missing or inconsistent');
    if (record.kind === 'slug' && tenants.get(record.tenantId).data.slug !== record.id) throw new Error('Slug and tenant registry disagree');
    if (record.kind === 'event' && !sessions.has(JSON.stringify([record.tenantId, record.sessionId]))) throw new Error('Event references a missing session');
    if (record.kind === 'receipt' && !sessions.has(JSON.stringify([record.tenantId, record.data.sessionId]))) throw new Error('Reply receipt references a missing session');
  }
}
export function countsFor(records) {
  return Object.fromEntries(KINDS.map(kind => [kind, records.filter(record => record.kind === kind).length]));
}
export async function writePrivateJson(path, data) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}
export async function readSnapshot(path) {
  const text = await readFile(path, 'utf8');
  const manifest = JSON.parse(await readFile(`${path}.manifest.json`, 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.sha256 !== sha256(text)) throw new Error('Snapshot checksum or schema mismatch');
  const records = text.split('\n').filter(Boolean).map(line => JSON.parse(line));
  validateTopology(records);
  if (canonical(countsFor(records)) !== canonical(manifest.counts)) throw new Error('Snapshot count mismatch');
  return { records, manifest };
}
export function parseArgs(args, options, flags = []) {
  const result = {};
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (flags.includes(name)) result[name.slice(2)] = true;
    else if (options.includes(name) && args[index + 1] && !args[index + 1].startsWith('--')) result[name.slice(2)] = args[++index];
    else throw new Error(`Unknown or incomplete option: ${name}`);
  }
  return result;
}
