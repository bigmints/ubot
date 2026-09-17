import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteConnection } from '../../data/database/sqlite.js';
import { ConciergeStore } from '../store.js';
import { createApprovalStore } from '../../automation/approvals/service.js';
import { createToolRegistry } from '../../engine/tools.js';
import approvalsModule from '../../automation/approvals/tools.js';
import { createMockContext } from '../../tools/__tests__/test-helpers.js';
import { handleIncomingMessage, type UnifiedDeps } from '../../engine/handler.js';
import { VISITOR_REPLY_UNAVAILABLE } from '../../engine/visitor-reply.js';
let db:SQLiteConnection, store:ConciergeStore, directory:string;
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'youbot-visitor-safety-'));db=new SQLiteConnection({config:{path:join(directory,'test.sqlite')}});store=new ConciergeStore(db);await store.ready;});
afterEach(async()=>{await db.close();await rm(directory,{recursive:true,force:true});});

describe('persisted visitor safety evidence',()=>{
  it('persists the visitor question and safe fallback without leaking the rejected draft',async()=>{
    const send=vi.fn();
    const deps={concierge:store,orchestrator:{getConfig:()=>({autoReplyWebchat:true}),chat:vi.fn().mockResolvedValue({content:'The visitor asked about freelance work. I should escalate. requester_jid is missing.',toolCalls:[]})},approvalStore:null,followUpStore:null,eventBus:null,skillEngine:null,contactStore:null,saveConfigValue:vi.fn()} as unknown as UnifiedDeps;
    await handleIncomingMessage({channel:'webchat',senderId:'visitor-42',senderName:'Visitor',body:'Open for freelance work?',timestamp:new Date(),replyFn:send},deps);
    expect(send).toHaveBeenCalledExactlyOnceWith(VISITOR_REPLY_UNAVAILABLE);
    expect((await store.messages('webchat:visitor-42')).messages.map(m=>({speaker:m.speaker,content:m.content}))).toEqual([
      {speaker:'visitor',content:'Open for freelance work?'},
      {speaker:'concierge',content:VISITOR_REPLY_UNAVAILABLE},
    ]);
    expect(JSON.stringify(await store.messages('webchat:visitor-42'))).not.toContain('requester_jid');
    expect((await store.get('webchat:visitor-42'))?.lastError).toContain('held');
  });
  it('records and resolves a real SQLite approval for the trusted webchat conversation',async()=>{
    const approvalStore=createApprovalStore(db),ctx=createMockContext();
    ctx.getApprovalStore=()=>approvalStore;ctx.getFollowUpStore=()=>null;
    const reply='Pretheesh would like to review a short project outline.';
    const hostAgent=ctx.getAgent();ctx.getAgent=()=>({...hostAgent,generate:vi.fn().mockResolvedValue(JSON.stringify({reply}))});
    const relay=vi.fn().mockResolvedValue(true);ctx.relayMessage=relay;
    const registry=createToolRegistry();approvalsModule.register(registry,ctx);
    expect((await registry.execute({toolName:'ask_owner',rawText:'',arguments:{question:'Open for freelance work?',context:'Project inquiry',requester_jid:'wrong-person'}},{isOwner:false,sessionId:'webchat:visitor-42'})).success).toBe(true);
    const [pending]=await approvalStore.getPending();
    expect(pending).toMatchObject({question:'Open for freelance work?',requesterJid:'webchat:visitor-42',sessionId:'webchat:visitor-42',status:'pending'});
    expect((await registry.execute({toolName:'respond_to_approval',rawText:'',arguments:{approval_id:pending.id,response:'I can review a short outline.'}},{isOwner:true,sessionId:'web-console'})).success).toBe(true);
    expect(await approvalStore.getById(pending.id)).toMatchObject({status:'resolved',ownerResponse:'I can review a short outline.'});
    expect(relay).toHaveBeenCalledExactlyOnceWith('webchat:visitor-42',reply);
  });
});

it('shared automated dispatch blocks a raw skill-stage leak before outbox persistence',async()=>{
  const {thread}=await store.receive({id:'webchat:skill-visitor',name:'Visitor',channel:'webchat',address:'skill-visitor',content:'Freelance inquiry'});
  const send=vi.fn();
  expect(await store.automatedReply(thread.id,thread.revision,'Let me reconsider. The visitor asked about freelance work. requester_jid is missing.',send)).toBe(false);
  expect(send).not.toHaveBeenCalled();
  expect((await store.messages(thread.id)).messages).toHaveLength(1);
  expect((await store.get(thread.id))?.lastError).toContain('held');
});
