import makeWASocket, { 
  DisconnectReason, 
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  type WASocket
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { mkdir, access, readdir, readFile, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import type { 
  WhatsAppConnectionConfig, 
  WhatsAppConnectionStatus,
  WhatsAppAdapterEvents,
  WhatsAppMessage,
  WhatsAppInteractiveOption
} from './types.js';
import { DEFAULT_WHATSAPP_CONFIG } from './types.js';
import type { AnyMessageContent, WAMessage } from '@whiskeysockets/baileys';
import { WhatsAppRateLimiter, createRateLimiter } from './rate-limiter.js';
import type { RateLimiterConfig } from './rate-limiter.js';

export interface ConnectionResult {
  socket: WASocket;
  saveCreds: () => Promise<void>;
}

export interface ConnectionState {
  status: WhatsAppConnectionStatus;
  qrCode: string | null;
  lastConnected: Date | null;
  reconnectAttempts: number;
  /** How many full QR cycles (connect→timeout→close) without a successful scan */
  qrAttempts: number;
}

export class WhatsAppConnection {
  private config: WhatsAppConnectionConfig;
  private socket: WASocket | null = null;
  private state: ConnectionState;
  private eventListeners: Map<string, Set<Function>> = new Map();
  private saveCreds: (() => Promise<void>) | null = null;
  private lidToPhone: Map<string, string> = new Map();
  private phoneToLid: Map<string, string> = new Map();
  private logger: pino.Logger;
  private rateLimiter: WhatsAppRateLimiter;
  /** Keep recent raw messages for media download */
  private rawMessages: Map<string, any> = new Map();
  private readonly MAX_RAW_MESSAGES = 200;

  /** Maximum QR code cycles before giving up (0 = unlimited). Default 3. */
  private maxQrRetries: number;
  /** Maximum reconnection attempts for non-QR disconnects. Default 10. */
  private maxReconnectAttempts: number;
  /** Whether we have ever connected in this session */
  private hasConnectedBefore = false;
  /** Whether the user manually disconnected (to prevent auto-reconnect) */
  private isManualDisconnect = false;

  constructor(config: Partial<WhatsAppConnectionConfig> = {}) {
    this.config = { ...DEFAULT_WHATSAPP_CONFIG, ...config };
    this.maxQrRetries = config.maxQrRetries ?? 3;
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? 10;
    this.state = {
      status: 'disconnected',
      qrCode: null,
      lastConnected: null,
      reconnectAttempts: 0,
      qrAttempts: 0,
    };
    this.logger = pino({
      level: 'silent'
    });
    this.rateLimiter = createRateLimiter(config.rateLimiter);
  }

  get status(): WhatsAppConnectionStatus {
    return this.state.status;
  }

  get isConnected(): boolean {
    return this.state.status === 'connected' && this.socket !== null;
  }

  getSocket(): WASocket | null {
    return this.socket;
  }

  /** Get the connected user's info (phone number + name), or null if not connected */
  getUser(): { id: string; name: string | undefined; phone: string } | null {
    if (!this.socket?.user) return null;
    const user = this.socket.user;
    // Baileys user.id is in format "919947793728:34@s.whatsapp.net"
    const phone = user.id.split(':')[0].split('@')[0];
    return {
      id: user.id,
      name: user.name,
      phone: `+${phone}`,
    };
  }

  /** Send a message through the rate limiter (preferred over raw socket.sendMessage) */
  async sendMessage(jid: string, content: AnyMessageContent, options?: any): Promise<WAMessage | undefined> {
    if (!this.socket) throw new Error('Not connected to WhatsApp');
    const msg = await this.rateLimiter.sendMessage(this.socket, jid, content, options);
    if (msg && msg.key.id) {
      this.rawMessages.set(msg.key.id, msg);
      if (this.rawMessages.size > this.MAX_RAW_MESSAGES) {
        const oldest = this.rawMessages.keys().next().value;
        if (oldest) this.rawMessages.delete(oldest);
      }
    }
    return msg;
  }

  async sendPresenceUpdate(type: import('@whiskeysockets/baileys').WAPresence, toJid: string): Promise<void> {
    if (this.socket) {
      try {
        await this.socket.sendPresenceUpdate(type, toJid);
      } catch {
        // ignore
      }
    }
  }

  /** Download media from a received message */
  async downloadMedia(messageId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const rawMsg = this.rawMessages.get(messageId);
    if (!rawMsg) return null;

    const msg = rawMsg.message;
    if (!msg) return null;

    // Determine MIME type from message content
    let mimeType = 'application/octet-stream';
    if (msg.imageMessage) mimeType = msg.imageMessage.mimetype || 'image/jpeg';
    else if (msg.videoMessage) mimeType = msg.videoMessage.mimetype || 'video/mp4';
    else if (msg.audioMessage) mimeType = msg.audioMessage.mimetype || 'audio/ogg';
    else if (msg.documentMessage) mimeType = msg.documentMessage.mimetype || 'application/octet-stream';

    // Download stream using Baileys
    try {
      const stream = await import('@whiskeysockets/baileys').then((m) =>
        m.downloadContentFromMessage(
          (msg.imageMessage || msg.videoMessage || msg.audioMessage || msg.documentMessage) as any,
          mimeType.split('/')[0] as any,
        ),
      );
      let buffer = Buffer.from([]);
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
      }
      return { buffer, mimeType };
    } catch (err) {
      console.error('[WhatsApp] ❌ Failed to download media:', err);
      return null;
    }
  }

  /** Get a raw Baileys message by ID for quoting */
  getRawMessage(id: string): any {
    return this.rawMessages.get(id);
  }


  /** Get the rate limiter instance (for stats / config updates) */
  getRateLimiter(): WhatsAppRateLimiter {
    return this.rateLimiter;
  }

  async connect(): Promise<WASocket> {
    if (this.socket) {
      try {
        await this.socket.end(undefined);
      } catch (err) { /* ignore */ }
      this.socket = null;
    }
    this.isManualDisconnect = false;
    this.updateStatus('connecting');
    
    try {
      await this.ensureSessionDirectory();
      
      const { state, saveCreds } = await useMultiFileAuthState(
        join(this.config.sessionPath, this.config.sessionName)
      );
      this.saveCreds = saveCreds;
      
      // Fetch WA Web version
      let version: [number, number, number];
      try {
        const fetched = await fetchLatestBaileysVersion();
        if (fetched.version && Array.isArray(fetched.version) && fetched.version.length === 3) {
          version = fetched.version as [number, number, number];
        } else {
          console.warn('[WhatsApp] ⚠️ Invalid version format from API — using fallback');
          version = [2, 3000, 1015901307];
        }
      } catch {
        console.warn('[WhatsApp] ⚠️ Failed to fetch version — using fallback');
        version = [2, 3000, 1015901307];
      }
      console.log('[WhatsApp] Using WA Web version:', version);
      
      this.socket = makeWASocket({
        version,
        auth: state,
        connectTimeoutMs: this.config.connectTimeoutMs,
        keepAliveIntervalMs: this.config.keepAliveIntervalMs,
        retryRequestDelayMs: this.config.retryRequestDelayMs,
        maxMsgRetryCount: this.config.maxMsgRetryCount,
        browser: this.config.browser,
        logger: this.logger,
        getMessage: async (key) => {
          if (key.id) {
            const rawMsg = this.rawMessages.get(key.id);
            if (rawMsg?.message) return rawMsg.message;
          }
          return { conversation: '' };
        }
      });

      this.setupEventHandlers();
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.off('connection.update', onConnected as any);
          this.off('connection.update', onDisconnected);
          reject(new Error('Connection timeout'));
        }, this.config.connectTimeoutMs);

        const onConnected = (status: WhatsAppConnectionStatus, qr?: string) => {
          if (status === 'connected' || (status === 'connecting' && qr)) {
            clearTimeout(timeout);
            this.off('connection.update', onConnected as any);
            this.off('connection.update', onDisconnected);
            resolve(this.socket!);
          }
        };

        const onDisconnected = (status: WhatsAppConnectionStatus) => {
          if (status === 'logged_out' || status === 'disconnected') {
            clearTimeout(timeout);
            this.off('connection.update', onDisconnected);
            this.off('connection.update', onConnected as any);
            reject(new Error('Connection failed'));
          }
        };

        this.on('connection.update', onConnected as any);
        this.on('connection.update', onDisconnected);
      });
    } catch (error) {

      this.updateStatus('disconnected');
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      this.isManualDisconnect = true;
      await this.socket.end(undefined);
      this.socket = null;
      this.updateStatus('disconnected');
    }
  }

  private async ensureSessionDirectory(): Promise<void> {
    const sessionDir = join(this.config.sessionPath, this.config.sessionName);
    try {
      await access(sessionDir);
    } catch {
      await mkdir(sessionDir, { recursive: true });
    }
  }

  /** Delete stale session/auth files so Baileys generates a fresh QR on next connect */
  async clearSession(): Promise<void> {
    const sessionDir = join(this.config.sessionPath, this.config.sessionName);
    try {
      await rm(sessionDir, { recursive: true, force: true });
      console.log('[WhatsApp] Cleared stale session data');
    } catch (err: any) {
      console.error('[WhatsApp] Failed to clear session:', err.message);
    }
  }

  /** Resolve a LID JID to a phone JID if known, otherwise return the original */
  public resolveLid(jid: string): string {
    if (!jid.endsWith('@lid')) return jid;
    return this.lidToPhone.get(jid) || jid;
  }

  /** Load LID→phone mappings from session directory files */
  private async loadLIDMappings(): Promise<void> {
    const sessionDir = join(this.config.sessionPath, this.config.sessionName);
    try {
      const files = await readdir(sessionDir);
      const reverseFiles = files.filter(f => f.startsWith('lid-mapping-') && f.endsWith('_reverse.json'));
      
      for (const file of reverseFiles) {
        try {
          const content = await readFile(join(sessionDir, file), 'utf-8');
          const phoneNumber = JSON.parse(content);
          // Extract LID from filename: lid-mapping-{lid}_reverse.json
          const lid = file.replace('lid-mapping-', '').replace('_reverse.json', '');
          const lidJid = `${lid}@lid`;
          const phoneJid = `${phoneNumber}@s.whatsapp.net`;
          this.lidToPhone.set(lidJid, phoneJid);
          this.phoneToLid.set(phoneJid, lidJid);
        } catch {
          // Skip invalid files
        }
      }
      console.log(`[WhatsApp] Loaded ${this.lidToPhone.size} LID→phone mappings`);
    } catch (err: any) {
      console.error('[WhatsApp] Failed to read session dir for LID mappings:', err.message);
    }
  }

  /** Persist a new LID↔phone mapping to session directory */
  private async saveLIDMapping(lid: string, phoneNumber: string): Promise<void> {
    const lidClean = lid.replace('@lid', '');
    const phoneClean = phoneNumber.replace('@s.whatsapp.net', '');
    const sessionDir = join(this.config.sessionPath, this.config.sessionName);
    try {
      // Save reverse mapping (LID → phone)
      await writeFile(
        join(sessionDir, `lid-mapping-${lidClean}_reverse.json`),
        JSON.stringify(phoneClean),
      );
      // Save forward mapping (phone → LID)
      await writeFile(
        join(sessionDir, `lid-mapping-${phoneClean}.json`),
        JSON.stringify(lidClean),
      );
      console.log('[WhatsApp] Saved contact address mapping');
    } catch (err: any) {
      console.error('[WhatsApp] Failed to save LID mapping:', err.message);
    }
  }

  private setupEventHandlers(): void {
    if (!this.socket) return;

    this.socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      if (qr) {
        this.state.qrCode = qr;
        this.state.qrAttempts++;

        // Check if we've exceeded max QR retries (only if we never connected before)
        if (this.maxQrRetries > 0 && !this.hasConnectedBefore && this.state.qrAttempts > this.maxQrRetries * 6) {
          // Each QR cycle generates ~6 QR codes before the connection times out
          console.log(`[WhatsApp] ⏹️  Giving up after ${this.state.qrAttempts} QR codes — scan the QR from the dashboard and restart, or run 'youbot restart'.`);
          this.updateStatus('disconnected');
          this.socket?.end(undefined);
          return;
        }

        console.log(`[WhatsApp] 📱 QR code generated — scan with your phone (attempt ${this.state.qrAttempts})`);
        this.emit('connection.update', 'connecting', qr);
      }
      
      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        const isReplaced = statusCode === 440;

      console.log('[WhatsApp] Disconnected with status code:', statusCode ?? 'unknown');

        if (this.isManualDisconnect) {
          console.log('[WhatsApp] ⏹️  Manual disconnect — stopping auto-reconnect.');
          this.updateStatus('disconnected');
          return;
        }

        if (isReplaced) {
          this.state.reconnectAttempts++;
          const delay = Math.min(8000 * this.state.reconnectAttempts, 60000);
          console.log(`[WhatsApp] ⚠️  Connection replaced by another session (code 440). Reconnecting in ${(delay / 1000).toFixed(0)}s (attempt ${this.state.reconnectAttempts}/${this.maxReconnectAttempts})...`);
          this.updateStatus('reconnecting');
          if (this.state.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('[WhatsApp] ⏹️  Too many 440 conflicts. Giving up — restart the server or scan QR again.');
            this.updateStatus('disconnected');
            return;
          }
          await new Promise(resolve => setTimeout(resolve, delay));
          try {
            await this.connect();
          } catch (err: any) {
            console.error('[WhatsApp] 💥 Reconnect after 440 conflict failed:', err.message);
          }
          return;
        }
        
        if (isLoggedOut) {
          // Session is invalid — clear stale creds and reconnect for fresh QR
          console.log('[WhatsApp] 🔄 Session expired — clearing creds and reconnecting for new QR...');
          this.updateStatus('connecting');
          this.state.reconnectAttempts = 0;
          await this.clearSession();
          try {
            await this.connect();
          } catch (err: any) {
            console.error('[WhatsApp] Reconnect after session expiration failed:', err.message);
          }
        } else if (!this.hasConnectedBefore && this.maxQrRetries > 0 && this.state.qrAttempts >= this.maxQrRetries * 6) {
          // Never connected + QR retries exhausted → stop
          console.log('[WhatsApp] ⏹️  Not reconnecting — QR retry limit reached. Restart when ready to scan.');
          this.updateStatus('disconnected');
        } else if (this.state.reconnectAttempts >= this.maxReconnectAttempts) {
          // Too many reconnects
          console.log(`[WhatsApp] ⏹️  Max reconnect attempts (${this.maxReconnectAttempts}) reached. Giving up.`);
          this.updateStatus('disconnected');
        } else {
          this.state.reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, this.state.reconnectAttempts - 1), 30000);
          console.log(`[WhatsApp] 🔄 Reconnecting in ${(delay / 1000).toFixed(0)}s (attempt ${this.state.reconnectAttempts}/${this.maxReconnectAttempts})...`);
          this.updateStatus('reconnecting');
          await new Promise(resolve => setTimeout(resolve, delay));
          try {
            await this.connect();
          } catch (err: any) {
            console.error('[WhatsApp] 💥 Auto-reconnect failed (will retry on next cycle if applicable):', err.message);
          }
        }
      } else if (connection === 'open') {
        this.hasConnectedBefore = true;
        this.updateStatus('connected');
        this.state.lastConnected = new Date();
        this.state.reconnectAttempts = 0;
        this.state.qrAttempts = 0;
        this.state.qrCode = null;
        console.log('[WhatsApp] ✅ Connected successfully');
        // Load LID→phone mappings from session files
        this.loadLIDMappings().catch(err => 
          console.error('[WhatsApp] Failed to load LID mappings:', err.message)
        );
      }
    });

    // ── Dynamic LID mapping capture ──────────────────────────
    // Baileys emits contacts.update when it resolves LID↔phone associations.
    // We capture these at runtime so we don't need to restart to learn new contacts.
    this.socket.ev.on('contacts.update' as any, (updates: any[]) => {
      for (const contact of updates) {
        if (!contact.id) continue;
        const id = contact.id as string;
        // If this is a phone JID and we get a LID, save the mapping
        if (id.endsWith('@s.whatsapp.net') && contact.lid) {
          const lidJid = typeof contact.lid === 'string'
            ? (contact.lid.endsWith('@lid') ? contact.lid : `${contact.lid}@lid`)
            : undefined;
          if (lidJid && !this.lidToPhone.has(lidJid)) {
            this.lidToPhone.set(lidJid, id);
            this.phoneToLid.set(id, lidJid);
            console.log('[WhatsApp] Learned contact address mapping');
            this.saveLIDMapping(lidJid, id).catch(() => {});
          }
        }
        // If this is a LID and we have the phone, save it
        if (id.endsWith('@lid') && !this.lidToPhone.has(id)) {
          // Check if we can find a phone from Baileys' internal resolution
          const verifiedName = contact.verifiedName || contact.notify || contact.name;
          if (verifiedName) {
            console.log('[WhatsApp] Received contact address update');
          }
        }
      }
    });

    this.socket.ev.on('creds.update', async () => {
      if (this.saveCreds) {
        await this.saveCreds();
      }
    });

    // ── Messaging history for LID↔phone linking ─────────────
    // When Baileys sends/receives messages, we can often learn LID↔phone
    // from the message's participant or key.remoteJid fields.
    this.socket.ev.on('messaging-history.set' as any, (data: any) => {
      try {
        const contacts = data?.contacts || [];
        for (const c of contacts) {
          if (c.id?.endsWith('@s.whatsapp.net') && c.lid) {
            const lidJid = c.lid.endsWith('@lid') ? c.lid : `${c.lid}@lid`;
            if (!this.lidToPhone.has(lidJid)) {
              this.lidToPhone.set(lidJid, c.id);
              this.phoneToLid.set(c.id, lidJid);
            console.log('[WhatsApp] Learned contact address mapping from history');
              this.saveLIDMapping(lidJid, c.id).catch(() => {});
            }
          }
        }
      } catch {
        // Ignore history parse errors
      }
    });

    this.socket.ev.on('messages.upsert', ({ messages, type }) => {
      for (const msg of messages) {
        // Skip status@broadcast — these are WhatsApp Status/Story updates, not real chats
        if (msg.key.remoteJid === 'status@broadcast') continue;

        const body = this.extractBody(msg);
        const hasMedia = !!(msg.message?.imageMessage || msg.message?.videoMessage || msg.message?.audioMessage || msg.message?.documentMessage);
        const hasInteractive = this.hasInteractiveContent(msg);

        // Skip empty-body non-notify events (contact syncs, phone lookups, receipts etc.)
        if (!body && !hasMedia && !hasInteractive) continue;

        console.log(`[WhatsApp] Received type=${type} fromMe=${msg.key.fromMe} media=${hasMedia} interactive=${hasInteractive} chars=${body.length}`);

        // Store raw message for media download AND interactive response lookup
        if (msg.key.id) {
          this.rawMessages.set(msg.key.id, msg);
          // Prune old messages to prevent memory leak
          if (this.rawMessages.size > this.MAX_RAW_MESSAGES) {
            const oldest = this.rawMessages.keys().next().value;
            if (oldest) this.rawMessages.delete(oldest);
          }
        }

        // Emit message if not from self
        if (!msg.key.fromMe) {
          const parsed = this.parseMessage(msg, body || '[Media message]');
          this.emit('message.received', parsed);
        }
      }
    });
  }

  /** Check if a raw message contains interactive content */
  private hasInteractiveContent(msg: any): boolean {
    const m = msg.message;
    if (!m) return false;
    return !!(m.interactiveMessage || m.interactiveResponseMessage ||
             m.buttonsMessage || m.buttonsResponseMessage ||
             m.listMessage || m.listResponseMessage ||
             m.templateMessage || m.templateButtonReplyMessage);
  }

  /** Extract text body from any WhatsApp message type, including interactive content */
  private extractBody(msg: any): string {
    const m = msg.message;
    if (!m) return '';

    // Standard text messages
    const basicText = m.conversation
      || m.extendedTextMessage?.text
      || m.imageMessage?.caption
      || m.videoMessage?.caption
      || m.documentMessage?.caption;
    if (basicText) return basicText;

    // ── Interactive response messages (user tapped a button / selected a list item) ──
    if (m.buttonsResponseMessage?.selectedDisplayText) {
      return `[Button selected: ${m.buttonsResponseMessage.selectedDisplayText}]`;
    }
    if (m.listResponseMessage?.singleSelectReply?.selectedRowId) {
      const title = m.listResponseMessage.title || '';
      const rowId = m.listResponseMessage.singleSelectReply.selectedRowId;
      return `[List selection: ${rowId}]${title ? ` (${title})` : ''}`;
    }
    if (m.templateButtonReplyMessage?.selectedDisplayText) {
      return `[Template button selected: ${m.templateButtonReplyMessage.selectedDisplayText}]`;
    }
    if (m.interactiveResponseMessage) {
      const irm = m.interactiveResponseMessage;
      const bodyText = irm.body?.text || '';
      const nfr = irm.nativeFlowResponseMessage;
      if (nfr) {
        const name = nfr.name || 'unknown';
        let params = '';
        try { params = nfr.paramsJson ? JSON.stringify(JSON.parse(nfr.paramsJson)) : ''; } catch { params = nfr.paramsJson || ''; }
        return `[Interactive response: ${name}${params ? ` — ${params}` : ''}]${bodyText ? `\n${bodyText}` : ''}`;
      }
      return bodyText || '[Interactive response]';
    }

    // ── Interactive messages (bot sending buttons, lists, carousels) ──
    if (m.interactiveMessage) {
      return this.extractInteractiveBody(m.interactiveMessage);
    }

    // ── Buttons message (legacy format) ──
    if (m.buttonsMessage) {
      const bm = m.buttonsMessage;
      const lines: string[] = [];
      if (bm.contentText) lines.push(bm.contentText);
      if (bm.footerText) lines.push(bm.footerText);
      if (bm.buttons && Array.isArray(bm.buttons)) {
        lines.push('\n--- Buttons ---');
        for (let i = 0; i < bm.buttons.length; i++) {
          const btn = bm.buttons[i];
          const label = btn.buttonText?.displayText || btn.buttonId || `Option ${i + 1}`;
          const id = btn.buttonId || `btn_${i}`;
          lines.push(`[${i + 1}] ${label} (id: ${id})`);
        }
      }
      return lines.join('\n');
    }

    // ── List message ──
    if (m.listMessage) {
      const lm = m.listMessage;
      const lines: string[] = [];
      if (lm.title) lines.push(lm.title);
      if (lm.description) lines.push(lm.description);
      if (lm.buttonText) lines.push(`\nTap: "${lm.buttonText}"`);
      if (lm.sections && Array.isArray(lm.sections)) {
        let itemIdx = 1;
        for (const section of lm.sections) {
          if (section.title) lines.push(`\n--- ${section.title} ---`);
          if (section.rows && Array.isArray(section.rows)) {
            for (const row of section.rows) {
              const label = row.title || row.rowId || `Item ${itemIdx}`;
              const desc = row.description ? ` — ${row.description}` : '';
              lines.push(`[${itemIdx}] ${label}${desc} (id: ${row.rowId})`);
              itemIdx++;
            }
          }
        }
      }
      if (lm.footerText) lines.push(`\n${lm.footerText}`);
      return lines.join('\n');
    }

    // ── Template message ──
    if (m.templateMessage) {
      const tm = m.templateMessage;
      const hydrated = tm.hydratedTemplate || tm.hydratedFourRowTemplate;
      if (hydrated) {
        const lines: string[] = [];
        if (hydrated.hydratedContentText) lines.push(hydrated.hydratedContentText);
        if (hydrated.hydratedFooterText) lines.push(hydrated.hydratedFooterText);
        if (hydrated.hydratedButtons && Array.isArray(hydrated.hydratedButtons)) {
          lines.push('\n--- Buttons ---');
          for (let i = 0; i < hydrated.hydratedButtons.length; i++) {
            const btn = hydrated.hydratedButtons[i];
            const label = btn.quickReplyButton?.displayText || btn.urlButton?.displayText || btn.callButton?.displayText || `Button ${i + 1}`;
            const id = btn.quickReplyButton?.id || `tmpl_btn_${i}`;
            lines.push(`[${i + 1}] ${label} (id: ${id})`);
          }
        }
        return lines.join('\n');
      }
    }

    return '';
  }

  /** Extract readable text from an InteractiveMessage (native flow buttons, carousels, etc.) */
  private extractInteractiveBody(im: any): string {
    const lines: string[] = [];

    // Header
    if (im.header) {
      if (im.header.title) lines.push(`**${im.header.title}**`);
      if (im.header.subtitle) lines.push(im.header.subtitle);
    }

    // Body text
    if (im.body?.text) lines.push(im.body.text);

    // Footer
    if (im.footer?.text) lines.push(im.footer.text);

    // Native flow message (modern button format)
    if (im.nativeFlowMessage) {
      const nfm = im.nativeFlowMessage;
      if (nfm.buttons && Array.isArray(nfm.buttons)) {
        lines.push('\n--- Options ---');
        for (let i = 0; i < nfm.buttons.length; i++) {
          const btn = nfm.buttons[i];
          const name = btn.name || 'button';
          let label = `Option ${i + 1}`;
          let paramsStr = '';
          if (btn.buttonParamsJson) {
            try {
              const params = JSON.parse(btn.buttonParamsJson);
              label = params.display_text || params.title || label;
              paramsStr = btn.buttonParamsJson;
            } catch {
              paramsStr = btn.buttonParamsJson;
            }
          }
          lines.push(`[${i + 1}] ${label} (flow: ${name}, params: ${paramsStr})`);
        }
      }
      if (nfm.messageParamsJson) {
        try {
          const mp = JSON.parse(nfm.messageParamsJson);
          if (mp.header) lines.unshift(`**${mp.header}**`);
        } catch { /* ignore */ }
      }
    }

    // Carousel message (multiple cards)
    if (im.carouselMessage?.cards && Array.isArray(im.carouselMessage.cards)) {
      lines.push('\n--- Carousel ---');
      for (let i = 0; i < im.carouselMessage.cards.length; i++) {
        const card = im.carouselMessage.cards[i];
        lines.push(`\nCard ${i + 1}:`);
        lines.push(this.extractInteractiveBody(card));
      }
    }

    // Shop/Collection (less common, but capture)
    if (im.shopStorefrontMessage) {
      lines.push('[Shop storefront message]');
    }
    if (im.collectionMessage) {
      lines.push(`[Collection: ${im.collectionMessage.id || 'unknown'}]`);
    }

    return lines.join('\n');
  }

  private parseMessage(msg: any, body: string): WhatsAppMessage {
    const rawJid = msg.key.remoteJid || '';
    let from = rawJid;
    const pushName = msg.pushName || undefined;

    // Resolve LID → phone number if needed (for identification only)
    if (from.endsWith('@lid')) {
      if (msg.key.participant) {
        // Group message — participant is the actual sender's phone JID
        from = msg.key.participant;

        // Also learn this LID↔phone mapping for future DM resolution
        if (!this.lidToPhone.has(rawJid) && msg.key.participant.endsWith('@s.whatsapp.net')) {
          this.lidToPhone.set(rawJid, msg.key.participant);
          this.phoneToLid.set(msg.key.participant, rawJid);
        console.log('[WhatsApp] Learned a group LID mapping');
          this.saveLIDMapping(rawJid, msg.key.participant).catch(() => {});
        }
      } else {
        const resolved = this.lidToPhone.get(from);
        if (resolved) {
        console.log('[WhatsApp] Resolved contact address');
          from = resolved;
        } else {
        console.log('[WhatsApp] Contact address remains unresolved');
          // Keep rawJid as `from` — the reply will still work via LID
          // But log the pushName so the skill engine can use it for better context
        }
      }
    }

    console.log(`[WhatsApp] Parsed inbound message (${body.length} chars)`);
    return {
      id: msg.key.id,
      from,
      rawJid,
      to: msg.key.fromMe ? msg.key.remoteJid : '',
      body,
      timestamp: new Date(msg.messageTimestamp * 1000),
      isFromMe: msg.key.fromMe,
      hasMedia: !!(msg.message?.imageMessage || msg.message?.videoMessage || msg.message?.audioMessage || msg.message?.documentMessage),
      quotedMessageId: msg.message?.extendedTextMessage?.contextInfo?.stanzaId,
      participant: msg.key.participant || undefined,
      pushName,
      interactiveOptions: this.extractInteractiveOptions(msg),
    };
  }

  /** Extract structured interactive options from a raw message for tool use */
  private extractInteractiveOptions(msg: any): WhatsAppInteractiveOption[] | undefined {
    const m = msg.message;
    if (!m) return undefined;

    const options: WhatsAppInteractiveOption[] = [];

    // Buttons message
    if (m.buttonsMessage?.buttons) {
      for (const btn of m.buttonsMessage.buttons) {
        options.push({
          type: 'button',
          id: btn.buttonId || '',
          label: btn.buttonText?.displayText || '',
        });
      }
    }

    // List message
    if (m.listMessage?.sections) {
      for (const section of m.listMessage.sections) {
        if (section.rows) {
          for (const row of section.rows) {
            options.push({
              type: 'list_item',
              id: row.rowId || '',
              label: row.title || '',
              description: row.description,
              section: section.title,
            });
          }
        }
      }
    }

    // Template buttons
    if (m.templateMessage) {
      const hydrated = m.templateMessage.hydratedTemplate || m.templateMessage.hydratedFourRowTemplate;
      if (hydrated?.hydratedButtons) {
        for (const btn of hydrated.hydratedButtons) {
          if (btn.quickReplyButton) {
            options.push({
              type: 'quick_reply',
              id: btn.quickReplyButton.id || '',
              label: btn.quickReplyButton.displayText || '',
            });
          } else if (btn.urlButton) {
            options.push({
              type: 'url_button',
              id: '',
              label: btn.urlButton.displayText || '',
              url: btn.urlButton.url,
            });
          }
        }
      }
    }

    // Interactive message (native flow)
    if (m.interactiveMessage?.nativeFlowMessage?.buttons) {
      for (const btn of m.interactiveMessage.nativeFlowMessage.buttons) {
        let label = 'Option';
        let flowParams: any = {};
        if (btn.buttonParamsJson) {
          try {
            flowParams = JSON.parse(btn.buttonParamsJson);
            label = flowParams.display_text || flowParams.title || label;
          } catch { /* ignore */ }
        }
        options.push({
          type: 'native_flow',
          id: btn.name || '',
          label,
          flowName: btn.name,
          flowParams: btn.buttonParamsJson,
        });
      }
    }

    // Interactive message carousel
    if (m.interactiveMessage?.carouselMessage?.cards) {
      for (let i = 0; i < m.interactiveMessage.carouselMessage.cards.length; i++) {
        const card = m.interactiveMessage.carouselMessage.cards[i];
        if (card.nativeFlowMessage?.buttons) {
          for (const btn of card.nativeFlowMessage.buttons) {
            let label = `Card ${i + 1} Option`;
            if (btn.buttonParamsJson) {
              try {
                const p = JSON.parse(btn.buttonParamsJson);
                label = p.display_text || p.title || label;
              } catch { /* ignore */ }
            }
            options.push({
              type: 'native_flow',
              id: btn.name || '',
              label,
              flowName: btn.name,
              flowParams: btn.buttonParamsJson,
              cardIndex: i,
            });
          }
        }
      }
    }

    return options.length > 0 ? options : undefined;
  }

  /** Send a selection response to a WhatsApp bot's interactive message */
  async sendInteractiveResponse(
    jid: string,
    originalMessageId: string,
    selection: { type: string; id: string; label?: string; flowName?: string; flowParams?: string },
  ): Promise<WAMessage | undefined> {
    if (!this.socket) throw new Error('Not connected to WhatsApp');

    const rawMsg = this.rawMessages.get(originalMessageId);
    const quotedMsg = rawMsg || undefined;

    // For text-based bot menus (like Medcare's "type A"), just send the text
    if (selection.type === 'text_reply') {
      const content: AnyMessageContent = {
        text: selection.id,
      };
      return this.rateLimiter.sendMessage(this.socket, jid, content);
    }

    // For button responses
    if (selection.type === 'button') {
      // Baileys: send buttonsResponseMessage isn't directly supported.
      // WhatsApp Business API bots often accept plain text replies.
      const content: AnyMessageContent = {
        text: selection.label || selection.id,
      };
      return this.rateLimiter.sendMessage(this.socket, jid, content);
    }

    // For list selections
    if (selection.type === 'list_item') {
      const content: AnyMessageContent = {
        text: selection.label || selection.id,
      };
      return this.rateLimiter.sendMessage(this.socket, jid, content);
    }

    // For quick reply buttons
    if (selection.type === 'quick_reply') {
      const content: AnyMessageContent = {
        text: selection.label || selection.id,
      };
      return this.rateLimiter.sendMessage(this.socket, jid, content);
    }

    // For native flow (modern interactive buttons), send as text
    // Most WhatsApp bots accept the display text as a reply
    if (selection.type === 'native_flow') {
      const content: AnyMessageContent = {
        text: selection.label || selection.id,
      };
      return this.rateLimiter.sendMessage(this.socket, jid, content);
    }

    // Fallback: just send the label/id as text
    const content: AnyMessageContent = {
      text: selection.label || selection.id,
    };
    return this.rateLimiter.sendMessage(this.socket, jid, content);
  }

  /** Get the interactive options from a stored raw message */
  getInteractiveOptions(messageId: string): WhatsAppInteractiveOption[] | undefined {
    const raw = this.rawMessages.get(messageId);
    if (!raw) return undefined;
    return this.extractInteractiveOptions(raw);
  }

  private updateStatus(status: WhatsAppConnectionStatus): void {
    this.state.status = status;
    this.emit('connection.update', status);
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
        (listener as Function)(...args);
      }
    }
  }
}

export function createWhatsAppConnection(
  config: Partial<WhatsAppConnectionConfig> = {}
): WhatsAppConnection {
  return new WhatsAppConnection(config);
}
