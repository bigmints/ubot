/**
 * Follow-Up Store
 * SQLite-backed follow-up tracking for conversation continuity.
 * 
 * Ensures every conversation reaches closure by tracking pending actions,
 * scheduled check-ins, and unresolved items across all channels.
 */

import { v4 as uuidv4 } from 'uuid';
import type { DatabaseConnection } from '../data/database/types.js';

// ─── Types ────────────────────────────────────────────────

export type FollowUpStatus = 'pending' | 'completed' | 'cancelled' | 'expired';
export type FollowUpPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface FollowUp {
  id: string;
  sessionId: string;
  contactId: string;
  channel: string;
  reason: string;
  context: string;
  status: FollowUpStatus;
  priority: FollowUpPriority;
  followUpAt: Date;
  createdAt: Date;
  completedAt: Date | null;
  result: string | null;
  /** Number of times this follow-up has been attempted */
  attempts: number;
  /** Max attempts before auto-expiring */
  maxAttempts: number;
  /** Optional: ID of the approval this follow-up was created for (set by ask_owner) */
  approvalId?: string;
}

export interface FollowUpCreate {
  sessionId: string;
  contactId: string;
  channel: string;
  reason: string;
  context: string;
  priority?: FollowUpPriority;
  followUpAt: Date;
  maxAttempts?: number;
  /** Optional: ID of the approval this follow-up was created for (set by ask_owner) */
  approvalId?: string;
}

export interface FollowUpFilter {
  status?: FollowUpStatus | FollowUpStatus[];
  sessionId?: string;
  contactId?: string;
  channel?: string;
  priority?: FollowUpPriority;
  dueBefore?: Date;
  dueAfter?: Date;
}



// ─── Store Interface ──────────────────────────────────────

export interface FollowUpStore {
  create(input: FollowUpCreate): Promise<FollowUp>;
  get(id: string): Promise<FollowUp | undefined>;
  list(filter?: FollowUpFilter): Promise<FollowUp[]>;
  getDue(): Promise<FollowUp[]>;
  getForSession(sessionId: string): Promise<FollowUp[]>;
  getForContact(contactId: string): Promise<FollowUp[]>;
  complete(id: string, result: string): Promise<boolean>;
  cancel(id: string, reason?: string): Promise<boolean>;
  expire(id: string, reason?: string): Promise<boolean>;
  recordAttempt(id: string, newFollowUpAt?: Date): Promise<boolean>;
  delete(id: string): Promise<boolean>;
  getStats(): Promise<{ pending: number; completed: number; cancelled: number; expired: number; overdue: number }>;
}

