/**
 * Structured Logger with Ring Buffer
 *
 * In-memory circular buffer that captures the last N log entries.
 * Provides a cursor-based API so the frontend can poll for new entries.
 * Also writes to stdout so file-based logs (youbot.log) still work.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;       // monotonic cursor
  ts: string;       // ISO timestamp
  level: LogLevel;
  tag: string;      // e.g. "Browser", "Agent", "WhatsApp"
  message: string;
}

const MAX_ENTRIES = 500;

class LogBuffer {
  private entries: LogEntry[] = [];
  private cursor = 0;

  push(level: LogLevel, tag: string, message: string): void {
    const entry: LogEntry = {
      id: this.cursor++,
      ts: new Date().toISOString(),
      level,
      tag,
      message,
    };

    if (this.entries.length >= MAX_ENTRIES) {
      this.entries.shift();
    }
    this.entries.push(entry);

    // Also write to stdout for file-based logs
    const prefix = `[${tag}]`;
    if (level === 'error') {
      console.error(prefix, message);
    } else if (level === 'warn') {
      console.warn(prefix, message);
    } else {
      console.log(prefix, message);
    }
  }

  /**
   * Get entries after a given cursor id.
   * Returns { entries, cursor } where cursor is the next id to poll with.
   */
  getEntries(since = -1): { entries: LogEntry[]; cursor: number } {
    const filtered = since >= 0
      ? this.entries.filter(e => e.id > since)
      : this.entries;

    return {
      entries: filtered,
      cursor: this.cursor,
    };
  }
}

// Singleton
const buffer = new LogBuffer();

/** Shorthand logger */
export const log = {
  info: (tag: string, message: string) => buffer.push('info', tag, message),
  warn: (tag: string, message: string) => buffer.push('warn', tag, message),
  error: (tag: string, message: string) => buffer.push('error', tag, message),
  getEntries: (since?: number) => buffer.getEntries(since),
};
