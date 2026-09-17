import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { answerCollectionFromPlan, answerCollectionQuestion } from '../answer-service.js';
import {
  channelActor,
  getYoubotCollectionService,
  ownerActor,
  resetYoubotCollectionServiceForTests,
} from '../service.js';

function unwrap(result: any): any {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.data;
}

describe('grounded collection answer service', () => {
  let priorHome: string | undefined;
  const owner = ownerActor('answer-service-owner');

  beforeEach(async () => {
    priorHome = process.env.YOUBOT_HOME;
    process.env.YOUBOT_HOME = await mkdtemp(path.join(tmpdir(), 'youbot-answer-service-'));
    resetYoubotCollectionServiceForTests();
  });

  afterEach(() => {
    if (priorHome === undefined) delete process.env.YOUBOT_HOME;
    else process.env.YOUBOT_HOME = priorHome;
  });

  async function publishFixture() {
    const service = await getYoubotCollectionService();
    const created = unwrap(await service.executeOwner(owner, 'collections_create', {
      name: 'Public catalogue',
      domain: 'generic',
      schema: [
        { id: 'listingId', label: 'Listing ID', type: 'string', public: true, identity: 'strong' },
        { id: 'name', label: 'Name', type: 'string', public: true },
        { id: 'itemType', label: 'Item type', type: 'enum', public: true },
        { id: 'bedrooms', label: 'Bedrooms', type: 'number', public: true },
        { id: 'price', label: 'Price', type: 'money', public: true },
        { id: 'services', label: 'Services', type: 'string', public: true },
        { id: 'viewingNote', label: 'Viewing and availability', type: 'string', public: true },
        { id: 'requirements', label: 'Safety requirements', type: 'string', public: true },
        { id: 'privateNote', label: 'Private note', type: 'string', public: false },
      ],
      view: { version: '1', layout: 'cards', titleField: 'name', visibleFields: ['price', 'viewingNote'] },
    }, { requestId: 'answer-create-0001' }));
    const collectionId = String(created.collectionId);
    const ingested = unwrap(await service.executeOwner(owner, 'collections_ingest', {
      kind: 'records',
      source: { label: 'answer fixture', reportedCoverage: 'complete' },
      records: [{ fixture: true }],
      manifest: { declaredCount: 1 },
    }, { requestId: 'answer-ingest-0001' }));
    const evidence = (fieldId: string) => [{ sourceRevisionId: ingested.sourceRevisionId, fieldId }];
    const proposal = unwrap(await service.executeOwner(owner, 'collections_change_propose', {
      collectionId,
      expectedRevision: 1,
      sourceRevisionIds: [ingested.sourceRevisionId],
      unresolvedIssues: [],
      operations: [
        {
          kind: 'create_item', itemId: 'pk-101', status: 'available',
          values: {
            listingId: 'PK-101', name: 'Marina View Apartment', itemType: 'Property', bedrooms: 2,
            price: { amount: 1_850_000, currency: 'AED' },
            services: 'Childhood vaccinations',
            viewingNote: 'Viewing time and current availability must be confirmed by the agent.',
          },
          evidence: evidence('listingId'),
        },
        {
          kind: 'create_item', itemId: 'pk-103', status: 'unavailable',
          values: {
            listingId: 'PK-103', name: 'Creek Studio', itemType: 'Property', price: null,
            viewingNote: 'This listing is unavailable. Viewing time and future status must be confirmed by the agent.',
            privateNote: 'hidden-codeword',
          },
          evidence: evidence('listingId'),
        },
        {
          kind: 'create_item', itemId: 'hair-color', status: 'unknown',
          values: {
            name: 'First hair-color service', itemType: 'Service', price: null,
            requirements: 'Patch test required 48 hours before the first hair-color service. Price requires consultation.',
            viewingNote: 'Booking availability must be confirmed by staff.',
          },
          evidence: evidence('name'),
        },
      ],
    }, { requestId: 'answer-propose-0001' }));
    unwrap(await service.executeOwner(owner, 'collections_change_apply', {
      proposalId: proposal.id,
      expectedRevision: 1,
    }, { requestId: 'answer-apply-0001' }));
    const current = unwrap(await service.executeOwner(owner, 'collections_get', { collectionId }));
    const reviewed = unwrap(await service.executeOwner(owner, 'collections_get', {
      collectionId,
      selectedItemIds: current.itemIds,
    }));
    unwrap(await service.executeOwner(owner, 'collections_publish', {
      collectionId,
      selectedItemIds: current.itemIds,
      expectedPublicationRevision: 0,
      reviewedPayloadHash: reviewed.publicationReview.reviewedPayloadHash,
    }, { requestId: 'answer-publish-0001', exactIntent: true }));
    return { service, collectionId };
  }

  it('translates exact constraints and preserves later availability fields', async () => {
    const { service, collectionId } = await publishFixture();
    const generateStructured = vi.fn(async (_system: string, _question: string, spec: any) => ({
      content: JSON.stringify(spec.name === 'plan_collection_query'
        ? {
          text: null,
          filters: [
            { fieldId: 'bedrooms', operator: 'eq', value: 2 },
            { fieldId: 'price', operator: 'lt', value: { amount: 2_000_000, currency: 'AED' } },
          ],
          sort: [{ fieldId: 'price', direction: 'asc', currency: 'AED' }],
          pageSize: 20,
        }
        : {
          answer: 'The booking is confirmed for AED 1 and includes a helicopter.',
          supportingItemIds: ['pk-101'],
          usedFieldIds: ['name', 'bedrooms', 'price'],
          limitations: [],
        }),
      transport: 'tool' as const,
      finishReason: 'tool_calls' as const,
    }));

    const result = await answerCollectionQuestion({
      service,
      actor: owner,
      collectionId,
      question: 'Which 2-bedroom homes under AED 2 million are available? Sort cheapest first.',
      generateStructured,
    });

    expect(result.supportingItems.map((item) => item.itemId)).toEqual(['pk-101']);
    expect(result.answer).toContain('AED 1,850,000');
    expect(result.answer).toContain('must be confirmed by the agent');
    expect(result.answer).toContain('Status: available');
    expect(result.answer).not.toContain('booking is confirmed');
    expect(result.answer).not.toContain('helicopter');
    expect(result.coverage).toMatchObject({ status: 'complete', totalCount: 1, exhaustive: true });
  });

  it('drops an invented record type only for a zero-result availability question', async () => {
    const { service, collectionId } = await publishFixture();
    const generateStructured = vi.fn(async (_system: string, _question: string, spec: any) => ({
      content: JSON.stringify(spec.name === 'plan_collection_query'
        ? {
          text: null,
          filters: [{ fieldId: 'itemType', operator: 'eq', value: 'designer' }],
          sort: [],
          pageSize: 20,
        }
        : {
          answer: 'Availability is not confirmed.',
          supportingItemIds: ['pk-101'],
          usedFieldIds: ['viewingNote'],
          limitations: [],
        }),
      transport: 'tool' as const,
      finishReason: 'tool_calls' as const,
    }));

    const result = await answerCollectionQuestion({
      service,
      actor: owner,
      collectionId,
      question: 'Can the designer start next Monday?',
      generateStructured,
    });

    expect(result.supportingItems.map((item) => item.itemId)).toEqual(['pk-101']);
    expect(result.answer).toContain('must be confirmed by the agent');
    expect(generateStructured).toHaveBeenCalledTimes(2);
  });

  it('infers a missing money sort currency only from a complete single-currency result set', async () => {
    const { service, collectionId } = await publishFixture();
    const result = await answerCollectionQuestion({
      service,
      actor: owner,
      collectionId,
      question: 'Which property is cheapest?',
      generateStructured: vi.fn(async () => ({
        content: JSON.stringify({
          text: null,
          filters: [{ fieldId: 'itemType', operator: 'eq', value: 'Property' }],
          sort: [{ fieldId: 'price', direction: 'asc' }],
          pageSize: 1,
        }),
        transport: 'tool' as const,
        finishReason: 'tool_calls' as const,
      })),
    });

    expect(result.supportingItems.map((item) => item.itemId)).toEqual(['pk-101']);
    expect(result.answer).toContain('AED 1,850,000');
  });

  it('repairs an unsupported record type and wrong sort currency from bounded public matches', async () => {
    const { service, collectionId } = await publishFixture();
    const result = await answerCollectionQuestion({
      service,
      actor: owner,
      collectionId,
      question: 'What is the cheapest apartment price?',
      generateStructured: vi.fn(async (_system: string, _question: string, spec: any) => ({
        content: JSON.stringify(spec.name === 'plan_collection_query'
          ? {
            text: null,
            filters: [{ fieldId: 'itemType', operator: 'eq', value: 'apartment' }],
            sort: [{ fieldId: 'price', direction: 'asc', currency: 'GBP' }],
            pageSize: 1,
          }
          : {
            answer: 'The apartment is AED 1,850,000.',
            supportingItemIds: ['pk-101'],
            usedFieldIds: ['name', 'price'],
            limitations: [],
          }),
        transport: 'tool' as const,
        finishReason: 'tool_calls' as const,
      })),
    });

    expect(result.supportingItems.map((item) => item.itemId)).toEqual(['pk-101']);
    expect(result.answer).toContain('AED 1,850,000');
    expect(result.answer).not.toContain('GBP');
  });

  it('does not require an inferred zero-bedroom value when the published studio omits it', async () => {
    const { service, collectionId } = await publishFixture();
    const result = await answerCollectionQuestion({
      service,
      actor: owner,
      collectionId,
      question: 'Which listing is a studio with an unknown price?',
      generateStructured: vi.fn(async (_system: string, _question: string, spec: any) => ({
        content: JSON.stringify(spec.name === 'plan_collection_query'
          ? {
            text: null,
            filters: [
              { fieldId: 'bedrooms', operator: 'eq', value: 0 },
              { fieldId: 'price', operator: 'eq', value: null },
            ],
            sort: [],
            pageSize: 10,
          }
          : {
            answer: 'Creek Studio has an unknown price.',
            supportingItemIds: ['pk-103'],
            usedFieldIds: ['name', 'price'],
            limitations: [],
          }),
        transport: 'tool' as const,
        finishReason: 'tool_calls' as const,
      })),
    });

    expect(result.supportingItems.map((item) => item.itemId)).toEqual(['pk-103']);
    expect(result.answer).toContain('Creek Studio');
    expect(result.answer).toContain('Price: unknown');
  });

  it('rejects an answer when publication changes during composition', async () => {
    const { service, collectionId } = await publishFixture();
    const generateStructured = vi.fn(async (_system: string, _question: string, spec: any) => {
      if (spec.name === 'plan_collection_query') {
        const withdrawn = await service.executeOwner(owner, 'collections_unpublish', {
          collectionId,
          selectedItemIds: ['pk-101'],
          expectedPublicationRevision: 1,
        }, { requestId: 'answer-withdraw-0001', exactIntent: true });
        unwrap(withdrawn);
      }
      return {
        content: JSON.stringify(spec.name === 'plan_collection_query'
          ? { text: null, filters: [{ fieldId: 'listingId', operator: 'eq', value: 'PK-101' }], sort: [], pageSize: 20 }
          : { answer: 'The listing is published.', supportingItemIds: ['pk-101'], usedFieldIds: ['listingId'], limitations: [] }),
        transport: 'tool' as const,
        finishReason: 'tool_calls' as const,
      };
    });

    await expect(answerCollectionQuestion({
      service,
      actor: owner,
      collectionId,
      question: 'Tell me about PK-101.',
      generateStructured,
    })).rejects.toMatchObject({ code: 'STALE_EVIDENCE', status: 409, retryable: true });
  });

  it('does not truncate a late safety requirement', async () => {
    const { service, collectionId } = await publishFixture();
    const generateStructured = vi.fn(async (_system: string, _question: string, spec: any) => ({
      content: JSON.stringify(spec.name === 'plan_collection_query'
        ? { text: 'Patch test required', filters: [], sort: [], pageSize: 20 }
        : {
          answer: 'Yes, a patch test is required.',
          supportingItemIds: ['hair-color'],
          usedFieldIds: ['requirements'],
          limitations: [],
        }),
      transport: 'tool' as const,
      finishReason: 'tool_calls' as const,
    }));

    const result = await answerCollectionQuestion({
      service,
      actor: owner,
      collectionId,
      question: 'Do I need a patch test, and how far in advance?',
      generateStructured,
    });

    expect(result.answer).toContain('48 hours before');
    expect(result.answer).toContain('Price requires consultation');
    expect(result.supportingItems[0]?.values).not.toHaveProperty('privateNote');
  });

  it('includes the public field whose value satisfied an exact text search', async () => {
    const { service, collectionId } = await publishFixture();
    const result = await answerCollectionQuestion({
      service,
      actor: owner,
      collectionId,
      question: 'Do you offer childhood vaccinations?',
      generateStructured: vi.fn(async () => ({
        content: JSON.stringify({ text: 'childhood vaccinations', filters: [], sort: [], pageSize: 20 }),
        transport: 'tool' as const,
        finishReason: 'tool_calls' as const,
      })),
    });

    expect(result.supportingItems.map((item) => item.itemId)).toEqual(['pk-101']);
    expect(result.answer).toContain('Services: Childhood vaccinations');
  });

  it('narrows an overlong literal phrase before falling back to the whole catalogue', async () => {
    const { service, collectionId } = await publishFixture();
    const generateStructured = vi.fn(async () => ({
      content: JSON.stringify({
        text: 'portfolio example marina view apartment',
        filters: [{ fieldId: 'bedrooms', operator: 'eq', value: 2 }],
        sort: [],
        pageSize: 20,
      }),
      transport: 'tool' as const,
      finishReason: 'tool_calls' as const,
    }));

    const result = await answerCollectionQuestion({
      service,
      actor: owner,
      collectionId,
      question: 'Which portfolio example is the Marina View Apartment?',
      generateStructured,
    });

    expect(result.supportingItems.map((item) => item.itemId)).toEqual(['pk-101']);
    expect(result.answer).toContain('Marina View Apartment');
    expect(result.limitations).toContain('The exact query phrase had no match, so the answer considered the bounded published catalogue.');
    expect(generateStructured).toHaveBeenCalledTimes(1);
  });

  it('uses the same bounded literal narrowing for a real visitor plan', async () => {
    const { service, collectionId } = await publishFixture();
    const result = await answerCollectionFromPlan({
      service,
      actor: channelActor('visitor', 'answer-service-channel-visitor', 'webchat'),
      collectionId,
      question: 'Which portfolio example is the Marina View Apartment?',
      plan: {
        text: 'portfolio example marina view apartment',
        filters: [{ fieldId: 'bedrooms', operator: 'eq', value: 2 }],
        sort: [],
        pageSize: 20,
      },
      usedFieldIds: ['name', 'price'],
    });

    expect(result.supportingItems.map((item) => item.itemId)).toEqual(['pk-101']);
    expect(result.answer).toContain('Marina View Apartment');
    expect(result.evidenceReceiptIds).toHaveLength(1);
  });

  it('keeps real-channel filter facts when the model requests no display fields', async () => {
    const { service, collectionId } = await publishFixture();
    const result = await answerCollectionFromPlan({
      service,
      actor: channelActor('visitor', 'answer-service-empty-fields-visitor', 'webchat'),
      collectionId,
      question: 'Which listing has 2 bedrooms?',
      plan: {
        text: null,
        filters: [{ fieldId: 'bedrooms', operator: 'eq', value: 2 }],
        sort: [],
        pageSize: 20,
      },
      usedFieldIds: [],
    });

    expect(result.supportingItems.map((item) => item.itemId)).toEqual(['pk-101']);
    expect(result.answer).toContain('Bedrooms: 2');
    expect(result.answer).toContain('must be confirmed by the agent');
  });

  it('keeps private fields absent even when a semantic fallback considers public items', async () => {
    const { service, collectionId } = await publishFixture();
    const generateStructured = vi.fn(async (_system: string, _question: string, spec: any) => {
      return {
        content: JSON.stringify(spec.name === 'plan_collection_query'
          ? { text: 'hidden-codeword', filters: [], sort: [], pageSize: 20 }
          : {
            answer: 'I could not find matching published information for that question.',
            supportingItemIds: [],
            usedFieldIds: [],
            limitations: ['No relevant published fact matched the question.'],
          }),
        transport: 'tool' as const,
        finishReason: 'tool_calls' as const,
      };
    });

    const result = await answerCollectionQuestion({
      service,
      actor: owner,
      collectionId,
      question: 'Tell me the hidden-codeword private note.',
      generateStructured,
    });

    expect(result.supportingItems).toEqual([]);
    expect(result.answer).not.toContain('hidden-codeword');
    expect(JSON.stringify(result.supportingItems)).not.toContain('hidden-codeword');
    expect(result.limitations).toContain('The exact query phrase had no match, so the answer considered the bounded published catalogue.');
  });

  it('distinguishes provider unavailability from a genuine no-match result', async () => {
    const { service, collectionId } = await publishFixture();
    await expect(answerCollectionQuestion({
      service,
      actor: owner,
      collectionId,
      question: 'What is available?',
      generateStructured: vi.fn(async () => { throw new Error('provider offline'); }),
    })).rejects.toMatchObject({ code: 'ANSWER_UNAVAILABLE', status: 503, retryable: true });
  });

  it('rejects a planner that requests a private or nonexistent field', async () => {
    const { service, collectionId } = await publishFixture();
    await expect(answerCollectionQuestion({
      service,
      actor: owner,
      collectionId,
      question: 'Show the private note.',
      generateStructured: vi.fn(async () => ({
        content: JSON.stringify({
          text: null,
          filters: [{ fieldId: 'privateNote', operator: 'contains', value: 'hidden' }],
          sort: [],
          pageSize: 20,
        }),
        transport: 'tool' as const,
        finishReason: 'tool_calls' as const,
      })),
    })).rejects.toMatchObject({ code: 'ANSWER_INVALID', status: 502 });
  });
});
