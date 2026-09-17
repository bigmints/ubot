import type { WASocket } from '@whiskeysockets/baileys';
import type { RateLimiterConfig } from './rate-limiter.js';
import { join } from 'path';
import { homedir } from 'os';

export type WhatsAppConnectionStatus = 
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'logged_out';

/** Structured interactive option extracted from a bot message */
export interface WhatsAppInteractiveOption {
  /** Option type: 'button' | 'list_item' | 'quick_reply' | 'url_button' | 'native_flow' */
  type: string;
  /** Button/row ID */
  id: string;
  /** Display text / label */
  label: string;
  /** Optional description (for list items) */
  description?: string;
  /** Section title (for list items) */
  section?: string;
  /** URL (for url_button type) */
  url?: string;
  /** Flow name (for native_flow type) */
  flowName?: string;
  /** Raw flow params JSON (for native_flow type) */
  flowParams?: string;
  /** Card index (for carousel items) */
  cardIndex?: number;
}

export interface WhatsAppMessage {
  id: string;
  /** Resolved sender (phone JID for identification/routing) */
  from: string;
  /** Original remoteJid from Baileys (may be LID — use this for replying) */
  rawJid: string;
  to: string;
  body: string;
  timestamp: Date;
  isFromMe: boolean;
  hasMedia: boolean;
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'audio' | 'document';
  quotedMessageId?: string;
  /** In group messages, the actual sender JID (e.g. 919947793728@s.whatsapp.net) */
  participant?: string;
  /** WhatsApp display name of the sender (from pushName) */
  pushName?: string;
  /** Structured interactive options from bot messages (buttons, lists, etc.) */
  interactiveOptions?: WhatsAppInteractiveOption[];
}

export interface WhatsAppSendMessageOptions {
  quotedMessageId?: string;
  mentions?: string[];
  delay?: number;
}

export interface WhatsAppContact {
  id: string;
  name?: string;
  pushName?: string;
  isGroup: boolean;
  isBlocked: boolean;
}

export interface WhatsAppGroupMetadata {
  id: string;
  subject: string;
  owner: string;
  participants: Array<{
    id: string;
    isAdmin: boolean;
    isSuperAdmin: boolean;
  }>;
  createdAt: Date;
}

export interface WhatsAppConnectionConfig {
  sessionName: string;
  sessionPath: string;
  printQRInTerminal: boolean;
  connectTimeoutMs: number;
  keepAliveIntervalMs: number;
  retryRequestDelayMs: number;
  maxMsgRetryCount: number;
  browser?: [string, string, string];
  /** Rate limiter configuration for human-like send behavior */
  rateLimiter?: Partial<RateLimiterConfig>;
  /** Maximum QR code retry cycles before giving up (0 = unlimited). Default 3. */
  maxQrRetries?: number;
  /** Maximum reconnection attempts for non-QR disconnects. Default 10. */
  maxReconnectAttempts?: number;
}

export interface WhatsAppAdapterEvents {
  'connection.update': (status: WhatsAppConnectionStatus, qrCode?: string) => void;
  'message.received': (message: WhatsAppMessage) => void;
  'message.sent': (message: WhatsAppMessage) => void;
  'message.ack': (messageId: string, ack: number) => void;
  'group.update': (metadata: WhatsAppGroupMetadata) => void;
  'contact.update': (contact: WhatsAppContact) => void;
  'error': (error: Error) => void;
}

export interface WhatsAppAdapterOptions {
  config: Partial<WhatsAppConnectionConfig>;
  onMessage?: (message: WhatsAppMessage) => Promise<void> | void;
  onConnectionChange?: (status: WhatsAppConnectionStatus, qrCode?: string) => void;
  onError?: (error: Error) => void;
}

export interface WhatsAppAdapter {
  readonly status: WhatsAppConnectionStatus;
  readonly socket: WASocket | null;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(to: string, body: string, options?: WhatsAppSendMessageOptions): Promise<WhatsAppMessage>;
  getContacts(): Promise<WhatsAppContact[]>;
  getGroups(): Promise<WhatsAppGroupMetadata[]>;
  getGroupMetadata(groupId: string): Promise<WhatsAppGroupMetadata>;
  downloadMedia(messageId: string): Promise<Buffer | null>;
  on<K extends keyof WhatsAppAdapterEvents>(event: K, listener: WhatsAppAdapterEvents[K]): void;
  off<K extends keyof WhatsAppAdapterEvents>(event: K, listener: WhatsAppAdapterEvents[K]): void;
}

export interface WhatsAppSessionData {
  sessionId: string;
  createdAt: Date;
  lastActive: Date;
  status: WhatsAppConnectionStatus;
}

export interface WhatsAppMessageFilter {
  from?: string;
  to?: string;
  isFromMe?: boolean;
  hasMedia?: boolean;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export interface WhatsAppMessageListResult {
  messages: WhatsAppMessage[];
  total: number;
  hasMore: boolean;
}

/** Resolve the canonical session directory — always absolute */
function getDefaultSessionPath(): string {
  const youbotHome = process.env.YOUBOT_HOME || join(homedir(), '.youbot');
  return join(youbotHome, 'sessions');
}

export const DEFAULT_WHATSAPP_CONFIG: WhatsAppConnectionConfig = {
  sessionName: 'youbot-session',
  sessionPath: getDefaultSessionPath(),
  printQRInTerminal: true,
  connectTimeoutMs: 60000,
  keepAliveIntervalMs: 25000,
  retryRequestDelayMs: 1000,
  maxMsgRetryCount: 5,
  browser: ['Youbot Core', 'Chrome', '1.0.0']
};