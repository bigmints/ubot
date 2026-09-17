import { describe, it, expect, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { handleIncomingMessage, type UnifiedDeps } from './handler.js';
import { VISITOR_REPLY_UNAVAILABLE } from './visitor-reply.js';
import { channelActor, getYoubotCollectionService, ownerActor, resetYoubotCollectionServiceForTests } from '../concierge/collections/service.js';

type EvidenceState = { value?: { evidenceReceiptIds: string[]; updatedAt: string } };

function harness(content: string, inbox = true, toolCalls: any[] = [], evidenceState: EvidenceState = {}) {
  const send = vi.fn();
  const failure = vi.fn();
  const rememberCollectionEvidence = vi.fn(async (_id, evidenceReceiptIds) => {
    evidenceState.value = { evidenceReceiptIds, updatedAt: new Date().toISOString() };
  });
  const collectionEvidence = vi.fn(async () => evidenceState.value);
  const automatedReply = vi.fn(async (id, _revision, _text, dispatch) => {
    try {
      await dispatch();
      return true;
    } catch (error) {
      if ((error as Error).name === 'InboxDispatchHeld') {
        await failure(id, (error as Error).message);
        return false;
      }
      throw error;
    }
  });
  const deps = {
    concierge: inbox ? {
      receive: vi.fn().mockResolvedValue({thread:{revision:7,paused:false}}),
      failure, automatedReply, rememberCollectionEvidence, collectionEvidence,
    } : null,
    orchestrator: {getConfig:()=>({autoReplyWebchat:true}), chat:vi.fn().mockResolvedValue({content,toolCalls})},
    approvalStore:null,followUpStore:null,eventBus:null,skillEngine:null,contactStore:null,saveConfigValue:vi.fn(),
  } as unknown as UnifiedDeps;
  const incoming = {channel:'webchat' as const,senderId:'visitor-42',senderName:'Visitor',body:'Is Pretheesh open for freelance work?',timestamp:new Date(),replyFn:send};
  return {send,failure,automatedReply,rememberCollectionEvidence,collectionEvidence,run:()=>handleIncomingMessage(incoming,deps)};
}

describe('visitor dispatch defense',()=>{
  it.each([true,false])('does not dispatch internal deliberation (inbox=%s)',async inbox=>{
    const h=harness('The visitor asked about freelance work. I should escalate to the owner. requester_jid is missing.',inbox);
    expect(await h.run()).toMatchObject({response:VISITOR_REPLY_UNAVAILABLE,replyDispatched:true,handled:false});
    expect(h.send).toHaveBeenCalledExactlyOnceWith(VISITOR_REPLY_UNAVAILABLE);
    if(inbox)expect(h.failure).toHaveBeenCalledWith('webchat:visitor-42',expect.stringContaining('held'));
  });
  it('does not send even the fixed failure notice after owner takeover', async () => {
    const h = harness('');
    h.automatedReply.mockResolvedValueOnce(false);
    expect(await h.run()).toMatchObject({ response: '', replyDispatched: true });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.failure).toHaveBeenCalled();
  });
  it('dispatches finished text through the existing revision-checked inbox path',async()=>{
    const text='I can’t confirm Pretheesh’s availability. What kind of project do you have in mind?';
    const h=harness(text);expect(await h.run()).toMatchObject({response:text,replyDispatched:true});
    expect(h.automatedReply).toHaveBeenCalledWith('webchat:visitor-42',7,text,expect.any(Function));
    expect(h.send).toHaveBeenCalledExactlyOnceWith(text);expect(h.failure).not.toHaveBeenCalled();
  });
  it('holds a finished answer when its collection evidence is withdrawn before dispatch', async () => {
    const priorHome = process.env.YOUBOT_HOME;
    process.env.YOUBOT_HOME = await mkdtemp(path.join(tmpdir(), 'youbot-dispatch-evidence-'));
    resetYoubotCollectionServiceForTests();
    try {
      const service = await getYoubotCollectionService();
      const owner = ownerActor('dispatch-test');
      const created = await service.executeOwner(owner, 'collections_create', {
        name: 'Dispatch facts',
        schema: [{ id: 'title', label: 'Title', type: 'string', public: true }],
      }, { requestId: 'dispatch-create' });
      const collectionId = String(created.ok && (created.data as any).collectionId);
      const proposed = await service.executeOwner(owner, 'collections_change_propose', {
        collectionId, expectedRevision: 1,
        operations: [{ kind: 'create_item', values: { title: 'Available today' } }],
      }, { requestId: 'dispatch-propose' });
      const proposalId = String(proposed.ok && (proposed.data as any).id);
      await service.executeOwner(owner, 'collections_change_apply', {
        proposalId, expectedRevision: 1,
      }, { requestId: 'dispatch-apply' });
      const state = await service.executeOwner(owner, 'collections_get', { collectionId });
      const itemId = String(state.ok && (state.data as any).itemIds[0]);
      const review = await service.executeOwner(owner, 'collections_get', { collectionId, selectedItemIds: [itemId] });
      await service.executeOwner(owner, 'collections_publish', {
        collectionId, selectedItemIds: [itemId], expectedPublicationRevision: 0,
        reviewedPayloadHash: review.ok && (review.data as any).publicationReview.reviewedPayloadHash,
      }, { requestId: 'dispatch-publish', exactIntent: true });
      const search = await service.executeVisitor(
        channelActor('visitor', 'webchat:visitor-42', 'webchat'),
        'collections_search', { collectionIds: [collectionId], text: 'Available' },
      );
      expect(search.ok).toBe(true);
      const executeVisitor = service.executeVisitor.bind(service);
      let validationChecks = 0;
      vi.spyOn(service, 'executeVisitor').mockImplementation(async (...args: any[]) => {
        const result = await (executeVisitor as any)(...args);
        if (args[1] === 'collections_evidence_validate' && ++validationChecks === 1) {
          const withdrawn = await service.executeOwner(owner, 'collections_unpublish', {
            collectionId, selectedItemIds: [itemId], expectedPublicationRevision: 1,
          }, { requestId: 'dispatch-unpublish', exactIntent: true });
          expect(withdrawn.ok).toBe(true);
        }
        return result;
      });

      const text = 'The published catalogue says this is available today.';
      const h = harness(text, true, [{
        toolName: 'collections_answer', success: true, result: JSON.stringify({
          answer: text,
          limitations: [],
          evidenceReceiptIds: [search.ok && search.evidence?.id],
        }), duration: 0,
      }]);
      expect(await h.run()).toMatchObject({ response: '', handled: false, replyDispatched: true });
      expect(h.send).not.toHaveBeenCalled();
      expect(h.automatedReply).toHaveBeenCalledTimes(1);
      expect(validationChecks).toBe(2);
      expect(h.failure).toHaveBeenCalledWith('webchat:visitor-42', expect.stringContaining('changed before delivery'));
    } finally {
      if (priorHome === undefined) delete process.env.YOUBOT_HOME;
      else process.env.YOUBOT_HOME = priorHome;
      resetYoubotCollectionServiceForTests();
    }
  });

  it('holds a no-tool reply when durable session evidence became stale', async () => {
    const priorHome = process.env.YOUBOT_HOME;
    process.env.YOUBOT_HOME = await mkdtemp(path.join(tmpdir(), 'youbot-session-evidence-'));
    resetYoubotCollectionServiceForTests();
    try {
      const service = await getYoubotCollectionService();
      const owner = ownerActor('session-test');
      const created = await service.executeOwner(owner, 'collections_create', {
        name: 'Session facts', schema: [{ id: 'title', label: 'Title', type: 'string', public: true }],
      }, { requestId: 'session-create' });
      const collectionId = String(created.ok && (created.data as any).collectionId);
      const proposed = await service.executeOwner(owner, 'collections_change_propose', {
        collectionId, expectedRevision: 1,
        operations: [{ kind: 'create_item', values: { title: 'Morning class' } }],
      }, { requestId: 'session-propose' });
      const proposalId = String(proposed.ok && (proposed.data as any).id);
      await service.executeOwner(owner, 'collections_change_apply', { proposalId, expectedRevision: 1 }, { requestId: 'session-apply' });
      const state = await service.executeOwner(owner, 'collections_get', { collectionId });
      const itemId = String(state.ok && (state.data as any).itemIds[0]);
      const review = await service.executeOwner(owner, 'collections_get', { collectionId, selectedItemIds: [itemId] });
      await service.executeOwner(owner, 'collections_publish', {
        collectionId, selectedItemIds: [itemId], expectedPublicationRevision: 0,
        reviewedPayloadHash: review.ok && (review.data as any).publicationReview.reviewedPayloadHash,
      }, { requestId: 'session-publish', exactIntent: true });
      const search = await service.executeVisitor(
        channelActor('visitor', 'webchat:visitor-42', 'webchat'),
        'collections_search', { collectionIds: [collectionId], text: 'Morning' },
      );
      expect(search.ok).toBe(true);
      const evidenceState: EvidenceState = {};
      const first = harness('The morning class is listed.', true, [{
        toolName: 'collections_answer', success: true, result: JSON.stringify({
          answer: 'The morning class is listed.',
          limitations: [],
          evidenceReceiptIds: [search.ok && search.evidence?.id],
        }), duration: 0,
      }], evidenceState);
      expect(await first.run()).toMatchObject({ response: 'The morning class is listed.', handled: true });
      expect(first.send).toHaveBeenCalledTimes(1);
      expect(evidenceState.value?.evidenceReceiptIds).toEqual([search.ok && search.evidence?.id]);

      await service.executeOwner(owner, 'collections_unpublish', {
        collectionId, selectedItemIds: [itemId], expectedPublicationRevision: 1,
      }, { requestId: 'session-unpublish', exactIntent: true });
      const repeated = harness('Yes, that schedule remains available.', true, [], evidenceState);
      expect(await repeated.run()).toMatchObject({ response: '', handled: false, replyDispatched: true });
      expect(repeated.send).not.toHaveBeenCalled();
      expect(repeated.automatedReply).not.toHaveBeenCalled();
      expect(repeated.failure).toHaveBeenCalledWith('webchat:visitor-42', expect.stringContaining('changed before delivery'));
    } finally {
      if (priorHome === undefined) delete process.env.YOUBOT_HOME;
      else process.env.YOUBOT_HOME = priorHome;
      resetYoubotCollectionServiceForTests();
    }
  });
});
