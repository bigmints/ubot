import { createRequire } from 'node:module';
import { readFile, appendFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { normalize, canonical, recordKey, validateTopology, countsFor, sha256, writePrivateJson, parseArgs } from './migration-lib.mjs';

// Every operation against Firestore is a read. This command never changes source data.
export async function* collectionDocuments(collection) {
  let cursor;
  do {
    let query = collection.orderBy('__name__').limit(250);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const doc of page.docs) yield doc;
    if (page.docs.length < 250) return;
    cursor = page.docs.at(-1);
  } while (true);
}
export async function* exportRecords(db) {
  for await (const tenant of collectionDocuments(db.collection('relay_tenants'))) {
    const tenantId = tenant.id;
    yield { kind: 'tenant', tenantId, id: tenantId, data: normalize(tenant.data()) };
    for await (const session of collectionDocuments(tenant.ref.collection('sessions'))) {
      const data = normalize(session.data());
      const sessionId = data.sessionId;
      if (typeof sessionId !== 'string') throw new Error('Session document missing original session ID');
      yield { kind: 'session', tenantId, id: session.id, sessionId, data };
      for await (const event of collectionDocuments(session.ref.collection('events'))) {
        yield { kind: 'event', tenantId, id: event.id, sessionId, data: normalize(event.data()) };
      }
    }
    for (const [collection, kind] of [['messages', 'message'], ['sent_replies', 'receipt']]) {
      for await (const doc of collectionDocuments(tenant.ref.collection(collection))) {
        yield { kind, tenantId, id: doc.id, data: normalize(doc.data()) };
      }
    }
  }
  for await (const slug of collectionDocuments(db.collection('relay_slugs'))) {
    const data = normalize(slug.data());
    yield { kind: 'slug', tenantId: data.tenantId, id: slug.id, data };
  }
}
export async function exportSnapshot({ db, project, database = '(default)', output, write = false, resume = false, frozen = false }) {
  if (write && !output) throw new Error('--output is required with --write');
  if (resume && !write) throw new Error('--resume requires --write');
  const partial = `${output}.partial`;
  const metaPath = `${partial}.json`;
  const records = [];
  const previous = new Map();
  if (write) {
    if (resume) {
      const meta = JSON.parse(await readFile(metaPath, 'utf8'));
      if (meta.project !== project || meta.database !== database || meta.sourceFrozen !== frozen) throw new Error('Resume source metadata mismatch');
      const text = await readFile(partial, 'utf8');
      if (text && !text.endsWith('\n')) throw new Error('Interrupted partial line; restart into a fresh snapshot path');
      for (const line of text.split('\n').filter(Boolean)) {
        const record = JSON.parse(line);
        if (previous.has(recordKey(record))) throw new Error('Duplicate partial record');
        previous.set(recordKey(record), canonical(record));
      }
    } else {
      // Exclusive create prevents overwriting an earlier export, including completed output.
      for (const path of [output, `${output}.manifest.json`, metaPath]) {
        try { await readFile(path); throw new Error('Snapshot path already exists; choose a new output path'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      await appendFile(partial, '', { flag: 'wx', mode: 0o600 });
      await writePrivateJson(metaPath, { project, database, sourceFrozen: frozen });
    }
  }
  const seen = new Set();
  for await (const record of exportRecords(db)) {
    const key = recordKey(record);
    seen.add(key);
    records.push(record);
    if (previous.has(key)) {
      if (previous.get(key) !== canonical(record)) throw new Error('Source changed since interrupted export; restart into a fresh snapshot path');
    } else if (write) await appendFile(partial, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  }
  if ([...previous.keys()].some(key => !seen.has(key))) throw new Error('Source records disappeared since interrupted export; restart snapshot');
  validateTopology(records);
  const counts = countsFor(records);
  if (!write) return { mode: 'dry-run', counts, sourceFrozen: frozen };
  const text = await readFile(partial, 'utf8');
  const manifest = { schemaVersion: 1, project, database, exportedAt: new Date().toISOString(), sourceFrozen: frozen, counts, sha256: sha256(text) };
  await writePrivateJson(`${output}.manifest.json`, manifest);
  await rename(partial, output);
  await unlink(metaPath);
  return { mode: 'exported', counts, sourceFrozen: frozen, sha256: manifest.sha256 };
}
async function main() {
  const args = parseArgs(process.argv.slice(2), ['--project', '--database', '--output'], ['--write', '--resume', '--source-frozen', '--gcloud-auth', '--help']);
  if (args.help) {
    console.log('export-firestore.mjs --project ID [--database ID] [--output PATH --write [--resume]] [--source-frozen] [--gcloud-auth]\nDefault: read-only scan and counts. --write saves private JSONL + manifest. Use a frozen source for cutover. --gcloud-auth uses the active gcloud account token in memory.');
    return;
  }
  if (!args.project) throw new Error('--project must explicitly identify the source Google project');
  const require = createRequire(import.meta.url);
  const { Firestore } = require('@google-cloud/firestore');
  let auth;
  if(args['gcloud-auth']) {
    const result=spawnSync('gcloud',['auth','print-access-token','--quiet'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000});
    const token=result.stdout?.trim();
    if(result.error || result.status!==0 || !token || /\s/.test(token)) throw Object.assign(new Error('gcloud credential unavailable'),{code:'GCLOUD_TOKEN_UNAVAILABLE'});
    const { GoogleAuth, OAuth2Client }=require('google-auth-library');
    const client=new OAuth2Client();client.setCredentials({access_token:token});
    auth=new GoogleAuth({projectId:args.project,authClient:client});
  }
  const db = new Firestore({ projectId: args.project, databaseId: args.database || '(default)', ...(auth ? {auth}: {}) });
  try { console.log(JSON.stringify(await exportSnapshot({ db, project: args.project, database: args.database, output: args.output && resolve(args.output), write: args.write, resume: args.resume, frozen: !!args['source-frozen'] }))); }
  finally { await db.terminate(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { const code=String(error.code || 'EXPORT_ERROR'); console.error(`Export failed (${ /^[A-Z0-9_]+$/.test(code) ? code : 'EXPORT_ERROR'}). Check credentials, source schema, and output/resume state. Source data was not modified; no document contents were logged.`); process.exitCode = 1; });
}
