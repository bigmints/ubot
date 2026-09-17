/**
 * Telegram Types & Configuration
 */

export interface TelegramConfig {
  botToken: string;
  /** Poll interval in ms (default 1000) */
  pollingInterval?: number;
}

export const DEFAULT_TELEGRAM_CONFIG: TelegramConfig = {
  botToken: '',
  pollingInterval: 1000,
};

export type TelegramConnectionStatus = 
  | 'connected'
  | 'disconnected'
  | 'connecting'
  | 'error';

export interface TelegramMessage {
  id: string;
  chatId: number;
  from: string;
  fromUsername?: string;
  body: string;
  timestamp: Date;
  isFromMe: boolean;
  hasMedia: boolean;
  mediaType?: 'photo' | 'video' | 'audio' | 'document' | 'voice' | 'sticker';
  replyToMessageId?: number;
}

export interface TelegramConnectionEvents {
  'connection.update': (status: TelegramConnectionStatus) => void;
  'message.received': (message: TelegramMessage) => void;
  'error': (error: Error) => void;
}
