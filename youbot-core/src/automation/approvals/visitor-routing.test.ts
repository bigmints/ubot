import { describe, it, expect, vi } from 'vitest';
import approvalsModule from './tools.js';
import { createToolRegistry } from '../../engine/tools.js';
import { createMockContext } from '../../tools/__tests__/test-helpers.js';

function harness() {
  const ctx = createMockContext();
  const create = vi.fn().mockResolvedValue({id:'approval-local-proof'});
  ctx.getApprovalStore = () => ({create});
  ctx.getFollowUpStore = () => null;
  const registry = createToolRegistry();
  approvalsModule.register(registry,ctx);
  return {registry,create};
}

describe('trusted visitor approval return routing',()=>{
  it.each(['webchat:visitor-42','telegram:42','447700900001@s.whatsapp.net'])('binds %s and ignores a forged return address',async sessionId=>{
    const h=harness();
    const result=await h.registry.execute({toolName:'ask_owner',rawText:'',arguments:{question:'Open for freelance work?',context:'A visitor has a project inquiry.',requester_jid:'victim@example.com'}},{isOwner:false,sessionId});
    expect(result.success).toBe(true);
    expect(h.create).toHaveBeenCalledExactlyOnceWith({question:'Open for freelance work?',context:'A visitor has a project inquiry.',requesterJid:sessionId,sessionId});
    expect(result.result).toContain('Request recorded');
    expect(result.result).not.toContain('has been notified');
  });
  it('works without a visitor name, contact details or model-supplied JID',async()=>{
    const h=harness();
    const result=await h.registry.execute({toolName:'ask_owner',rawText:'',arguments:{question:'Open for freelance work?',context:'Project inquiry'}},{isOwner:false,sessionId:'webchat:anonymous'});
    expect(result.success).toBe(true);expect(h.create.mock.calls[0][0].requesterJid).toBe('webchat:anonymous');
  });
  it('refuses an unbound visitor even when the model supplies an address',async()=>{
    const h=harness();const result=await h.registry.execute({toolName:'ask_owner',rawText:'',arguments:{question:'Availability?',requester_jid:'somebody-else'}},{isOwner:false});
    expect(result.success).toBe(false);expect(h.create).not.toHaveBeenCalled();
  });
});

describe('approved visitor response dispatch',()=>{
  function responseHarness(draft: string, sharedRoute = true) {
    const ctx=createMockContext();
    const approval={id:'a-1',status:'pending',question:'Open for freelance work?',requesterJid:'webchat:visitor-42'};
    ctx.getApprovalStore=()=>({getById:vi.fn().mockResolvedValue(approval),resolve:vi.fn()});
    const relay=vi.fn().mockResolvedValue(true),whatsapp=vi.fn(),telegram=vi.fn();
    ctx.getAgent=()=>({generate:vi.fn().mockResolvedValue(draft)});
    ctx.getWhatsApp=()=>({isConnected:true,sendMessage:whatsapp});
    ctx.getTelegram=()=>({sendMessage:telegram});
    if(sharedRoute)ctx.relayMessage=relay;
    const registry=createToolRegistry();approvalsModule.register(registry,ctx);
    return {relay,whatsapp,telegram,run:()=>registry.execute({toolName:'respond_to_approval',rawText:'',arguments:{approval_id:'a-1',response:'I can review a short project outline.'}})};
  }
  it('uses the trusted webchat return route and only a validated final reply',async()=>{
    const text='Pretheesh can review a short project outline.';
    const h=responseHarness(JSON.stringify({reply:text}));const result=await h.run(); expect(result.error).toBeUndefined(); expect(result.success).toBe(true);
    expect(h.relay).toHaveBeenCalledExactlyOnceWith('webchat:visitor-42',text);
    expect(h.whatsapp).not.toHaveBeenCalled();expect(h.telegram).not.toHaveBeenCalled();
  });
  it('never converts a webchat ID into a WhatsApp destination when shared routing is absent',async()=>{
    const h=responseHarness('{"reply":"Please share a project outline."}',false);
    expect((await h.run()).success).toBe(false);expect(h.whatsapp).not.toHaveBeenCalled();expect(h.telegram).not.toHaveBeenCalled();
  });
  it('does not send owner-approval drafts containing deliberation',async()=>{
    const h=responseHarness('{"reply":"The visitor asked about freelance work. I should ask the owner."}');
    expect((await h.run()).success).toBe(false);expect(h.relay).not.toHaveBeenCalled();expect(h.whatsapp).not.toHaveBeenCalled();
  });
});

it('schedules a visitor approval follow-up on the webchat channel',async()=>{
  const ctx=createMockContext();
  ctx.getApprovalStore=()=>({create:vi.fn().mockResolvedValue({id:'a-1'})});
  const create=vi.fn().mockResolvedValue({id:'f-1'});ctx.getFollowUpStore=()=>({create});
  const registry=createToolRegistry();approvalsModule.register(registry,ctx);
  expect((await registry.execute({toolName:'ask_owner',rawText:'',arguments:{question:'Open for freelance work?',context:'Project inquiry'}},{isOwner:false,sessionId:'webchat:visitor-42'})).success).toBe(true);
  expect(create).toHaveBeenCalledWith(expect.objectContaining({channel:'webchat',sessionId:'webchat:visitor-42',contactId:'webchat:visitor-42'}));
});
