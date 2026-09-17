/**
 * WhatsApp Rate Limiter & Human-Like Delay Simulator
 *
 * Wraps outgoing WhatsApp sends to:
 * 1. Add random reply delays (2–6s) so messages don't arrive instantly
 * 2. Send typing indicators ("composing" presence) before each message
 * 3. Enforce per-contact minimum gaps (cooldown)
 * 4. Cap messages via multiple sliding windows (per-minute, per-hour, per-day)
 */

import type { WASocket, AnyMessageContent, WAMessage } from '@whiskeysockets/baileys';

// ── Configuration ──────────────────────────────────────────────

/** A single sliding-window rate limit interval */
export interface RateWindow {
  /** Human label for logging, e.g. "minute", "hour", "day" */
  label: string;
  /** Max messages allowed in this window */
  maxMessages: number;
  /** Duration of the window in ms */
  durationMs: number;
}

export interface RateLimiterConfig {
  /** Minimum random delay in ms before sending (default 2000) */
  minDelayMs: number;
  /** Maximum random delay in ms before sending (default 6000) */
  maxDelayMs: number;
  /** Whether to send typing indicators before messages (default true) */
  simulateTyping: boolean;
  /** Minimum gap between messages to the same contact in ms (default 3000) */
  perContactCooldownMs: number;
  /** Multiple sliding-window intervals (default: per-minute, per-hour, per-day) */
  windows: RateWindow[];
  /** Whether rate limiting is enabled at all (default true) */
  enabled: boolean;

  // ── Legacy single-window fields (mapped to windows[0] if present) ──
  /** @deprecated Use `windows` instead. Kept for backward compatibility. */
  maxMessagesPerWindow?: number;
  /** @deprecated Use `windows` instead. Kept for backward compatibility. */
  windowDurationMs?: number;
}

export const DEFAULT_WINDOWS: RateWindow[] = [
  { label: 'minute', maxMessages: 8, durationMs: 60_000 },
  { label: 'hour', maxMessages: 60, durationMs: 3_600_000 },
  { label: 'day', maxMessages: 500, durationMs: 86_400_000 },
];

export const DEFAULT_RATE_LIMITER_CONFIG: RateLimiterConfig = {
  minDelayMs: 2000,
  maxDelayMs: 6000,
  simulateTyping: true,
  perContactCooldownMs: 3000,
  windows: DEFAULT_WINDOWS,
  enabled: true,
};

// ── Rate Limiter ───────────────────────────────────────────────