function rowToFollowUp(row: any): FollowUp {
  return {
    id: row.id,
    sessionId: row.session_id,
    contactId: row.contact_id,
    channel: row.channel,
    reason: row.reason,
    context: row.context,
    status: row.status as FollowUpStatus,
    priority: row.priority as FollowUpPriority,
    followUpAt: new Date(row.follow_up_at),
    createdAt: new Date(row.created_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    result: row.result,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    approvalId: row.approval_id || undefined,
  };
}

export function createFollowUpStore(db: DatabaseConnection): FollowUpStore {
  return {
    async create(input: FollowUpCreate): Promise<FollowUp> {
      const id = uuidv4();
      const now = new Date().toISOString();
      const priority = input.priority || 'normal';
      const maxAttempts = input.maxAttempts || 3;

      await db.execute(
        `INSERT INTO youbot_follow_ups (
          id, session_id, contact_id, channel, reason, context, status, priority, 
          follow_up_at, created_at, attempts, max_attempts, approval_id
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, 0, ?, ?)`,
        [
          id, input.sessionId, input.contactId, input.channel, input.reason, 
          input.context || '', priority, input.followUpAt.toISOString(), now, 
          maxAttempts, input.approvalId || null
        ]
      );

      return {
        id, sessionId: input.sessionId, contactId: input.contactId, channel: input.channel,
        reason: input.reason, context: input.context || '', status: 'pending', priority,
        followUpAt: input.followUpAt, createdAt: new Date(now), completedAt: null, result: null,
        attempts: 0, maxAttempts, approvalId: input.approvalId,
      };
    },

    async get(id: string): Promise<FollowUp | undefined> {
      const row = await db.get(`SELECT * FROM youbot_follow_ups WHERE id = ?`, [id]);
      return row ? rowToFollowUp(row) : undefined;
    },

    async list(filter?: FollowUpFilter): Promise<FollowUp[]> {
      let sql = `SELECT * FROM youbot_follow_ups WHERE 1=1`;
      const params: any[] = [];

      if (filter?.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        sql += ` AND status IN (${statuses.map(() => '?').join(', ')})`;
        params.push(...statuses);
      }
      if (filter?.sessionId) { sql += ` AND session_id = ?`; params.push(filter.sessionId); }
      if (filter?.contactId) { sql += ` AND contact_id = ?`; params.push(filter.contactId); }
      if (filter?.channel) { sql += ` AND channel = ?`; params.push(filter.channel); }
      if (filter?.priority) { sql += ` AND priority = ?`; params.push(filter.priority); }
      if (filter?.dueBefore) { sql += ` AND follow_up_at <= ?`; params.push(filter.dueBefore.toISOString()); }
      if (filter?.dueAfter) { sql += ` AND follow_up_at >= ?`; params.push(filter.dueAfter.toISOString()); }

      sql += ` ORDER BY follow_up_at ASC`;
      const data = await db.query(sql, params);
      return data.map(rowToFollowUp);
    },

    async getDue(): Promise<FollowUp[]> {
      const now = new Date().toISOString();
      const data = await db.query(
        `SELECT * FROM youbot_follow_ups WHERE status = 'pending' AND follow_up_at <= ? ORDER BY priority DESC, follow_up_at ASC`,
        [now]
      );
      return data.map(rowToFollowUp);
    },

    async getForSession(sessionId: string): Promise<FollowUp[]> {
      const data = await db.query(
        `SELECT * FROM youbot_follow_ups WHERE session_id = ? AND status = 'pending' ORDER BY follow_up_at ASC`,
        [sessionId]
      );
      return data.map(rowToFollowUp);
    },

    async getForContact(contactId: string): Promise<FollowUp[]> {
      const data = await db.query(
        `SELECT * FROM youbot_follow_ups WHERE contact_id = ? AND status = 'pending' ORDER BY follow_up_at ASC`,
        [contactId]
      );
      return data.map(rowToFollowUp);
    },

    async complete(id: string, result: string): Promise<boolean> {
      const now = new Date().toISOString();
      const res = await db.execute(
        `UPDATE youbot_follow_ups SET status = 'completed', completed_at = ?, result = ? WHERE id = ? AND status = 'pending'`,
        [now, result, id]
      );
      return res.changes > 0;
    },

    async cancel(id: string, reason?: string): Promise<boolean> {
      const now = new Date().toISOString();
      const res = await db.execute(
        `UPDATE youbot_follow_ups SET status = 'cancelled', completed_at = ?, result = ? WHERE id = ? AND status = 'pending'`,
        [now, reason || 'Cancelled', id]
      );
      return res.changes > 0;
    },

    async expire(id: string, reason?: string): Promise<boolean> {
      const now = new Date().toISOString();
      const res = await db.execute(
        `UPDATE youbot_follow_ups SET status = 'expired', completed_at = ?, result = ? WHERE id = ? AND status = 'pending'`,
        [now, reason || 'Max attempts reached', id]
      );
      return res.changes > 0;
    },

    async recordAttempt(id: string, newFollowUpAt?: Date): Promise<boolean> {
      const followUp = await this.get(id);
      if (!followUp || followUp.status !== 'pending') return false;

      const newAttempts = followUp.attempts + 1;
      if (newAttempts >= followUp.maxAttempts) {
        return await this.expire(id);
      }

      const fields: string[] = ['attempts = ?'];
      const params: any[] = [newAttempts];
      
      if (newFollowUpAt) {
        fields.push('follow_up_at = ?');
        params.push(newFollowUpAt.toISOString());
      }
      params.push(id);

      await db.execute(`UPDATE youbot_follow_ups SET ${fields.join(', ')} WHERE id = ?`, params);
      return true;
    },

    async delete(id: string): Promise<boolean> {
      const res = await db.execute(`DELETE FROM youbot_follow_ups WHERE id = ?`, [id]);
      return res.changes > 0;
    },

    async getStats(): Promise<{ pending: number; completed: number; cancelled: number; expired: number; overdue: number }> {
      const now = new Date().toISOString();
      
      const getCount = async (status?: string, overdue?: boolean) => {
        let sql = `SELECT COUNT(*) as count FROM youbot_follow_ups WHERE 1=1`;
        const params: any[] = [];
        if (status) { sql += ` AND status = ?`; params.push(status); }
        if (overdue) { sql += ` AND follow_up_at <= ?`; params.push(now); }
        
        const row = await db.get<{count: number}>(sql, params);
        return row?.count || 0;
      };

      const [pending, completed, cancelled, expired, overdue] = await Promise.all([
        getCount('pending'),
        getCount('completed'),
        getCount('cancelled'),
        getCount('expired'),
        getCount('pending', true)
      ]);

      return { pending, completed, cancelled, expired, overdue };
    },
  };
}
