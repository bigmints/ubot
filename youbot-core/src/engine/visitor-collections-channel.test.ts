import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const model = vi.hoisted(() => ({
  calls: [] as Array<Record<string, any>>,
  chatResponses: [] as Array<Record<string, any>>,
}));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: vi.fn(async (request: Record<string, any>) => {
          model.calls.push(request);
          if (Array.isArray(request.tools) && request.tools.length > 0) {
            const response = model.chatResponses.shift();
            if (!response) throw new Error('No deterministic visitor-chat response remains.');
            return response;
          }
          return {
            choices: [{ finish_reason: 'stop', message: { content: '{}' } }],
          };
        }),
      },
    };
  },
}));

import { toolModules } from '../capabilities/collections/index.js';
import { InboxDispatchHeld } from '../concierge/store.js';
import {
  getYoubotCollectionService,
  ownerActor,
  resetYoubotCollectionServiceForTests,
  YoubotCollectionService,
} from '../concierge/collections/service.js';
import { handleIncomingMessage, type UnifiedDeps } from './handler.js';
import { createAgentOrchestrator, type AgentOrchestrator } from './orchestrator.js';
import { DEFAULT_AGENT_CONFIG } from './types.js';

type SeededFixture = {
  service: YoubotCollectionService;
  doctorCollectionId: string;
  realtyCollectionId: string;
  designerCollectionId: string;
  guitarCollectionId: string;
  guitarPublishedId: string;
  beautyCollectionId: string;
  foreignCollectionId: string;
};

type ConciergeHarness = {
  receive: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  failure: ReturnType<typeof vi.fn>;
  automatedReply: ReturnType<typeof vi.fn>;
  rememberCollectionEvidence: ReturnType<typeof vi.fn>;
  collectionEvidence: ReturnType<typeof vi.fn>;
};

function toolCall(name: string, args: Record<string, unknown>, id: string) {
  return {
    choices: [{
      finish_reason: 'tool_calls',
      message: {
        content: null,
        tool_calls: [{
          id,
          type: 'function',
          function: { name, arguments: JSON.stringify(args) },
        }],
      },
    }],
  };
}

function finishedReply(reply: string) {
  return {
    choices: [{
      finish_reason: 'stop',
      message: { content: JSON.stringify({ reply }), tool_calls: [] },
    }],
  };
}

function unwrap(result: any): any {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.data;
}

async function createAndPublish(
  service: YoubotCollectionService,
  owner: ReturnType<typeof ownerActor>,
  fixture: {
    name: string;
    schema: Array<Record<string, unknown>>;
    items: Array<{ id: string; values: Record<string, unknown>; status?: string; publish: boolean }>;
  },
) {
  const created = unwrap(await service.executeOwner(owner, 'collections_create', {
    name: fixture.name,
    domain: 'generic',
    schema: fixture.schema,
    view: {
      version: '1',
      layout: 'cards',
      titleField: fixture.schema[0]?.id,
      visibleFields: fixture.schema.filter((field) => field.public !== false).map((field) => field.id),
    },
  }, { requestId: `create-${fixture.name}` }));
  const collectionId = String(created.collectionId);

  const proposed = unwrap(await service.executeOwner(owner, 'collections_change_propose', {
    collectionId,
    expectedRevision: 1,
    sourceRevisionIds: [],
    unresolvedIssues: [],
    operations: fixture.items.map((item) => ({
      kind: 'create_item',
      itemId: item.id,
      status: item.status || 'unknown',
      values: item.values,
    })),
  }, { requestId: `propose-${fixture.name}` }));
  unwrap(await service.executeOwner(owner, 'collections_change_apply', {
    proposalId: proposed.id,
    expectedRevision: 1,
  }, { requestId: `apply-${fixture.name}` }));

  const selectedItemIds = fixture.items.filter((item) => item.publish).map((item) => item.id);
  const reviewed = unwrap(await service.executeOwner(owner, 'collections_get', {
    collectionId,
    selectedItemIds,
  }));
  unwrap(await service.executeOwner(owner, 'collections_publish', {
    collectionId,
    selectedItemIds,
    expectedPublicationRevision: 0,
    reviewedPayloadHash: reviewed.publicationReview.reviewedPayloadHash,
  }, { requestId: `publish-${fixture.name}`, exactIntent: true }));
  return collectionId;
}

