/**
 * Telegram Connection
 * Manages the Telegram bot connection using node-telegram-bot-api (long-polling).
 */

import TelegramBot, {
  type Message,
  type SendMessageParams,
  type User,
} from 'node-telegram-bot-api';
import type {
  TelegramConfig,
  TelegramConnectionStatus,
  TelegramConnectionEvents,
  TelegramMessage,
} from './types.js';

export class TelegramConnection {
  private config: TelegramConfig;
  private bot: TelegramBot | null = null;
  private _status: TelegramConnectionStatus = 'disconnected';
  private eventListeners = new Map<string, Set<Function>>();
  private botInfo: User | null = null;
  /** Store recent raw messages for media download */
  private rawMessages = new Map<string, Message>();
  private readonly MAX_RAW_MESSAGES = 200;
  private _reconnecting = false;
  private _reconnectAttempts = 0;

  constructor(config: TelegramConfig) {
    this.config = config;
  }

  get status(): TelegramConnectionStatus {
    return this._status;
  }

  get botUsername(): string | undefined {
    return this.botInfo?.username;
  }

  get botName(): string | undefined {
    return this.botInfo?.first_name;
  }

  getBot(): TelegramBot | null {
    return this.bot;
  }

  async connect(): Promise<void> {
    if (!this.config.botToken) {
      throw new Error('Telegram bot token is required');
    }

    this.updateStatus('connecting');

    try {
      this.bot = new TelegramBot(this.config.botToken, {
        polling: {
          interval: this.config.pollingInterval ?? 1000,
          autoStart: true,
        },
      });

      // Verify the token by fetching bot info
      this.botInfo = await this.bot.getMe();
      console.log(`[Telegram] ✅ Connected as @${this.botInfo.username} (${this.botInfo.first_name})`);
      this.updateStatus('connected');

      // Set up message handler
      this.bot.on('message', (msg) => this.handleMessage(msg));

      // Handle polling errors with auto-reconnect
      this.bot.on('polling_error', (err) => {
        const msg = err.message || '';
        console.error('[Telegram] Polling error:', msg);
        this.emit('error', err);

        // Determine if this is a recoverable error that killed the polling loop
        const isFatal = msg.includes('EFATAL');
        const isConflict = msg.includes('409') || msg.includes('Conflict');
        const isNetworkError = msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT') || msg.includes('ENOTFOUND');
        const shouldReconnect = isFatal || isConflict || isNetworkError;

        if (shouldReconnect && !this._reconnecting) {
          this._reconnecting = true;
          this._reconnectAttempts++;
          if (this._reconnectAttempts <= 10) {
            // For 409 conflicts, wait longer on first attempt to let the other instance die
            const baseDelay = isConflict ? 10000 : 5000;
            const delay = Math.min(baseDelay * this._reconnectAttempts, 60000);
            console.log(`[Telegram] ⚠️ ${isConflict ? '409 Conflict detected — another instance may be running. ' : ''}Attempting reconnect in ${delay / 1000}s (attempt ${this._reconnectAttempts}/10)...`);
            setTimeout(async () => {
              try {
                await this.disconnect();
                await this.connect();
                console.log('[Telegram] ✅ Reconnected successfully');
                this._reconnectAttempts = 0;
              } catch (reconnectErr: any) {
                console.error('[Telegram] Reconnect failed:', reconnectErr.message);
              } finally {
                this._reconnecting = false;
              }
            }, delay);
          } else {
            console.error('[Telegram] Max reconnect attempts reached. Manual restart needed.');
            this.updateStatus('error');
            this._reconnecting = false;
          }
        }
      });

    } catch (err: any) {
      console.error('[Telegram] ❌ Connection failed:', err.message);
      this.updateStatus('error');
      this.bot = null;
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this.bot) {
      try {
        await this.bot.stopPolling();
      } catch {
        // Ignore stop errors
      }
      this.bot = null;
      this.botInfo = null;
      this.updateStatus('disconnected');
      console.log('[Telegram] Disconnected');
    }
  }

  async sendMessage(chatId: number | string, text: string, replyToMessageId?: number, sendMediaOpts?: import('../types.js').SendOptions): Promise<Message> {
    if (!this.bot) {
      throw new Error('Not connected to Telegram');
    }

    const opts: Omit<SendMessageParams, 'chat_id' | 'text'> = {};
    if (replyToMessageId) {
      opts.reply_parameters = { message_id: replyToMessageId };
    }

    if (sendMediaOpts?.mediaType) {
      const source = sendMediaOpts.mediaUrl || sendMediaOpts.mediaPath || (sendMediaOpts.mediaBase64 ? Buffer.from(sendMediaOpts.mediaBase64, 'base64') : null);
      if (!source) throw new Error("Media source is required when mediaType is specified");

      const fileOpts = sendMediaOpts.fileName ? { filename: sendMediaOpts.fileName, contentType: sendMediaOpts.mimetype } : undefined;
      const mediaOpts = { ...opts, caption: sendMediaOpts.caption || (text !== '' ? text : undefined) };

      switch (sendMediaOpts.mediaType) {
        case 'image':
          return this.bot.sendPhoto(chatId, source, mediaOpts, fileOpts);
        case 'video':
          return this.bot.sendVideo(chatId, source, mediaOpts, fileOpts);
        case 'audio':
          if (sendMediaOpts.ptt) {
            return this.bot.sendVoice(chatId, source, mediaOpts, fileOpts);
          }
          return this.bot.sendAudio(chatId, source, mediaOpts, fileOpts);
        case 'document':
          return this.bot.sendDocument(chatId, source, mediaOpts, fileOpts);
      }
    }

    return this.bot.sendMessage(chatId, text, opts);
  }

