import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  COLLECTION_TOOL_DEFINITIONS,
  MIGRATABLE_PERSISTENCE_SCHEMA_VERSIONS,
  createCollectionEngine,
  createJsonFileCollectionRepository,
  createMemoryCollectionRepository,
  executeCollectionTool,
  getCollectionToolDefinitions,
} from '../dist/index.js';

const require = createRequire(import.meta.url);

test('ships equivalent ESM and CommonJS public roots', () => {
  const commonJs = require('../dist-cjs/index.js');
  assert.equal(typeof commonJs.createCollectionEngine, 'function');
  assert.deepEqual(commonJs.COLLECTION_TOOL_NAMES, COLLECTION_TOOL_DEFINITIONS.map((definition) => definition.name));
  assert.deepEqual(commonJs.MIGRATABLE_PERSISTENCE_SCHEMA_VERSIONS, MIGRATABLE_PERSISTENCE_SCHEMA_VERSIONS);
  assert.deepEqual(MIGRATABLE_PERSISTENCE_SCHEMA_VERSIONS, [0]);
});

test('two JSON repository instances preserve both acknowledged writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'collection-engine-multi-instance-'));
  const filePath = join(directory, 'engine.json');
  try {
    const [repositoryA, repositoryB] = await Promise.all([
      createJsonFileCollectionRepository({ filePath }),
      createJsonFileCollectionRepository({ filePath }),
    ]);
    const policy = { authorize: async () => true };
    const engineA = createCollectionEngine({ repository: repositoryA, policy });
    const engineB = createCollectionEngine({ repository: repositoryB, policy });
    const call = (engine, actorId, name, requestId) => executeCollectionTool(engine, { actorId, entityId: 'shared-entity', audience: 'owner', authorizationHandle: 'trusted', correlationId: requestId }, { name: 'collections_create', arguments: { name }, toolVersion: '1', requestId });
    const [createdA, createdB] = await Promise.all([
      call(engineA, 'owner-a', 'From A', 'create-a'),
      call(engineB, 'owner-b', 'From B', 'create-b'),
    ]);
    assert.equal(createdA.ok, true);
    assert.equal(createdB.ok, true);
    const reopened = await createJsonFileCollectionRepository({ filePath });
    const state = await reopened.read((value) => value);
    assert.equal(Object.keys(state.entities['shared-entity'].collections).length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('two cooperating processes preserve both acknowledged JSON writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'collection-engine-multi-process-'));
  const filePath = join(directory, 'engine.json');
  const writerPath = join(directory, 'writer.mjs');
  try {
    const moduleUrl = new URL('../dist/index.js', import.meta.url).href;
    await writeFile(writerPath, `
      import { createCollectionEngine, createJsonFileCollectionRepository, executeCollectionTool } from ${JSON.stringify(moduleUrl)};
      const [filePath, actorId, requestId] = process.argv.slice(2);
      const repository = await createJsonFileCollectionRepository({ filePath });
      const engine = createCollectionEngine({ repository, policy: { authorize: async () => true } });
      const result = await executeCollectionTool(engine, { actorId, entityId: 'process-entity', audience: 'owner', authorizationHandle: 'trusted', correlationId: requestId }, { name: 'collections_create', arguments: { name: actorId }, toolVersion: '1', requestId });
      if (!result.ok) throw new Error(JSON.stringify(result));
    `);
    const runWriter = (actorId, requestId) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [writerPath, filePath, actorId, requestId], { stdio: 'pipe' });
      let errorText = '';
      child.stderr.on('data', (chunk) => { errorText += chunk; });
      child.on('error', reject);
      child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(errorText || `writer exited ${code}`)));
    });
    await Promise.all([runWriter('process-a', 'process-write-a'), runWriter('process-b', 'process-write-b')]);
    const reopened = await createJsonFileCollectionRepository({ filePath });
    const count = await reopened.read((state) => Object.keys(state.entities['process-entity'].collections).length);
    assert.equal(count, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const owner = Object.freeze({ actorId: 'owner-1', entityId: 'entity-a', audience: 'owner', authorizationHandle: 'owner-live', correlationId: 'test' });
const visitor = Object.freeze({ actorId: 'visitor-1', entityId: 'entity-a', audience: 'visitor', authorizationHandle: 'visitor-live', correlationId: 'test' });
const otherOwner = Object.freeze({ ...owner, actorId: 'owner-2', entityId: 'entity-b' });
const withIntent = (context, receiptName) => Object.freeze({ ...context, intentReceipt: receiptName });

function harness(now = () => new Date('2026-09-14T10:00:00.000Z'), repository = createMemoryCollectionRepository()) {
  let sequence = 0;
  let allow = true;
  const authorization = [];
  const engine = createCollectionEngine({
    repository,
    policy: { authorize: async (request) => { authorization.push(request); return allow; } },
    ids: { next: (prefix) => `${prefix}_${++sequence}` },
    clock: { now },
  });
  const run = (context, name, args, requestId = `${name}-${++sequence}`, toolVersion = '1') => executeCollectionTool(engine, context, { name, arguments: args, toolVersion, requestId });
  return { engine, run, authorization, revoke: () => { allow = false; } };
}

async function buildPublishedCollection(h) {
  const created = await h.run(owner, 'collections_create', {
    name: 'Homes',
    schema: [
      { id: 'title', label: 'Title', type: 'string', required: true, public: true },
      { id: 'price', label: 'Price', type: 'number', public: true },
      { id: 'owner_note', label: 'Owner note', type: 'string', public: false },
    ],
    view: { version: '1', layout: 'cards', titleField: 'title', visibleFields: ['title', 'price'] },
  }, 'create-homes');
  assert.equal(created.ok, true);
  const collectionId = created.data.collectionId;
  const ingested = await h.run(owner, 'collections_ingest', {
    kind: 'segments',
    source: { reference: 'host-file-7', label: 'September catalogue', reportedCoverage: 'partial', coverageNote: 'Pages 1-3 supplied by host' },
    segments: [{ inputId: 'page-1-home-a', text: 'Garden home, 1800000 AED', locator: { pageLabel: '1' } }],
    manifest: { declaredCount: 1 },
  }, 'ingest-1');
  assert.equal(ingested.ok, true);
  const sourceRevisionId = ingested.data.sourceRevisionId;
  const proposal = await h.run(owner, 'collections_change_propose', {
    collectionId,
    expectedRevision: 1,
    sourceRevisionIds: [sourceRevisionId],
    operations: [{ kind: 'create_item', itemId: 'home-a', values: { title: 'Garden home', price: 1800000, owner_note: 'Call first' }, status: 'available', evidence: [{ sourceRevisionId, inputId: 'page-1-home-a', fieldId: 'price' }] }],
  }, 'proposal-1');
  assert.equal(proposal.ok, true);
  const applied = await h.run(owner, 'collections_change_apply', { proposalId: proposal.data.id, expectedRevision: 1 }, 'apply-1');
  assert.equal(applied.ok, true);
  const review = await h.run(owner, 'collections_get', { collectionId, selectedItemIds: ['home-a'] });
  assert.equal(review.ok, true);
  const publication = await h.run(withIntent(owner, 'publish-home-a'), 'collections_publish', {
    collectionId,
    selectedItemIds: ['home-a'],
    expectedPublicationRevision: 0,
    reviewedPayloadHash: review.data.publicationReview.reviewedPayloadHash,
  }, 'publish-1');
  assert.equal(publication.ok, true);
  return { collectionId, sourceRevisionId, publication, applied };
}

test('JSON repository migrates version 0 with exact state readback and retry-safe backup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'collection-engine-migration-'));
  const filePath = join(directory, 'engine.json');
  const backupPath = `${filePath}.schema-0.backup`;
  try {
    const originalRepository = await createJsonFileCollectionRepository({ filePath });
    const seeded = harness(undefined, originalRepository);
    const { collectionId } = await buildPublishedCollection(seeded);
    const current = JSON.parse(await readFile(filePath, 'utf8'));
    const legacyEntity = structuredClone(current.entities['entity-a']);
    delete legacyEntity.catalogRevision;
    const legacyRaw = JSON.stringify({ schemaVersion: 0, entities: { 'entity-a': legacyEntity } });
    await writeFile(filePath, legacyRaw);

    let migrated = await createJsonFileCollectionRepository({ filePath });
    assert.ok(migrated.capabilities.includes('migration-v0-to-v1'));
    const migratedState = await migrated.read((state) => state);
    assert.equal(migratedState.schemaVersion, 1);
    assert.equal(migratedState.entities['entity-a'].catalogRevision, 1);
    const migratedEntity = structuredClone(migratedState.entities['entity-a']);
    delete migratedEntity.catalogRevision;
    assert.deepEqual(migratedEntity, legacyEntity, 'migration must preserve all version 0 persisted data');
    assert.equal(await readFile(backupPath, 'utf8'), legacyRaw, 'rollback backup must contain exact prior bytes');

    let engine = createCollectionEngine({ repository: migrated, policy: { authorize: async () => true } });
    let readback = await executeCollectionTool(engine, visitor, {
      name: 'collections_item_get', arguments: { collectionId, itemId: 'home-a' }, toolVersion: '1', requestId: 'migration-readback',
    });
    assert.equal(readback.ok, true);
    assert.equal(readback.data.values.price, 1800000);
    assert.equal(readback.data.values.owner_note, undefined);

    await copyFile(backupPath, filePath);
    migrated = await createJsonFileCollectionRepository({ filePath });
    engine = createCollectionEngine({ repository: migrated, policy: { authorize: async () => true } });
    readback = await executeCollectionTool(engine, visitor, {
      name: 'collections_item_get', arguments: { collectionId, itemId: 'home-a' }, toolVersion: '1', requestId: 'migration-retry-readback',
    });
    assert.equal(readback.ok, true, 'an interrupted/retried migration state must remain recoverable');
    assert.equal(readback.data.values.price, 1800000);
    assert.equal(await readFile(backupPath, 'utf8'), legacyRaw);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('JSON repository rejects unsupported versions without changing persisted bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'collection-engine-unsupported-version-'));
  const filePath = join(directory, 'engine.json');
  const unsupportedRaw = JSON.stringify({ schemaVersion: 2, entities: {} });
  try {
    await writeFile(filePath, unsupportedRaw);
    await assert.rejects(
      createJsonFileCollectionRepository({ filePath }),
      /Unsupported persistence schema version 2; current=1, migratable=0/,
    );
    assert.equal(await readFile(filePath, 'utf8'), unsupportedRaw);
    await assert.rejects(readFile(`${filePath}.schema-0.backup`, 'utf8'), { code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('JSON repository refuses to overwrite a conflicting migration backup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'collection-engine-conflicting-backup-'));
  const filePath = join(directory, 'engine.json');
  const legacyRaw = JSON.stringify({ schemaVersion: 0, entities: {} });
  try {
    await writeFile(filePath, legacyRaw);
    await writeFile(`${filePath}.schema-0.backup`, 'different prior state');
    await assert.rejects(
      createJsonFileCollectionRepository({ filePath }),
      /already exists with different contents/,
    );
    assert.equal(await readFile(filePath, 'utf8'), legacyRaw);
    assert.equal(await readFile(`${filePath}.schema-0.backup`, 'utf8'), 'different prior state');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('JSON repository preserves version 0 primary when a dangling migration-backup symlink fails', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'collection-engine-dangling-backup-'));
  const filePath = join(directory, 'engine.json');
  const backupPath = `${filePath}.schema-0.backup`;
  const legacyRaw = JSON.stringify({ schemaVersion: 0, entities: {} });
  try {
    await writeFile(filePath, legacyRaw);
    try {
      await symlink(join(directory, 'missing-backup-target'), backupPath);
    } catch (error) {
      if (['EACCES', 'EPERM', 'ENOSYS', 'ENOTSUP'].includes(error.code)) {
        t.skip(`symlink creation unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    await assert.rejects(createJsonFileCollectionRepository({ filePath }), { code: 'ENOENT' });
    assert.equal(await readFile(filePath, 'utf8'), legacyRaw, 'backup failure must not replace the primary');
    assert.equal((await lstat(backupPath)).isSymbolicLink(), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('JSON repository rejects missing metadata and malformed version 0 without migration artifacts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'collection-engine-invalid-migration-'));
  try {
    const cases = [
      { name: 'missing-version', raw: JSON.stringify({ entities: {} }), error: /Unsupported persistence schema version undefined/ },
      { name: 'malformed-v0', raw: JSON.stringify({ schemaVersion: 0, entities: { entity: { collections: [] } } }), error: /collections must be an object/ },
    ];
    for (const candidate of cases) {
      const filePath = join(directory, `${candidate.name}.json`);
      await writeFile(filePath, candidate.raw);
      await assert.rejects(createJsonFileCollectionRepository({ filePath }), candidate.error);
      assert.equal(await readFile(filePath, 'utf8'), candidate.raw);
      await assert.rejects(readFile(`${filePath}.schema-0.backup`, 'utf8'), { code: 'ENOENT' });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function createPublished(h, { prefix, name, schema, items }) {
  const created = await h.run(owner, 'collections_create', { name, schema }, `${prefix}-create`);
  assert.equal(created.ok, true);
  const collectionId = created.data.collectionId;
  const proposal = await h.run(owner, 'collections_change_propose', { collectionId, expectedRevision: 1, operations: items.map((item) => ({ kind: 'create_item', ...item })) }, `${prefix}-proposal`);
  assert.equal(proposal.ok, true);
  const applied = await h.run(owner, 'collections_change_apply', { proposalId: proposal.data.id, expectedRevision: 1 }, `${prefix}-apply`);
  assert.equal(applied.ok, true);
  const selectedItemIds = items.map((item) => item.itemId);
  const review = await h.run(owner, 'collections_get', { collectionId, selectedItemIds }, `${prefix}-review`);
  const published = await h.run(withIntent(owner, `${prefix}-intent`), 'collections_publish', { collectionId, selectedItemIds, expectedPublicationRevision: 0, reviewedPayloadHash: review.data.publicationReview.reviewedPayloadHash }, `${prefix}-publish`);
  assert.equal(published.ok, true);
  return collectionId;
}

test('publishes exactly reviewed content and serves only public current facts to visitors', async () => {
  const h = harness();
  const { collectionId } = await buildPublishedCollection(h);
  const search = await h.run(visitor, 'collections_search', { collectionIds: [collectionId], filters: [{ fieldId: 'price', operator: 'lt', value: 2000000 }] });
  assert.equal(search.ok, true);
  assert.equal(search.data.totalCount, 1);
  assert.deepEqual(search.data.items[0].item.values, { title: 'Garden home', price: 1800000 });
  assert.deepEqual(search.data.items[0].item.evidence, []);
  assert.ok(search.evidence.id);
  const privateTextSearch = await h.run(visitor, 'collections_search', { collectionIds: [collectionId], text: 'Call first' });
  assert.equal(privateTextSearch.ok, true); assert.equal(privateTextSearch.data.totalCount, 0);
  const privateFieldSearch = await h.run(visitor, 'collections_search', { collectionIds: [collectionId], filters: [{ fieldId: 'owner_note', operator: 'contains', value: 'Call' }] });
  assert.equal(privateFieldSearch.ok, true); assert.equal(privateFieldSearch.data.totalCount, 0);

  const evidenceCurrent = await h.run(visitor, 'collections_evidence_validate', { evidenceReceiptId: search.evidence.id });
  assert.equal(evidenceCurrent.ok, true);
  assert.equal(evidenceCurrent.data.current, true);

  const edited = await h.run(owner, 'collections_change_propose', { collectionId, expectedRevision: 2, operations: [{ kind: 'update_item', itemId: 'home-a', values: { price: 1900000 } }] }, 'proposal-edit');
  assert.equal(edited.ok, true);
  const applied = await h.run(owner, 'collections_change_apply', { proposalId: edited.data.id, expectedRevision: 2 }, 'apply-edit');
  assert.equal(applied.ok, true);
  const stillPublished = await h.run(visitor, 'collections_item_get', { collectionId, itemId: 'home-a' });
  assert.equal(stillPublished.ok, true);
  assert.equal(stillPublished.data.values.price, 1800000, 'draft edit must not mutate published snapshot');
});

test('tool catalogue is audience appropriate and execution denies visitor mutation independently', async () => {
  const h = harness();
  assert.equal(COLLECTION_TOOL_DEFINITIONS.length, 19);
  const ownerDefinitions = await getCollectionToolDefinitions(h.engine, owner);
  const visitorDefinitions = await getCollectionToolDefinitions(h.engine, visitor);
  assert.equal(ownerDefinitions.length, 19);
  assert.deepEqual(visitorDefinitions.map((definition) => definition.name).sort(), ['collections_evidence_validate', 'collections_get', 'collections_item_get', 'collections_list', 'collections_search', 'collections_view_get']);
  for (const definition of ownerDefinitions) {
    assert.equal(definition.inputSchema.additionalProperties, false);
    assert.equal(JSON.stringify(definition.inputSchema).includes('authorizationHandle'), false);
    assert.equal(JSON.stringify(definition.inputSchema).includes('entityId'), false);
  }
  const denied = await h.run(visitor, 'collections_create', { name: 'Forged', entityId: 'entity-b', audience: 'owner' });
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'UNAUTHORIZED');
});

test('ingestion is bounded, atomic, idempotent, and private across entities', async () => {
  const h = harness();
  const args = { kind: 'records', source: { reference: 'external-parser-output', reportedCoverage: 'unknown' }, records: [{ source_key: 'class-1', title: 'Pottery' }], manifest: { declaredCount: 1 } };
  const first = await h.run(owner, 'collections_ingest', args, 'same-ingest');
  const retry = await h.run(owner, 'collections_ingest', args, 'same-ingest');
  assert.equal(first.ok, true); assert.deepEqual(retry.data, first.data);
  const conflict = await h.run(owner, 'collections_ingest', { ...args, records: [{ source_key: 'class-2' }] }, 'same-ingest');
  assert.equal(conflict.ok, false); assert.equal(conflict.error.code, 'IDEMPOTENCY_CONFLICT');
  const incomplete = await h.run(owner, 'collections_ingest', { ...args, manifest: { declaredCount: 2 } }, 'incomplete');
  assert.equal(incomplete.ok, false); assert.equal(incomplete.error.code, 'INPUT_INCOMPLETE');
  const otherRead = await h.run(otherOwner, 'collections_source_get', { sourceRevisionId: first.data.sourceRevisionId });
  assert.equal(otherRead.ok, false); assert.equal(otherRead.error.code, 'NOT_FOUND_OR_FORBIDDEN');
  const visitorRead = await h.run(visitor, 'collections_source_review', { sourceRevisionId: first.data.sourceRevisionId });
  assert.equal(visitorRead.ok, false); assert.equal(visitorRead.error.code, 'UNAUTHORIZED');
});

test('archive withdraws immediately and undo restores draft without republishing', async () => {
  const h = harness();
  const { collectionId } = await buildPublishedCollection(h);
  const archived = await h.run(withIntent(owner, 'archive-home-a'), 'collections_archive', { collectionId, selectedItemIds: ['home-a'], expectedRevision: 2, expectedPublicationRevision: 1 }, 'archive-1');
  assert.equal(archived.ok, true);
  const hidden = await h.run(visitor, 'collections_item_get', { collectionId, itemId: 'home-a' });
  assert.equal(hidden.ok, false); assert.equal(hidden.error.code, 'NOT_FOUND_OR_FORBIDDEN');
  const undone = await h.run(owner, 'collections_undo', { collectionId, changeId: archived.data.changeId, expectedRevision: 3 }, 'undo-1');
  assert.equal(undone.ok, true);
  const draft = await h.run(owner, 'collections_item_get', { collectionId, itemId: 'home-a' });
  assert.equal(draft.ok, true); assert.equal(draft.data.archived, false);
  const remainsHidden = await h.run(visitor, 'collections_item_get', { collectionId, itemId: 'home-a' });
  assert.equal(remainsHidden.ok, false, 'undo must not republish');
});

test('intent, revisions, unsupported versions, and live policy fail closed', async () => {
  const h = harness();
  const created = await h.run(owner, 'collections_create', { name: 'Classes' }, 'create-classes');
  const collectionId = created.data.collectionId;
  const noIntent = await h.run(owner, 'collections_publish', { collectionId, selectedItemIds: [], expectedPublicationRevision: 0, reviewedPayloadHash: 'wrong' }, 'publish-no-intent');
  assert.equal(noIntent.ok, false); assert.equal(noIntent.error.code, 'INTENT_REQUIRED');
  const unsupported = await h.run(owner, 'collections_list', {}, 'v2', '2');
  assert.equal(unsupported.ok, false); assert.equal(unsupported.error.code, 'UNSUPPORTED_VERSION');
  const stale = await h.run(owner, 'collections_change_propose', { collectionId, expectedRevision: 99, operations: [{ kind: 'set_schema_field', field: { id: 'name', label: 'Name', type: 'string' } }] });
  assert.equal(stale.ok, false); assert.equal(stale.error.code, 'REVISION_CONFLICT');
  h.revoke();
  const denied = await h.run(owner, 'collections_list', {});
  assert.equal(denied.ok, false); assert.equal(denied.error.code, 'UNAUTHORIZED');
});

test('multi-collection and paginated evidence binds exact collection-item identities', async () => {
  const h = harness();
  const schema = [{ id: 'title', label: 'Title', type: 'string', public: true }];
  const collectionA = await createPublished(h, { prefix: 'evidence-a', name: 'A', schema, items: [{ itemId: 'shared-item', values: { title: 'A item' }, status: 'available' }] });
  const collectionB = await createPublished(h, { prefix: 'evidence-b', name: 'B', schema, items: [{ itemId: 'shared-item', values: { title: 'B item' }, status: 'available' }] });
  const full = await h.run(visitor, 'collections_search', { collectionIds: [collectionA, collectionB] }, 'evidence-full');
  assert.equal(full.ok, true); assert.equal(full.evidence.itemReferences.length, 2); assert.equal(new Set(full.evidence.itemReferences.map((reference) => reference.collectionId)).size, 2);
  const searched = await h.run(visitor, 'collections_search', { collectionIds: [collectionA, collectionB], pageSize: 1 }, 'evidence-page');
  assert.equal(searched.ok, true); assert.equal(searched.data.totalCount, 2); assert.equal(searched.data.items.length, 1);
  assert.equal(searched.evidence.itemReferences.length, 1);
  assert.ok(searched.evidence.itemReferences[0].collectionId);
  const withdrawn = await h.run(withIntent(owner, 'withdraw-a'), 'collections_unpublish', { collectionId: collectionA, selectedItemIds: ['shared-item'], expectedPublicationRevision: 1 }, 'withdraw-a');
  assert.equal(withdrawn.ok, true);
  const stale = await h.run(visitor, 'collections_evidence_validate', { evidenceReceiptId: searched.evidence.id }, 'validate-duplicate-id');
  assert.equal(stale.ok, false); assert.equal(stale.error.code, 'STALE_EVIDENCE');
  const fullStale = await h.run(visitor, 'collections_evidence_validate', { evidenceReceiptId: full.evidence.id }, 'validate-full-duplicate-id');
  assert.equal(fullStale.ok, false); assert.equal(fullStale.error.code, 'STALE_EVIDENCE');

  const emptyHarness = harness();
  const empty = await emptyHarness.run(visitor, 'collections_search', {}, 'empty-search');
  assert.equal(empty.ok, true); assert.equal(empty.data.totalCount, 0);
  await emptyHarness.run(owner, 'collections_create', { name: 'Later' }, 'later-create');
  const emptyStale = await emptyHarness.run(visitor, 'collections_evidence_validate', { evidenceReceiptId: empty.evidence.id }, 'validate-empty');
  assert.equal(emptyStale.ok, false); assert.equal(emptyStale.error.code, 'STALE_EVIDENCE');
});

test('paginated search evidence expires with any off-page result in its full query scope', async () => {
  let currentTime = '2026-09-14T10:00:00.000Z';
  const h = harness(() => new Date(currentTime));
  const collectionId = await createPublished(h, {
    prefix: 'scope-expiry',
    name: 'Expiring results',
    schema: [{ id: 'name', label: 'Name', type: 'string', public: true }],
    items: [
      { itemId: 'a', values: { name: 'First' }, status: 'available' },
      { itemId: 'z', values: { name: 'Second' }, status: 'available', validThrough: '2026-09-14T10:00:01.000Z' },
    ],
  });
  const page = await h.run(visitor, 'collections_search', { collectionIds: [collectionId], pageSize: 1 }, 'scope-expiry-page');
  assert.equal(page.ok, true);
  assert.equal(page.data.totalCount, 2);
  assert.equal(page.evidence.itemReferences.length, 1);
  assert.equal(page.evidence.validThrough, '2026-09-14T10:00:01.000Z');
  currentTime = '2026-09-14T10:00:02.000Z';
  const validation = await h.run(visitor, 'collections_evidence_validate', { evidenceReceiptId: page.evidence.id }, 'scope-expiry-validate');
  assert.equal(validation.ok, false);
  assert.equal(validation.error.code, 'STALE_EVIDENCE');
});

test('calendar dates and valid-through currentness use real inclusive date boundaries', async () => {
  const h = harness();
  const created = await h.run(owner, 'collections_create', { name: 'Dates', schema: [{ id: 'day', label: 'Day', type: 'date', public: true }] }, 'dates-create');
  const collectionId = created.data.collectionId;
  const impossible = await h.run(owner, 'collections_change_propose', { collectionId, expectedRevision: 1, operations: [{ kind: 'create_item', itemId: 'bad', values: { day: '2026-99-99' } }] }, 'bad-calendar');
  assert.equal(impossible.ok, false); assert.equal(impossible.error.code, 'INVALID_ARGUMENT');
  const proposal = await h.run(owner, 'collections_change_propose', { collectionId, expectedRevision: 1, operations: [
    { kind: 'create_item', itemId: 'inclusive-date', values: { day: '2026-09-14' }, status: 'available', validThrough: '2026-09-14' },
    { kind: 'create_item', itemId: 'exact-expiry', values: { day: '2026-09-14' }, status: 'available', validThrough: '2026-09-14T10:00:00.000Z' },
  ] }, 'valid-dates');
  assert.equal(proposal.ok, true);
  await h.run(owner, 'collections_change_apply', { proposalId: proposal.data.id, expectedRevision: 1 }, 'apply-dates');
  const review = await h.run(owner, 'collections_get', { collectionId, selectedItemIds: ['inclusive-date', 'exact-expiry'] }, 'review-dates');
  await h.run(withIntent(owner, 'publish-dates'), 'collections_publish', { collectionId, selectedItemIds: ['inclusive-date', 'exact-expiry'], expectedPublicationRevision: 0, reviewedPayloadHash: review.data.publicationReview.reviewedPayloadHash }, 'publish-dates');
  const current = await h.run(visitor, 'collections_search', { collectionIds: [collectionId] }, 'search-dates');
  assert.equal(current.ok, true); assert.deepEqual(current.data.items.map((entry) => entry.item.id), ['inclusive-date']);
});

test('references must resolve to an item in the caller entity', async () => {
  const h = harness();
  const target = await h.run(owner, 'collections_create', { name: 'Targets', schema: [{ id: 'name', label: 'Name', type: 'string' }] }, 'target-create');
  const targetProposal = await h.run(owner, 'collections_change_propose', { collectionId: target.data.collectionId, expectedRevision: 1, operations: [{ kind: 'create_item', itemId: 'target-1', values: { name: 'Target' } }] }, 'target-proposal');
  await h.run(owner, 'collections_change_apply', { proposalId: targetProposal.data.id, expectedRevision: 1 }, 'target-apply');
  const links = await h.run(owner, 'collections_create', { name: 'Links', schema: [{ id: 'target', label: 'Target', type: 'reference' }] }, 'links-create');
  const invalidShape = await h.run(owner, 'collections_change_propose', { collectionId: links.data.collectionId, expectedRevision: 1, operations: [{ kind: 'create_item', values: { target: 'target-1' } }] }, 'link-string');
  assert.equal(invalidShape.ok, false); assert.equal(invalidShape.error.code, 'INVALID_ARGUMENT');
  const dangling = await h.run(owner, 'collections_change_propose', { collectionId: links.data.collectionId, expectedRevision: 1, operations: [{ kind: 'create_item', values: { target: { collectionId: target.data.collectionId, itemId: 'missing' } } }] }, 'link-dangling');
  assert.equal(dangling.ok, false); assert.equal(dangling.error.code, 'PROPOSAL_INVALID');
  const valid = await h.run(owner, 'collections_change_propose', { collectionId: links.data.collectionId, expectedRevision: 1, operations: [{ kind: 'create_item', values: { target: { collectionId: target.data.collectionId, itemId: 'target-1' } } }] }, 'link-valid');
  assert.equal(valid.ok, true);
  const otherTarget = await h.run(otherOwner, 'collections_create', { name: 'Other target' }, 'other-target');
  const crossEntity = await h.run(owner, 'collections_change_propose', { collectionId: links.data.collectionId, expectedRevision: 1, operations: [{ kind: 'create_item', values: { target: { collectionId: otherTarget.data.collectionId, itemId: 'anything' } } }] }, 'link-cross-entity');
  assert.equal(crossEntity.ok, false); assert.equal(crossEntity.error.code, 'PROPOSAL_INVALID');
});

test('exact ordering requires a compatible currency and reports exclusions', async () => {
  const h = harness();
  const collectionId = await createPublished(h, { prefix: 'money', name: 'Prices', schema: [{ id: 'price', label: 'Price', type: 'money', public: true }], items: [
    { itemId: 'usd', values: { price: { amount: 500, currency: 'USD' } }, status: 'available' },
    { itemId: 'aed', values: { price: { amount: 1000, currency: 'AED' } }, status: 'available' },
  ] });
  const ambiguous = await h.run(visitor, 'collections_search', { collectionIds: [collectionId], sort: [{ fieldId: 'price', direction: 'asc' }] }, 'money-no-currency');
  assert.equal(ambiguous.ok, false); assert.equal(ambiguous.error.code, 'INPUT_INCOMPLETE');
  const comparable = await h.run(visitor, 'collections_search', { collectionIds: [collectionId], sort: [{ fieldId: 'price', direction: 'asc', currency: 'AED' }] }, 'money-aed');
  assert.equal(comparable.ok, true); assert.equal(comparable.data.totalCount, 1); assert.equal(comparable.data.items[0].item.id, 'aed'); assert.equal(comparable.data.complete, false); assert.equal(comparable.data.excludedIncompatibleCount, 1); assert.equal(comparable.warnings[0].code, 'INCOMPATIBLE_ORDERING_VALUES_EXCLUDED');
});

test('numeric filters require a shared unit and explicitly exclude incompatible rows', async () => {
  const h = harness();
  const metric = await createPublished(h, {
    prefix: 'filter-metric',
    name: 'Metric',
    schema: [{ id: 'area', label: 'Area', type: 'number', unit: 'm2', public: true }],
    items: [{ itemId: 'metric', values: { area: 100 }, status: 'available' }],
  });
  const imperial = await createPublished(h, {
    prefix: 'filter-imperial',
    name: 'Imperial',
    schema: [{ id: 'area', label: 'Area', type: 'number', unit: 'ft2', public: true }],
    items: [{ itemId: 'imperial', values: { area: 100 }, status: 'available' }],
  });
  const ambiguous = await h.run(visitor, 'collections_search', { collectionIds: [metric, imperial], filters: [{ fieldId: 'area', operator: 'gte', value: 90 }] }, 'filter-unit-required');
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.error.code, 'INPUT_INCOMPLETE');
  assert.equal(ambiguous.error.details.path, 'arguments.filters[0].unit');
  const metricOnly = await h.run(visitor, 'collections_search', { collectionIds: [metric, imperial], filters: [{ fieldId: 'area', operator: 'gte', value: 90, unit: 'm2' }] }, 'filter-unit-metric');
  assert.equal(metricOnly.ok, true);
  assert.equal(metricOnly.data.totalCount, 1);
  assert.equal(metricOnly.data.items[0].item.id, 'metric');
  assert.equal(metricOnly.data.complete, false);
  assert.equal(metricOnly.data.excludedIncompatibleCount, 1);
  assert.equal(metricOnly.warnings[0].code, 'INCOMPATIBLE_FILTER_VALUES_EXCLUDED');
});

test('reconciliation matches strong IDs, surfaces ambiguous candidates, and preserves manual fields', async () => {
  const h = harness();
  const created = await h.run(owner, 'collections_create', { name: 'Reconcile', schema: [
    { id: 'sku', label: 'SKU', type: 'string', identity: 'strong' },
    { id: 'title', label: 'Title', type: 'string', identity: 'candidate' },
  ] }, 'reconcile-create');
  const collectionId = created.data.collectionId;
  const seed = await h.run(owner, 'collections_change_propose', { collectionId, expectedRevision: 1, operations: [
    { kind: 'create_item', itemId: 'one', values: { sku: 'SKU-1', title: 'Shared' } },
    { kind: 'create_item', itemId: 'two', values: { sku: 'SKU-2', title: 'Shared' } },
  ] }, 'reconcile-seed');
  await h.run(owner, 'collections_change_apply', { proposalId: seed.data.id, expectedRevision: 1 }, 'reconcile-seed-apply');
  const strong = await h.run(owner, 'collections_change_propose', { collectionId, expectedRevision: 2, operations: [{ kind: 'create_item', values: { sku: 'SKU-1' } }] }, 'strong-match');
  assert.equal(strong.ok, true); assert.equal(strong.data.operations[0].kind, 'update_item'); assert.equal(strong.data.operations[0].itemId, 'one'); assert.equal(strong.data.reconciliation.unchanged, 1);
  const ambiguous = await h.run(owner, 'collections_change_propose', { collectionId, expectedRevision: 2, operations: [{ kind: 'create_item', values: { title: 'Shared' } }] }, 'candidate-match');
  assert.equal(ambiguous.ok, true); assert.equal(ambiguous.data.reconciliation.conflicting, 1); assert.ok(ambiguous.data.unresolvedIssues[0].includes('Confirm whether'));
  const ingested = await h.run(owner, 'collections_ingest', { kind: 'segments', source: {}, segments: [{ inputId: 's1', text: 'SKU-1 title changed' }] }, 'reconcile-source');
  const protectedProposal = await h.run(owner, 'collections_change_propose', { collectionId, expectedRevision: 2, sourceRevisionIds: [ingested.data.sourceRevisionId], operations: [{ kind: 'update_item', itemId: 'one', values: { title: 'Source replacement' }, evidence: [{ sourceRevisionId: ingested.data.sourceRevisionId, inputId: 's1', fieldId: 'title' }] }] }, 'manual-protection');
  assert.equal(protectedProposal.ok, true); assert.equal(protectedProposal.data.reconciliation.conflicting, 1); assert.ok(protectedProposal.data.unresolvedIssues[0].includes('Manual correction preserved'));
  const cannotApply = await h.run(owner, 'collections_change_apply', { proposalId: protectedProposal.data.id, expectedRevision: 2 }, 'manual-protection-apply');
  assert.equal(cannotApply.ok, false); assert.equal(cannotApply.error.code, 'PROPOSAL_INVALID');
  const unlinkedEvidence = await h.run(owner, 'collections_change_propose', { collectionId, expectedRevision: 2, sourceRevisionIds: [ingested.data.sourceRevisionId], operations: [{ kind: 'update_item', itemId: 'one', values: { title: 'Unlinked source replacement' }, evidence: [{ sourceRevisionId: ingested.data.sourceRevisionId }] }] }, 'manual-protection-unlinked-evidence');
  assert.equal(unlinkedEvidence.ok, true);
  assert.equal(unlinkedEvidence.data.reconciliation.conflicting, 1);
  assert.ok(unlinkedEvidence.data.unresolvedIssues[0].includes('field-level provenance'));
  assert.deepEqual(unlinkedEvidence.data.operations[0].values, {});
  const unlinkedCannotApply = await h.run(owner, 'collections_change_apply', { proposalId: unlinkedEvidence.data.id, expectedRevision: 2 }, 'manual-protection-unlinked-apply');
  assert.equal(unlinkedCannotApply.ok, false);
  assert.equal(unlinkedCannotApply.error.code, 'PROPOSAL_INVALID');
});

test('null equality filters include omitted optional values', async () => {
  const h = harness();
  const collectionId = await createPublished(h, {
    prefix: 'unknown-price',
    name: 'Unknown prices',
    schema: [
      { id: 'name', label: 'Name', type: 'string', public: true },
      { id: 'price', label: 'Price', type: 'money', public: true },
    ],
    items: [
      { itemId: 'known', values: { name: 'Known', price: { amount: 10, currency: 'AED' } }, status: 'available' },
      { itemId: 'explicit-null', values: { name: 'Explicit null', price: null }, status: 'unknown' },
      { itemId: 'omitted', values: { name: 'Omitted' }, status: 'unknown' },
    ],
  });
  const unknown = await h.run(visitor, 'collections_search', {
    collectionIds: [collectionId],
    filters: [{ fieldId: 'price', operator: 'eq', value: null }],
  }, 'unknown-price-search');
  assert.equal(unknown.ok, true);
  assert.deepEqual(unknown.data.items.map((row) => row.item.id).sort(), ['explicit-null', 'omitted']);
});

test('tool schemas declare access/effects, nested contracts, and validate real outputs', async () => {
  const h = harness();
  const definitions = await getCollectionToolDefinitions(h.engine, owner);
  assert.equal(definitions.length, 19);
  for (const definition of definitions) {
    assert.ok(['read', 'write'].includes(definition.metadata.access));
    assert.ok(['none', 'draft', 'publication', 'withdrawal'].includes(definition.metadata.effect));
    assert.ok(Array.isArray(definition.outputSchema.oneOf));
  }
  const propose = definitions.find((definition) => definition.name === 'collections_change_propose');
  assert.ok(propose.inputSchema.properties.operations.items.oneOf.length >= 4);
  const viewTool = definitions.find((definition) => definition.name === 'collections_view_propose');
  assert.equal(viewTool.inputSchema.properties.view.properties.layout.enum.includes('cards'), true);
  const listed = await h.run(owner, 'collections_list', {});
  assert.equal(listed.ok, true, 'dispatcher output validation accepts its advertised list result');
});
