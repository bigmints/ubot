import { isVisitorFacingReply } from '../engine/visitor-reply.js';
import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseConnection } from '../data/database/types.js';

export type VisitorChannel = 'whatsapp' | 'telegram' | 'webchat';
export interface InboxThread {
  id: string; name: string; channel: VisitorChannel; address: string;
  incomingVersion: number; readVersion: number; handled: boolean; paused: boolean;
  revision: number; createdAt: string; updatedAt: string; lastIncomingAt: string;
  lastError: string | null; unread: boolean; preview: string;
  approvals: number; overdue: number; status: 'needs' | 'handled' | 'active';
}
export interface InboxMessage {
  id: string; threadId: string; speaker: 'visitor' | 'concierge' | 'owner';
  content: string; channel: string; timestamp: string; delivery: string;
  requestId: string | null; attachments: unknown[];
}
interface ThreadRow {
  id: string; name: string; channel: VisitorChannel; address: string;
  incoming_version: number; read_version: number; handled: number; paused: number;
  revision: number; created_at: string; updated_at: string; last_incoming_at: string;
  last_error: string | null; preview?: string; approvals?: number; overdue?: number;
}
interface MessageRow { id: string; thread_id: string; speaker: InboxMessage['speaker']; body: string; channel: string; created_at: string; delivery: string; request_id: string | null; attachments: string | unknown[] | null }
export class InboxConflict extends Error { constructor(message: string, public status = 409) { super(message); } }

export class InboxDispatchHeld extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InboxDispatchHeld';
  }
}

export type CollectionSessionEvidence = {
  evidenceReceiptIds: string[];
  updatedAt: string;
};

/** One instance per database/process. The mutex covers transport dispatch + ownership changes,
 * not slow model generation. Revision checks discard pre-takeover model results. */
