/**
 * Metrics Collector
 *
 * Lightweight, in-memory metrics for tracking channel activity and tool usage.
 * Resets on process restart (operational metrics, not audit logs).
 */

import type { DatabaseConnection } from '../data/database/types.js';

// ── Types ───────────────────────────────────────────────

export interface ChannelMetrics {
  messagesIn: number;
  messagesOut: number;
  lastActivity: string | null;
}

export interface ToolMetrics {
  calls: number;
  errors: number;
  lastUsed: string | null;
  avgDuration?: number;
}

export interface MetricsSummary {
  uptime: number;
  startedAt: string;
  channels: Record<string, ChannelMetrics>;
  tools: Record<string, ToolMetrics>;
  totals: {
    messagesIn: number;
    messagesOut: number;
    toolCalls: number;
    toolErrors: number;
  };
}

// ── Collector ───────────────────────────────────────────

class MetricsCollector {
  private startedAt = new Date();
  private channels = new Map<string, ChannelMetrics>();
  private tools = new Map<string, ToolMetrics>();
  private db: DatabaseConnection | null = null;

  /**
   * Set database connection.
   */
  setDatabase(db: DatabaseConnection): void {
    this.db = db;
    console.log('[Metrics] Persistent tool metrics connected to Supabase');
  }

  /**
   * Record a channel message (in or out).
   */
  recordMessage(channel: string, direction: 'in' | 'out'): void {
    const key = channel.toLowerCase();
    let m = this.channels.get(key);
    if (!m) {
      m = { messagesIn: 0, messagesOut: 0, lastActivity: null };
      this.channels.set(key, m);
    }
    if (direction === 'in') m.messagesIn++;
    else m.messagesOut++;
    m.lastActivity = new Date().toISOString();
  }

  /**
   * Record a tool execution.
   */
  async recordTool(toolName: string, success: boolean, durationMs?: number, sessionId?: string): Promise<void> {
    // In-memory update
    let t = this.tools.get(toolName);
    if (!t) {
      t = { calls: 0, errors: 0, lastUsed: null };
      this.tools.set(toolName, t);
    }
    t.calls++;
    if (!success) t.errors++;
    t.lastUsed = new Date().toISOString();

    // Database update (fire-and-forget inside async but we await anyway if called explicitly)
    if (this.db) {
      try {
        await this.db.execute(
          `INSERT INTO youbot_tool_metrics (tool_name, success, duration_ms, session_id, timestamp) VALUES (?, ?, ?, ?, ?)`,
          [toolName, success ? 1 : 0, durationMs || null, sessionId || null, new Date().toISOString()]
        );
      } catch (err: any) {
        console.error(`[Metrics] Database recordTool failed: ${err.message}`);
      }
    }
  }

  /**
   * Get historical metrics from Supabase.
   */
  async getHistoricalMetrics(hours: number = 24): Promise<Array<{ toolName: string, calls: number, errors: number, avgDuration: number }>> {
    if (!this.db) return [];
    
    try {
      const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
      const data = await this.db.query(
        `SELECT * FROM youbot_tool_metrics WHERE timestamp > ?`,
        [cutoff]
      );
      
      const agg = new Map<string, { calls: number, errors: number, durSum: number, durCount: number }>();
      
      for (const row of data || []) {
        let entry = agg.get(row.tool_name);
        if (!entry) {
          entry = { calls: 0, errors: 0, durSum: 0, durCount: 0 };
          agg.set(row.tool_name, entry);
        }
        entry.calls++;
        if (row.success === 0) entry.errors++;
        if (row.duration_ms) {
          entry.durSum += row.duration_ms;
          entry.durCount++;
        }
      }

      return Array.from(agg.entries()).map(([name, stats]) => ({
        toolName: name,
        calls: stats.calls,
        errors: stats.errors,
        avgDuration: stats.durCount > 0 ? Math.round(stats.durSum / stats.durCount) : 0
      })).sort((a, b) => b.calls - a.calls);

    } catch (err: any) {
      console.error(`[Metrics] getHistoricalMetrics failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Get per-channel metrics.
   */
  getChannelMetrics(): Record<string, ChannelMetrics> {
    return Object.fromEntries(this.channels);
  }

  /**
   * Get per-tool metrics, optionally sorted by call count.
   */
  getToolMetrics(limit?: number): Record<string, ToolMetrics> {
    const sorted = [...this.tools.entries()].sort((a, b) => b[1].calls - a[1].calls);
    const entries = limit ? sorted.slice(0, limit) : sorted;
    return Object.fromEntries(entries);
  }

  /**
   * Get full summary with totals.
   */
  getSummary(): MetricsSummary {
    let messagesIn = 0, messagesOut = 0, toolCalls = 0, toolErrors = 0;
    for (const m of this.channels.values()) {
      messagesIn += m.messagesIn;
      messagesOut += m.messagesOut;
    }
    for (const t of this.tools.values()) {
      toolCalls += t.calls;
      toolErrors += t.errors;
    }
    return {
      uptime: Date.now() - this.startedAt.getTime(),
      startedAt: this.startedAt.toISOString(),
      channels: this.getChannelMetrics(),
      tools: this.getToolMetrics(),
      totals: { messagesIn, messagesOut, toolCalls, toolErrors },
    };
  }

  /**
   * Reset all metrics.
   */
  reset(): void {
    this.channels.clear();
    this.tools.clear();
    this.startedAt = new Date();
  }
}

// ── Singleton ───────────────────────────────────────────

export const metricsCollector = new MetricsCollector();
