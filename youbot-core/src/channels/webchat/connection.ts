/**
 * Webchat Connection
 * Connects to a remote cloud relay to receive and respond to webchat messages.
 * 
 * Architecture: YOUBOT (local) polls relay (public cloud) — works through NAT.
 * The relay holds visitor messages until YOUBOT picks them up.
 * 
 * This mirrors how TelegramConnection works with Telegram's servers.
 */

export interface WebchatConfig {
  /** URL of the cloud relay (e.g. https://youbot-webchat-xxx.run.app) */
  relayUrl: string;
  /** Secret for authenticating with the relay */
  botSecret: string;
  /** Polling interval in ms (default: 2000) */
  pollingInterval?: number;
}

export type WebchatConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface WebchatMessage {
  /** Unique message ID (from relay) */
  id: string;
  /** Visitor session ID */
  session: string;
  /** Visitor display name */
  name: string;
  /** Message body */
  message: string;
  /** Owner key for owner identification (optional) */
  ownerKey?: string;
  /** Base64 data URL of voice audio (optional) */
  audio?: string;
  /** Base64 data URL of image attachment (optional) */
  image?: string;
}

export interface WebchatConnectionEvents {
  'connection.update': (status: WebchatConnectionStatus) => void;
  'message.received': (msg: WebchatMessage) => void;
  'error': (err: Error) => void;
}

export class WebchatConnection {
  private config: WebchatConfig;
  private _status: WebchatConnectionStatus = 'disconnected';
  private eventListeners = new Map<string, Set<Function>>();
  private pollAbortController: AbortController | null = null;
  private running = false;
  private _supportsSessionReplies = false;
  private _reconnectAttempts = 0;
  /** Track message IDs currently being processed to avoid re-dispatching */
  private inFlightMessageIds = new Set<string>();

  constructor(config: WebchatConfig) {
    this.config = config;
  }

  get status(): WebchatConnectionStatus {
    return this._status;
  }

  get relayUrl(): string {
    return this.config.relayUrl;
  }

  get supportsSessionReplies(): boolean {
    return this._supportsSessionReplies;
  }

  /** Persist an asynchronous reply to an existing visitor session. Never swallow delivery errors. */
  async sendMessage(session: string, response: string, requestId: string): Promise<void> {
    if (this.status !== 'connected' || !this.supportsSessionReplies) {
      throw new Error('Website relay is not ready for manual replies.');
    }
    const res = await fetch(`${this.config.relayUrl}/api/bot/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bot-Secret': this.config.botSecret || '' },
      body: JSON.stringify({ session, response, requestId }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Website reply was not confirmed (${res.status}).`);
    const receipt = await res.json() as { ok?: boolean; requestId?: string };
    if (receipt.ok !== true || receipt.requestId !== requestId) throw new Error('Website reply receipt was invalid.');
  }

  async connect(): Promise<void> {
    if (!this.config.relayUrl) {
      throw new Error('Webchat relay URL is required');
    }

    this.updateStatus('connecting');
    this.running = true;

    // Verify connectivity by checking relay health
    try {
      const healthRes = await fetch(`${this.config.relayUrl}/health`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!healthRes.ok) {
        throw new Error(`Relay health check failed: ${healthRes.status}`);
      }
      const health = await healthRes.json() as { capabilities?: { sessionReplies?: boolean } };
      this._supportsSessionReplies = health.capabilities?.sessionReplies === true;
      console.log('[Webchat] Connected to relay');
      this.updateStatus('connected');
      this._reconnectAttempts = 0;
    } catch (err: any) {
      console.error(`[Webchat] ❌ Failed to connect to relay: ${err.message}`);
      this.updateStatus('error');
      throw err;
    }

    // Start polling loop
    this.pollLoop();
  }

  async disconnect(): Promise<void> {
    this.running = false;
    this._supportsSessionReplies = false;
    if (this.pollAbortController) {
      this.pollAbortController.abort();
      this.pollAbortController = null;
    }
    this.updateStatus('disconnected');
    console.log('[Webchat] Disconnected from relay');
  }