export class WhatsAppRateLimiter {
  private config: RateLimiterConfig;
  /** Every send timestamp — checked against all windows */
  private globalSendLog: number[] = [];
  /** Last send time per contact JID */
  private contactLastSend: Map<string, number> = new Map();
  /** Mutex per contact to serialize sends to the same recipient */
  private contactLocks: Map<string, Promise<void>> = new Map();

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = this._mergeConfig(config);
  }

  /**
   * Send a message through the rate limiter.
   * Adds human-like delays, typing indicators, and rate limiting.
   */
  async sendMessage(
    socket: WASocket,
    jid: string,
    content: AnyMessageContent,
    options?: any,
  ): Promise<WAMessage | undefined> {
    if (!this.config.enabled) {
      return socket.sendMessage(jid, content, options);
    }

    // Serialize sends to the same contact (no parallel bursts)
    const lock = this.contactLocks.get(jid) ?? Promise.resolve();
    const sendPromise = lock.then(() => this._throttledSend(socket, jid, content, options));

    // Store the new lock (without leaking the return value)
    this.contactLocks.set(jid, sendPromise.then(() => {}).catch(() => {}));

    return sendPromise;
  }

  // ── Internals ──────────────────────────────────────────────

  private async _throttledSend(
    socket: WASocket,
    jid: string,
    content: AnyMessageContent,
    options?: any,
  ): Promise<WAMessage | undefined> {
    // 1. Wait for ALL global rate limit windows
    await this._waitForAllWindows();

    // 2. Wait for per-contact cooldown
    await this._waitForContactCooldown(jid);

    // 3. Random human-like delay
    const delay = this._randomDelay();
    console.log(`[RateLimiter] Delaying outbound message by ${delay}ms`);
    await sleep(delay);

    // 4. Simulate typing
    if (this.config.simulateTyping) {
      try {
        await socket.sendPresenceUpdate('composing', jid);
        // Typing duration proportional to message length (300–1500ms)
        const textLength = ('text' in content && typeof content.text === 'string')
          ? content.text.length
          : 50; // fallback
        const typingDuration = Math.min(300 + textLength * 15, 1500);
        await sleep(typingDuration);
        await socket.sendPresenceUpdate('paused', jid);
      } catch (err) {
        // Presence updates are best-effort — don't block sends
        console.warn('[RateLimiter] Typing simulation failed (non-fatal):', (err as Error).message);
      }
    }

    // 5. Actually send
    const result = await socket.sendMessage(jid, content, options);

    // 6. Record the send
    const now = Date.now();
    this.globalSendLog.push(now);
    this.contactLastSend.set(jid, now);

    const windowSummary = this.config.windows
      .map((w) => `${w.label}: ${this._countInWindow(w)}/${w.maxMessages}`)
      .join(', ');
    console.log(`[RateLimiter] Sent outbound message (${windowSummary})`);
    return result;
  }

  /** Block until ALL sliding windows have a free slot */
  private async _waitForAllWindows(): Promise<void> {
    for (const window of this.config.windows) {
      await this._waitForWindowSlot(window);
    }
  }

  /** Block until a specific sliding window has a free slot */
  private async _waitForWindowSlot(window: RateWindow): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const count = this._countInWindow(window);
      if (count < window.maxMessages) return;

      // Find the oldest entry within this window and wait for it to expire
      const cutoff = Date.now() - window.durationMs;
      const oldestInWindow = this.globalSendLog.find((ts) => ts > cutoff);
      if (!oldestInWindow) return; // all expired

      const waitMs = oldestInWindow + window.durationMs - Date.now() + 50; // +50ms buffer
      if (waitMs <= 0) return;

      console.log(
        `[RateLimiter] 🚦 ${window.label} limit hit (${count}/${window.maxMessages}), waiting ${waitMs}ms`,
      );
      await sleep(waitMs);
    }
  }

  /** Count sends within a specific window */
  private _countInWindow(window: RateWindow): number {
    const cutoff = Date.now() - window.durationMs;
    let count = 0;
    // Walk backwards for efficiency (recent entries first)
    for (let i = this.globalSendLog.length - 1; i >= 0; i--) {
      if (this.globalSendLog[i] > cutoff) count++;
      else break; // log is sorted, no need to keep scanning
    }
    return count;
  }

  /** Block until per-contact cooldown has elapsed */
  private async _waitForContactCooldown(jid: string): Promise<void> {
    const lastSend = this.contactLastSend.get(jid);
    if (!lastSend) return;

    const elapsed = Date.now() - lastSend;
    const remaining = this.config.perContactCooldownMs - elapsed;
    if (remaining > 0) {
      console.log(`[RateLimiter] Per-contact cooldown: waiting ${remaining}ms`);
      await sleep(remaining);
    }
  }

  /** Prune entries older than the largest window to prevent unbounded growth */
  private _pruneLog(): void {
    const maxDuration = Math.max(...this.config.windows.map((w) => w.durationMs));
    const cutoff = Date.now() - maxDuration;
    while (this.globalSendLog.length > 0 && this.globalSendLog[0] < cutoff) {
      this.globalSendLog.shift();
    }
  }

  /** Generate a random delay between min and max */
  private _randomDelay(): number {
    const { minDelayMs, maxDelayMs } = this.config;
    return Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1)) + minDelayMs;
  }

  /** Get current stats (useful for debugging / UI) */
  getStats(): {
    windows: { label: string; count: number; max: number }[];
    contactCooldowns: number;
  } {
    this._pruneLog();
    return {
      windows: this.config.windows.map((w) => ({
        label: w.label,
        count: this._countInWindow(w),
        max: w.maxMessages,
      })),
      contactCooldowns: this.contactLastSend.size,
    };
  }

  /** Update configuration at runtime */
  updateConfig(partial: Partial<RateLimiterConfig>): void {
    this.config = this._mergeConfig(partial);
  }

  /** Merge config, handling legacy single-window fields */
  private _mergeConfig(partial: Partial<RateLimiterConfig>): RateLimiterConfig {
    const base = { ...DEFAULT_RATE_LIMITER_CONFIG, ...this.config, ...partial };

    // Backward compat: if legacy fields are set but no `windows`, build from them
    if (partial.maxMessagesPerWindow != null || partial.windowDurationMs != null) {
      if (!partial.windows) {
        base.windows = [
          {
            label: 'minute',
            maxMessages: partial.maxMessagesPerWindow ?? DEFAULT_WINDOWS[0].maxMessages,
            durationMs: partial.windowDurationMs ?? DEFAULT_WINDOWS[0].durationMs,
          },
          ...DEFAULT_WINDOWS.slice(1),
        ];
      }
    }

    return base;
  }
}

// ── Helpers ────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Factory ────────────────────────────────────────────────────

export function createRateLimiter(config?: Partial<RateLimiterConfig>): WhatsAppRateLimiter {
  return new WhatsAppRateLimiter(config);
}
