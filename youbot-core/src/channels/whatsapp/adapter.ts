import type { 
  WASocket, 
  GroupMetadata,
  AnyMessageContent,
  WAMessage
} from '@whiskeysockets/baileys';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { WhatsAppConnection, createWhatsAppConnection } from './connection.js';
import type {
  WhatsAppAdapter,
  WhatsAppAdapterOptions,
  WhatsAppConnectionStatus,
  WhatsAppMessage,
  WhatsAppSendMessageOptions,
  WhatsAppContact,
  WhatsAppGroupMetadata,
  WhatsAppAdapterEvents
} from './types.js';

interface SocketStore {
  contacts: Record<string, { name?: string; notify?: string; isBlocked?: boolean }>;
  chats: Record<string, unknown>;
  messages?: Record<string, WAMessage[]>;
}

interface ExtendedWASocket extends WASocket {
  store?: SocketStore;
}

export class WhatsAppAdapterImpl implements WhatsAppAdapter {
  private connection: WhatsAppConnection;
  private _status: WhatsAppConnectionStatus = 'disconnected';
  private eventListeners: Map<string, Set<Function>> = new Map();
  private onMessage?: (message: WhatsAppMessage) => Promise<void> | void;
  private onConnectionChange?: (status: WhatsAppConnectionStatus, qrCode?: string) => void;
  private onError?: (error: Error) => void;

  constructor(options: WhatsAppAdapterOptions) {
    this.connection = createWhatsAppConnection(options.config);
    this.onMessage = options.onMessage;
    this.onConnectionChange = options.onConnectionChange;
    this.onError = options.onError;
    
    this.setupConnectionListeners();
  }

  get status(): WhatsAppConnectionStatus {
    return this._status;
  }

  get socket(): ExtendedWASocket | null {
    return this.connection.getSocket() as ExtendedWASocket | null;
  }

  private setupConnectionListeners(): void {
    this.connection.on('connection.update', (status, qrCode) => {
      this._status = status;
      this.emit('connection.update', status, qrCode);
      this.onConnectionChange?.(status, qrCode);
    });

    this.connection.on('message.received', (message) => {
      this.emit('message.received', message as WhatsAppMessage);
      this.onMessage?.(message as WhatsAppMessage);
    });

    this.connection.on('error', (error) => {
      this.emit('error', error);
      this.onError?.(error);
    });
  }

  async connect(): Promise<void> {
    await this.connection.connect();
  }

  async disconnect(): Promise<void> {
    await this.connection.disconnect();
  }

  async sendMessage(
    to: string, 
    body: string, 
    options: WhatsAppSendMessageOptions = {}
  ): Promise<WhatsAppMessage> {
    const socket = this.socket;
    if (!socket) {
      throw new Error('Not connected to WhatsApp');
    }

    const jid = this.normalizeJid(to);
    
    const messageContent: AnyMessageContent = options.quotedMessageId
      ? {
          text: body,
          contextInfo: {
            stanzaId: options.quotedMessageId,
            participant: jid
          }
        }
      : { text: body };

    const sent = await this.connection.sendMessage(jid, messageContent);
    
    if (!sent?.key?.id) {
      throw new Error('Failed to send message');
    }
    
    const message: WhatsAppMessage = {
      id: sent.key.id,
      from: sent.key.fromMe ? '' : jid,
      rawJid: jid,
      to: jid,
      body,
      timestamp: new Date(),
      isFromMe: true,
      hasMedia: false,
      quotedMessageId: options.quotedMessageId
    };

    this.emit('message.sent', message);
    return message;
  }

  async getContacts(): Promise<WhatsAppContact[]> {
    const socket = this.socket;
    if (!socket) {
      throw new Error('Not connected to WhatsApp');
    }

    const contacts: WhatsAppContact[] = [];
    const store = socket.store;
    
    if (!store?.contacts) {
      return contacts;
    }
    
    for (const [id, contact] of Object.entries(store.contacts)) {
      if (id && contact) {
        contacts.push({
          id,
          name: contact.name || contact.notify,
          pushName: contact.notify,
          isGroup: id.endsWith('@g.us'),
          isBlocked: contact.isBlocked || false
        });
      }
    }

    return contacts;
  }

  async getGroups(): Promise<WhatsAppGroupMetadata[]> {
    const socket = this.socket;
    if (!socket) {
      throw new Error('Not connected to WhatsApp');
    }

    const groups: WhatsAppGroupMetadata[] = [];
    const store = socket.store;
    
    if (!store?.chats) {
      return groups;
    }

    for (const [id] of Object.entries(store.chats)) {
      if (id.endsWith('@g.us')) {
        try {
          const metadata = await this.getGroupMetadata(id);
          groups.push(metadata);
        } catch {
          // Skip groups we can't fetch
        }
      }
    }

    return groups;
  }

  async getGroupMetadata(groupId: string): Promise<WhatsAppGroupMetadata> {
    const socket = this.socket;
    if (!socket) {
      throw new Error('Not connected to WhatsApp');
    }

    const jid = this.normalizeJid(groupId);
    const metadata: GroupMetadata = await socket.groupMetadata(jid);

    return {
      id: metadata.id,
      subject: metadata.subject,
      owner: metadata.owner ?? '',
      participants: metadata.participants.map(p => ({
        id: p.id,
        isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
        isSuperAdmin: p.admin === 'superadmin'
      })),
      createdAt: new Date((metadata.creation ?? 0) * 1000)
    };
  }

  async downloadMedia(messageId: string): Promise<Buffer | null> {
    const socket = this.socket;
    if (!socket) {
      throw new Error('Not connected to WhatsApp');
    }

    const store = socket.store;
    if (store?.messages) {
      for (const messages of Object.values(store.messages)) {
        const message = messages.find((m: WAMessage) => {
          return m?.key?.id === messageId;
        });
        
        if (message) {
          try {
            const buffer = await downloadMediaMessage(message, 'buffer', {});
            return buffer as Buffer;
          } catch {
            return null;
          }
        }
      }
    }

    return null;
  }

  on<K extends keyof WhatsAppAdapterEvents>(
    event: K, 
    listener: WhatsAppAdapterEvents[K]
  ): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);
  }

  off<K extends keyof WhatsAppAdapterEvents>(
    event: K, 
    listener: WhatsAppAdapterEvents[K]
  ): void {
    this.eventListeners.get(event)?.delete(listener);
  }

  private emit<K extends keyof WhatsAppAdapterEvents>(
    event: K, 
    ...args: Parameters<WhatsAppAdapterEvents[K]>
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          (listener as Function)(...args);
        } catch (error) {
          this.onError?.(error as Error);
        }
      }
    }
  }

  private normalizeJid(jid: string): string {
    if (jid.includes('@')) {
      return jid;
    }
    
    const cleanNumber = jid.replace(/\D/g, '');
    if (cleanNumber.length > 15) {
      return `${cleanNumber}@g.us`;
    }
    return `${cleanNumber}@s.whatsapp.net`;
  }
}

export function createWhatsAppAdapter(options: WhatsAppAdapterOptions): WhatsAppAdapter {
  return new WhatsAppAdapterImpl(options);
}