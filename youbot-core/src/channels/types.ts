/**
 * Platform-Agnostic Messaging Types
 * Any channel adapter (WhatsApp, Telegram) implements MessagingProvider.
 */

export type ChannelType = 'whatsapp' | 'telegram';
export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'reconnecting';

/** Normalized message across all platforms */
export interface Message {
  id: string;
  channel: ChannelType;
  from: string;
  to: string;
  body: string;
  timestamp: Date;
  isFromMe: boolean;
  hasMedia: boolean;
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'audio' | 'document';
  /** Platform-specific ID for replying/quoting */
  replyToId?: string;
  /** Raw platform-specific data */
  metadata?: Record<string, unknown>;
}

/** Normalized contact across all platforms */
export interface Contact {
  id: string;
  channel: ChannelType;
  name?: string;
  displayName?: string;
  phone?: string;
  isGroup: boolean;
  isBlocked: boolean;
}

/** Conversation summary */
export interface Conversation {
  id: string;
  channel: ChannelType;
  contact: Contact;
  lastMessage?: Message;
  unreadCount: number;
  updatedAt: Date;
}

/** Filter for searching messages */
export interface MessageFilter {
  from?: string;
  to?: string;
  query?: string;
  isFromMe?: boolean;
  hasMedia?: boolean;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

/** Options for sending messages */
export interface SendOptions {
  replyToId?: string;
  mentions?: string[];
  mediaPath?: string;      // Local file path to the media
  mediaUrl?: string;       // Remote URL of the media
  mediaBase64?: string;    // Base64 encoded media string
  mediaType?: 'image' | 'video' | 'audio' | 'document';
  mimetype?: string;       // Specific mime type (e.g. 'audio/ogg; codecs=opus')
  caption?: string;        // Caption for media
  fileName?: string;       // File name for documents
  ptt?: boolean;           // Push-To-Talk (true for voice notes)
}

/** Events emitted by messaging providers */
export interface MessagingProviderEvents {
  'message': (message: Message) => void;
  'connection': (status: ConnectionStatus, data?: { qr?: string; error?: string }) => void;
  'error': (error: Error) => void;
}

/**
 * The core abstraction — any messaging channel adapter implements this.
 * WhatsApp, Telegram all look the same to the agent.
 */
export interface MessagingProvider {
  readonly channel: ChannelType;
  readonly status: ConnectionStatus;

  // --- Connection ---
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // --- Core Operations ---
  sendMessage(to: string, body: string, opts?: SendOptions): Promise<Message>;
  searchMessages(filter: MessageFilter): Promise<Message[]>;
  getContacts(query?: string): Promise<Contact[]>;
  getConversations(limit?: number): Promise<Conversation[]>;
  deleteMessage(messageId: string): Promise<void>;
  replyToMessage(messageId: string, body: string): Promise<Message>;

  // --- Events ---
  on<K extends keyof MessagingProviderEvents>(
    event: K,
    handler: MessagingProviderEvents[K]
  ): void;
  off<K extends keyof MessagingProviderEvents>(
    event: K,
    handler: MessagingProviderEvents[K]
  ): void;
}
