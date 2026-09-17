/**
 * Prompt A/B Testing Framework
 * 
 * Compares system prompt variants by tracking tool routing accuracy.
 */

import { log } from '../logger/ring-buffer.js';
import type { DatabaseConnection } from '../data/database/types.js';

export interface PromptVariant {
  id: string;
  name: string;
  promptOverride: string;
  /** If true, appends to base prompt; if false, replaces it */
  isPartial: boolean;
}

export interface PromptExperiment {
  id: string;
  name: string;
  description: string;
  variants: PromptVariant[];
  /** Percentages, e.g. [50, 50] */
  trafficSplit: number[];
  active: boolean;
  createdAt: Date;
}

export interface ExperimentResult {
  experimentId: string;
  variantId: string;
  sessionId: string;
  toolCalls: number;
  toolSuccesses: number;
  toolFailures: number;
  responseTimeMs: number;
  timestamp: Date;
}

export class PromptExperimentManager {
  private db?: DatabaseConnection;

  constructor(db?: DatabaseConnection) {
    this.db = db;
  }

  async createExperiment(ex: Omit<PromptExperiment, 'createdAt'>): Promise<void> {
    if (!this.db) return;
    try {
      await this.db.execute(
        `INSERT INTO youbot_prompt_experiments (id, name, description, variants_json, traffic_split_json, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [ex.id, ex.name, ex.description, JSON.stringify(ex.variants), JSON.stringify(ex.trafficSplit), ex.active ? 1 : 0, new Date().toISOString()]
      );
    } catch (err: any) {
      log.error('ExperimentManager', `Failed to create experiment: ${err.message}`);
    }
  }

  async getActiveExperiment(): Promise<PromptExperiment | null> {
    if (!this.db) return null;
    try {
      const row = await this.db.get(
        `SELECT * FROM youbot_prompt_experiments WHERE active = 1 LIMIT 1`
      );
        
      if (!row) return null;

      return {
        id: row.id,
        name: row.name,
        description: row.description,
        variants: JSON.parse(row.variants_json),
        trafficSplit: JSON.parse(row.traffic_split_json),
        active: row.active === 1,
        createdAt: new Date(row.created_at)
      };
    } catch {
      return null;
    }
  }

  assignVariant(sessionId: string, experiment: PromptExperiment): PromptVariant {
    // Hash-based stable assignment
    let hash = 0;
    for (let i = 0; i < sessionId.length; i++) {
      hash = (hash * 31 + sessionId.charCodeAt(i)) % 100;
    }

    let cumulative = 0;
    for (let i = 0; i < experiment.trafficSplit.length; i++) {
      cumulative += experiment.trafficSplit[i];
      if (hash < cumulative) {
        return experiment.variants[i];
      }
    }
    return experiment.variants[0];
  }

  async recordResult(res: Omit<ExperimentResult, 'timestamp'>): Promise<void> {
    if (!this.db) return;
    try {
      await this.db.execute(
        `INSERT INTO youbot_experiment_results (experiment_id, variant_id, session_id, tool_calls, tool_successes, tool_failures, response_time_ms, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [res.experimentId, res.variantId, res.sessionId, res.toolCalls, res.toolSuccesses, res.toolFailures, res.responseTimeMs, new Date().toISOString()]
      );
    } catch (err: any) {
      log.error('ExperimentManager', `Failed to record result: ${err.message}`);
    }
  }

  async deactivateExperiment(id: string): Promise<void> {
    if (!this.db) return;
    await this.db.execute(`UPDATE youbot_prompt_experiments SET active = 0 WHERE id = ?`, [id]);
  }

  async getResults(experimentId: string): Promise<any[]> {
    if (!this.db) return [];
    
    try {
      const rows = await this.db.query(
        `SELECT variant_id, COUNT(*) as count, AVG(tool_calls) as avg_tool_calls, AVG(tool_successes) as avg_successes, AVG(tool_failures) as avg_failures, AVG(response_time_ms) as avg_time 
         FROM youbot_experiment_results 
         WHERE experiment_id = ? 
         GROUP BY variant_id`, 
         [experimentId]
      );
      return rows;
    } catch (error: any) {
      log.error('ExperimentManager', `Failed to aggregate results: ${error.message}`);
      return [];
    }
  }

  async getAllExperiments(): Promise<any[]> {
    if (!this.db) return [];
    const data = await this.db.query(`SELECT * FROM youbot_prompt_experiments ORDER BY created_at DESC`);
    return data || [];
  }
}

let manager: PromptExperimentManager | null = null;

export function initPromptExperiments(db: DatabaseConnection): PromptExperimentManager {
  manager = new PromptExperimentManager(db);
  return manager;
}

export function getPromptExperiments(): PromptExperimentManager | null {
  return manager;
}