async function seedFixture(): Promise<SeededFixture> {
  const service = await getYoubotCollectionService();
  const owner = ownerActor('visitor-channel-fixture');
  const doctorCollectionId = await createAndPublish(service, owner, {
    name: 'Harbor Family Clinic',
    schema: [
      { id: 'service', label: 'Service', type: 'string', public: true },
      { id: 'mode', label: 'Mode', type: 'string', public: true },
      { id: 'price', label: 'Price', type: 'money', public: true },
      { id: 'hours', label: 'Hours', type: 'string', public: true },
      { id: 'availability', label: 'Availability', type: 'string', public: true },
      { id: 'safety', label: 'Safety', type: 'string', public: true },
      { id: 'privateNote', label: 'Private note', type: 'string', public: false },
    ],
    items: [
      {
        id: 'doctor-in-person',
        publish: true,
        status: 'unknown',
        values: {
          service: 'Family medicine consultation',
          mode: 'in-person',
          price: { amount: 350, currency: 'AED' },
          hours: 'Monday, Wednesday and Thursday 09:00–17:00; Tuesday 12:00–20:00; Friday 09:00–13:00; closed Saturday and Sunday',
          availability: 'Same-day appointments may be available but must be confirmed by clinic staff.',
          safety: 'Emergency symptoms are not handled; contact emergency services.',
          privateNote: 'doctor-private-mobile-050000',
        },
      },
      {
        id: 'doctor-video',
        publish: true,
        status: 'unknown',
        values: {
          service: 'Family medicine consultation',
          mode: 'video',
          price: { amount: 250, currency: 'AED' },
          hours: 'During clinic opening hours',
          availability: 'Appointment availability must be confirmed by clinic staff.',
          safety: 'Emergency symptoms are not handled; contact emergency services.',
        },
      },
      {
        id: 'doctor-draft',
        publish: false,
        values: {
          service: 'Unannounced home visit',
          price: { amount: 999, currency: 'AED' },
          privateNote: 'doctor-draft-secret',
        },
      },
    ],
  });

  const realtyCollectionId = await createAndPublish(service, owner, {
    name: 'Palm & Key Realty',
    schema: [
      { id: 'listingId', label: 'Listing ID', type: 'string', public: true },
      { id: 'property', label: 'Property', type: 'string', public: true },
      { id: 'bedrooms', label: 'Bedrooms', type: 'number', public: true },
      { id: 'area', label: 'Area (sq ft)', type: 'number', unit: 'sq ft', public: true },
      { id: 'price', label: 'Price', type: 'money', public: true },
      { id: 'availability', label: 'Availability', type: 'string', public: true },
      { id: 'priceNote', label: 'Price note', type: 'string', public: true },
      { id: 'viewing', label: 'Viewing', type: 'string', public: true },
      { id: 'privateNote', label: 'Private note', type: 'string', public: false },
    ],
    items: [
      {
        id: 'property-pk-101',
        publish: true,
        status: 'available',
        values: {
          listingId: 'PK-101',
          property: 'Marina View Apartment',
          bedrooms: 2,
          area: 1220,
          price: { amount: 1850000, currency: 'AED' },
          availability: 'Available, subject to current agent confirmation.',
          viewing: 'Viewing times and current availability must be confirmed by the agent.',
          privateNote: 'realty-private-seller-phone',
        },
      },
      {
        id: 'property-pk-102',
        publish: true,
        status: 'available',
        values: {
          listingId: 'PK-102',
          property: 'Garden Townhouse',
          bedrooms: 3,
          price: { amount: 2750000, currency: 'AED' },
          availability: 'Available, subject to current agent confirmation.',
          viewing: 'Viewing times and current availability must be confirmed by the agent.',
        },
      },
      {
        id: 'property-pk-103',
        publish: true,
        status: 'unavailable',
        values: {
          listingId: 'PK-103',
          property: 'Creek Studio',
          bedrooms: 0,
          price: null,
          availability: 'Unavailable',
          priceNote: 'Price unknown',
          viewing: 'Viewing times and current availability must be confirmed by the agent.',
        },
      },
      {
        id: 'property-draft',
        publish: false,
        values: {
          listingId: 'PK-DRAFT',
          property: 'Unannounced penthouse',
          price: { amount: 1, currency: 'AED' },
          privateNote: 'realty-draft-secret',
        },
      },
    ],
  });

  const designerCollectionId = await createAndPublish(service, owner, {
    name: 'Mira Vale Design',
    schema: [
      { id: 'service', label: 'Service', type: 'string', public: true },
      { id: 'price', label: 'Price', type: 'money', public: true },
      { id: 'timeline', label: 'Timeline', type: 'string', public: true },
      { id: 'includes', label: 'Includes', type: 'string', public: true },
      { id: 'deposit', label: 'Deposit', type: 'string', public: true },
      { id: 'portfolio', label: 'Portfolio', type: 'string', multiple: true, public: true },
      { id: 'availability', label: 'Availability', type: 'string', public: true },
      { id: 'privateNote', label: 'Private note', type: 'string', public: false },
    ],
    items: [
      {
        id: 'design-brand-starter',
        publish: true,
        status: 'unknown',
        values: {
          service: 'Brand Starter',
          price: { amount: 4500, currency: 'AED' },
          timeline: '2 weeks',
          includes: 'Logo, color palette and typography',
          deposit: '50 percent after proposal approval',
          portfolio: ['Cedar Coffee identity', 'Luma skincare packaging'],
          availability: 'New-project availability is unknown until Mira confirms.',
          privateNote: 'designer-private-floor-aed-3700',
        },
      },
      {
        id: 'design-website-launch',
        publish: true,
        status: 'unknown',
        values: {
          service: 'Website Launch',
          price: { amount: 9500, currency: 'AED' },
          timeline: '4–6 weeks',
          includes: 'Up to 5 responsive pages',
          deposit: '50 percent after proposal approval',
          portfolio: ['Northstar coaching website'],
          availability: 'New-project availability is unknown until Mira confirms.',
        },
      },
      {
        id: 'design-draft',
        publish: false,
        values: {
          service: 'Unannounced subscription',
          price: { amount: 3700, currency: 'AED' },
          privateNote: 'designer-draft-secret',
        },
      },
    ],
  });

  const guitarPublishedId = 'guitar-beginner';
  const guitarCollectionId = await createAndPublish(service, owner, {
    name: 'Samir Guitar Studio',
    schema: [
      { id: 'name', label: 'Class', type: 'string', public: true },
      { id: 'format', label: 'Format', type: 'string', public: true },
      { id: 'ageMinimum', label: 'Minimum age', type: 'number', public: true },
      { id: 'price', label: 'Price', type: 'money', public: true },
      { id: 'schedule', label: 'Schedule', type: 'string', public: true },
      { id: 'capacity', label: 'Capacity', type: 'number', public: true },
      { id: 'availability', label: 'Availability', type: 'string', public: true },
      { id: 'privateNote', label: 'Private note', type: 'string', public: false },
    ],
    items: [
      {
        id: guitarPublishedId,
        publish: true,
        status: 'unknown',
        values: {
          name: 'Beginner Foundations',
          format: 'course',
          ageMinimum: 12,
          price: { amount: 1200, currency: 'AED' },
          schedule: 'Wednesdays 18:00–19:00',
          capacity: 8,
          availability: 'Capacity is not live seat availability. A place requires studio confirmation.',
          privateNote: 'guitar-private-discount-floor',
        },
      },
      {
        id: 'guitar-draft',
        publish: false,
        values: {
          name: 'Unannounced masterclass',
          price: { amount: 400, currency: 'AED' },
          privateNote: 'guitar-draft-secret',
        },
      },
    ],
  });

  const beautyCollectionId = await createAndPublish(service, owner, {
    name: 'Noor Beauty Lounge',
    schema: [
      { id: 'service', label: 'Service', type: 'string', public: true },
      { id: 'price', label: 'Price', type: 'money', public: true },
      { id: 'duration', label: 'Duration', type: 'number', public: true },
      { id: 'requirements', label: 'Requirements', type: 'string', public: true },
      { id: 'availability', label: 'Availability', type: 'string', public: true },
      { id: 'privateNote', label: 'Private note', type: 'string', public: false },
    ],
    items: [
      {
        id: 'beauty-hair-color',
        publish: true,
        status: 'unknown',
        values: {
          service: 'First hair-color service',
          price: null,
          duration: null,
          requirements: 'Patch test required 48 hours before the first hair-color service. Price requires consultation.',
          availability: 'Appointment availability must be confirmed by salon staff.',
          privateNote: 'beauty-private-formula',
        },
      },
      {
        id: 'beauty-draft',
        publish: false,
        values: {
          service: 'Unannounced treatment',
          privateNote: 'beauty-draft-secret',
        },
      },
    ],
  });

  const foreign = YoubotCollectionService.memory('entity-foreign');
  const foreignOwner = ownerActor('foreign-owner');
  const foreignCollectionId = await createAndPublish(foreign, foreignOwner, {
    name: 'Foreign tenant catalogue',
    schema: [
      { id: 'name', label: 'Name', type: 'string', public: true },
      { id: 'privateNote', label: 'Private note', type: 'string', public: false },
    ],
    items: [{
      id: 'foreign-item',
      publish: true,
      values: { name: 'Foreign published item', privateNote: 'foreign-tenant-secret' },
    }],
  });

  return {
    service,
    doctorCollectionId,
    realtyCollectionId,
    designerCollectionId,
    guitarCollectionId,
    guitarPublishedId,
    beautyCollectionId,
    foreignCollectionId,
  };
}

