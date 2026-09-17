/**
 * WhatsApp Messaging Provider
 * Wraps the existing WhatsApp adapter to implement the MessagingProvider interface.
 */

import type {
  MessagingProvider,
  Message,
  Contact,
  Conversation,
  MessageFilter,
  SendOptions,
  ConnectionStatus,
  MessagingProviderEvents,
} from '../types.js';
import type { WhatsAppConnection } from './connection.js';
import type { WASocket, WAMessage, AnyMessageContent } from '@whiskeysockets/baileys';

interface SocketStore {
  contacts: Record<string, { name?: string; notify?: string; isBlocked?: boolean }>;
  chats: Record<string, unknown>;
  messages?: Record<string, WAMessage[]>;
}

interface ExtendedWASocket extends WASocket {
  store?: SocketStore;
}

/** In-memory message store for search/history */
const messageStore: Message[] = [];
const MAX_STORED_MESSAGES = 1000;

function addToStore(msg: Message): void {
  messageStore.push(msg);
  if (messageStore.length > MAX_STORED_MESSAGES) {
    messageStore.shift();
  }
}

export class WhatsAppMessagingProvider implements MessagingProvider {
  readonly channel = 'whatsapp' as const;
  private _status: ConnectionStatus = 'disconnected';
  private eventListeners = new Map<string, Set<Function>>();
  private connection: WhatsAppConnection;

