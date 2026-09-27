/**
 * Webchat Connection
 * Connects to a remote cloud relay to receive and respond to webchat messages.
 * 
 * Architecture: YOUBOT receives push notifications over an outbound WebSocket.
 * The relay holds visitor messages until YOUBOT picks them up.
 * 
 * Older relays retain polling compatibility.
 */

export interface WebchatConfig {
  /** URL of the cloud relay (e.g. https://youbot-webchat-xxx.run.app) */
  relayUrl: string;
  /** Secret for authenticating with the relay */
  botSecret: string;
  /** Empty polling interval for older relays in ms (default: 2000) */
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
  private lifecycle: AbortController | null = null;
  private socket: WebSocket | null = null;
  private running = false;
  private _supportsSessionReplies = false;
  private _reconnectAttempts = 0;
  private supportsPush = false;
  private startupRetryAttempts = 0;
  private startupRetryTimer: ReturnType<typeof setTimeout> | undefined;
  /** Track message IDs currently being processed to avoid re-dispatching */
  private inFlightMessageIds = new Set<string>();
  /** Cache completed responses so delivery recovery never re-runs the AI turn. */
  private replyOutbox = new Map<string, { response: string; retryAt: number; rounds: number; terminal: boolean }>();
  private replyDeliveries = new Map<string, Promise<void>>();
  private replyRetryTimer: ReturnType<typeof setTimeout> | undefined;

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
    if (!this.config.relayUrl) throw new Error('Webchat relay URL is required');
    if (this.running) return;
    // An explicit reconnect replaces any failed startup's scheduled retry.
    clearTimeout(this.startupRetryTimer); this.startupRetryTimer = undefined;
    this.lifecycle?.abort();
    const lifecycle = new AbortController();
    this.lifecycle = lifecycle;
    this.startupRetryAttempts = 0;
    await this.connectAttempt(lifecycle);
  }

  private async connectAttempt(lifecycle: AbortController): Promise<void> {
    if (lifecycle.signal.aborted || this.lifecycle !== lifecycle) return;
    this.running = true;
    this.updateStatus('connecting');
    if (lifecycle.signal.aborted) return;
    let retryable = true;
    try {
      const healthRes = await fetch(`${this.config.relayUrl}/health`, {
        signal: AbortSignal.any([lifecycle.signal, AbortSignal.timeout(10000)]),
      });
      if (!healthRes.ok) throw new Error(`Relay health check failed: ${healthRes.status}`);
      const health = await healthRes.json() as { capabilities?: { sessionReplies?: boolean; botPush?: boolean } };
      if (lifecycle.signal.aborted) return;
      this._supportsSessionReplies = health.capabilities?.sessionReplies === true;
      this.supportsPush = health.capabilities?.botPush === true;
      if (this.supportsPush && typeof WebSocket === 'undefined') {
        retryable = false;
        throw new Error('Push webchat requires Node.js 22 or later.');
      }
      this._reconnectAttempts = 0;
      this.startupRetryAttempts = 0;
      if (!this.supportsPush) { this.updateStatus('connected'); this.retryReplies(true); }
      void this.receiveLoop(lifecycle.signal);
    } catch (err) {
      if (lifecycle.signal.aborted) return;
      this.running = false;
      this.updateStatus('error');
      if (retryable && this.lifecycle === lifecycle) {
        const delay = Math.min(2000 * 2 ** Math.min(this.startupRetryAttempts++, 4), 30000);
        this.startupRetryTimer = setTimeout(() => {
          this.startupRetryTimer = undefined;
          if (lifecycle.signal.aborted || this.lifecycle !== lifecycle) return;
          void this.connectAttempt(lifecycle).catch(error => {
            if (!lifecycle.signal.aborted) this.emit('error', error instanceof Error ? error : new Error(String(error)));
          });
        }, delay);
      }
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    this.running = false;
    clearTimeout(this.startupRetryTimer); this.startupRetryTimer = undefined;
    clearTimeout(this.replyRetryTimer); this.replyRetryTimer = undefined;
    this.lifecycle?.abort();
    this.lifecycle = null;
    this.socket?.close();
    this.socket = null;
    this._supportsSessionReplies = false;
    this.updateStatus('disconnected');
  }

  /** A reply remains in flight until the relay confirms durable persistence. */
  async respond(messageId: string, response: string): Promise<void> {
    const previous = this.replyOutbox.get(messageId);
    if (previous && previous.response !== response) throw new Error('A different response is already awaiting delivery for this message.');
    if (!previous) this.replyOutbox.set(messageId, { response, retryAt: 0, rounds: 0, terminal: false });
    const active = this.replyDeliveries.get(messageId);
    if (active) return active;
    const delivery = this.deliverReply(messageId);
    this.replyDeliveries.set(messageId, delivery);
    try { await delivery; }
    finally {
      this.replyDeliveries.delete(messageId);
      this.scheduleReplyRetry();
    }
  }

  private async deliverReply(messageId: string): Promise<void> {
    const entry = this.replyOutbox.get(messageId)!;
    const signal = this.lifecycle?.signal;
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(`${this.config.relayUrl}/api/bot/reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Bot-Secret': this.config.botSecret || '' },
          body: JSON.stringify({ messageId, response: entry.response }),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
        });
        if (!res.ok) {
          entry.terminal = [400, 403, 404, 409, 422].includes(res.status);
          throw new Error(`Website reply was not confirmed (${res.status}).`);
        }
        const receipt = await res.json() as { ok?: boolean };
        if (receipt.ok !== true) throw new Error('Website reply receipt was invalid.');
        this.replyOutbox.delete(messageId);
        this.inFlightMessageIds.delete(messageId);
        return;
      } catch (err) {
        if (attempt >= 2 || signal?.aborted || entry.terminal) {
          if (!signal?.aborted) entry.rounds++;
          entry.terminal ||= entry.rounds >= 10;
          entry.retryAt = Date.now() + Math.min(5000 * 2 ** Math.min(entry.rounds, 3), 30000);
          // The caller sees the failure now; later recovery uses this exact reply.
          throw err;
        }
        await this.pause(1000 * (attempt + 1), signal);
      }
    }
  }

  private retryReplies(force = false): void {
    if (!this.running || this.lifecycle?.signal.aborted) return;
    for (const [messageId, entry] of this.replyOutbox) {
      if (entry.terminal || this.replyDeliveries.has(messageId) || (!force && entry.retryAt > Date.now())) continue;
      void this.respond(messageId, entry.response).catch(err => this.emit('error', err instanceof Error ? err : new Error(String(err))));
    }
    this.scheduleReplyRetry();
  }

  private scheduleReplyRetry(): void {
    clearTimeout(this.replyRetryTimer); this.replyRetryTimer = undefined;
    if (!this.running || this.lifecycle?.signal.aborted) return;
    const times = [...this.replyOutbox].filter(([id, entry]) => !entry.terminal && !this.replyDeliveries.has(id)).map(([, entry]) => entry.retryAt);
    if (times.length) this.replyRetryTimer = setTimeout(() => this.retryReplies(), Math.max(100, Math.min(...times) - Date.now()));
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

  // Push connections sleep between notifications; only legacy relays poll while idle.
  private async receiveLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        if (this.supportsPush) {
          await this.pushSession(signal);
        } else {
          const count = await this.pollOnce(signal);
          if (signal.aborted) return;
          this.updateStatus('connected');
          this._reconnectAttempts = 0;
          if (!count) await this.pause(this.config.pollingInterval ?? 2000, signal);
          continue;
        }
        if (!signal.aborted) throw new Error('Website notification connection closed.');
      } catch (err) {
        if (signal.aborted) return;
        this._reconnectAttempts++;
        this.updateStatus(this._reconnectAttempts >= 5 ? 'error' : 'connecting');
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
        await this.pause(Math.min(2000 * this._reconnectAttempts, 30000), signal);
      }
    }
  }

  private async pollOnce(signal: AbortSignal): Promise<number> {
    const res = await fetch(`${this.config.relayUrl}/api/bot/poll`, {
      headers: { 'X-Bot-Secret': this.config.botSecret || '' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(35000)]),
    });
    if (!res.ok) throw new Error(`Poll failed: ${res.status}`);
    const data = await res.json() as { messages?: WebchatMessage[]; capabilities?: { sessionReplies?: boolean } };
    if (signal.aborted) return 0;
    if (data.capabilities) this._supportsSessionReplies = data.capabilities.sessionReplies === true;
    for (const msg of data.messages ?? []) {
      if (this.inFlightMessageIds.has(msg.id) || this.replyOutbox.has(msg.id)) continue;
      this.inFlightMessageIds.add(msg.id);
      this.emit('message.received', msg);
    }
    return data.messages?.length ?? 0;
  }

  private async pushSession(signal: AbortSignal): Promise<void> {
    const ticketResponse = await fetch(`${this.config.relayUrl}/api/bot/socket-ticket`, {
      method: 'POST',
      headers: { 'X-Bot-Secret': this.config.botSecret || '' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    });
    if (!ticketResponse.ok) throw new Error(`Website notification ticket failed (${ticketResponse.status}).`);
    const { ticket } = await ticketResponse.json() as { ticket?: string };
    if (typeof ticket !== 'string' || !ticket) throw new Error('Website notification ticket was invalid.');
    if (signal.aborted) return;
    const url = new URL(`${this.config.relayUrl}/api/bot/events`);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('ticket', ticket);
    const socket = new WebSocket(url);
    this.socket = socket;
    const session = new AbortController();
    const sessionSignal = AbortSignal.any([signal, session.signal]);
    await new Promise<void>((resolve, reject) => {
      let finished = false;
      let draining = false;
      let requested = false;
      let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
      let pongTimer: ReturnType<typeof setTimeout> | undefined;
      const heartbeat = () => {
        clearTimeout(heartbeatTimer);
        heartbeatTimer = setTimeout(() => {
          if (finished) return;
          pongTimer = setTimeout(() => finish(new Error('Website notification connection stopped responding.')), 10000);
          try { socket.send('ping'); }
          catch { finish(new Error('Website notification connection failed.')); }
        }, 30000);
      };
      const timer = setTimeout(() => finish(new Error('Website notification connection timed out.')), 10000);
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        clearTimeout(heartbeatTimer);
        clearTimeout(pongTimer);
        signal.removeEventListener('abort', aborted);
        session.abort();
        if (this.socket === socket) this.socket = null;
        socket.close();
        if (error) reject(error); else resolve();
      };
      const aborted = () => finish();
      const drain = async () => {
        requested = true;
        if (draining) return;
        draining = true;
        try {
          while (requested && !sessionSignal.aborted) {
            requested = false;
            while (!sessionSignal.aborted && await this.pollOnce(sessionSignal) > 0) { /* drain claimed queue */ }
          }
        } catch (err) {
          if (!sessionSignal.aborted) finish(err instanceof Error ? err : new Error(String(err)));
        } finally {
          draining = false;
        }
      };
      signal.addEventListener('abort', aborted, { once: true });
      socket.addEventListener('message', (event: MessageEvent) => {
        if (finished) return;
        if (event.data === 'pong') {
          clearTimeout(pongTimer); pongTimer = undefined;
          heartbeat();
          return;
        }
        let data: { type?: string };
        try { data = JSON.parse(String(event.data)); } catch { return; }
        if (data.type === 'ready') {
          clearTimeout(timer);
          this._reconnectAttempts = 0;
          this.updateStatus('connected');
          heartbeat();
          this.retryReplies(true);
          void drain();
        } else if (data.type === 'messages_available') {
          this.retryReplies();
          void drain();
        }
      });
      socket.addEventListener('close', () => finish());
      socket.addEventListener('error', () => finish(new Error('Website notification connection failed.')));
      if (signal.aborted) finish();
    });
  }

  private pause(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.resolve();
    return new Promise(resolve => {
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal?.addEventListener('abort', done, { once: true });
    });
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

  private releaseFailedMessage(event: keyof WebchatConnectionEvents, value: unknown): void {
    if (event !== 'message.received') return;
    const messageId = (value as WebchatMessage).id;
    // A processing failure can be claimed again; a completed response must only
    // retry delivery, because regenerating it could repeat external side effects.
    if (!this.replyOutbox.has(messageId)) this.inFlightMessageIds.delete(messageId);
  }

  private emit<K extends keyof WebchatConnectionEvents>(
    event: K,
    ...args: Parameters<WebchatConnectionEvents[K]>
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          const result = (listener as Function)(...args);
          // Message consumers are often async; report rejected delivery/processing
          // promises without leaving an unhandled rejection in the host process.
          Promise.resolve(result).catch(err => {
            console.error(`[Webchat] Event handler error (${event})`);
            this.releaseFailedMessage(event, args[0]);
            if (event !== 'error') this.emit('error', err instanceof Error ? err : new Error(String(err)));
          });
        } catch (err) {
          console.error(`[Webchat] Event handler error (${event})`);
          this.releaseFailedMessage(event, args[0]);
          if (event !== 'error') this.emit('error', err instanceof Error ? err : new Error(String(err)));
        }
      }
    }
  }
}