function createTestOrchestrator(): AgentOrchestrator {
  const histories = new Map<string, Array<Record<string, any>>>();
  const conversationStore = {
    getOrCreateSession: vi.fn(async (id: string, type = 'webchat') => ({
      id,
      type,
      name: id,
      createdAt: new Date(),
      updatedAt: new Date(),
      messageCount: histories.get(id)?.length || 0,
    })),
    renameSession: vi.fn(async () => undefined),
    addMessage: vi.fn(async (id: string, role: string, content: string, metadata?: unknown) => {
      const history = histories.get(id) || [];
      history.push({ id: `${id}-${history.length}`, sessionId: id, role, content, metadata, timestamp: new Date() });
      histories.set(id, history);
    }),
    getHistory: vi.fn(async (id: string, limit = 50) => (histories.get(id) || []).slice(-limit)),
    getRecentWebMessages: vi.fn(async () => []),
  };
  const memoryStore = {
    getMemories: vi.fn(async () => []),
    saveMemory: vi.fn(),
  };
  const soul = {
    buildSoulPrompt: vi.fn(async () => ''),
    getDocument: vi.fn(() => ''),
    getStore: vi.fn(() => memoryStore),
  };

  const orchestrator = createAgentOrchestrator({
    ...DEFAULT_AGENT_CONFIG,
    llmBaseUrl: 'http://127.0.0.1:1/v1',
    llmApiKey: 'test-only',
    llmModel: 'deterministic-test-model',
    llmProviders: [],
    defaultLlmProviderId: 'deterministic-test',
    maxToolIterations: 6,
    autoReplyWebchat: true,
  }, conversationStore as never, memoryStore as never, null as never, soul as never);

  toolModules[0]!.register(orchestrator.getToolRegistry(), {} as never);
  return orchestrator;
}

