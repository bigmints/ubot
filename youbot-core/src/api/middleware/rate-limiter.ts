/**
 * API Rate Limiter
 * 
 * Sliding-window rate limiter that tracks requests per client (API key name or IP).
 * Different limits for different endpoint categories.
 */

export interface RateLimitConfig {
  /** Default requests per window */
  defaultLimit: number;
  /** Window duration in milliseconds */
  windowMs: number;
  /** Per-path overrides: path prefix → limit */
  pathLimits?: Record<string, number>;
}

interface ClientWindow {
  timestamps: number[];
}

const DEFAULT_CONFIG: RateLimitConfig = {
  defaultLimit: 300,
  windowMs: 60_000, // 1 minute
  pathLimits: {
    '/api/chat': 60,
  },
};

export class ApiRateLimiter {
  private config: RateLimitConfig;
  private clients: Map<string, ClientWindow> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<RateLimitConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    // Clean up expired entries every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60_000);
    // Prevent the interval from keeping the process alive
    if (this.cleanupInterval.unref) this.cleanupInterval.unref();
  }

  /**
   * Check if a request is allowed under the rate limit.
   * Returns { allowed, limit, remaining, retryAfter }.
   */
  check(clientId: string, path: string): RateLimitResult {
    const now = Date.now();
    const limit = this.getLimitForPath(path);
    const windowStart = now - this.config.windowMs;

    let window = this.clients.get(clientId);
    if (!window) {
      window = { timestamps: [] };
      this.clients.set(clientId, window);
    }

    // Remove timestamps outside the window
    window.timestamps = window.timestamps.filter(t => t > windowStart);

    if (window.timestamps.length >= limit) {
      const oldestInWindow = window.timestamps[0];
      const retryAfterMs = oldestInWindow + this.config.windowMs - now;
      return {
        allowed: false,
        limit,
        remaining: 0,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      };
    }

    // Record this request
    window.timestamps.push(now);

    return {
      allowed: true,
      limit,
      remaining: limit - window.timestamps.length,
      retryAfterSeconds: 0,
    };
  }

  /**
   * Get the rate limit for a specific path.
   */
  private getLimitForPath(path: string): number {
    if (this.config.pathLimits) {
      for (const [prefix, limit] of Object.entries(this.config.pathLimits)) {
        if (path.startsWith(prefix)) {
          return limit;
        }
      }
    }
    return this.config.defaultLimit;
  }

  /**
   * Remove expired client windows.
   */
  private cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    for (const [clientId, window] of this.clients.entries()) {
      window.timestamps = window.timestamps.filter(t => t > windowStart);
      if (window.timestamps.length === 0) {
        this.clients.delete(clientId);
      }
    }
  }

  /** Stop the cleanup interval */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /** Reset all client windows (for testing) */
  reset(): void {
    this.clients.clear();
  }
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Send a 429 Too Many Requests response.
 */
export function sendRateLimited(
  res: import('http').ServerResponse,
  result: RateLimitResult,
): void {
  res.writeHead(429, {
    'Content-Type': 'application/json',
    'Retry-After': String(result.retryAfterSeconds),
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': '0',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify({
    error: 'Too many requests',
    retryAfter: result.retryAfterSeconds,
  }));
}

/**
 * Add rate limit headers to a successful response (call before res.end()).
 */
export function setRateLimitHeaders(
  res: import('http').ServerResponse,
  result: RateLimitResult,
): void {
  res.setHeader('X-RateLimit-Limit', String(result.limit));
  res.setHeader('X-RateLimit-Remaining', String(result.remaining));
}
