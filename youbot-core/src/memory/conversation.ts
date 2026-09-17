/**
 * Conversation Store
 * SQLite-backed conversation history management
 */

import { v4 as uuidv4 } from 'uuid';
import type { DatabaseConnection } from '../data/database/types.js';
import type { ChatMessage, ChatRole, ChatMessageMetadata, ConversationSession } from '../engine/types.js';

export interface ConversationStore {
  createSession(id: string, type: 'web' | 'whatsapp' | 'telegram' | 'webchat' | 'sub-agent' | 'scheduler', name?: string): Promise<ConversationSession>;
  getSession(id: string): Promise<ConversationSession | undefined>;
  getOrCreateSession(id: string, type: 'web' | 'whatsapp' | 'telegram' | 'webchat' | 'sub-agent' | 'scheduler', name?: string): Promise<ConversationSession>;
  listSessions(): Promise<ConversationSession[]>;
  addMessage(sessionId: string, role: ChatRole, content: string, metadata?: ChatMessageMetadata): Promise<ChatMessage>;
  getHistory(sessionId: string, limit?: number): Promise<ChatMessage[]>;
  getRecentWebMessages(sinceMs: number): Promise<ChatMessage[]>;
  clearSession(sessionId: string): Promise<void>;
  clearAll(): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  renameSession(sessionId: string, name: string): Promise<void>;
}

export function createConversationStore(db: DatabaseConnection): ConversationStore {
  return {
    async createSession(id: string, type: 'web' | 'whatsapp' | 'telegram' | 'webchat' | 'sub-agent' | 'scheduler', name?: string): Promise<ConversationSession> {
      const now = new Date().toISOString();
      const sessionName = name || (type === 'web' ? 'Command Center' : id);
      const ownerId = '00000000-0000-0000-0000-000000000000'; // Default owner for SQLite backend

      try {
        await db.execute(
          `INSERT INTO youbot_chat_sessions (id, type, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET type = excluded.type, name = excluded.name, updated_at = excluded.updated_at`,
          [id, type, sessionName, ownerId, now, now]
        );
      } catch (error: any) {
        console.error('[SQLite] createSession Error:', error);
        throw new Error(`Failed to create session: ${error.message || error}`);
      }

      return {
        id,
        type,
        name: sessionName,
        createdAt: new Date(now),
        updatedAt: new Date(now),
        messageCount: 0,
      };
    },

    async getSession(id: string): Promise<ConversationSession | undefined> {
      const data = await db.get(`
        SELECT s.id, s.type, s.name, s.created_at, s.updated_at, COUNT(m.id) as count
        FROM youbot_chat_sessions s
        LEFT JOIN youbot_chat_messages m ON s.id = m.session_id
        WHERE s.id = ?
        GROUP BY s.id
      `, [id]);

      if (!data) return undefined;

      return {
        id: data.id,
        type: data.type as any,
        name: data.name,
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at),
        messageCount: data.count,
      };
    },

    async getOrCreateSession(id: string, type: 'web' | 'whatsapp' | 'telegram' | 'webchat' | 'sub-agent' | 'scheduler', name?: string): Promise<ConversationSession> {
      const existing = await this.getSession(id);
      if (existing) return existing;
      return this.createSession(id, type, name);
    },

    async listSessions(): Promise<ConversationSession[]> {
      try {
        const sessions = await db.query(`
          SELECT s.id, s.type, s.name, s.created_at, s.updated_at, COUNT(m.id) as count,
                 (SELECT latest.role FROM youbot_chat_messages latest WHERE latest.session_id = s.id ORDER BY latest.timestamp DESC LIMIT 1) as last_message_role,
                 (SELECT latest.content FROM youbot_chat_messages latest WHERE latest.session_id = s.id ORDER BY latest.timestamp DESC LIMIT 1) as last_message_content,
                 (SELECT latest.timestamp FROM youbot_chat_messages latest WHERE latest.session_id = s.id ORDER BY latest.timestamp DESC LIMIT 1) as last_message_timestamp
          FROM youbot_chat_sessions s
          LEFT JOIN youbot_chat_messages m ON s.id = m.session_id
          GROUP BY s.id
          ORDER BY s.updated_at DESC
        `);

        return sessions.map((row: any) => ({
          id: row.id,
          type: row.type,
          name: row.name,
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at),
          messageCount: row.count || 0,
          lastMessage: row.last_message_timestamp ? {
            role: row.last_message_role as ChatRole,
            content: row.last_message_content || '',
            timestamp: new Date(row.last_message_timestamp),
          } : undefined,
        }));
      } catch (error) {
        console.error('[SQLite] listSessions Error:', error);
        return [];
      }
    },

    async addMessage(sessionId: string, role: ChatRole, content: string, metadata?: ChatMessageMetadata): Promise<ChatMessage> {
      const id = uuidv4();
      const now = new Date();
      const timestamp = now.toISOString();

      try {
        await db.execute(
          `INSERT INTO youbot_chat_messages (id, session_id, role, content, timestamp, metadata) VALUES (?, ?, ?, ?, ?, ?)`,
          [id, sessionId, role, content, timestamp, metadata ? JSON.stringify(metadata) : null]
        );

        await db.execute(
          `UPDATE youbot_chat_sessions SET updated_at = ? WHERE id = ?`,
          [timestamp, sessionId]
        );
      } catch (error) {
        console.error('[SQLite] addMessage Error:', error);
      }

      return {
        id,
        sessionId,
        role,
        content,
        timestamp: now,
        metadata,
      };
    },

    async getHistory(sessionId: string, limit = 50): Promise<ChatMessage[]> {
      const data = await db.query(
        `SELECT * FROM (
           SELECT * FROM youbot_chat_messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?
         ) ORDER BY timestamp ASC`,
        [sessionId, limit]
      );

      return data.map((row: any) => ({
        id: row.id,
        sessionId: row.session_id,
        role: row.role as ChatRole,
        content: row.content,
        timestamp: new Date(row.timestamp),
        metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : undefined,
      }));
    },

    async getRecentWebMessages(sinceMs: number): Promise<ChatMessage[]> {
      const data = await db.query(
        `SELECT m.* FROM youbot_chat_messages m
         JOIN youbot_chat_sessions s ON m.session_id = s.id
         WHERE s.type = 'web'
           AND m.timestamp >= ?
         ORDER BY m.timestamp ASC`,
        [new Date(sinceMs).toISOString()]
      );

      return data.map((row: any) => ({
        id: row.id,
        sessionId: row.session_id,
        role: row.role as ChatRole,
        content: row.content,
        timestamp: new Date(row.timestamp),
        metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : undefined,
      }));
    },

    async clearSession(sessionId: string): Promise<void> {
      await db.execute(`DELETE FROM youbot_chat_messages WHERE session_id = ?`, [sessionId]);
    },

    async clearAll(): Promise<void> {
      await db.execute(`DELETE FROM youbot_chat_messages WHERE id != '0'`);
      await db.execute(`DELETE FROM youbot_chat_sessions WHERE id != '0'`);
    },

    async deleteSession(sessionId: string): Promise<void> {
      await db.execute(`DELETE FROM youbot_chat_messages WHERE session_id = ?`, [sessionId]);
      await db.execute(`DELETE FROM youbot_chat_sessions WHERE id = ?`, [sessionId]);
    },

    async renameSession(sessionId: string, name: string): Promise<void> {
      await db.execute(
        `UPDATE youbot_chat_sessions SET name = ?, updated_at = ? WHERE id = ?`,
        [name, new Date().toISOString(), sessionId]
      );
    },
  };
}
