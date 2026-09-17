import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { toolModules } from '../../../capabilities/collections/index.js';
import { createToolRegistry, getToolsForSource, VISITOR_SAFE_TOOL_NAMES } from '../../../engine/tools.js';
import { createMockRegistry } from '../../../tools/__tests__/test-helpers.js';
import {
  channelActor,
  getYoubotCollectionService,
  ownerActor,
  resetYoubotCollectionServiceForTests,
} from '../service.js';
import { revalidateVisitorCollectionEvidence } from '../../../engine/visitor-reply.js';

function parsedResult(result: { success: boolean; result?: string; error?: string }): Record<string, any> {
  expect(result.success, result.error).toBe(true);
  const parsed = JSON.parse(result.result || '{}');
  expect(parsed.ok).toBe(true);
  return parsed.data;
}

describe('collection LLM tools', () => {
  it('registers proposal tools but excludes reviewed effect operations', () => {
    const module = toolModules[0]!;
    const names = module.tools.map((tool) => tool.name);
    expect(names).toContain('collections_ingest');
    expect(names).toContain('collections_change_propose');
    expect(names).not.toContain('collections_change_apply');
    expect(names).not.toContain('collections_publish');
    expect(names).not.toContain('collections_unpublish');
    expect(names).not.toContain('collections_archive');
    expect(names).not.toContain('collections_undo');

    const registry = createMockRegistry();
    module.register(registry, {} as never);
    expect(registry.registeredNames()).toEqual(names);
  });

  it('binds visitor execution context to published reads and denies spoofed authority or mutation', async () => {
    const priorHome = process.env.YOUBOT_HOME;
    process.env.YOUBOT_HOME = await mkdtemp(path.join(tmpdir(), 'youbot-visitor-tools-'));
    resetYoubotCollectionServiceForTests();
    try {
      const service = await getYoubotCollectionService();
      const owner = ownerActor('test-owner');
      const created = await service.executeOwner(owner, 'collections_create', {
        name: 'Visitor catalogue',
        schema: [
          { id: 'name', label: 'Name', type: 'string', public: true },
          { id: 'privateNote', label: 'Private note', type: 'string', public: false },
        ],
        view: { version: '1', layout: 'cards', titleField: 'name', visibleFields: ['name'] },
      }, { requestId: 'visitor-tools-create' });
      expect(created.ok).toBe(true);
      const collectionId = String(created.ok && (created.data as any).collectionId);

      const proposed = await service.executeOwner(owner, 'collections_change_propose', {
        collectionId,
        expectedRevision: 1,
        operations: [
          { kind: 'create_item', values: { name: 'Published home', privateNote: 'classified-published' } },
          { kind: 'create_item', values: { name: 'Draft home', privateNote: 'classified-draft' } },
        ],
        sourceRevisionIds: [],
        unresolvedIssues: [],
      }, { requestId: 'visitor-tools-propose' });
      expect(proposed.ok).toBe(true);
      const proposalId = String(proposed.ok && (proposed.data as any).id);
      const applied = await service.executeOwner(owner, 'collections_change_apply', {
        proposalId,
        expectedRevision: 1,
      }, { requestId: 'visitor-tools-apply' });
      expect(applied.ok).toBe(true);

      const current = await service.executeOwner(owner, 'collections_get', { collectionId });
      expect(current.ok).toBe(true);
      const itemIds = current.ok ? (current.data as any).itemIds as string[] : [];
      const firstItem = await service.executeOwner(owner, 'collections_item_get', {
        collectionId,
        itemId: itemIds[0],
      });
      expect(firstItem.ok).toBe(true);
      const publishedId = itemIds[0]!;
      const review = await service.executeOwner(owner, 'collections_get', {
        collectionId,
        selectedItemIds: [publishedId],
      });
      expect(review.ok).toBe(true);
      const publication = await service.executeOwner(owner, 'collections_publish', {
        collectionId,
        selectedItemIds: [publishedId],
        expectedPublicationRevision: 0,
        reviewedPayloadHash: review.ok && (review.data as any).publicationReview.reviewedPayloadHash,
      }, { requestId: 'visitor-tools-publish', exactIntent: true });
      expect(publication.ok).toBe(true);

      const module = toolModules[0]!;
      const registry = createToolRegistry();
      module.register(registry, {} as never);
      const visitorExecution = { sessionId: 'webchat:visitor-42', source: 'webchat', isOwner: false };
      const invoke = (toolName: string, args: Record<string, unknown>, execution = visitorExecution) =>
        registry.execute({ toolName, arguments: args }, execution);

      const searchTrace = await invoke('collections_search', {
        collectionIds: [collectionId],
        pageSize: 20,
      });
      const search = parsedResult(searchTrace);
      expect(search.items).toHaveLength(1);
      expect(search.items[0].item.values).toEqual({ name: 'Published home' });

      const privateSearch = parsedResult(await invoke('collections_search', {
        collectionIds: [collectionId],
        text: 'classified',
      }));
      expect(privateSearch.items).toEqual([]);

      const mutation = await invoke('collections_create', {
        name: 'Visitor-created',
      });
      expect(mutation).toMatchObject({ success: false });
      expect(mutation.error).toContain('UNAUTHORIZED');

      const spoofed = await invoke('collections_search', {
        collectionIds: [collectionId],
        entityId: 'other-entity',
        actorId: 'owner',
        isOwner: true,
      });
      expect(spoofed).toMatchObject({ success: false });
      expect(spoofed.error).toContain('INVALID_ARGUMENT');

      const ownerRead = await invoke(
        'collections_get',
        { collectionId },
        { sessionId: 'web-console', source: 'web', isOwner: true },
      );
      expect(ownerRead.success).toBe(true);

      expect(VISITOR_SAFE_TOOL_NAMES.has('collections_search')).toBe(true);
      expect(VISITOR_SAFE_TOOL_NAMES.has('collections_publish')).toBe(false);
      const visitorDefinitions = (await getToolsForSource(false)).map((tool) => tool.name);
      expect(visitorDefinitions).toContain('collections_search');
      expect(visitorDefinitions).toContain('collections_view_get');
      expect(visitorDefinitions).not.toContain('collections_source_review');
      expect(visitorDefinitions).not.toContain('collections_create');
      expect(channelActor('visitor', visitorExecution.sessionId, visitorExecution.source).id)
        .not.toBe(channelActor('owner', visitorExecution.sessionId, visitorExecution.source).id);

      const withdrawn = await service.executeOwner(owner, 'collections_unpublish', {
        collectionId,
        selectedItemIds: [publishedId],
        expectedPublicationRevision: 1,
      }, { requestId: 'visitor-tools-unpublish', exactIntent: true });
      expect(withdrawn.ok).toBe(true);
      expect(await revalidateVisitorCollectionEvidence(
        [searchTrace],
        async (evidenceReceiptId) => (await service.executeVisitor(
          channelActor('visitor', visitorExecution.sessionId, visitorExecution.source),
          'collections_evidence_validate',
          { evidenceReceiptId },
        )).ok,
      )).toBe(false);
    } finally {
      if (priorHome === undefined) delete process.env.YOUBOT_HOME;
      else process.env.YOUBOT_HOME = priorHome;
      resetYoubotCollectionServiceForTests();
    }
  });
});