function createConciergeHarness(): ConciergeHarness {
  const failure = vi.fn(async () => undefined);
  return {
    receive: vi.fn(async () => ({ thread: { revision: 7, paused: false } })),
    get: vi.fn(async () => ({ lastError: null })),
    failure,
    automatedReply: vi.fn(async (_id: string, _revision: number, _text: string, dispatch: () => Promise<void>) => {
      try {
        await dispatch();
        return true;
      } catch (error) {
        if ((error as Error).name === InboxDispatchHeld.name) {
          await failure(_id, (error as Error).message);
          return false;
        }
        throw error;
      }
    }),
    rememberCollectionEvidence: vi.fn(async () => undefined),
    collectionEvidence: vi.fn(async () => undefined),
  };
}

async function runVisitor(
  orchestrator: AgentOrchestrator,
  concierge: ConciergeHarness,
  body: string,
  senderId: string,
) {
  const send = vi.fn(async () => undefined);
  let orchestration: Awaited<ReturnType<AgentOrchestrator['chat']>> | undefined;
  const chat = orchestrator.chat.bind(orchestrator);
  vi.spyOn(orchestrator, 'chat').mockImplementation(async (...args) => {
    orchestration = await chat(...args);
    return orchestration;
  });
  const result = await handleIncomingMessage({
    channel: 'webchat',
    senderId,
    senderName: 'Fixture visitor',
    body,
    timestamp: new Date(),
    replyFn: send,
  }, {
    concierge,
    orchestrator,
    approvalStore: null,
    followUpStore: null,
    eventBus: null,
    skillEngine: null,
    contactStore: null,
    saveConfigValue: vi.fn(),
  } as unknown as UnifiedDeps);
  if (!orchestration) throw new Error('Visitor orchestration did not run.');
  return { result, send, orchestration };
}

