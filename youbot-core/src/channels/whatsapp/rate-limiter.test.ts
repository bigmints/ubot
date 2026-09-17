import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WhatsAppRateLimiter, createRateLimiter } from './rate-limiter.js';
import type { WASocket, AnyMessageContent    } from '@whiskeysockets/baileys';

function createMockSocket(): WASocket {
  return {
    sendMessage: vi.fn().mockResolvedValue({ key: { id: 'msg-1', fromMe: true } }),
    sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
  } as unknown as WASocket;
}

describe('WhatsAppRateLimiter', () => {
  let limiter: WhatsAppRateLimiter;
  let socket: WASocket;

  beforeEach(() => {
    vi.useFakeTimers();
    socket = createMockSocket();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper: create a limiter with very short delays for fast tests
  function fastLimiter(overrides: Record<string, unknown> = {}): WhatsAppRateLimiter {
    return createRateLimiter({
      minDelayMs: 10,
      maxDelayMs: 20,
      simulateTyping: false,
      perContactCooldownMs: 0,
      maxMessagesPerWindow: 100,
      windowDurationMs: 60_000,
      enabled: true,
      ...overrides,
    });
  }

  describe('createRateLimiter', () => {
    it('should create a rate limiter with default config', () => {
      const rl = createRateLimiter();
      expect(rl).toBeInstanceOf(WhatsAppRateLimiter);
    });

    it('should create a rate limiter with custom config', () => {
      const rl = createRateLimiter({ minDelayMs: 100, maxDelayMs: 200 });
      expect(rl).toBeInstanceOf(WhatsAppRateLimiter);
    });
  });

  describe('sendMessage — disabled', () => {
    it('should pass through directly when disabled', async () => {
      limiter = createRateLimiter({ enabled: false });
      const content: AnyMessageContent = { text: 'hello' };
      const promise = limiter.sendMessage(socket, '123@s.whatsapp.net', content);
      await vi.advanceTimersByTimeAsync(0);
      await promise;
      expect(socket.sendMessage).toHaveBeenCalledWith('123@s.whatsapp.net', content, undefined);
      expect(socket.sendPresenceUpdate).not.toHaveBeenCalled();
    });
  });

  describe('sendMessage — enabled', () => {
    it('should call socket.sendMessage after a delay', async () => {
      limiter = fastLimiter();
      const content: AnyMessageContent = { text: 'hello' };
      const promise = limiter.sendMessage(socket, '123@s.whatsapp.net', content);

      // Advance past the random delay (max 20ms)
      await vi.advanceTimersByTimeAsync(100);
      await promise;

      expect(socket.sendMessage).toHaveBeenCalledWith('123@s.whatsapp.net', content, undefined);
    });

    it('should send typing indicators when simulateTyping is true', async () => {
      limiter = fastLimiter({ simulateTyping: true });
      const content: AnyMessageContent = { text: 'hello world' };
      const jid = '123@s.whatsapp.net';

      const promise = limiter.sendMessage(socket, jid, content);
      // Advance enough for delay + typing duration
      await vi.advanceTimersByTimeAsync(5000);
      await promise;

      expect(socket.sendPresenceUpdate).toHaveBeenCalledWith('composing', jid);
      expect(socket.sendPresenceUpdate).toHaveBeenCalledWith('paused', jid);
    });

    it('should not fail if presence update throws', async () => {
      limiter = fastLimiter({ simulateTyping: true });
      (socket.sendPresenceUpdate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));

      const promise = limiter.sendMessage(socket, '123@s.whatsapp.net', { text: 'hi' });
      await vi.advanceTimersByTimeAsync(5000);

      // Should still send the message despite presence failure
      await expect(promise).resolves.toBeDefined();
      expect(socket.sendMessage).toHaveBeenCalled();
    });
  });

  describe('per-contact cooldown', () => {
    it('should enforce minimum gap between messages to the same contact', async () => {
      limiter = fastLimiter({ perContactCooldownMs: 500 });
      const jid = '123@s.whatsapp.net';

      // Send first message
      const p1 = limiter.sendMessage(socket, jid, { text: 'first' });
      await vi.advanceTimersByTimeAsync(200);
      await p1;

      // Send second — should wait for cooldown
      const p2 = limiter.sendMessage(socket, jid, { text: 'second' });

      // Advance just past the cooldown + delay
      await vi.advanceTimersByTimeAsync(1000);
      await p2;

      expect(socket.sendMessage).toHaveBeenCalledTimes(2);
    });

    it('should not cooldown different contacts', async () => {
      limiter = fastLimiter({ perContactCooldownMs: 5000 });

      // Send to two different contacts immediately
      const p1 = limiter.sendMessage(socket, '111@s.whatsapp.net', { text: 'a' });
      const p2 = limiter.sendMessage(socket, '222@s.whatsapp.net', { text: 'b' });

      await vi.advanceTimersByTimeAsync(200);
      await Promise.all([p1, p2]);

      expect(socket.sendMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe('global rate limit', () => {
    it('should block sends when window is full', async () => {
      limiter = fastLimiter({
        maxMessagesPerWindow: 2,
        windowDurationMs: 1000,
      });

      // Fill the window
      const p1 = limiter.sendMessage(socket, '111@s.whatsapp.net', { text: '1' });
      await vi.advanceTimersByTimeAsync(100);
      await p1;

      const p2 = limiter.sendMessage(socket, '222@s.whatsapp.net', { text: '2' });
      await vi.advanceTimersByTimeAsync(100);
      await p2;

      // Third should be rate limited
      const p3 = limiter.sendMessage(socket, '333@s.whatsapp.net', { text: '3' });

      // Advance past the window so first entry expires
      await vi.advanceTimersByTimeAsync(1500);
      await p3;

      expect(socket.sendMessage).toHaveBeenCalledTimes(3);
    });
  });

  describe('getStats', () => {
    it('should return current statistics', async () => {
      limiter = fastLimiter();

      const stats = limiter.getStats();
      expect(stats.windows.length).toBeGreaterThanOrEqual(1);
      expect(stats.windows[0].count).toBe(0);
      expect(stats.windows[0].max).toBe(100);
      expect(stats.contactCooldowns).toBe(0);
    });

    it('should update after sending', async () => {
      limiter = fastLimiter();
      const p = limiter.sendMessage(socket, '123@s.whatsapp.net', { text: 'hi' });
      await vi.advanceTimersByTimeAsync(200);
      await p;

      const stats = limiter.getStats();
      expect(stats.windows[0].count).toBe(1);
      expect(stats.contactCooldowns).toBe(1);
    });
  });

  describe('updateConfig', () => {
    it('should update configuration at runtime', () => {
      limiter = fastLimiter();
      limiter.updateConfig({ minDelayMs: 500, maxDelayMs: 1000 });

      const stats = limiter.getStats();
      expect(stats.windows[0].max).toBe(100); // unchanged
    });
  });

  describe('message ordering', () => {
    it('should deliver messages to the same contact in order', async () => {
      limiter = fastLimiter();
      const jid = '123@s.whatsapp.net';
      const order: string[] = [];

      (socket.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
        async (_jid: string, content: AnyMessageContent) => {
          order.push((content as { text: string }).text);
          return { key: { id: `msg-${order.length}`, fromMe: true } };
        }
      );

      const p1 = limiter.sendMessage(socket, jid, { text: 'first' });
      const p2 = limiter.sendMessage(socket, jid, { text: 'second' });
      const p3 = limiter.sendMessage(socket, jid, { text: 'third' });

      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.all([p1, p2, p3]);

      expect(order).toEqual(['first', 'second', 'third']);
    });
  });
});
