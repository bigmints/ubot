/**
 * Telegram Messaging Provider
 * Wraps TelegramConnection to implement the platform-agnostic MessagingProvider interface.
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
import type { TelegramConnection } from './connection.js';

/** In-memory message store for search/history */
const messageStore: Message[] = [];
const MAX_STORED_MESSAGES = 1000;

function addToStore(msg: Message): void {
  messageStore.push(msg);
  if (messageStore.length > MAX_STORED_MESSAGES) {
    messageStore.splice(0, messageStore.length - MAX_STORED_MESSAGES);
  }
}

export class TelegramMessagingProvider implements MessagingProvider {
  readonly channel = 'telegram' as const;
  private _status: ConnectionStatus = 'disconnected';
  private eventListeners = new Map<string, Set<Function>>();
  private connection: TelegramConnection;
  /** Map chatId → last known sender name */
  private chatNames = new Map<number, string>();

  constructor(connection: TelegramConnection) {
    this.connection = connection;
    this.setupForwarding();
  }

  get status(): ConnectionStatus {
    const s = this.connection.status;
    if (s === 'error') return 'disconnected';
    return s as ConnectionStatus;
  }

  /** Forward TelegramConnection events → MessagingProvider events */
  private setupForwarding(): void {
    this.connection.on('connection.update', (status) => {
      this._status = status === 'error' ? 'disconnected' : status as ConnectionStatus;
      this.emit('connection', this._status);
    });

    this.connection.on('message.received', (tgMsg) => {
      const msg: Message = {
        id: tgMsg.id,
        channel: 'telegram',
        from: tgMsg.chatId.toString(),
        to: this.connection.botUsername ?? 'bot',
        body: tgMsg.body,
        timestamp: tgMsg.timestamp,
        isFromMe: tgMsg.isFromMe,
        hasMedia: tgMsg.hasMedia,
        mediaType: tgMsg.mediaType === 'photo' ? 'image' : tgMsg.mediaType as any,
        metadata: {
          chatId: tgMsg.chatId,
          fromName: tgMsg.from,
          fromUsername: tgMsg.fromUsername,
        },
      };

      // Track chat names
      this.chatNames.set(tgMsg.chatId, tgMsg.from);

      addToStore(msg);
      this.emit('message', msg);
    });

    this.connection.on('error', (err) => {
      this.emit('error', err);
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
    const chatId = parseInt(to, 10) || to;
    const replyToId = opts?.replyToId ? parseInt(opts.replyToId, 10) : undefined;

    const sent = await this.connection.sendMessage(chatId, body, replyToId, opts);

    const msg: Message = {
      id: sent.message_id.toString(),
      channel: 'telegram',
      from: this.connection.botUsername ?? 'bot',
      to: to,
      body,
      timestamp: new Date(sent.date * 1000),
      isFromMe: true,
      hasMedia: false,
    };

    addToStore(msg);
    return msg;
  }

  async searchMessages(filter: MessageFilter): Promise<Message[]> {
    let results = [...messageStore];

    if (filter.from) {
      results = results.filter(m => m.from === filter.from);
    }
    if (filter.query) {
      const q = filter.query.toLowerCase();
      results = results.filter(m => m.body.toLowerCase().includes(q));
    }
    if (filter.isFromMe !== undefined) {
      results = results.filter(m => m.isFromMe === filter.isFromMe);
    }
    if (filter.startDate) {
      results = results.filter(m => m.timestamp >= filter.startDate!);
    }
    if (filter.endDate) {
      results = results.filter(m => m.timestamp <= filter.endDate!);
    }

    // Sort newest first
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (filter.offset) results = results.slice(filter.offset);
    if (filter.limit) results = results.slice(0, filter.limit);

    return results;
  }

  async getContacts(_query?: string): Promise<Contact[]> {
    // Telegram bots don't have a contact list — return known chat partners
    const contacts: Contact[] = [];
    for (const [chatId, name] of this.chatNames) {
      contacts.push({
        id: chatId.toString(),
        channel: 'telegram',
        name,
        displayName: name,
        isGroup: chatId < 0, // Negative IDs = groups in Telegram
        isBlocked: false,
      });
    }
    return contacts;
  }

  async getConversations(limit = 20): Promise<Conversation[]> {
    const contactMap = new Map<string, Message>();
    for (const msg of messageStore) {
      const key = msg.isFromMe ? msg.to : msg.from;
      const existing = contactMap.get(key);
      if (!existing || msg.timestamp > existing.timestamp) {
        contactMap.set(key, msg);
      }
    }

    const conversations: Conversation[] = [];
    for (const [id, lastMsg] of contactMap) {
      const name = this.chatNames.get(parseInt(id, 10)) ?? id;
      conversations.push({
        id,
        channel: 'telegram',
        contact: {
          id,
          channel: 'telegram',
          name,
          displayName: name,
          isGroup: parseInt(id, 10) < 0,
          isBlocked: false,
        },
        lastMessage: lastMsg,
        unreadCount: 0,
        updatedAt: lastMsg.timestamp,
      });
    }

    conversations.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return conversations.slice(0, limit);
  }

  async deleteMessage(_messageId: string): Promise<void> {
    // Not supported for bots easily — no-op
    console.log('[Telegram] deleteMessage not supported for bots');
  }

  async replyToMessage(messageId: string, body: string): Promise<Message> {
    // Find the original message to get the chatId
    const original = messageStore.find(m => m.id === messageId);
    if (!original) {
      throw new Error(`Message ${messageId} not found in store`);
    }
    const chatId = (original.metadata?.chatId as number)?.toString() ?? original.from;
    return this.sendMessage(chatId, body, { replyToId: messageId });
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
        } catch (err) {
          console.error('[Telegram] Event handler error:', err);
        }
      }
    }
  }

  /** Get the underlying connection */
  getConnection(): TelegramConnection {
    return this.connection;
  }
}
