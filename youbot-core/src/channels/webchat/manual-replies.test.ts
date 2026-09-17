import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebchatConnection } from './connection.js';
import { replyAvailability, sendVisitorReply } from '../../api/routes/concierge.js';
import type { ApiContext } from '../../api/context.js';
import type { InboxThread } from '../../concierge/store.js';

const connections: WebchatConnection[] = [];
afterEach(async () => { for (const connection of connections.splice(0)) await connection.disconnect(); vi.unstubAllGlobals(); });
const thread = { id: 'contact-uuid', channel: 'webchat', address: 'wc_browser-session' } as InboxThread;

async function connect(capable = true, sendResponse: () => Response = () => Response.json({ ok: true, requestId: 'manual-request-00001' })) {
  const fetcher = vi.fn((url: string, options?: RequestInit) => {
    if (url.endsWith('/health')) return Promise.resolve(Response.json({ capabilities: { sessionReplies: capable } }));
    if (url.endsWith('/api/bot/send')) return Promise.resolve(sendResponse());
    return new Promise<Response>((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  });
  vi.stubGlobal('fetch', fetcher);
  const connection = new WebchatConnection({ relayUrl: 'https://relay.test/tenant-a', botSecret: 'scoped-test-secret' });
  connections.push(connection);
  await connection.connect();
  return { connection, fetcher, ctx: { webchatConnection: connection } as ApiContext };
}

describe('website manual reply transport', () => {
  it('uses the verified browser address, scoped credential and stable request ID', async () => {
    const { ctx, fetcher } = await connect();
    expect(replyAvailability(ctx, thread)).toBeNull();
    await sendVisitorReply(ctx, thread, 'Owner response', 'manual-request-00001');
    expect(fetcher).toHaveBeenCalledWith('https://relay.test/tenant-a/api/bot/send', expect.objectContaining({
      headers: expect.objectContaining({ 'X-Bot-Secret': 'scoped-test-secret' }),
      body: JSON.stringify({ session: 'wc_browser-session', response: 'Owner response', requestId: 'manual-request-00001' }),
    }));
  });
  it('blocks disconnected, older relay and unverified address threads', async () => {
    expect(replyAvailability({} as ApiContext, thread)).toContain('Reconnect');
    const { ctx, fetcher } = await connect(false);
    expect(replyAvailability(ctx, thread)).toContain('Update');
    await expect(sendVisitorReply(ctx, thread, 'Hello')).rejects.toThrow('Update');
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/send'))).toHaveLength(0);
    expect(replyAvailability(ctx, { ...thread, address: '' })).toContain('verified');
  });
  it.each([404, 409, 500])('does not claim delivery for HTTP %s', async status => {
    const { ctx } = await connect(true, () => Response.json({ error: 'Rejected' }, { status }));
    await expect(sendVisitorReply(ctx, thread, 'Hello')).rejects.toThrow('not confirmed');
  });
  it('rejects an absent or mismatched delivery receipt', async () => {
    const { ctx } = await connect(true, () => Response.json({ ok: true, requestId: 'another-request' }));
    await expect(sendVisitorReply(ctx, thread, 'Hello', 'manual-request-00001')).rejects.toThrow('receipt');
  });
});