export class ConciergeStore {
  readonly ready: Promise<void>;
  private lanes = new Map<string, Promise<unknown>>();
  constructor(readonly db: DatabaseConnection) { this.ready = this.initialize(); }
  private async initialize() {
    await this.db.execute(`CREATE TABLE IF NOT EXISTS youbot_inbox_threads (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, channel TEXT NOT NULL, address TEXT NOT NULL,
      incoming_version INTEGER NOT NULL DEFAULT 0, read_version INTEGER NOT NULL DEFAULT 0,
      handled INTEGER NOT NULL DEFAULT 0, paused INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_incoming_at TEXT NOT NULL, last_error TEXT
    )`);
    await this.db.execute(`CREATE TABLE IF NOT EXISTS youbot_inbox_messages (
      id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, speaker TEXT NOT NULL, body TEXT NOT NULL,
      channel TEXT NOT NULL, created_at TEXT NOT NULL, delivery TEXT NOT NULL,
      request_id TEXT UNIQUE, attachments TEXT
    )`);
    await this.db.execute('CREATE INDEX IF NOT EXISTS idx_inbox_messages_thread ON youbot_inbox_messages(thread_id, created_at)');
    await this.db.execute(`CREATE TABLE IF NOT EXISTS youbot_collection_session_evidence (
      session_id TEXT PRIMARY KEY,
      evidence_receipt_ids TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    await this.db.execute('CREATE TABLE IF NOT EXISTS youbot_inbox_meta (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
    // A durable outbox entry survives a crash. Never automatically resend an uncertain operation.
    await this.db.execute("UPDATE youbot_inbox_threads SET last_error = 'A reply was interrupted. Delivery is unknown; check the messaging app before retrying.' WHERE id IN (SELECT thread_id FROM youbot_inbox_messages WHERE delivery = 'sending')");
    await this.db.execute("UPDATE youbot_inbox_messages SET delivery = 'unknown' WHERE delivery = 'sending'");
    if (!await this.db.get("SELECT id FROM youbot_inbox_meta WHERE id = 'legacy-import'")) {
      // Import once: legacy assistant history records generation, not transport delivery.
      const sessions = await this.db.query<{ id: string; name: string; type: VisitorChannel; created_at: string; updated_at: string }>("SELECT * FROM youbot_chat_sessions WHERE type IN ('whatsapp','telegram','webchat') AND id <> 'web-console'");
      for (const s of sessions) {
        const identities = await this.db.query<{ platform_id: string }>('SELECT platform_id FROM youbot_contact_identities WHERE contact_id = ? AND channel = ?', [s.id, s.type]);
        let address = identities.length === 1 ? identities[0].platform_id : '';
        if (!address && s.type === 'whatsapp' && /^\d+@(s\.whatsapp\.net|g\.us|lid)$/.test(s.id)) address = s.id;
        if (!address && s.type === 'telegram' && /^(telegram:)?-?\d+$/.test(s.id)) address = s.id.replace(/^telegram:/, '');
        const history = await this.db.query<{ id: string; role: string; content: string; timestamp: string; metadata: unknown }>("SELECT * FROM youbot_chat_messages WHERE session_id = ? AND role IN ('user','assistant') ORDER BY timestamp", [s.id]);
        if (!history.length) continue;
        const incoming = history.filter(m => m.role === 'user');
        await this.db.execute('INSERT INTO youbot_inbox_threads (id,name,channel,address,incoming_version,created_at,updated_at,last_incoming_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING', [s.id, s.name || 'Visitor', s.type, address, incoming.length, s.created_at, s.updated_at, incoming.at(-1)?.timestamp || s.updated_at]);
        for (const m of history) await this.db.execute('INSERT INTO youbot_inbox_messages (id,thread_id,speaker,body,channel,created_at,delivery) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING', [`history-${m.id}`, s.id, m.role === 'user' ? 'visitor' : 'concierge', m.content || '', s.type, m.timestamp, m.role === 'user' ? 'received' : 'historical']);
      }
      await this.db.execute("INSERT INTO youbot_inbox_meta (id,value) VALUES ('legacy-import',?) ON CONFLICT(id) DO NOTHING", [new Date().toISOString()]);
    }
  }
  async locked<T>(id: string, action: () => Promise<T>): Promise<T> {
    await this.ready;
    const previous = this.lanes.get(id) || Promise.resolve();
    const current = previous.catch(() => {}).then(action);
    this.lanes.set(id, current);
    try { return await current; } finally { if (this.lanes.get(id) === current) this.lanes.delete(id); }
  }
  private map(row: ThreadRow): InboxThread {
    const approvals = Number(row.approvals || 0), overdue = Number(row.overdue || 0);
    const needs = !!row.last_error || approvals > 0 || overdue > 0 || (!!row.paused && !row.handled);
    return { id: row.id, name: row.name, channel: row.channel, address: row.address,
      incomingVersion: row.incoming_version, readVersion: row.read_version,
      handled: !!row.handled, paused: !!row.paused, revision: row.revision,
      createdAt: row.created_at, updatedAt: row.updated_at, lastIncomingAt: row.last_incoming_at,
      lastError: row.last_error, unread: row.incoming_version > row.read_version,
      preview: row.preview || '', approvals, overdue, status: needs ? 'needs' : row.handled ? 'handled' : 'active' };
  }
  private projection = `SELECT t.*,
    (SELECT body FROM youbot_inbox_messages m WHERE m.thread_id=t.id ORDER BY created_at DESC, id DESC LIMIT 1) AS preview,
    (SELECT COUNT(*) FROM youbot_pending_approvals a WHERE a.session_id=t.id AND a.status='pending') AS approvals,
    (SELECT COUNT(*) FROM youbot_follow_ups f WHERE (f.session_id=t.id OR f.contact_id=t.id) AND f.status='pending' AND f.follow_up_at <= ?) AS overdue
    FROM youbot_inbox_threads t`;
  async get(id: string): Promise<InboxThread | null> {
    await this.ready;
    const row = await this.db.get<ThreadRow>(this.projection + ' WHERE t.id = ?', [new Date().toISOString(), id]);
    return row ? this.map(row) : null;
  }
  async list(options: { search?: string; channel?: string; filter?: string; offset?: number; limit?: number } = {}) {
    await this.ready;
    const params: unknown[] = [new Date().toISOString()];
    const clauses: string[] = [];
    if (options.channel && options.channel !== 'all') { clauses.push('t.channel = ?'); params.push(options.channel); }
    if (options.search?.trim()) {
      clauses.push("(LOWER(t.name) LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM youbot_inbox_messages m WHERE m.thread_id=t.id AND LOWER(m.body) LIKE ? ESCAPE '\\'))");
      const query = `%${options.search.trim().toLowerCase().replace(/[\\%_]/g, '\\$&')}%`;
      params.push(query, query);
    }
    const base = this.projection + (clauses.length ? ' WHERE ' + clauses.join(' AND ') : '');
    const filter = options.filter === 'unread' ? 'incoming_version > read_version'
      : options.filter === 'needs' ? "(last_error IS NOT NULL OR approvals > 0 OR overdue > 0 OR (paused=1 AND handled=0))"
      : options.filter === 'handled' ? '(handled=1 AND last_error IS NULL AND approvals=0 AND overdue=0)' : '1=1';
    const count = await this.db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM (${base}) projected WHERE ${filter}`, params);
    const rows = await this.db.query<ThreadRow>(`SELECT * FROM (${base}) projected WHERE ${filter} ORDER BY updated_at DESC,id LIMIT ? OFFSET ?`, [...params, options.limit || 50, options.offset || 0]);
    return { threads: rows.map(row => this.map(row)), total: Number(count?.count || 0) };
  }
  async invalidateChannel(channel: string) {
    await this.ready;
    const rows = await this.db.query<{id:string}>('SELECT id FROM youbot_inbox_threads WHERE channel=?', [channel]);
    await Promise.all(rows.map(row => this.locked(row.id, () => this.db.execute('UPDATE youbot_inbox_threads SET revision=revision+1 WHERE id=?', [row.id]))));
  }
  async findTarget(channel: string, address: string) {
    await this.ready;
    const rows = await this.db.query<{id:string}>('SELECT id FROM youbot_inbox_threads WHERE channel=? AND address=?', [channel,address]);
    return rows.length === 1 ? this.get(rows[0].id) : null;
  }
  async messages(id: string, before?: string) {
    await this.ready;
    const rows = await this.db.query<MessageRow>(`SELECT * FROM youbot_inbox_messages WHERE thread_id=? ${before ? 'AND (created_at,id) < (SELECT created_at,id FROM youbot_inbox_messages WHERE id=? AND thread_id=?)' : ''} ORDER BY created_at DESC,id DESC LIMIT 201`, before ? [id, before, id] : [id]);
    const hasMore = rows.length > 200;
    return { messages: rows.slice(0, 200).reverse().map(row => this.message(row)), hasMore };
  }
  private message(row: MessageRow): InboxMessage {
    let attachments: unknown[] = [];
    try { attachments = typeof row.attachments === 'string' ? JSON.parse(row.attachments) : row.attachments || []; } catch { /* Legacy metadata can be invalid. */ }
    return { id: row.id, threadId: row.thread_id, speaker: row.speaker, content: row.body, channel: row.channel, timestamp: row.created_at, delivery: row.delivery, requestId: row.request_id, attachments };
  }
  async receive(input: { id: string; channel: VisitorChannel; address: string; name: string; content: string; messageId?: string; attachments?: unknown[] }) {
    return this.locked(input.id, async () => {
      const eventId = input.messageId ? createHash('sha256').update(`${input.channel}:${input.address}:${input.messageId}`).digest('hex') : randomUUID();
      if (await this.db.get('SELECT id FROM youbot_inbox_messages WHERE id=?', [eventId])) { await this.reconcile(input.id); return { duplicate: true, thread: (await this.get(input.id))! }; }
      const now = new Date().toISOString();
      await this.db.execute(`INSERT INTO youbot_inbox_threads (id,name,channel,address,created_at,updated_at,last_incoming_at) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET revision=CASE WHEN youbot_inbox_threads.channel<>excluded.channel OR youbot_inbox_threads.address<>excluded.address THEN youbot_inbox_threads.revision+1 ELSE youbot_inbox_threads.revision END,name=excluded.name,channel=excluded.channel,address=excluded.address`, [input.id, input.name || 'Visitor', input.channel, input.address, now, now, now]);
      await this.db.execute('INSERT INTO youbot_inbox_messages (id,thread_id,speaker,body,channel,created_at,delivery,attachments) VALUES (?,?,?,?,?,?,?,?)', [eventId, input.id, 'visitor', input.content, input.channel, now, 'received', JSON.stringify(input.attachments || [])]);
      await this.reconcile(input.id);
      return { duplicate: false, thread: (await this.get(input.id))! };
    });
  }
  private async reconcile(id: string) {
    await this.db.execute(`UPDATE youbot_inbox_threads SET handled=CASE WHEN incoming_version < (SELECT COUNT(*) FROM youbot_inbox_messages WHERE thread_id=? AND speaker='visitor') THEN 0 ELSE handled END,
      incoming_version=(SELECT COUNT(*) FROM youbot_inbox_messages WHERE thread_id=? AND speaker='visitor'),
      last_incoming_at=(SELECT MAX(created_at) FROM youbot_inbox_messages WHERE thread_id=? AND speaker='visitor'),
      updated_at=(SELECT MAX(created_at) FROM youbot_inbox_messages WHERE thread_id=?) WHERE id=?`, [id,id,id,id,id]);
  }
  async read(id: string, seenVersion: number) {
    await this.ready;
    await this.db.execute('UPDATE youbot_inbox_threads SET read_version=CASE WHEN read_version < ? AND incoming_version >= ? THEN ? ELSE read_version END WHERE id=?', [seenVersion, seenVersion, seenVersion, id]);
  }
  async control(id: string, action: 'takeover' | 'handback' | 'handled' | 'reopen', expectedVersion?: number) {
    return this.locked(id, async () => {
      const t = await this.get(id); if (!t) throw new InboxConflict('Conversation not found.', 404);
      if (action === 'handled' && (t.incomingVersion !== expectedVersion || t.approvals || t.overdue || t.lastError)) throw new InboxConflict('There is a new message or an unresolved item. Review the thread before marking it handled.');
      if (action === 'takeover' || action === 'handback') await this.db.execute('UPDATE youbot_inbox_threads SET paused=?,revision=revision+1 WHERE id=?', [action === 'takeover' ? 1 : 0, id]);
      else await this.db.execute('UPDATE youbot_inbox_threads SET handled=?,revision=revision+1 WHERE id=?', [action === 'handled' ? 1 : 0, id]);
      return this.get(id);
    });
  }
  async failure(id: string, message: string) { await this.ready; await this.db.execute('UPDATE youbot_inbox_threads SET last_error=? WHERE id=?', [message, id]); }
  async collectionEvidence(id: string): Promise<CollectionSessionEvidence | undefined> {
    await this.ready;
    const row = await this.db.get<{
      evidence_receipt_ids: string | string[];
      updated_at: string;
    }>('SELECT evidence_receipt_ids,updated_at FROM youbot_collection_session_evidence WHERE session_id=?', [id]);
    if (!row) return undefined;
    try {
      return {
        evidenceReceiptIds: Array.isArray(row.evidence_receipt_ids)
          ? row.evidence_receipt_ids
          : JSON.parse(row.evidence_receipt_ids),
        updatedAt: row.updated_at,
      };
    } catch {
      return undefined;
    }
  }
  async rememberCollectionEvidence(
    id: string,
    evidenceReceiptIds: string[],
  ): Promise<void> {
    await this.ready;
    const now = new Date().toISOString();
    await this.db.execute(`INSERT INTO youbot_collection_session_evidence
      (session_id,evidence_receipt_ids,updated_at) VALUES (?,?,?)
      ON CONFLICT(session_id) DO UPDATE SET
        evidence_receipt_ids=excluded.evidence_receipt_ids,
        updated_at=excluded.updated_at`, [
      id,
      JSON.stringify([...new Set(evidenceReceiptIds)]),
      now,
    ]);
  }
  async automatedReply(id: string, revision: number, content: string, send: () => Promise<unknown>) {
    return this.locked(id, async () => {
      const t = await this.get(id); if (!t || t.paused || t.revision !== revision) return false;
      if (!isVisitorFacingReply(content)) {
        await this.failure(id, 'An automated reply was held because it was not finished visitor-facing text. Review this conversation.');
        return false;
      }
      try {
        await this.dispatch(t, 'concierge', content, send, null);
        return true;
      } catch (error) {
        if (error instanceof InboxDispatchHeld) return false;
        throw error;
      }
    });
  }
  async ownerReply(id: string, content: string, requestId: string, channel: string, send: (thread: InboxThread) => Promise<unknown>, expectedVersion?: number, validate?: (thread: InboxThread) => void) {
    return this.locked(id, async () => {
      const prior = await this.db.get<MessageRow>('SELECT * FROM youbot_inbox_messages WHERE request_id=?', [requestId]);
      if (prior) {
        if (prior.thread_id !== id || prior.body !== content || prior.channel !== channel) throw new InboxConflict('This reply reference was already used for a different message.');
        return this.message(prior);
      }
      const t = await this.get(id); if (!t) throw new InboxConflict('Conversation not found.', 404);
      if (!t.paused) throw new InboxConflict('Take over this conversation before replying.');
      if (t.channel !== channel) throw new InboxConflict('The visitor used another channel. Reload the conversation before replying.');
      if (expectedVersion !== undefined && t.incomingVersion !== expectedVersion) throw new InboxConflict('A new message arrived. Review it before sending.');
      validate?.(t);
      return this.dispatch(t, 'owner', content, () => send(t), requestId);
    });
  }
  private async dispatch(t: InboxThread, speaker: 'owner' | 'concierge', body: string, send: () => Promise<unknown>, requestId: string | null) {
    const id = randomUUID(), now = new Date().toISOString();
    await this.db.execute('INSERT INTO youbot_inbox_messages (id,thread_id,speaker,body,channel,created_at,delivery,request_id) VALUES (?,?,?,?,?,?,?,?)', [id, t.id, speaker, body, t.channel, now, 'sending', requestId]);
    try {
      await send();
      if (speaker === 'owner') await this.db.execute('INSERT INTO youbot_chat_messages (id,session_id,role,content,timestamp,metadata) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING', [`inbox-${id}`, t.id, 'assistant', body, now, JSON.stringify({ source: t.channel, sentBy: 'owner' })]);
      await this.db.execute("UPDATE youbot_inbox_messages SET delivery='sent' WHERE id=?", [id]);
      await this.db.execute('UPDATE youbot_inbox_threads SET updated_at=? WHERE id=?', [new Date().toISOString(), t.id]);
    } catch (error) {
      if (error instanceof InboxDispatchHeld) {
        await this.db.execute('DELETE FROM youbot_inbox_messages WHERE id=?', [id]);
        await this.failure(t.id, error.message);
        throw error;
      }
      await this.db.execute("UPDATE youbot_inbox_messages SET delivery='unknown' WHERE id=?", [id]);
      await this.failure(t.id, 'We could not confirm this reply was sent. Check the messaging app before trying again.');
      throw new InboxConflict('The reply may have been sent. Its delivery is unknown. Check the conversation before sending again.', 502);
    }
    return this.message((await this.db.get<MessageRow>('SELECT * FROM youbot_inbox_messages WHERE id=?', [id]))!);
  }
}
const stores = new WeakMap<DatabaseConnection, ConciergeStore>();
export function getConciergeStore(db: DatabaseConnection) { let store = stores.get(db); if (!store) { store = new ConciergeStore(db); stores.set(db, store); } return store; }
