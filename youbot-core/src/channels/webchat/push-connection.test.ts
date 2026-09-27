import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebchatConnection } from './connection.js';
class FakeSocket extends EventTarget {
  static instances: FakeSocket[] = [];
  closed = false;
  answerPing = true;
  sent: string[] = [];
  send(data: string) { this.sent.push(data); if (data === 'ping' && this.answerPing) this.dispatchEvent(new MessageEvent('message', { data: 'pong' })); }
  constructor(readonly url: URL) { super(); FakeSocket.instances.push(this); }
  close() { if (!this.closed) { this.closed = true; this.dispatchEvent(new Event('close')); } }
  message(type: string) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type }) })); }
}
const message = { id: 'message-1', session: 'visitor', name: 'Visitor', message: 'Hello' };
let connection: WebchatConnection;
let poll: ReturnType<typeof vi.fn>, reply: ReturnType<typeof vi.fn>, ticket: ReturnType<typeof vi.fn>, fetcher: ReturnType<typeof vi.fn>;
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
beforeEach(() => {
  vi.useFakeTimers(); FakeSocket.instances = [];
  poll = vi.fn(async () => Response.json({ messages: [] }));
  reply = vi.fn(async () => Response.json({ ok: true }));
  ticket = vi.fn(async () => Response.json({ ticket: 'single-use-ticket' }));
  fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/health')) return Response.json({ capabilities: { botPush: true, sessionReplies: true } });
    if (url.endsWith('/socket-ticket')) return ticket();
    if (url.endsWith('/poll')) return poll(options);
    if (url.endsWith('/reply')) return reply();
    throw new Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', fetcher); vi.stubGlobal('WebSocket', FakeSocket);
  connection = new WebchatConnection({ relayUrl: 'https://relay.test/tenant-one', botSecret: 'private-secret' });
});
afterEach(async () => { await connection.disconnect(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function ready() {
  await connection.connect(); await flush();
  const socket = FakeSocket.instances.at(-1)!; socket.message('ready'); await flush(); return socket;
}
describe('push webchat connection', () => {
  it('uses scoped headers and a ticket and never polls while idle', async () => {
    const socket = await ready();
    expect(socket.url.toString()).toBe('wss://relay.test/tenant-one/api/bot/events?ticket=single-use-ticket');
    expect(fetcher).toHaveBeenCalledWith('https://relay.test/tenant-one/api/bot/socket-ticket', expect.objectContaining({ method: 'POST', headers: { 'X-Bot-Secret': 'private-secret' } }));
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120000);
    expect(poll).toHaveBeenCalledTimes(1); expect(connection.status).toBe('connected');
    expect(connection.supportsSessionReplies).toBe(true);
    expect(fetcher.mock.calls.every(([url]) => !url.includes('secret='))).toBe(true);
  });
  it('drains notifications and skips duplicate in-flight messages', async () => {
    const receive = vi.fn(); connection.on('message.received', receive); const socket = await ready();
    poll.mockResolvedValueOnce(Response.json({ messages: [message] })).mockResolvedValueOnce(Response.json({ messages: [message] }));
    socket.message('messages_available'); await flush();
    expect(receive).toHaveBeenCalledTimes(1); expect(poll).toHaveBeenCalledTimes(4);
  });
  it('preserves notifications that arrive during an empty queue fetch', async () => {
    const socket = await ready(); let resolve!: (value: Response) => void;
    poll.mockImplementationOnce(() => new Promise<Response>(r => { resolve = r; }));
    socket.message('messages_available'); await flush(); socket.message('messages_available');
    resolve(Response.json({ messages: [] })); await flush(); expect(poll).toHaveBeenCalledTimes(3);
  });
  it('reconnects with a fresh ticket and recovers missed messages', async () => {
    const receive = vi.fn(); connection.on('message.received', receive); const socket = await ready();
    socket.close(); await flush(); expect(connection.status).toBe('connecting');
    await vi.advanceTimersByTimeAsync(2000); poll.mockResolvedValueOnce(Response.json({ messages: [message] }));
    FakeSocket.instances.at(-1)!.message('ready'); await flush();
    expect(ticket).toHaveBeenCalledTimes(2); expect(receive).toHaveBeenCalledWith(message);
  });
  it('cancels drain and retries on disconnect and supports a new connection', async () => {
    const socket = await ready(); let resolve!: (value: Response) => void;
    poll.mockImplementationOnce(() => new Promise<Response>(r => { resolve = r; }));
    const receive = vi.fn(); connection.on('message.received', receive);
    socket.message('messages_available'); await flush(); const signal = poll.mock.calls.at(-1)![0].signal;
    await connection.disconnect(); expect(signal.aborted).toBe(true);
    resolve(Response.json({ messages: [message] })); await flush(); await vi.advanceTimersByTimeAsync(60000);
    expect(receive).not.toHaveBeenCalled(); expect(ticket).toHaveBeenCalledTimes(1); expect(connection.status).toBe('disconnected');
    await ready(); expect(connection.status).toBe('connected'); expect(ticket).toHaveBeenCalledTimes(2);
  });
  it.each([{}, { status: 401 }])('retries invalid tickets without polling fallback: %s', async options => {
    ticket.mockResolvedValueOnce(Response.json({}, options)); const error = vi.fn(); connection.on('error', error);
    await connection.connect(); await flush(); expect(error).toHaveBeenCalledTimes(1); expect(poll).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000); expect(FakeSocket.instances).toHaveLength(1);
    FakeSocket.instances[0].message('ready'); await flush(); expect(connection.status).toBe('connected');
  });
  it('recovers failed queue fetches by reconnecting', async () => {
    const socket = await ready(); poll.mockResolvedValueOnce(Response.json({}, { status: 503 }));
    socket.message('messages_available'); await flush(); expect(socket.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(2000); FakeSocket.instances.at(-1)!.message('ready'); await flush();
    expect(poll).toHaveBeenCalledTimes(3);
  });
  it('times out a socket that never becomes ready', async () => {
    await connection.connect(); await flush(); await vi.advanceTimersByTimeAsync(10000);
    expect(FakeSocket.instances[0].closed).toBe(true); expect(poll).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000); expect(ticket).toHaveBeenCalledTimes(2);
  });
  it('retries lost receipts with the same ID and retains in-flight suppression', async () => {
    const receive = vi.fn(); connection.on('message.received', receive);
    poll.mockResolvedValueOnce(Response.json({ messages: [message] })); const socket = await ready();
    reply.mockRejectedValueOnce(new Error('lost receipt')); const sending = connection.respond(message.id, 'Reply'); await flush();
    poll.mockResolvedValueOnce(Response.json({ messages: [message] })); socket.message('messages_available'); await flush();
    expect(receive).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(1000); await sending;
    expect(reply).toHaveBeenCalledTimes(2);
    const requests = fetcher.mock.calls.filter(([url]) => url.endsWith('/reply'));
    expect(requests[0][1].body).toEqual(requests[1][1].body);
  });
  it('throws on unconfirmed replies and keeps in-flight suppression', async () => {
    const receive = vi.fn(); connection.on('message.received', receive);
    poll.mockResolvedValueOnce(Response.json({ messages: [message] })); const socket = await ready();
    reply.mockImplementation(async () => Response.json({ ok: false }));
    const rejection = expect(connection.respond(message.id, 'Reply')).rejects.toThrow('receipt');
    await vi.advanceTimersByTimeAsync(3000); await rejection;
    poll.mockResolvedValueOnce(Response.json({ messages: [message] })); socket.message('messages_available'); await flush();
    expect(receive).toHaveBeenCalledTimes(1);
  });
  it('reports asynchronous message handler failures without an unhandled rejection', async () => {
    const failure = new Error('Reply persistence failed');
    const error = vi.fn(); connection.on('error', error);
    connection.on('message.received', async () => { throw failure; });
    poll.mockResolvedValueOnce(Response.json({ messages: [message] }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await ready(); await flush();
    expect(error).toHaveBeenCalledWith(failure);
    log.mockRestore();
  });
  it('checks socket liveness through auto-response without polling and cancels heartbeat timers', async () => {
    const socket = await ready();
    await vi.advanceTimersByTimeAsync(90000);
    expect(socket.sent).toEqual(['ping', 'ping', 'ping']);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(ticket).toHaveBeenCalledTimes(1);
    await connection.disconnect();
    await vi.advanceTimersByTimeAsync(120000);
    expect(socket.sent).toHaveLength(3);
    expect(ticket).toHaveBeenCalledTimes(1);
  });
  it('reconnects a half-open socket when its pong deadline passes and drains missed work', async () => {
    const socket = await ready(); socket.answerPing = false;
    await vi.advanceTimersByTimeAsync(39999);
    expect(socket.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(ticket).toHaveBeenCalledTimes(2);
    const receive = vi.fn(); connection.on('message.received', receive);
    poll.mockResolvedValueOnce(Response.json({ messages: [message] }));
    FakeSocket.instances.at(-1)!.message('ready'); await flush();
    expect(receive).toHaveBeenCalledWith(message);
    expect(connection.status).toBe('connected');
  });
  it('recovers exhausted reply retries from its outbox without regenerating the response', async () => {
    const receive = vi.fn(); connection.on('message.received', receive);
    poll.mockResolvedValueOnce(Response.json({ messages: [message] }));
    const socket = await ready();
    reply.mockImplementation(async () => Response.json({}, { status: 503 }));
    const failed = expect(connection.respond(message.id, 'Stable answer')).rejects.toThrow('503');
    await vi.advanceTimersByTimeAsync(3000); await failed;
    poll.mockResolvedValueOnce(Response.json({ messages: [message] }));
    socket.message('messages_available'); await flush();
    expect(receive).toHaveBeenCalledTimes(1);
    reply.mockImplementation(async () => Response.json({ ok: true }));
    await vi.advanceTimersByTimeAsync(10000);
    expect(reply).toHaveBeenCalledTimes(4);
    const requests = fetcher.mock.calls.filter(([url]) => url.endsWith('/reply'));
    expect(new Set(requests.map(([, options]) => options.body)).size).toBe(1);
    await vi.advanceTimersByTimeAsync(60000); expect(reply).toHaveBeenCalledTimes(4);
  });
  it('reconnect flushes the stable reply outbox and disconnect pauses its retry timers', async () => {
    await ready(); reply.mockImplementation(async () => Response.json({}, { status: 503 }));
    const failed = expect(connection.respond(message.id, 'Stable answer')).rejects.toThrow('503');
    await vi.advanceTimersByTimeAsync(3000); await failed;
    await connection.disconnect(); await vi.advanceTimersByTimeAsync(60000);
    expect(reply).toHaveBeenCalledTimes(3);
    reply.mockImplementation(async () => Response.json({ ok: true }));
    await ready(); await flush(); expect(reply).toHaveBeenCalledTimes(4);
  });
  it('allows a failed processor to reclaim a message without losing delivery failures', async () => {
    const failure = new Error('Processing failed');
    const receive = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    connection.on('message.received', receive);
    poll.mockResolvedValueOnce(Response.json({ messages: [message] }));
    const socket = await ready(); await flush();
    poll.mockResolvedValueOnce(Response.json({ messages: [message] }));
    socket.message('messages_available'); await flush();
    expect(receive).toHaveBeenCalledTimes(2); log.mockRestore();
  });
  it('keeps a rejected completed reply out of processor redelivery', async () => {
    reply.mockImplementation(async () => Response.json({}, { status: 503 }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const receive = vi.fn(async () => { await connection.respond(message.id, 'Stable answer'); });
    connection.on('message.received', receive);
    poll.mockResolvedValueOnce(Response.json({ messages: [message] }));
    const socket = await ready(); await vi.advanceTimersByTimeAsync(3000);
    poll.mockResolvedValueOnce(Response.json({ messages: [message] }));
    socket.message('messages_available'); await flush();
    expect(receive).toHaveBeenCalledTimes(1); log.mockRestore();
  });
  it('recovers startup DNS/health failure into push mode without changing the relay URL', async () => {
    fetcher.mockRejectedValueOnce(new Error('DNS not propagated'));
    await expect(connection.connect()).rejects.toThrow('DNS not propagated');
    expect(connection.status).toBe('error');
    await vi.advanceTimersByTimeAsync(1999); expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); await flush();
    expect(FakeSocket.instances).toHaveLength(1);
    FakeSocket.instances[0].message('ready'); await flush();
    expect(connection.status).toBe('connected');
    await vi.advanceTimersByTimeAsync(120000);
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/health'))).toHaveLength(2);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls.every(([url]) => url.startsWith('https://relay.test/tenant-one/'))).toBe(true);
  });
  it('cancels failed startup retries on disconnect', async () => {
    fetcher.mockResolvedValueOnce(Response.json({}, { status: 404 }));
    await expect(connection.connect()).rejects.toThrow('404');
    await connection.disconnect(); await vi.advanceTimersByTimeAsync(120000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(connection.status).toBe('disconnected'); expect(FakeSocket.instances).toHaveLength(0);
  });
  it('explicit reconnect cancels the older startup timer and does not open duplicate sockets', async () => {
    fetcher.mockRejectedValueOnce(new Error('DNS not propagated'));
    await expect(connection.connect()).rejects.toThrow('DNS');
    await ready(); await vi.advanceTimersByTimeAsync(120000);
    expect(ticket).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/health'))).toHaveLength(2);
  });
  it('uses bounded startup backoff and aborts an in-progress retry without stale status changes', async () => {
    const error = vi.fn(); connection.on('error', error);
    fetcher.mockRejectedValueOnce(new Error('Unavailable'))
      .mockRejectedValueOnce(new Error('Still unavailable'));
    await expect(connection.connect()).rejects.toThrow('Unavailable');
    await vi.advanceTimersByTimeAsync(2000); expect(error).toHaveBeenCalledTimes(1);
    let resolve!: (value: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise<Response>(r => { resolve = r; }));
    await vi.advanceTimersByTimeAsync(3999);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    const signal = fetcher.mock.calls.at(-1)![1].signal;
    await connection.disconnect(); expect(signal.aborted).toBe(true);
    resolve(Response.json({ capabilities: { botPush: true } })); await flush();
    await vi.advanceTimersByTimeAsync(120000);
    expect(connection.status).toBe('disconnected'); expect(ticket).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('cannot start receiving after a disconnected initial health body resolves', async () => {
    let resolve!: (value: unknown) => void;
    fetcher.mockResolvedValueOnce({ ok: true, json: () => new Promise(r => { resolve = r; }) });
    const connecting = connection.connect(); await flush();
    await connection.disconnect();
    resolve({ capabilities: { botPush: true } }); await connecting;
    await vi.advanceTimersByTimeAsync(120000);
    expect(connection.status).toBe('disconnected'); expect(ticket).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not retry an unsupported WebSocket runtime', async () => {
    vi.stubGlobal('WebSocket', undefined);
    await expect(connection.connect()).rejects.toThrow('Node.js 22');
    await vi.advanceTimersByTimeAsync(120000);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(connection.status).toBe('error');
  });
  it('retains polling for old relays', async () => {
    fetcher.mockImplementationOnce(async () => Response.json({ capabilities: { sessionReplies: true } }));
    await connection.connect(); await flush(); expect(FakeSocket.instances).toHaveLength(0); expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000); expect(poll).toHaveBeenCalledTimes(2);
  });
});
