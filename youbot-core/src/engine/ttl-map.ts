export class TtlMap<K, V> {
  private map = new Map<K, { value: V; expiresAt: number }>();
  private defaultTtl: number;
  private timer: NodeJS.Timeout;

  constructor(defaultTtlMs: number, cleanupIntervalMs: number = 60000) {
    this.defaultTtl = defaultTtlMs;
    this.timer = setInterval(() => this.cleanup(), cleanupIntervalMs);
    // Unref allows the node process to exit even if this timer is active
    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  set(key: K, value: V, ttlMs?: number): void {
    const expiresAt = Date.now() + (ttlMs ?? this.defaultTtl);
    this.map.set(key, { value, expiresAt });
  }

  get(key: K): V | undefined {
    const item = this.map.get(key);
    if (!item) return undefined;
    if (Date.now() > item.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh TTL on get
    item.expiresAt = Date.now() + this.defaultTtl;
    return item.value;
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  has(key: K): boolean {
    const item = this.map.get(key);
    if (!item) return false;
    if (Date.now() > item.expiresAt) {
      this.map.delete(key);
      return false;
    }
    return true;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, item] of this.map.entries()) {
      if (now > item.expiresAt) {
        this.map.delete(key);
      }
    }
  }

  destroy(): void {
    clearInterval(this.timer);
    this.map.clear();
  }
}