  constructor(connection: WhatsAppConnection) {
    this.connection = connection;
    this.setupForwarding();
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  private get socket(): ExtendedWASocket | null {
    return this.connection.getSocket() as ExtendedWASocket | null;
  }

  /** Forward connection events to MessagingProvider events */
  private setupForwarding(): void {
    this.connection.on('connection.update', (status, qrCode) => {
      // Map WhatsApp statuses to our generic ones
      const mapped: ConnectionStatus =
        status === 'connected' ? 'connected'
        : status === 'connecting' ? 'connecting'
        : status === 'reconnecting' ? 'reconnecting'
        : 'disconnected';
      this._status = mapped;
      this.emit('connection', mapped, { qr: qrCode });
    });

    this.connection.on('message.received', (waMsg) => {
      const msg: Message = {
        id: waMsg.id || `wa_${Date.now()}`,
        channel: 'whatsapp',
        from: waMsg.from || '',
        to: waMsg.to || '',
        body: waMsg.body || '',
        timestamp: waMsg.timestamp instanceof Date ? waMsg.timestamp : new Date(),
        isFromMe: waMsg.isFromMe ?? false,
        hasMedia: waMsg.hasMedia ?? false,
        mediaUrl: waMsg.mediaUrl,
        mediaType: waMsg.mediaType,
        replyToId: waMsg.quotedMessageId,
      };
      addToStore(msg);
      this.emit('message', msg);
    });

    this.connection.on('error', (error) => {
      this.emit('error', error);
    });
  }

  // --- Connection ---

  async connect(): Promise<void> {
    await this.connection.connect();
  }

  async disconnect(): Promise<void> {
    await this.connection.disconnect();
  }

  // --- Core Operations ---

  async sendMessage(to: string, body: string, opts?: SendOptions): Promise<Message> {
    const socket = this.socket;
    if (!socket) throw new Error('WhatsApp not connected');

    const jid = this.normalizeJid(to);
    
    let content: AnyMessageContent;
    
    if (opts?.mediaType) {
      const mediaSource = opts.mediaUrl 
        ? { url: opts.mediaUrl } 
        : opts.mediaPath 
          ? { url: opts.mediaPath } 
          : opts.mediaBase64 
            ? Buffer.from(opts.mediaBase64, 'base64') 
            : null;
      
      if (!mediaSource) {
        throw new Error("Media source (path, url, or base64) is required when mediaType is specified");
      }

      // fallback body to caption if no explicit caption is provided (except audio docs)
      const caption = opts.caption || (body ? body : undefined);
      
      switch (opts.mediaType) {
        case 'image':
          content = { image: mediaSource, caption };
          break;
        case 'video':
          content = { video: mediaSource, caption, mimetype: opts.mimetype };
          break;
        case 'audio':
          content = { audio: mediaSource, mimetype: opts.mimetype || 'audio/mp4', ptt: opts.ptt };
          break;
        case 'document':
          content = { document: mediaSource, mimetype: opts.mimetype || 'application/octet-stream', fileName: opts.fileName || 'Attachment', caption };
          break;
        default:
          content = { text: body };
      }
    } else {
      content = { text: body };
    }

    if (opts?.replyToId) {
      (content as any).contextInfo = { stanzaId: opts.replyToId, participant: jid };
    }

    const sent = await this.connection.sendMessage(jid, content);
    if (!sent?.key?.id) throw new Error('Failed to send message');

    const msg: Message = {
      id: sent.key.id,
      channel: 'whatsapp',
      from: 'me',
      to: jid,
      body,
      timestamp: new Date(),
      isFromMe: true,
      hasMedia: false,
      replyToId: opts?.replyToId,
    };
    addToStore(msg);
    return msg;
  }

  async searchMessages(filter: MessageFilter): Promise<Message[]> {
    let results = [...messageStore];

    if (filter.from) {
      const normalizedFrom = this.normalizeJid(filter.from);
      results = results.filter(m =>
        m.from === filter.from ||
        m.from === normalizedFrom ||
        m.from.includes(filter.from!.replace(/\D/g, ''))
      );
    }
    if (filter.to) {
      const normalizedTo = this.normalizeJid(filter.to);
      results = results.filter(m =>
        m.to === filter.to ||
        m.to === normalizedTo
      );
    }
    if (filter.query) {
      const q = filter.query.toLowerCase();
      results = results.filter(m => m.body.toLowerCase().includes(q));
    }
    if (filter.isFromMe !== undefined) {
      results = results.filter(m => m.isFromMe === filter.isFromMe);
    }
    if (filter.hasMedia !== undefined) {
      results = results.filter(m => m.hasMedia === filter.hasMedia);
    }
    if (filter.startDate) {
      results = results.filter(m => m.timestamp >= filter.startDate!);
    }
    if (filter.endDate) {
      results = results.filter(m => m.timestamp <= filter.endDate!);
    }

    // Sort newest first
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (filter.offset) {
      results = results.slice(filter.offset);
    }
    if (filter.limit) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  async getContacts(query?: string): Promise<Contact[]> {
    const socket = this.socket;
    if (!socket) throw new Error('WhatsApp not connected');

    const contacts: Contact[] = [];
    const store = socket.store;

    if (store?.contacts) {
      for (const [id, contact] of Object.entries(store.contacts)) {
        if (!id) continue;
        const c: Contact = {
          id,
          channel: 'whatsapp',
          name: contact.name,
          displayName: contact.notify || contact.name,
          phone: id.replace('@s.whatsapp.net', '').replace('@g.us', ''),
          isGroup: id.endsWith('@g.us'),
          isBlocked: contact.isBlocked || false,
        };
        contacts.push(c);
      }
    }

    // Also include contacts seen in messages
    const seenIds = new Set(contacts.map(c => c.id));
    for (const msg of messageStore) {
      const cid = msg.isFromMe ? msg.to : msg.from;
      if (cid && !seenIds.has(cid) && cid !== 'me') {
        seenIds.add(cid);
        contacts.push({
          id: cid,
          channel: 'whatsapp',
          phone: cid.replace('@s.whatsapp.net', '').replace('@g.us', ''),
          isGroup: cid.endsWith('@g.us'),
          isBlocked: false,
        });
      }
    }

    if (query) {
      const q = query.toLowerCase();
      return contacts.filter(c =>
        (c.name?.toLowerCase().includes(q)) ||
        (c.displayName?.toLowerCase().includes(q)) ||
        (c.phone?.includes(q)) ||
        (c.id.includes(q))
      );
    }

    return contacts;
  }

  async getConversations(limit = 20): Promise<Conversation[]> {
    // Build conversations from message store
    const convMap = new Map<string, { messages: Message[]; contact: Contact }>();

    for (const msg of messageStore) {
      const cid = msg.isFromMe ? msg.to : msg.from;
      if (!cid || cid === 'me') continue;

      if (!convMap.has(cid)) {
        convMap.set(cid, {
          messages: [],
          contact: {
            id: cid,
            channel: 'whatsapp',
            phone: cid.replace('@s.whatsapp.net', '').replace('@g.us', ''),
            isGroup: cid.endsWith('@g.us'),
            isBlocked: false,
          },
        });
      }
      convMap.get(cid)!.messages.push(msg);
    }

    const conversations: Conversation[] = [];
    for (const [id, data] of convMap.entries()) {
      const sorted = data.messages.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      conversations.push({
        id,
        channel: 'whatsapp',
        contact: data.contact,
        lastMessage: sorted[0],
        unreadCount: 0,
        updatedAt: sorted[0]?.timestamp || new Date(),
      });
    }

    // Sort by most recent
    conversations.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return conversations.slice(0, limit);
  }

  async deleteMessage(messageId: string): Promise<void> {
    const socket = this.socket;
    if (!socket) throw new Error('WhatsApp not connected');

    // Find the message in store to get the JID
    const msg = messageStore.find(m => m.id === messageId);
    if (!msg) throw new Error(`Message not found: ${messageId}`);

    const jid = msg.isFromMe ? msg.to : msg.from;
    try {
      await socket.sendMessage(jid, { delete: { remoteJid: jid, id: messageId, fromMe: msg.isFromMe } });
    } catch {
      // Some messages can't be deleted (too old, etc.)
      throw new Error(`Cannot delete message ${messageId} — it may be too old or not deletable`);
    }

    // Remove from local store
    const idx = messageStore.findIndex(m => m.id === messageId);
    if (idx >= 0) messageStore.splice(idx, 1);
  }

  async replyToMessage(messageId: string, body: string): Promise<Message> {
    const msg = messageStore.find(m => m.id === messageId);
    if (!msg) throw new Error(`Message not found: ${messageId}`);

    const to = msg.isFromMe ? msg.to : msg.from;
    return this.sendMessage(to, body, { replyToId: messageId });
  }

  // --- Events ---

  on<K extends keyof MessagingProviderEvents>(
    event: K,
    handler: MessagingProviderEvents[K]
  ): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(handler);
  }

  off<K extends keyof MessagingProviderEvents>(
    event: K,
    handler: MessagingProviderEvents[K]
  ): void {
    this.eventListeners.get(event)?.delete(handler);
  }

  private emit<K extends keyof MessagingProviderEvents>(
    event: K,
    ...args: Parameters<MessagingProviderEvents[K]>
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          (listener as Function)(...args);
        } catch {
          // swallow listener errors
        }
      }
    }
  }

  /** Get the underlying connection (for backward compat) */
  getConnection(): WhatsAppConnection {
    return this.connection;
  }

  /** Normalize a phone number or JID */
  private normalizeJid(jid: string): string {
    if (jid.includes('@')) return jid;
    const clean = jid.replace(/\D/g, '');
    return clean.length > 15 ? `${clean}@g.us` : `${clean}@s.whatsapp.net`;
  }
}

export function createWhatsAppMessagingProvider(connection: WhatsAppConnection): WhatsAppMessagingProvider {
  return new WhatsAppMessagingProvider(connection);
}
