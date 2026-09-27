import { Readable } from 'node:stream';
import { describe, it, expect, vi } from 'vitest';
import type { ApiContext } from '../context.js';
import { authenticate, setApiKeysForTesting, type AuthResult } from '../middleware/auth.js';
import { canAccessApiRoute, resolveChatSession } from '../middleware/access.js';
vi.mock('../../engine/handler.js', () => ({ getProcessingSessions: () => [] }));
import { handleChatRoutes } from './chat.js';

const alice: AuthResult = { authenticated: true, clientId: 'key-alice', clientName: 'same name', scopes: ['chat'], isOwner: false };
const bob: AuthResult = { ...alice, clientId: 'key-bob' };
const owner: AuthResult = { authenticated: true, isOwner: true };
const aliceId = resolveChatSession(alice, 'thread')!;
const bobId = resolveChatSession(bob, 'thread')!;
function context(auth = alice) {
  const store = {
    listSessions: vi.fn(async () => [{ id: 'web-console' }, { id: aliceId }, { id: bobId }]),
    getHistory: vi.fn(async (id: string) => [{ content: id === 'web-console' ? 'owner secret' : id }]),
    clearSession: vi.fn(async () => {}), deleteSession: vi.fn(async () => {}), renameSession: vi.fn(async () => {}),
    createSession: vi.fn(async (id: string) => ({ id })),
  };
  return { auth, agentOrchestrator: { getConversationStore: () => store, getConfig: vi.fn(), chat: vi.fn(async () => ({content:'hello'})) },
    asyncJobStore: { get: vi.fn(async (id: string) => ({ id, sessionId: id === 'alice-job' ? aliceId : bobId, result: 'job result' })) },
  } as unknown as ApiContext;
}
async function call(ctx: ApiContext, method: string, url: string, body?: unknown) {
  const req = Object.assign(Readable.from(body === undefined ? [] : [JSON.stringify(body)]), { url });
  const capture = { status: 0, body: undefined as any };
  const res = { writeHead: (status: number) => { capture.status = status; }, end: (value: string) => { capture.body = JSON.parse(value); } };
  expect(await handleChatRoutes(req as any, res as any, url.split('?')[0], method, ctx)).toBe(true);
  return capture;
}

describe('chat client authorization', () => {
  it('denies configuration, credentials, uploads, provider discovery and channel messages before accessing data', async () => {
    const ctx = context();
    for (const [method, url] of [['GET','/api/chat/config'],['PUT','/api/chat/config'],['GET','/api/chat/uploads/private.pdf'],['GET','/api/llm-providers'],['GET','/api/llm-providers/models'],['GET','/api/whatsapp/messages'],['GET','/api/chat/processing']]) {
      expect((await call(ctx, method, url, {})).status).toBe(403);
    }
    expect(ctx.agentOrchestrator!.getConfig).not.toHaveBeenCalled();
  });
  it('lists only own sessions and honors query IDs without exposing owner or foreign history', async () => {
    const ctx = context();
    expect((await call(ctx,'GET','/api/chat/sessions')).body.sessions).toEqual([{id:aliceId}]);
    for (const id of ['thread', aliceId, 'web-console', bobId]) {
      const r = await call(ctx,'GET',`/api/chat/history?sessionId=${encodeURIComponent(id)}`);
      expect(r.status).toBe(200);
      expect(ctx.agentOrchestrator!.getConversationStore().getHistory).toHaveBeenLastCalledWith(resolveChatSession(alice,id),50);
      expect(r.body.messages[0].content).not.toBe('owner secret');
      expect(r.body.messages[0].content).not.toBe(bobId);
    }
  });
  it('isolates clear, rename, delete and create operations', async () => {
    const ctx = context(); const store = ctx.agentOrchestrator!.getConversationStore();
    await call(ctx,'POST','/api/chat/clear',{sessionId:'web-console'});
    expect(store.clearSession).toHaveBeenCalledWith(resolveChatSession(alice,'web-console'));
    await call(ctx,'PUT','/api/chat/sessions',{sessionId:bobId,name:'changed'});
    expect(store.renameSession).toHaveBeenCalledWith(resolveChatSession(alice,bobId),'changed');
    await call(ctx,'POST','/api/chat/sessions/delete',{sessionId:bobId});
    expect(store.deleteSession).toHaveBeenCalledWith(resolveChatSession(alice,bobId));
    const created = await call(ctx,'POST','/api/chat/sessions',{name:'new'});
    expect(resolveChatSession(alice,created.body.session.id)).toBe(created.body.session.id);
    expect((await call(ctx,'POST','/api/chat/sessions/delete',{sessionId:123})).status).toBe(400);
  });
  it('checks the owning session when polling jobs', async () => {
    const ctx=context();
    expect((await call(ctx,'GET','/api/chat/job/alice-job')).status).toBe(200);
    expect((await call(ctx,'GET','/api/chat/job/bob-job')).status).toBe(404);
  });
  it('preserves owner visibility and mutation IDs', async () => {
    const ctx=context(owner);
    expect((await call(ctx,'GET','/api/chat/sessions')).body.sessions).toHaveLength(3);
    expect((await call(ctx,'GET','/api/chat/history?sessionId=web-console')).body.messages[0].content).toBe('owner secret');
    await call(ctx,'POST','/api/chat/clear',{sessionId:bobId});
    expect(ctx.agentOrchestrator!.getConversationStore().clearSession).toHaveBeenCalledWith(bobId);
  });
  it('fails closed for missing identity or wrong scopes; blocks direct administrative routes', () => {
    for (const auth of [undefined, {...alice,clientId:undefined}, {...alice,scopes:['tools']}, {...alice,authenticated:false}]) {
      expect(canAccessApiRoute(auth,'POST','/api/chat')).toBe(false);
    }
    for(const route of ['/api/shutdown','/api/logs','/api/auth/profile','/api/auth/password','/api/config/model-routing','/api/chat/config']) {
      expect(canAccessApiRoute(alice,'POST',route)).toBe(false);
      expect(canAccessApiRoute(owner,'POST',route)).toBe(true);
    }
  });
  it('uses credential identity instead of colliding key display names', () => {
    setApiKeysForTesting([{key:'one-test-key',name:'same name'},{key:'other-test-key',name:'same name'}]);
    const first=authenticate({headers:{authorization:'Bearer one-test-key'}} as any);
    const second=authenticate({headers:{authorization:'Bearer other-test-key'}} as any);
    expect(first.clientId).toBeTruthy();
    expect(first.clientId).not.toBe(second.clientId);
    expect(resolveChatSession(first,'thread')).not.toBe(resolveChatSession(second,'thread'));
  });
});