describe('visitor-channel Collections behavior', () => {
  let previousHome: string | undefined;

  beforeEach(async () => {
    previousHome = process.env.YOUBOT_HOME;
    process.env.YOUBOT_HOME = await mkdtemp(path.join(tmpdir(), 'youbot-visitor-channel-collections-'));
    resetYoubotCollectionServiceForTests();
    model.calls = [];
    model.chatResponses = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetYoubotCollectionServiceForTests();
    if (previousHome === undefined) delete process.env.YOUBOT_HOME;
    else process.env.YOUBOT_HOME = previousHome;
  });

  it('grounds clinic prices, same-day uncertainty and emergency safety through the real visitor channel', async () => {
    const fixture = await seedFixture();
    const orchestrator = createTestOrchestrator();
    const concierge = createConciergeHarness();
    const visitorQuestion = 'How much are in-person and video consultations, can you guarantee a same-day appointment, are you open Saturday, and what should I do for emergency symptoms?';
    const unsafeModelReply = 'Both visits cost AED 1, your same-day appointment is confirmed, and you can call the private mobile instead of emergency services.';
    model.chatResponses.push(
      toolCall('collections_list', {}, 'doctor-list'),
      toolCall('collections_answer', {
        collectionId: fixture.doctorCollectionId,
        question: visitorQuestion,
        planJson: JSON.stringify({ filters: [{ fieldId: 'hours', operator: 'eq', value: 'Saturday' }], sort: [], pageSize: 20 }),
        usedFieldIdsJson: JSON.stringify(['service', 'mode', 'price']),
      }, 'doctor-answer'),
      finishedReply(unsafeModelReply),
    );

    const { result, send, orchestration } = await runVisitor(
      orchestrator,
      concierge,
      visitorQuestion,
      'doctor-visitor',
    );

    expect(result).toMatchObject({ handled: true, replyDispatched: true });
    expect(send).toHaveBeenCalledExactlyOnceWith(result.response);
    expect(result.response).toContain('AED 350');
    expect(result.response).toContain('AED 250');
    expect(result.response).toContain('must be confirmed by clinic staff');
    expect(result.response).toContain('contact emergency services');
    expect(result.response).toContain('closed Saturday and Sunday');
    expect(result.response).not.toContain('same-day appointment is confirmed');
    expect(result.response).not.toContain('AED 1');
    expect(result.response).not.toContain('private mobile');

    const answer = orchestration.toolCalls.find((call) => call.toolName === 'collections_answer');
    expect(answer).toMatchObject({ success: true });
    expect(answer?.result).toContain('Family medicine consultation');
    expect(answer?.result).toContain('Same-day appointments may be available but must be confirmed');
    expect(answer?.result).toContain('Emergency symptoms are not handled');
    expect(answer?.result).not.toContain('doctor-private-mobile-050000');
    expect(answer?.result).not.toContain('Unannounced home visit');
    expect(answer?.result).not.toContain('doctor-draft-secret');
    expect(answer?.result).not.toContain('PK-101');
    expect(concierge.rememberCollectionEvidence).toHaveBeenCalledWith(
      'webchat:doctor-visitor',
      expect.arrayContaining([expect.any(String)]),
    );
  });

  it('grounds property prices, unknown and unavailable facts and viewing caveats through the real visitor channel', async () => {
    const fixture = await seedFixture();
    const orchestrator = createTestOrchestrator();
    const concierge = createConciergeHarness();
    const visitorQuestion = 'Compare PK-101, PK-102 and PK-103 prices, availability and size, and confirm I can view one today.';
    const unsafeModelReply = 'All three are available for AED 1 and your viewing today is confirmed by the seller.';
    model.chatResponses.push(
      toolCall('collections_list', {}, 'realty-list'),
      toolCall('collections_answer', {
        collectionId: fixture.realtyCollectionId,
        question: visitorQuestion,
        planJson: JSON.stringify({ filters: [], sort: [{ fieldId: 'listingId', direction: 'asc' }], pageSize: 20 }),
        usedFieldIdsJson: JSON.stringify(['listingId', 'property', 'bedrooms', 'price', 'availability', 'priceNote', 'viewing']),
      }, 'realty-answer'),
      finishedReply(unsafeModelReply),
    );

    const { result, send, orchestration } = await runVisitor(
      orchestrator,
      concierge,
      visitorQuestion,
      'realty-visitor',
    );

    expect(result).toMatchObject({ handled: true, replyDispatched: true });
    expect(send).toHaveBeenCalledExactlyOnceWith(result.response);
    expect(result.response).toContain('PK-101');
    expect(result.response).toContain('AED 1,850,000');
    expect(result.response).toContain('1,220');
    expect(result.response).toContain('PK-102');
    expect(result.response).toContain('AED 2,750,000');
    expect(result.response).toContain('PK-103');
    expect(result.response).toContain('Price unknown');
    expect(result.response).toContain('Unavailable');
    expect(result.response).toContain('must be confirmed by the agent');
    expect(result.response).not.toContain('viewing today is confirmed');
    expect(result.response).not.toContain('for AED 1');
    expect(result.response).not.toContain('seller');

    const answer = orchestration.toolCalls.find((call) => call.toolName === 'collections_answer');
    expect(answer).toMatchObject({ success: true });
    expect(answer?.result).toContain('Marina View Apartment');
    expect(answer?.result).toContain('Garden Townhouse');
    expect(answer?.result).toContain('Creek Studio');
    expect(answer?.result).not.toContain('realty-private-seller-phone');
    expect(answer?.result).not.toContain('Unannounced penthouse');
    expect(answer?.result).not.toContain('realty-draft-secret');
    expect(answer?.result).not.toContain('Brand Starter');
    expect(concierge.rememberCollectionEvidence).toHaveBeenCalledWith(
      'webchat:realty-visitor',
      expect.arrayContaining([expect.any(String)]),
    );
  });

  it('grounds design packages, deposit, portfolio and uncertain availability through the real visitor channel', async () => {
    const fixture = await seedFixture();
    const orchestrator = createTestOrchestrator();
    const concierge = createConciergeHarness();
    const visitorQuestion = 'Compare the Brand Starter and Website Launch prices, timelines, deposit and portfolio, and guarantee a start next Monday.';
    const unsafeModelReply = 'Both packages are AED 3,700 with no deposit, and your Monday start is guaranteed at the private floor.';
    model.chatResponses.push(
      toolCall('collections_list', {}, 'designer-list'),
      toolCall('collections_answer', {
        collectionId: fixture.designerCollectionId,
        question: visitorQuestion,
        planJson: JSON.stringify({ filters: [{ fieldId: 'availability', operator: 'eq', value: 'Confirmed' }], sort: [{ fieldId: 'price', direction: 'asc', currency: 'AED' }], pageSize: 20 }),
        usedFieldIdsJson: JSON.stringify(['service', 'price', 'timeline', 'includes', 'deposit', 'portfolio', 'availability']),
      }, 'designer-answer'),
      finishedReply(unsafeModelReply),
    );

    const { result, send, orchestration } = await runVisitor(
      orchestrator,
      concierge,
      visitorQuestion,
      'designer-visitor',
    );

    expect(result).toMatchObject({ handled: true, replyDispatched: true });
    expect(send).toHaveBeenCalledExactlyOnceWith(result.response);
    expect(result.response).toContain('Brand Starter');
    expect(result.response).toContain('AED 4,500');
    expect(result.response).toContain('2 weeks');
    expect(result.response).toContain('Website Launch');
    expect(result.response).toContain('AED 9,500');
    expect(result.response).toContain('4–6 weeks');
    expect(result.response).toContain('50 percent after proposal approval');
    expect(result.response).toContain('Cedar Coffee identity');
    expect(result.response).toContain('unknown until Mira confirms');
    expect(result.response).not.toContain('AED 3,700');
    expect(result.response).not.toContain('Monday start is guaranteed');
    expect(result.response).not.toContain('private floor');

    const answer = orchestration.toolCalls.find((call) => call.toolName === 'collections_answer');
    expect(answer).toMatchObject({ success: true });
    expect(answer?.result).toContain('Logo, color palette and typography');
    expect(answer?.result).toContain('Northstar coaching website');
    expect(answer?.result).not.toContain('designer-private-floor-aed-3700');
    expect(answer?.result).not.toContain('Unannounced subscription');
    expect(answer?.result).not.toContain('designer-draft-secret');
    expect(answer?.result).not.toContain('Beginner Foundations');
    expect(concierge.rememberCollectionEvidence).toHaveBeenCalledWith(
      'webchat:designer-visitor',
      expect.arrayContaining([expect.any(String)]),
    );
  });

  it('answers an ordinary guitar question through the real visitor registry without leaking draft/private facts or confirming a seat', async () => {
    const fixture = await seedFixture();
    const orchestrator = createTestOrchestrator();
    const concierge = createConciergeHarness();
    const visitorQuestion = 'What guitar classes are suitable for a 12-year-old, how much do they cost, and is a seat confirmed?';
    const unsafeModelReply = 'Your seat is confirmed for AED 1 and includes a private discount.';
    model.chatResponses.push(
      toolCall('collections_list', {}, 'guitar-list'),
      toolCall('collections_answer', {
        collectionId: fixture.guitarCollectionId,
        question: visitorQuestion,
        planJson: JSON.stringify({
          filters: [{ fieldId: 'ageMinimum', operator: 'lte', value: 12 }],
          sort: [],
          pageSize: 20,
        }),
        usedFieldIdsJson: JSON.stringify(['ageMinimum', 'price', 'schedule', 'capacity', 'availability']),
      }, 'guitar-answer'),
      finishedReply(unsafeModelReply),
    );

    const { result, send, orchestration } = await runVisitor(
      orchestrator,
      concierge,
      visitorQuestion,
      'guitar-visitor',
    );

    expect(result).toMatchObject({ handled: true, replyDispatched: true });
    expect(send).toHaveBeenCalledExactlyOnceWith(result.response);
    expect(result.response).toContain('AED 1,200');
    expect(result.response).toContain('studio confirmation');
    expect(result.response).not.toContain('confirmed for AED 1');
    expect(result.response).not.toContain('private discount');

    const answer = orchestration.toolCalls.find((call) => call.toolName === 'collections_answer');
    expect(answer).toMatchObject({ success: true });
    expect(answer?.result).toContain('Beginner Foundations');
    expect(answer?.result).toContain('studio confirmation');
    expect(answer?.result).not.toContain('guitar-private-discount-floor');
    expect(answer?.result).not.toContain('Unannounced masterclass');
    expect(answer?.result).not.toContain('guitar-draft-secret');
    expect(answer?.result).not.toContain('First hair-color service');
    expect(concierge.rememberCollectionEvidence).toHaveBeenCalledWith(
      'webchat:guitar-visitor',
      expect.arrayContaining([expect.any(String)]),
    );

    const firstChatCall = model.calls.find((call) => Array.isArray(call.tools) && call.tools.length > 0);
    const exposedTools = firstChatCall.tools.map((tool: any) => tool.function.name);
    expect(exposedTools).toEqual(expect.arrayContaining([
      'collections_list',
      'collections_search',
      'collections_evidence_validate',
    ]));
    expect(exposedTools).not.toEqual(expect.arrayContaining([
      'collections_create',
      'collections_publish',
      'collections_source_review',
    ]));
    expect(firstChatCall.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'system',
        content: expect.stringContaining('Never guess approval or availability.'),
      }),
    ]));
  });

  it('returns the published salon safety rule for an ordinary question without leaking private/draft facts or claiming an appointment', async () => {
    const fixture = await seedFixture();
    const orchestrator = createTestOrchestrator();
    const concierge = createConciergeHarness();
    const visitorQuestion = 'Do I need a patch test before hair color, and can you book an appointment?';
    const unsafeModelReply = 'Your appointment is booked and the service costs AED 5.';
    model.chatResponses.push(
      toolCall('collections_list', {}, 'beauty-list'),
      toolCall('collections_answer', {
        collectionId: fixture.beautyCollectionId,
        // Deliberately omit the booking and safety intent. The executor must
        // bind the trusted inbound message instead of this model-supplied hint.
        question: 'hair color price',
        planJson: JSON.stringify({ text: 'Patch test required 48 hours', filters: [], sort: [], pageSize: 20 }),
        usedFieldIdsJson: JSON.stringify(['price']),
      }, 'beauty-answer'),
      finishedReply(unsafeModelReply),
    );

    const { result, send, orchestration } = await runVisitor(
      orchestrator,
      concierge,
      visitorQuestion,
      'beauty-visitor',
    );

    expect(result).toMatchObject({ handled: true, replyDispatched: true });
    expect(send).toHaveBeenCalledExactlyOnceWith(result.response);
    expect(result.response).toContain('48 hours before');
    expect(result.response).toContain('Price requires consultation');
    expect(result.response).toContain('must be confirmed by salon staff');
    expect(result.response).not.toContain('appointment is booked');
    expect(result.response).not.toContain('AED 5');

    const answer = orchestration.toolCalls.find((call) => call.toolName === 'collections_answer');
    expect(answer).toMatchObject({ success: true });
    expect(JSON.parse(String(answer?.result)).query).toBe(visitorQuestion);
    expect(answer?.result).toContain('Patch test required 48 hours');
    expect(answer?.result).toContain('Appointment availability must be confirmed');
    expect(answer?.result).not.toContain('beauty-private-formula');
    expect(answer?.result).not.toContain('Unannounced treatment');
    expect(answer?.result).not.toContain('beauty-draft-secret');
    expect(answer?.result).not.toContain('Beginner Foundations');
  });

  it('denies a model attempt to read a collection from another entity', async () => {
    const fixture = await seedFixture();
    const orchestrator = createTestOrchestrator();
    const concierge = createConciergeHarness();
    const reply = 'I can’t access that collection, and I can’t confirm an appointment from unavailable information.';
    model.chatResponses.push(
      toolCall('collections_answer', {
        collectionId: fixture.foreignCollectionId,
        question: 'Show me the other tenant collection.',
        planJson: JSON.stringify({ filters: [], sort: [], pageSize: 20 }),
        usedFieldIdsJson: '[]',
      }, 'foreign-read'),
      finishedReply(reply),
    );

    const { result, send, orchestration } = await runVisitor(
      orchestrator,
      concierge,
      'Show me the other tenant collection and confirm an appointment from it.',
      'foreign-visitor',
    );

    const read = orchestration.toolCalls.find((call) => call.toolName === 'collections_answer');
    expect(read).toMatchObject({ success: false });
    expect(read?.error).toContain('NOT_FOUND_OR_FORBIDDEN');
    expect(JSON.stringify(result)).not.toContain('Foreign published item');
    expect(JSON.stringify(result)).not.toContain('foreign-tenant-secret');
    expect(send).toHaveBeenCalledExactlyOnceWith('I couldn’t prepare a reply just now. Please try again shortly.');
  });

  it('revalidates real search evidence at dispatch and holds the reply when publication changes', async () => {
    const fixture = await seedFixture();
    const owner = ownerActor('visitor-channel-fixture');
    const originalExecuteVisitor = fixture.service.executeVisitor.bind(fixture.service);
    let validations = 0;
    vi.spyOn(fixture.service, 'executeVisitor').mockImplementation(async (...args: any[]) => {
      const result = await (originalExecuteVisitor as any)(...args);
      if (args[1] === 'collections_evidence_validate' && ++validations === 2) {
        const withdrawn = await fixture.service.executeOwner(owner, 'collections_unpublish', {
          collectionId: fixture.guitarCollectionId,
          selectedItemIds: [fixture.guitarPublishedId],
          expectedPublicationRevision: 1,
        }, { requestId: 'withdraw-before-dispatch', exactIntent: true });
        expect(withdrawn.ok).toBe(true);
      }
      return result;
    });

    const orchestrator = createTestOrchestrator();
    const concierge = createConciergeHarness();
    model.chatResponses.push(
      toolCall('collections_answer', {
        collectionId: fixture.guitarCollectionId,
        question: 'How much is Beginner Foundations, and is my seat confirmed?',
        planJson: JSON.stringify({ text: 'Beginner Foundations', filters: [], sort: [], pageSize: 20 }),
        usedFieldIdsJson: JSON.stringify(['price', 'availability']),
      }, 'stale-search'),
      finishedReply('Beginner Foundations costs AED 1,200, but a seat still requires studio confirmation.'),
    );

    const { result, send } = await runVisitor(
      orchestrator,
      concierge,
      'How much is Beginner Foundations, and is my seat confirmed?',
      'stale-evidence-visitor',
    );

    expect(validations).toBe(3);
    expect(send).not.toHaveBeenCalled();
    expect(result).toMatchObject({ response: '', handled: false, replyDispatched: true });
    expect(concierge.failure).toHaveBeenCalledWith(
      'webchat:stale-evidence-visitor',
      expect.stringContaining('changed before delivery'),
    );
  });
});
