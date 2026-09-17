import { describe, it, expect, vi } from 'vitest';
import { startFollowUpChecker, visitorFollowUpChannel } from './checker.js';

async function runFollowup(content: string, approval = false, throws = false) {
  const f={id:'test-only',contactId:'webchat:visitor-42',sessionId:'webchat:visitor-42',channel:'web',reason:'Requested update',context:'Freelance inquiry',createdAt:new Date(),followUpAt:new Date(),attempts:0,maxAttempts:3,priority:'normal',...(approval?{approvalId:'a-1'}:{})};
  const complete=vi.fn(),recordAttempt=vi.fn(),send=vi.fn().mockResolvedValue(true);
  const chat=throws?vi.fn().mockRejectedValue(Error('test provider failure')):vi.fn().mockResolvedValue({content});
  const store={getDue:vi.fn().mockResolvedValue([f]),complete,recordAttempt,expire:vi.fn()};
  const approvalStore=approval?{getById:vi.fn().mockResolvedValue({status:'resolved',question:'Availability?',ownerResponse:'PRIVATE OWNER SOURCE TEXT'})}:undefined;
  const stop=startFollowUpChecker({followUpStore:store as never,approvalStore:approvalStore as never,chat,sendMessage:send});
  try {await vi.waitFor(()=>expect(complete.mock.calls.length+recordAttempt.mock.calls.length).toBe(1));}
  finally {stop();}
  return {send,complete,recordAttempt,chat};
}

describe('scheduled visitor reply boundary',()=>{
  it.each([false,true])('holds plain deliberation without dispatch (approval=%s)',async approval=>{
    const h=await runFollowup('Let me reconsider. The visitor asked about freelance work. Hello!',approval);
    expect(h.send).not.toHaveBeenCalled();expect(h.complete).not.toHaveBeenCalled();expect(h.recordAttempt).toHaveBeenCalledTimes(1);
  });
  it('does not send the raw owner response when generation fails',async()=>{
    const h=await runFollowup('',true,true);expect(h.send).not.toHaveBeenCalled();expect(h.complete).not.toHaveBeenCalled();
  });
  it.each([false,true])('sends only parsed final text (approval=%s)',async approval=>{
    const text='Pretheesh would like to see your project outline.';
    const h=await runFollowup(JSON.stringify({reply:text}),approval);
    expect(h.send).toHaveBeenCalledExactlyOnceWith('web','webchat:visitor-42',text);expect(h.complete).toHaveBeenCalledTimes(1);
  });
  it('keeps exact scheduler controls out of visitor messages',async()=>{
    const h=await runFollowup('[NO_ACTION_NEEDED]');expect(h.send).not.toHaveBeenCalled();expect(h.complete).toHaveBeenCalledTimes(1);
  });
});

it('normalizes legacy webchat followups without converting owner web or WhatsApp targets',()=>{
  expect(visitorFollowUpChannel({channel:'web',contactId:'webchat:visitor-42'})).toBe('webchat');
  expect(visitorFollowUpChannel({channel:'web',contactId:'web-console'})).toBe('web');
  expect(visitorFollowUpChannel({channel:'whatsapp',contactId:'42@s.whatsapp.net'})).toBe('whatsapp');
});
