import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readSnapshot, countsFor, KINDS, recordKey, writePrivateJson, parseArgs } from './migration-lib.mjs';

export function destinationUrl(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Destination must be a bare relay origin');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('HTTPS required outside local development');
  return url.origin;
}
export async function migrateSnapshot({ input, url, apply = false, verify = false, resume = false, checkpoint, secret, fetchImpl = fetch }) {
  if (apply && verify) throw new Error('Choose --apply or --verify');
  if (resume && !apply) throw new Error('--resume requires --apply');
  const snapshot = await readSnapshot(input);
  const records = [...snapshot.records].sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
  const counts = countsFor(records);
  if (!apply && !verify) return { mode: 'dry-run', counts, sourceFrozen: snapshot.manifest.sourceFrozen, sha256: snapshot.manifest.sha256 };
  if (!snapshot.manifest.sourceFrozen) throw new Error('Apply/verification require a source-frozen snapshot; freeze both clients and ingress, then export again');
  const origin = destinationUrl(url);
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('Set RELAY_MIGRATION_SECRET to the destination migration secret (at least 32 characters)');
  const checkpointPath = checkpoint || `${input}.import-progress.json`;
  let progress = { schemaVersion: 1, sha256: snapshot.manifest.sha256, origin, completed: [] };
  if (apply && resume) {
    progress = JSON.parse(await readFile(checkpointPath, 'utf8'));
    if (progress.schemaVersion !== 1 || progress.sha256 !== snapshot.manifest.sha256 || progress.origin !== origin || !Array.isArray(progress.completed)) throw new Error('Checkpoint belongs to a different snapshot or destination');
    const keys = new Set(records.map(recordKey));
    if (progress.completed.some(key => !keys.has(key))) throw new Error('Invalid checkpoint record identity');
  } else if (apply) {
    try { await readFile(checkpointPath); throw new Error('Checkpoint exists; use --resume or a fresh checkpoint path'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await writePrivateJson(checkpointPath, progress);
  }
  const completed = new Set(progress.completed);
  let processed = 0;
  for (const record of records) {
    const key = recordKey(record);
    if (apply && completed.has(key)) continue;
    const response = await fetchImpl(`${origin}/__migration/${verify ? 'verify' : 'import'}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Migration-Secret': secret },
      body: JSON.stringify(record), redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Migration request rejected (HTTP ${response.status}); contents suppressed`);
    const result = await response.json();
    if (verify && result.matches !== true) throw new Error('Destination verification mismatch; keep traffic frozen and source intact');
    if (!verify && result.imported !== true) throw new Error('Destination did not acknowledge import');
    processed++;
    if (apply) {
      completed.add(key);
      progress.completed = [...completed];
      await writePrivateJson(checkpointPath, progress);
    }
  }
  return { mode: verify ? 'verified' : 'imported', counts, processed, sha256: snapshot.manifest.sha256 };
}
async function main() {
  const args = parseArgs(process.argv.slice(2), ['--input', '--url', '--checkpoint'], ['--apply', '--verify', '--resume', '--help']);
  if (args.help) {
    console.log('import-snapshot.mjs --input PATH [--url ORIGIN --apply|--verify] [--checkpoint PATH --resume]\nDefault: local checksum/topology validation only; no network requests. Mutations need --apply, a frozen snapshot, and RELAY_MIGRATION_SECRET.');
    return;
  }
  if (!args.input) throw new Error('--input is required');
  console.log(JSON.stringify(await migrateSnapshot({ input: resolve(args.input), url: args.url, apply: args.apply, verify: args.verify, resume: args.resume, checkpoint: args.checkpoint, secret: process.env.RELAY_MIGRATION_SECRET })));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Migration failed. Check the snapshot, destination migration mode/secret, and checkpoint. Keep public traffic frozen until verification succeeds; no record or credential contents were logged.'); process.exitCode = 1; });
}
