/**
 * Async Job Store
 *
 * Persistence for long-running chat jobs.
 * Used by the async API to track progress across restarts.
 */

import { log } from '../logger/ring-buffer.js';
import type { DatabaseConnection } from '../data/database/types.js';

export interface AsyncJob {
  id: string;
  sessionId: string;
  status: 'processing' | 'completed' | 'failed';
  result?: any;
  error?: string;
  startedAt: number;
  completedAt?: number;
}

export interface AsyncJobStore {
  create(jobId: string, sessionId: string): Promise<AsyncJob>;
  get(jobId: string): Promise<AsyncJob | undefined>;
  update(jobId: string, updates: Partial<Omit<AsyncJob, 'id' | 'sessionId' | 'startedAt'>>): Promise<boolean>;
  addEvent(jobId: string, event: any): Promise<boolean>;
  delete(jobId: string): Promise<boolean>;
  cleanup(maxAgeMs: number): Promise<number>;
  failAllProcessingJobs(error: string): Promise<number>;
}

export function createAsyncJobStore(db: DatabaseConnection): AsyncJobStore {
  function rowToJob(row: any): AsyncJob {
    return {
      id: row.id,
      sessionId: row.session_id,
      status: row.status as AsyncJob['status'],
      result: row.result ? (typeof row.result === 'string' ? JSON.parse(row.result) : row.result) : undefined,
      error: row.error || undefined,
      startedAt: row.started_at ? new Date(row.started_at).getTime() : 0,
      completedAt: row.completed_at ? new Date(row.completed_at).getTime() : undefined,
    };
  }

  return {
    async create(jobId: string, sessionId: string): Promise<AsyncJob> {
      const startedAt = Date.now();
      try {
        await db.execute(
          `INSERT INTO youbot_async_jobs (id, session_id, status, started_at) VALUES (?, ?, 'processing', ?)`,
          [jobId, sessionId, new Date(startedAt).toISOString()]
        );
      } catch (error) {
        console.error('[AsyncJobStore] Failed to insert job:', error);
      }
      return { id: jobId, sessionId, status: 'processing', startedAt };
    },

    async get(jobId: string): Promise<AsyncJob | undefined> {
      try {
        const row = await db.get(`SELECT * FROM youbot_async_jobs WHERE id = ?`, [jobId]);
        return row ? rowToJob(row) : undefined;
      } catch (error) {
        return undefined;
      }
    },

    async update(jobId: string, updates: Partial<Omit<AsyncJob, 'id' | 'sessionId' | 'startedAt'>>): Promise<boolean> {
      const fields: string[] = [];
      const params: any[] = [];
      
      if (updates.status) { fields.push('status = ?'); params.push(updates.status); }
      if (updates.result !== undefined) { fields.push('result = ?'); params.push(JSON.stringify(updates.result)); }
      if (updates.error !== undefined) { fields.push('error = ?'); params.push(updates.error); }
      if (updates.completedAt) { fields.push('completed_at = ?'); params.push(new Date(updates.completedAt).toISOString()); }

      if (fields.length === 0) return true;
      params.push(jobId);

      try {
        await db.execute(`UPDATE youbot_async_jobs SET ${fields.join(', ')} WHERE id = ?`, params);
        return true;
      } catch (error) {
        return false;
      }
    },

    async addEvent(jobId: string, event: any): Promise<boolean> {
      const existing = await this.get(jobId);
      if (!existing || existing.status !== 'processing') return false;

      const parsedRes = existing.result || { _type: 'transient_events', events: [] };
      const events = Array.isArray(parsedRes.events) ? parsedRes.events : [];
      events.push({ ...event, timestamp: Date.now() });

      try {
        await db.execute(`UPDATE youbot_async_jobs SET result = ? WHERE id = ?`, [JSON.stringify({ _type: 'transient_events', events }), jobId]);
        return true;
      } catch (error) {
        return false;
      }
    },

    async delete(jobId: string): Promise<boolean> {
      try {
        await db.execute(`DELETE FROM youbot_async_jobs WHERE id = ?`, [jobId]);
        return true;
      } catch (error) {
        return false;
      }
    },

    async cleanup(maxAgeMs: number): Promise<number> {
      const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
      try {
        const result = await db.execute(`DELETE FROM youbot_async_jobs WHERE started_at < ?`, [cutoff]);
        const count = Number(result.changes);
        if (count > 0) log.info('JobStore', `Cleaned up ${count} expired async jobs`);
        return count;
      } catch (error) {
        return 0;
      }
    },

    async failAllProcessingJobs(errorMessage: string): Promise<number> {
      try {
        const result = await db.execute(
          `UPDATE youbot_async_jobs SET status = 'failed', error = ?, completed_at = ? WHERE status = 'processing'`,
          [errorMessage, new Date().toISOString()]
        );
        const count = Number(result.changes);
        if (count > 0) log.info('JobStore', `Marked ${count} abandoned jobs as failed`);
        return count;
      } catch (error) {
        return 0;
      }
    }
  };
}