  /** Send a response for a pending message back to the relay */
  async respond(messageId: string, response: string): Promise<void> {
    // Remove from in-flight set so it won't be re-delivered
    this.inFlightMessageIds.delete(messageId);
    const url = `${this.config.relayUrl}/api/bot/reply`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Bot-Secret': this.config.botSecret || '',
        },
        body: JSON.stringify({ messageId, response }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        const text = await res.text();
        console.error(`[Webchat] Reply failed (${res.status}): ${text}`);
      }
    } catch (err: any) {
      console.error(`[Webchat] Reply error: ${err.message}`);
    }
  }

  /**
   * Send a typing indicator for a pending message.
   * This resets the relay's 120s hold timer so the visitor doesn't
   * see a timeout while a long agentic task is still running.
   */
  async sendTyping(messageId: string): Promise<void> {
    const url = `${this.config.relayUrl}/api/bot/typing`;
    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Bot-Secret': this.config.botSecret || '',
        },
        body: JSON.stringify({ messageId }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Non-fatal — typing indicators are best-effort
    }
  }

  /** Push widget config to the relay */
  async pushConfig(config: { title?: string; color?: string; welcomeMessage?: string; avatarUrl?: string }): Promise<void> {
    const url = `${this.config.relayUrl}/api/bot/config`;
    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Bot-Secret': this.config.botSecret || '',
        },
        body: JSON.stringify(config),
        signal: AbortSignal.timeout(10000),
      });
    } catch (err: any) {
      console.error(`[Webchat] Config push error: ${err.message}`);
    }
  }

  // ── Polling Loop ───────────────────────────────────────

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        this.pollAbortController = new AbortController();
        const secret = this.config.botSecret ? `?secret=${encodeURIComponent(this.config.botSecret)}` : '';
        const url = `${this.config.relayUrl}/api/bot/poll${secret}`;

        const res = await fetch(url, {
          headers: { 'X-Bot-Secret': this.config.botSecret || '' },
          signal: this.pollAbortController.signal,
        });

        if (!res.ok) {
          throw new Error(`Poll failed: ${res.status}`);
        }

        const data = await res.json() as { messages?: WebchatMessage[]; capabilities?: { sessionReplies?: boolean } };
        this._supportsSessionReplies = data.capabilities?.sessionReplies === true;
        if (data.messages && data.messages.length > 0) {
          for (const msg of data.messages) {
            // Skip messages already being processed (prevents re-delivery while LLM is running)
            if (this.inFlightMessageIds.has(msg.id)) continue;
            this.inFlightMessageIds.add(msg.id);
          console.log(`[Webchat] Received visitor message (${msg.message.length} chars)`);
            this.emit('message.received', msg);
          }
        } else {
          // No messages — small delay before next poll to avoid tight loop
          await new Promise(r => setTimeout(r, 500));
        }

        // Reset reconnect counter on success
        if (this._status !== 'connected') {
          this.updateStatus('connected');
        }
        this._reconnectAttempts = 0;

      } catch (err: any) {
        if (err.name === 'AbortError') {
          // Normal abort during disconnect
          continue;
        }

        this._reconnectAttempts++;
        const delay = Math.min(2000 * this._reconnectAttempts, 30000);
        console.error(`[Webchat] Poll error: ${err.message} — retrying in ${delay / 1000}s`);
        
        if (this._reconnectAttempts >= 5) {
          this.updateStatus('error');
          this.emit('error', new Error(`Poll failed after ${this._reconnectAttempts} attempts: ${err.message}`));
        }

        // Wait before retry
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  // ── Event Emitter ──────────────────────────────────────

  private updateStatus(status: WebchatConnectionStatus): void {
    this._status = status;
    this.emit('connection.update', status);
  }

  on<K extends keyof WebchatConnectionEvents>(
    event: K,
    handler: WebchatConnectionEvents[K]
  ): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(handler);
  }

  off<K extends keyof WebchatConnectionEvents>(
    event: K,
    handler: WebchatConnectionEvents[K]
  ): void {
    this.eventListeners.get(event)?.delete(handler);
  }

  removeAllListeners(): void {
    this.eventListeners.clear();
  }

  private emit<K extends keyof WebchatConnectionEvents>(
    event: K,
    ...args: Parameters<WebchatConnectionEvents[K]>
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          (listener as Function)(...args);
        } catch (err) {
          console.error(`[Webchat] Event handler error (${event})`);
        }
      }
    }
  }
}
