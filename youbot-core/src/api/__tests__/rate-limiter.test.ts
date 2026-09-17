/**
 * Rate Limiter Tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ApiRateLimiter } from '../middleware/rate-limiter.js';

describe('ApiRateLimiter', () => {
  let limiter: ApiRateLimiter;

  beforeEach(() => {
    limiter = new ApiRateLimiter({
      defaultLimit: 5,
      windowMs: 1000, // 1 second for fast tests
      pathLimits: {
        '/api/chat': 2,
      },
    });
  });

  afterEach(() => {
    limiter.destroy();
  });

  it('should allow requests under the limit', () => {
    const result = limiter.check('client-1', '/api/tools');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4); // 5 limit - 1 used
  });

  it('should block requests over the limit', () => {
    for (let i = 0; i < 5; i++) {
      limiter.check('client-1', '/api/tools');
    }
    const result = limiter.check('client-1', '/api/tools');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('should apply per-path limits', () => {
    // /api/chat has a limit of 2
    limiter.check('client-1', '/api/chat');
    limiter.check('client-1', '/api/chat');
    const result = limiter.check('client-1', '/api/chat');
    expect(result.allowed).toBe(false);
  });

  it('should track clients independently', () => {
    for (let i = 0; i < 5; i++) {
      limiter.check('client-1', '/api/tools');
    }
    // client-1 is at the limit
    expect(limiter.check('client-1', '/api/tools').allowed).toBe(false);
    // client-2 should still be allowed
    expect(limiter.check('client-2', '/api/tools').allowed).toBe(true);
  });

  it('should reset after window expires', async () => {
    for (let i = 0; i < 5; i++) {
      limiter.check('client-1', '/api/tools');
    }
    expect(limiter.check('client-1', '/api/tools').allowed).toBe(false);

    // Wait for window to expire
    await new Promise(resolve => setTimeout(resolve, 1100));

    expect(limiter.check('client-1', '/api/tools').allowed).toBe(true);
  });

  it('should reset all clients on reset()', () => {
    for (let i = 0; i < 5; i++) {
      limiter.check('client-1', '/api/tools');
    }
    expect(limiter.check('client-1', '/api/tools').allowed).toBe(false);

    limiter.reset();

    expect(limiter.check('client-1', '/api/tools').allowed).toBe(true);
  });

  it('should return correct limit and remaining', () => {
    const r1 = limiter.check('client-1', '/api/tools');
    expect(r1.limit).toBe(5);
    expect(r1.remaining).toBe(4);

    const r2 = limiter.check('client-1', '/api/tools');
    expect(r2.remaining).toBe(3);
  });

  it('should return correct limit for /api/chat', () => {
    const result = limiter.check('client-1', '/api/chat');
    expect(result.limit).toBe(2);
    expect(result.remaining).toBe(1);
  });
});