  async sendTyping(chatId: number | string): Promise<void> {
    if (!this.bot) return;
    try {
      await this.bot.sendChatAction(chatId, 'typing');
    } catch {
      // ignore
    }
  }

  /** Download media from a received message */
  async downloadMedia(messageId: string): Promise<{ buffer: Buffer; mimeType: string; filename: string } | null> {
    if (!this.bot) return null;
    const rawMsg = this.rawMessages.get(messageId);
    if (!rawMsg) return null;

    try {
      let fileId: string | undefined;
      let mimeType = 'application/octet-stream';
      let filename = 'file';

      if (rawMsg.photo && rawMsg.photo.length > 0) {
        // Get the largest photo
        const largest = rawMsg.photo[rawMsg.photo.length - 1];
        fileId = largest.file_id;
        mimeType = 'image/jpeg';
        filename = `photo-${messageId}.jpg`;
      } else if (rawMsg.document) {
        fileId = rawMsg.document.file_id;
        mimeType = rawMsg.document.mime_type || 'application/octet-stream';
        filename = rawMsg.document.file_name || `document-${messageId}`;
      } else if (rawMsg.video) {
        fileId = rawMsg.video.file_id;
        mimeType = rawMsg.video.mime_type || 'video/mp4';
        filename = `video-${messageId}.mp4`;
      } else if (rawMsg.audio) {
        fileId = rawMsg.audio.file_id;
        mimeType = rawMsg.audio.mime_type || 'audio/mpeg';
        filename = (rawMsg.audio as any).file_name || rawMsg.audio.title || `audio-${messageId}.mp3`;
      } else if (rawMsg.voice) {
        fileId = rawMsg.voice.file_id;
        mimeType = rawMsg.voice.mime_type || 'audio/ogg';
        filename = `voice-${messageId}.ogg`;
      }

      if (!fileId) return null;

      const fileLink = await this.bot.getFileLink(fileId);
      const response = await fetch(fileLink);
      if (!response.ok) return null;
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      return { buffer, mimeType, filename };
    } catch (err: any) {
      console.error(`[Telegram] Failed to download media for ${messageId}:`, err.message);
      return null;
    }
  }

  private handleMessage(msg: Message): void {
    const body = msg.text || msg.caption || '';
    const from = msg.from
      ? `${msg.from.first_name}${msg.from.last_name ? ' ' + msg.from.last_name : ''}`
      : 'Unknown';

    const isFromMe = msg.from?.id === this.botInfo?.id;

    let hasMedia = false;
    let mediaType: TelegramMessage['mediaType'];
    if (msg.photo) { hasMedia = true; mediaType = 'photo'; }
    else if (msg.video) { hasMedia = true; mediaType = 'video'; }
    else if (msg.audio) { hasMedia = true; mediaType = 'audio'; }
    else if (msg.document) { hasMedia = true; mediaType = 'document'; }
    else if (msg.voice) { hasMedia = true; mediaType = 'voice'; }
    else if (msg.sticker) { hasMedia = true; mediaType = 'sticker'; }

    // Skip messages with no text AND no media
    if (!body && !hasMedia) return;

    // Store raw message for media download
    const msgId = msg.message_id.toString();
    if (hasMedia) {
      this.rawMessages.set(msgId, msg);
      if (this.rawMessages.size > this.MAX_RAW_MESSAGES) {
        const oldest = this.rawMessages.keys().next().value;
        if (oldest) this.rawMessages.delete(oldest);
      }
    }

    const message: TelegramMessage = {
      id: msgId,
      chatId: msg.chat.id,
      from,
      fromUsername: msg.from?.username,
      body: body || (hasMedia ? '[Media message]' : ''),
      timestamp: new Date(msg.date * 1000),
      isFromMe,
      hasMedia,
      mediaType,
      replyToMessageId: msg.reply_to_message?.message_id,
    };

    console.log(`[Telegram] Received message (${body.length} chars, media=${hasMedia})`);

    if (!isFromMe) {
      this.emit('message.received', message);
    }
  }

  private updateStatus(status: TelegramConnectionStatus): void {
    this._status = status;
    this.emit('connection.update', status);
  }

  // --- Event Emitter ---
  on<K extends keyof TelegramConnectionEvents>(
    event: K,
    handler: TelegramConnectionEvents[K]
  ): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(handler);
  }

  off<K extends keyof TelegramConnectionEvents>(
    event: K,
    handler: TelegramConnectionEvents[K]
  ): void {
    this.eventListeners.get(event)?.delete(handler);
  }

  /** Remove all listeners for all events */
  removeAllListeners(): void {
    this.eventListeners.clear();
  }

  private emit<K extends keyof TelegramConnectionEvents>(
    event: K,
    ...args: Parameters<TelegramConnectionEvents[K]>
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          (listener as Function)(...args);
        } catch (err) {
          console.error(`[Telegram] Event handler error (${event})`);
        }
      }
    }
  }
}
