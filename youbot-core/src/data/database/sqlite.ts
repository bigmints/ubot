import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { DatabaseConnection, DatabaseOptions, QueryResult } from './types.js';
import * as path from 'path';
import fs from 'fs';

export function resolveSQLitePath(
  configuredPath: string | undefined,
  environment = process.env,
  workingDirectory = process.cwd(),
): string {
  const selectedPath = environment.DATABASE_PATH
    || environment.SQLITE_DB_PATH
    || configuredPath
    || path.join('data', 'youbot.db');
  const basePath = environment.YOUBOT_HOME || workingDirectory;
  return path.isAbsolute(selectedPath) ? selectedPath : path.join(basePath, selectedPath);
}

export class SQLiteConnection implements DatabaseConnection {
  private dbPromise: Promise<Database>;

  constructor(options: DatabaseOptions) {
    const dbPath = resolveSQLitePath(options.config.path);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
    this.dbPromise = open({
      filename: dbPath,
      driver: sqlite3.Database
    }).then(async (db) => {
      await db.exec('PRAGMA journal_mode = WAL;');
      await db.exec('PRAGMA foreign_keys = ON;');
      await db.exec('PRAGMA synchronous = NORMAL;');
      await db.exec('PRAGMA busy_timeout = 5000;');
      try { fs.chmodSync(dbPath, 0o600); } catch { /* best effort */ }
      await this.initializeSchema(db);
      return db;
    });
  }

  is_connected(): boolean {
    return true;
  }

  async close(): Promise<void> {
    const db = await this.dbPromise;
    await db.close();
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    try {
      const db = await this.dbPromise;
      const rows = await db.all(sql, ...params);
      return rows.map(r => this.parseJsonFields(r)) as T[];
    } catch (error: any) {
      console.error(`[SQLite Error] Query failed: ${sql} | Error: ${error.message}`);
      throw error;
    }
  }

