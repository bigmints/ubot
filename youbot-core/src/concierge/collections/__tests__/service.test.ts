import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMemoryCollectionRepository } from '@youbot/collection-engine';
import { describe, expect, it } from 'vitest';
import { YoubotCollectionService, channelActor, ownerActor } from '../service.js';

function data(result: Awaited<ReturnType<YoubotCollectionService['executeOwner']>>) {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.data as Record<string, any>;
}

describe('Youbot collection service', () => {
  it('keeps entity scope server-side and requires explicit host intent for publication', async () => {
    const repository = createMemoryCollectionRepository();
    const owner = ownerActor('dashboard-owner');
    const first = await YoubotCollectionService.create({ repository, entityId: 'entity_first' });
    const other = await YoubotCollectionService.create({ repository, entityId: 'entity_other' });

    const created = data(await first.executeOwner(owner, 'collections_create', {
      name: 'Homes',
      schema: [{ id: 'name', label: 'Name', type: 'string', public: true }],
      view: { version: '1', layout: 'cards', titleField: 'name' },
    }, { requestId: 'create-homes' }));
    const collectionId = String(created.collectionId);

    const ingested = data(await first.executeOwner(owner, 'collections_ingest', {
      kind: 'text',
      source: { label: 'Owner note', reportedCoverage: 'complete' },
      text: 'Palm House',
      manifest: { declaredCount: 1 },
    }, { requestId: 'ingest-home' }));

    const proposal = data(await first.executeOwner(owner, 'collections_change_propose', {
      collectionId,
      expectedRevision: 1,
      operations: [{
        kind: 'create_item',
        values: { name: 'Palm House' },
        evidence: [{ sourceRevisionId: ingested.sourceRevisionId, fieldId: 'name' }],
      }],
      sourceRevisionIds: [ingested.sourceRevisionId],
      unresolvedIssues: [],
    }, { requestId: 'propose-home' }));

    await first.executeOwner(owner, 'collections_change_apply', {
      proposalId: proposal.id,
      expectedRevision: 1,
    }, { requestId: 'apply-home' });
    const current = data(await first.executeOwner(owner, 'collections_get', { collectionId }));
    const itemId = String(current.itemIds[0]);
    const reviewed = data(await first.executeOwner(owner, 'collections_get', {
      collectionId,
      selectedItemIds: [itemId],
    }));

    const denied = await first.executeOwner(owner, 'collections_publish', {
      collectionId,
      selectedItemIds: [itemId],
      expectedPublicationRevision: 0,
      reviewedPayloadHash: reviewed.publicationReview.reviewedPayloadHash,
    }, { requestId: 'model-cannot-publish' });
    expect(denied).toMatchObject({ ok: false, error: { code: 'INTENT_REQUIRED' } });

    const published = await first.executeOwner(owner, 'collections_publish', {
      collectionId,
      selectedItemIds: [itemId],
      expectedPublicationRevision: 0,
      reviewedPayloadHash: reviewed.publicationReview.reviewedPayloadHash,
    }, { requestId: 'owner-publishes', exactIntent: true });
    expect(published.ok).toBe(true);

    const visible = await first.executeVisitor(
      channelActor('visitor', 'visitor-one', 'webchat'),
      'collections_item_get',
      { collectionId, itemId },
    );
    expect(data(visible as Awaited<ReturnType<YoubotCollectionService['executeOwner']>>)).toMatchObject({
      id: itemId,
      values: { name: 'Palm House' },
    });
    const isolated = data(await other.executeOwner(owner, 'collections_list', {}));
    expect(isolated.items).toEqual([]);
  });

  it('persists to a private Youbot-owned file and restarts cleanly', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'youbot-collections-'));
    const filePath = path.join(directory, 'data', 'collections', 'engine.json');
    const owner = ownerActor('dashboard-owner');
    const first = await YoubotCollectionService.create({ dataPath: filePath, entityId: 'entity_restart' });
    await first.executeOwner(owner, 'collections_create', { name: 'Classes' }, { requestId: 'create-classes' });

    const restarted = await YoubotCollectionService.create({ dataPath: filePath, entityId: 'entity_restart' });
    expect(data(await restarted.executeOwner(owner, 'collections_list', {})).items).toHaveLength(1);
    expect(JSON.parse(await readFile(filePath, 'utf8')).schemaVersion).toBe(1);
    expect((await stat(path.dirname(filePath))).mode & 0o777).toBe(0o700);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
  });

  it('enumerates only the package visitor-safe catalogue for visitor context', async () => {
    const service = YoubotCollectionService.memory();
    const names = (await service.visitorTools()).map((tool) => tool.name);
    expect(names).toEqual([
      'collections_list',
      'collections_get',
      'collections_item_get',
      'collections_search',
      'collections_view_get',
      'collections_evidence_validate',
    ]);
  });
});
