/**
 * LLM Usage Metering
 * 
 * Tracks token usage and estimated costs per model/purpose.
 * Stores data in SQLite for persistent per-tenant metering.
 */

import type { DatabaseConnection } from '../data/database/types.js';

// ── Cost rates per model ($ per 1M tokens) ──

interface ModelPricing {
  input: number;   // $ per 1M input tokens
  output: number;  // $ per 1M output tokens
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // Gemini models
  'gemini-3-flash-preview':              { input: 0.50, output: 3.00 },
  'gemini-3.1-flash-lite-preview':       { input: 0.25, output: 1.50 },
  'gemini-3.1-pro-preview':              { input: 2.00, output: 12.00 },
  'gemini-2.5-flash':                    { input: 0.30, output: 2.50 },
  'gemini-2.5-flash-lite':               { input: 0.10, output: 0.40 },
  'gemini-2.5-pro':                      { input: 1.25, output: 10.00 },
  'gemini-2.0-flash':                    { input: 0.10, output: 0.40 },
  'gemini-2.0-flash-lite':               { input: 0.075, output: 0.30 },
  // Mistral models (via Vertex AI)
  'mistral-nemo':                        { input: 0.02, output: 0.04 },
  'mistral-small-3.2-24b':               { input: 0.06, output: 0.18 },
  'mistral-medium-3':                    { input: 0.40, output: 2.00 },
  'mistral-large-3':                     { input: 0.50, output: 1.50 },
  // Anthropic (via Vertex AI)
  'claude-haiku-4.5':                    { input: 1.00, output: 5.00 },
  'claude-sonnet-4.6':                   { input: 3.00, output: 15.00 },
  // Ollama / local (free)
  'llama3.2:3b':                         { input: 0, output: 0 },
  'llama3.1:8b':                         { input: 0, output: 0 },
};

// Fallback pricing for unknown models
const FALLBACK_PRICING: ModelPricing = { input: 0.50, output: 3.00 };

function getPricing(model: string): ModelPricing {
  // Exact match
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  // Prefix match (e.g. "gemini-3-flash-preview-20260301" → "gemini-3-flash-preview")
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key)) return pricing;
  }
  // Local models are free
  if (model.includes('llama') || model.includes('qwen') || model.includes('deepseek')) {
    return { input: 0, output: 0 };
  }
  return FALLBACK_PRICING;
}

function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = getPricing(model);
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

// ── Usage record ──

export interface UsageRecord {
  timestamp: string;       // ISO 8601
  model: string;
  purpose: string;         // chat | router | extraction | generation
  providerId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;   // USD
}

export interface UsageSummary {
  period: string;          // e.g. "today", "7d", "30d", "all"
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCost: number;
  byModel: Record<string, { inputTokens: number; outputTokens: number; cost: number; calls: number }>;
  byPurpose: Record<string, { inputTokens: number; outputTokens: number; cost: number; calls: number }>;
  dailyCosts: Array<{ date: string; cost: number; tokens: number }>;
}

// ── Metering store (SQLite-backed via DatabaseConnection) ──

export class MeteringService {
  private db: DatabaseConnection;

  constructor(db: DatabaseConnection) {
    this.db = db;
  }

  /** Record a single LLM call */
  async record(model: string, purpose: string, providerId: string, inputTokens: number, outputTokens: number) {
    const totalTokens = inputTokens + outputTokens;
    const cost = calculateCost(model, inputTokens, outputTokens);
    
    // Fire and forget
    this.db.execute(
      `INSERT INTO youbot_llm_usage (model, purpose, provider_id, input_tokens, output_tokens, total_tokens, estimated_cost, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [model, purpose, providerId, inputTokens, outputTokens, totalTokens, cost, new Date().toISOString()]
    ).catch((error: any) => {
      console.error('[Metering] Failed to record usage:', error.message);
    });
  }

  /** Get usage summary for a time period */
  async getSummary(period: 'today' | '7d' | '30d' | 'all' = '30d'): Promise<UsageSummary> {
    const since = this.getSinceDate(period);

    const rows = await this.db.query(
      `SELECT * FROM youbot_llm_usage WHERE timestamp >= ?`,
      [since]
    );

    const summary: UsageSummary = {
      period,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      byModel: {},
      byPurpose: {},
      dailyCosts: []
    };

    if (!rows) return summary;

    const dailyMap = new Map<string, { cost: number; tokens: number }>();

    for (const row of rows) {
      const input = row.input_tokens || 0;
      const output = row.output_tokens || 0;
      const total = row.total_tokens || 0;
      const cost = row.estimated_cost || 0;
      
      summary.totalInputTokens += input;
      summary.totalOutputTokens += output;
      summary.totalTokens += total;
      summary.totalCost += cost;

      // By model
      if (!summary.byModel[row.model]) {
        summary.byModel[row.model] = { inputTokens: 0, outputTokens: 0, cost: 0, calls: 0 };
      }
      summary.byModel[row.model].inputTokens += input;
      summary.byModel[row.model].outputTokens += output;
      summary.byModel[row.model].cost += cost;
      summary.byModel[row.model].calls += 1;

      // By purpose
      if (!summary.byPurpose[row.purpose]) {
        summary.byPurpose[row.purpose] = { inputTokens: 0, outputTokens: 0, cost: 0, calls: 0 };
      }
      summary.byPurpose[row.purpose].inputTokens += input;
      summary.byPurpose[row.purpose].outputTokens += output;
      summary.byPurpose[row.purpose].cost += cost;
      summary.byPurpose[row.purpose].calls += 1;

      // Daily
      const dateStr = row.timestamp.split('T')[0];
      if (!dailyMap.has(dateStr)) {
        dailyMap.set(dateStr, { cost: 0, tokens: 0 });
      }
      const day = dailyMap.get(dateStr)!;
      day.cost += cost;
      day.tokens += total;
    }

    // Convert daily map back to sorted array
    summary.dailyCosts = Array.from(dailyMap.entries())
      .map(([date, data]) => ({ date, cost: data.cost, tokens: data.tokens }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return summary;
  }

  private getSinceDate(period: string): string {
    const now = new Date();
    switch (period) {
      case 'today':
        return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      case '7d':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      case '30d':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      case 'all':
      default:
        return '1970-01-01T00:00:00.000Z';
    }
  }
}

// ── Singleton ──

let meteringService: MeteringService | null = null;

export function initMetering(db: DatabaseConnection): MeteringService {
  meteringService = new MeteringService(db);
  return meteringService;
}

export function getMetering(): MeteringService | null {
  return meteringService;
}