  async get<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    try {
      const db = await this.dbPromise;
      const row = await db.get(sql, ...params);
      return row ? this.parseJsonFields(row) as T : null;
    } catch (error: any) {
      console.error(`[SQLite Error] Get failed: ${sql} | Error: ${error.message}`);
      throw error;
    }
  }

  async execute(sql: string, params: any[] = []): Promise<QueryResult> {
    try {
      const db = await this.dbPromise;
      const result = await db.run(sql, ...params);
      return {
        changes: result.changes ?? 0,
        lastInsertRowid: result.lastID ?? 0
      };
    } catch (error: any) {
      console.error(`[SQLite Error] Execute failed: ${sql} | Error: ${error.message}`);
      throw error;
    }
  }

  private parseJsonFields(row: any) {
    if (!row) return row;
    const parsed = { ...row };
    for (const key of Object.keys(parsed)) {
      const val = parsed[key];
      if (typeof val === 'string' && val.length > 1) {
        if ((val.startsWith('{') && val.endsWith('}')) || (val.startsWith('[') && val.endsWith(']'))) {
          try { parsed[key] = JSON.parse(val); } catch (e) {}
        }
      }
    }
    return parsed;
  }

  private async initializeSchema(db: Database) {
    console.log('[SQLite] Initializing database schema...');

    // Drop legacy scheduled_tasks table if it has the old 'cron' column
    try {
      const tableInfo = await db.all("PRAGMA table_info(youbot_scheduled_tasks)");
      if (tableInfo.length > 0 && tableInfo.some(col => col.name === 'cron')) {
        console.log('[SQLite] Dropping legacy youbot_scheduled_tasks table...');
        await db.exec("DROP TABLE youbot_scheduled_tasks;");
      }
    } catch (e) {
      console.warn('[SQLite] Failed to check legacy schema for youbot_scheduled_tasks');
    }

    await db.exec(`
      CREATE TABLE IF NOT EXISTS youbot_contacts (
          id TEXT PRIMARY KEY,
          display_name TEXT,
          type TEXT NOT NULL DEFAULT 'person',
          tags TEXT,
          metadata TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS youbot_contact_identities (
          contact_id TEXT NOT NULL,
          channel TEXT NOT NULL,
          platform_id TEXT NOT NULL,
          PRIMARY KEY (channel, platform_id),
          FOREIGN KEY(contact_id) REFERENCES youbot_contacts(id)
      );

      CREATE TABLE IF NOT EXISTS youbot_chat_sessions (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL DEFAULT 'web',
          name TEXT NOT NULL DEFAULT 'Chat',
          owner_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_youbot_sessions_type ON youbot_chat_sessions(type);

        CREATE TABLE IF NOT EXISTS youbot_chat_messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          metadata TEXT,
          owner_id TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_youbot_messages_session ON youbot_chat_messages(session_id);

        CREATE TABLE IF NOT EXISTS youbot_memories (
          id TEXT PRIMARY KEY,
          contact_id TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'fact',
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'extracted',
          confidence REAL NOT NULL DEFAULT 0.8,
          expires_at TEXT,
          owner_id TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_youbot_memories_contact ON youbot_memories(contact_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_unique ON youbot_memories(contact_id, category, key);

        CREATE TABLE IF NOT EXISTS youbot_soul_documents (
          persona_id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          owner_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS youbot_follow_ups (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          contact_id TEXT NOT NULL,
          channel TEXT NOT NULL DEFAULT 'whatsapp',
          reason TEXT NOT NULL,
          context TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending',
          priority TEXT NOT NULL DEFAULT 'normal',
          follow_up_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          completed_at TEXT,
          result TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 3,
          owner_id TEXT,
          approval_id TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_youbot_followups_status ON youbot_follow_ups(status);

        CREATE TABLE IF NOT EXISTS youbot_async_jobs (
          id TEXT PRIMARY KEY,
          session_id TEXT,
          status TEXT NOT NULL DEFAULT 'processing',
          result TEXT,
          error TEXT,
          started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          completed_at TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS youbot_scheduled_tasks (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          tag TEXT NOT NULL,
          schedule TEXT NOT NULL,
          data TEXT NOT NULL,
          priority TEXT NOT NULL,
          status TEXT NOT NULL,
          tags TEXT NOT NULL,
          metadata TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          next_run_at TEXT,
          run_count INTEGER NOT NULL DEFAULT 0,
          failure_count INTEGER NOT NULL DEFAULT 0,
          enabled INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS ubot_spawned_sessions (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          task TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'running',
          result TEXT,
          error TEXT,
          start_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          end_time TEXT
        );

        CREATE TABLE IF NOT EXISTS ubot_sessions (
          id TEXT PRIMARY KEY
        );

        CREATE TABLE IF NOT EXISTS youbot_task_plans (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          original_request TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS youbot_task_steps (
          id TEXT PRIMARY KEY,
          plan_id TEXT NOT NULL,
          description TEXT NOT NULL,
          agent_type TEXT,
          depends_on TEXT,
          status TEXT NOT NULL,
          prompt TEXT,
          result TEXT,
          error TEXT
        );

        CREATE TABLE IF NOT EXISTS youbot_prompt_experiments (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          variants_json TEXT NOT NULL,
          traffic_split_json TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS youbot_experiment_results (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          experiment_id TEXT NOT NULL,
          variant_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          tool_calls INTEGER NOT NULL DEFAULT 0,
          tool_successes INTEGER NOT NULL DEFAULT 0,
          tool_failures INTEGER NOT NULL DEFAULT 0,
          response_time_ms INTEGER NOT NULL DEFAULT 0,
          timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS youbot_agent_memories (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          content TEXT NOT NULL,
          embedding_json TEXT NOT NULL,
          metadata_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS youbot_pending_approvals (
          id TEXT PRIMARY KEY,
          question TEXT NOT NULL,
          context TEXT,
          requester_jid TEXT,
          session_id TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          owner_response TEXT,
          resolved_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS youbot_tool_metrics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tool_name TEXT NOT NULL,
          success INTEGER NOT NULL DEFAULT 0,
          duration_ms INTEGER,
          session_id TEXT,
          timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS youbot_llm_usage (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          model TEXT NOT NULL,
          purpose TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          input_tokens INTEGER NOT NULL,
          output_tokens INTEGER NOT NULL,
          total_tokens INTEGER NOT NULL,
          estimated_cost REAL NOT NULL DEFAULT 0.0,
          timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);

    await this.runFollowUpsMigration(db);
    await this.runCrmMigration(db);
  }

  private async runFollowUpsMigration(db: Database) {
    try {
      const columns = await db.all(`PRAGMA table_info(youbot_follow_ups)`);
      const hasApprovalId = columns.some((column: any) => column.name === 'approval_id');
      if (!hasApprovalId) {
        await db.run(`ALTER TABLE youbot_follow_ups ADD COLUMN approval_id TEXT`);
        console.log('[SQLite] Added missing approval_id column to youbot_follow_ups.');
      }
    } catch (e: any) {
      console.warn('[SQLite] Follow-up migration failed:', e.message);
      throw e;
    }
  }

  private async runCrmMigration(db: Database) {
    try {
      const unmigrated = await db.all(`
        SELECT DISTINCT contact_id 
        FROM youbot_memories 
        WHERE contact_id NOT IN (
          SELECT platform_id FROM youbot_contact_identities
        ) AND contact_id != '00000000-0000-0000-0000-000000000000'
      `);

      if (unmigrated.length > 0) {
        console.log(`[SQLite] Migrating ${unmigrated.length} legacy contacts to Universal CRM...`);
        
        // Need uuid for generating new IDs
        const { v4: uuidv4 } = require('uuid');

        await db.exec('BEGIN TRANSACTION;');
        for (const row of unmigrated) {
          const oldId = row.contact_id;
          let channel = 'web';
          if (oldId.includes('@s.whatsapp.net') || oldId.includes('@g.us')) {
            channel = 'whatsapp';
          } else if (/^\d+$/.test(oldId) && oldId.length < 15) {
            channel = 'telegram';
          } else if (oldId.includes('webchat:')) {
            channel = 'webchat';
          }
          
          const newId = uuidv4();
          await db.run('INSERT INTO youbot_contacts (id, display_name, type, tags, metadata) VALUES (?, ?, ?, ?, ?)', [newId, oldId, 'person', '[]', '{}']);
          await db.run('INSERT INTO youbot_contact_identities (contact_id, channel, platform_id) VALUES (?, ?, ?)', [newId, channel, oldId]);
          await db.run('UPDATE youbot_memories SET contact_id = ? WHERE contact_id = ?', [newId, oldId]);
          await db.run('UPDATE youbot_follow_ups SET contact_id = ? WHERE contact_id = ?', [newId, oldId]);
        }
        await db.exec('COMMIT;');
        console.log('[SQLite] Legacy CRM migration complete.');
      }
    } catch (e: any) {
      await db.exec('ROLLBACK;');
      console.warn('[SQLite] CRM migration failed:', e.message);
    }
  }
}
