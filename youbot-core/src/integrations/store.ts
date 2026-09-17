import { createHash } from 'crypto';
import type { DatabaseConnection } from '../data/database/types.js';
import { externalRecordSchema, type ExternalRecord } from './schemas.js';
import type {
  IntegrationConnection,
  IntegrationRepository,
  IntegrationSyncState,
} from './types.js';

interface ConnectionRow {
  id: string;
  connector_id: string;
  name: string;
  status: IntegrationConnection['status'];
  enabled_streams: string | string[];
  last_checked_at: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}
interface StateRow {
  connection_id: string;
  stream: string;
  state_json: string | unknown | null;
  records_synced: number;
  last_sync_at: string | null;
  last_error: string | null;
}

interface RecordRow {
  source_id: string;
  stream: string;
  external_id: string;
  external_updated_at: string | null;
  cursor_json: string | unknown | null;
  text_content: string;
  data_json: string | Record<string, unknown>;
  metadata_json: string | Record<string, unknown>;
  acl_json: string | string[];
  fingerprint: string;
}

function decodeJson<T>(value: string | T | null, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function toConnection(row: ConnectionRow): IntegrationConnection {
  return {
    id: row.id,
    connectorId: row.connector_id,
    name: row.name,
    status: row.status,
    enabledStreams: decodeJson(row.enabled_streams, []),
    lastCheckedAt: row.last_checked_at,
    lastSyncAt: row.last_sync_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class IntegrationStore implements IntegrationRepository {
  private initializePromise: Promise<void> | null = null;

  constructor(private readonly db: DatabaseConnection) {}

  initialize(): Promise<void> {
    if (!this.initializePromise) this.initializePromise = this.createSchema();
    return this.initializePromise;
  }

  private async createSchema(): Promise<void> {
    const statements = [
      `CREATE TABLE IF NOT EXISTS youbot_integration_connections (
        id TEXT PRIMARY KEY,
        connector_id TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'connected',
        enabled_streams TEXT NOT NULL DEFAULT '[]',
        last_checked_at TEXT,
        last_sync_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_youbot_integrations_connector
        ON youbot_integration_connections(connector_id)`,
      `CREATE TABLE IF NOT EXISTS youbot_integration_sync_state (
        connection_id TEXT NOT NULL,
        stream TEXT NOT NULL,
        state_json TEXT,
        records_synced INTEGER NOT NULL DEFAULT 0,
        last_sync_at TEXT,
        last_error TEXT,
        PRIMARY KEY (connection_id, stream)
      )`,
      `CREATE TABLE IF NOT EXISTS youbot_integration_records (
        connection_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        stream TEXT NOT NULL,
        external_id TEXT NOT NULL,
        external_updated_at TEXT,
        cursor_json TEXT,
        text_content TEXT NOT NULL DEFAULT '',
        data_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        acl_json TEXT NOT NULL DEFAULT '[]',
        fingerprint TEXT NOT NULL,
        ingested_at TEXT NOT NULL,
        PRIMARY KEY (connection_id, stream, external_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_youbot_integration_records_source
        ON youbot_integration_records(connection_id, stream)`,
    ];
    for (const sql of statements) await this.db.execute(sql);
  }

  async createConnection(connection: IntegrationConnection): Promise<void> {
    await this.initialize();
    await this.db.execute(
      `INSERT INTO youbot_integration_connections
       (id, connector_id, name, status, enabled_streams, last_checked_at, last_sync_at, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [connection.id, connection.connectorId, connection.name, connection.status,
        JSON.stringify(connection.enabledStreams), connection.lastCheckedAt, connection.lastSyncAt,
        connection.lastError, connection.createdAt, connection.updatedAt],
    );
  }

  async getConnection(id: string): Promise<IntegrationConnection | null> {
    await this.initialize();
    const row = await this.db.get<ConnectionRow>(
      'SELECT * FROM youbot_integration_connections WHERE id = ?', [id],
    );
    return row ? toConnection(row) : null;
  }

  async listConnections(): Promise<IntegrationConnection[]> {
    await this.initialize();
    const rows = await this.db.query<ConnectionRow>(
      'SELECT * FROM youbot_integration_connections ORDER BY created_at DESC',
    );
    return rows.map(toConnection);
  }

  async updateConnection(
    id: string,
    updates: Partial<Pick<IntegrationConnection,
      'name' | 'status' | 'enabledStreams' | 'lastCheckedAt' | 'lastSyncAt' | 'lastError' | 'updatedAt'>>,
  ): Promise<void> {
    await this.initialize();
    const columns: Record<string, string> = {
      name: 'name', status: 'status', enabledStreams: 'enabled_streams',
      lastCheckedAt: 'last_checked_at', lastSyncAt: 'last_sync_at',
      lastError: 'last_error', updatedAt: 'updated_at',
    };
    const entries = Object.entries(updates).filter(([, value]) => value !== undefined);
    if (entries.length === 0) return;
    const values = entries.map(([key, value]) => key === 'enabledStreams' ? JSON.stringify(value) : value);
    const assignments = entries.map(([key]) => `${columns[key]} = ?`).join(', ');
    await this.db.execute(
      `UPDATE youbot_integration_connections SET ${assignments} WHERE id = ?`,
      [...values, id],
    );
  }

  async deleteConnection(id: string): Promise<void> {
    await this.initialize();
    await this.db.execute('DELETE FROM youbot_integration_records WHERE connection_id = ?', [id]);
    await this.db.execute('DELETE FROM youbot_integration_sync_state WHERE connection_id = ?', [id]);
    await this.db.execute('DELETE FROM youbot_integration_connections WHERE id = ?', [id]);
  }

  async getSyncState(connectionId: string, stream: string): Promise<IntegrationSyncState | null> {
    await this.initialize();
    const row = await this.db.get<StateRow>(
      'SELECT * FROM youbot_integration_sync_state WHERE connection_id = ? AND stream = ?',
      [connectionId, stream],
    );
    if (!row) return null;
    return {
      connectionId: row.connection_id,
      stream: row.stream,
      state: decodeJson(row.state_json, null),
      recordsSynced: Number(row.records_synced),
      lastSyncAt: row.last_sync_at,
      lastError: row.last_error,
    };
  }

  async saveSyncState(state: IntegrationSyncState): Promise<void> {
    await this.initialize();
    await this.db.execute(
      `INSERT INTO youbot_integration_sync_state
       (connection_id, stream, state_json, records_synced, last_sync_at, last_error)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(connection_id, stream) DO UPDATE SET
         state_json = excluded.state_json,
         records_synced = excluded.records_synced,
         last_sync_at = excluded.last_sync_at,
         last_error = excluded.last_error`,
      [state.connectionId, state.stream, state.state === null ? null : JSON.stringify(state.state),
        state.recordsSynced, state.lastSyncAt, state.lastError],
    );
  }

  async upsertRecords(connectionId: string, records: ExternalRecord[]): Promise<number> {
    await this.initialize();
    let stored = 0;
    for (const input of records) {
      const record = externalRecordSchema.parse(input);
      const fingerprint = record.fingerprint || createHash('sha256')
        .update(JSON.stringify({ text: record.text, data: record.data, metadata: record.metadata }))
        .digest('hex');
      await this.db.execute(
        `INSERT INTO youbot_integration_records
         (connection_id, source_id, stream, external_id, external_updated_at, cursor_json,
          text_content, data_json, metadata_json, acl_json, fingerprint, ingested_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(connection_id, stream, external_id) DO UPDATE SET
           source_id = excluded.source_id,
           external_updated_at = excluded.external_updated_at,
           cursor_json = excluded.cursor_json,
           text_content = excluded.text_content,
           data_json = excluded.data_json,
           metadata_json = excluded.metadata_json,
           acl_json = excluded.acl_json,
           fingerprint = excluded.fingerprint,
           ingested_at = excluded.ingested_at`,
        [connectionId, record.sourceId, record.stream, record.externalId, record.updatedAt || null,
          record.cursor === undefined ? null : JSON.stringify(record.cursor), record.text,
          JSON.stringify(record.data), JSON.stringify(record.metadata), JSON.stringify(record.acl),
          fingerprint, new Date().toISOString()],
      );
      stored++;
    }
    return stored;
  }

  async searchRecords(
    query: string,
    options: { connectionId?: string; stream?: string; limit?: number } = {},
  ): Promise<ExternalRecord[]> {
    await this.initialize();
    const conditions = ['(LOWER(text_content) LIKE ? OR LOWER(data_json) LIKE ?)'];
    const needle = `%${query.toLowerCase()}%`;
    const params: unknown[] = [needle, needle];
    if (options.connectionId) {
      conditions.push('connection_id = ?');
      params.push(options.connectionId);
    }
    if (options.stream) {
      conditions.push('stream = ?');
      params.push(options.stream);
    }
    const limit = Math.min(Math.max(options.limit || 20, 1), 100);
    params.push(limit);
    const rows = await this.db.query<RecordRow>(
      `SELECT source_id, stream, external_id, external_updated_at, cursor_json,
              text_content, data_json, metadata_json, acl_json, fingerprint
       FROM youbot_integration_records
       WHERE ${conditions.join(' AND ')}
       ORDER BY external_updated_at DESC, external_id ASC LIMIT ?`,
      params,
    );
    return rows.map((row) => externalRecordSchema.parse({
      sourceId: row.source_id,
      stream: row.stream,
      externalId: row.external_id,
      updatedAt: row.external_updated_at || undefined,
      cursor: decodeJson(row.cursor_json, undefined),
      text: row.text_content,
      data: decodeJson(row.data_json, {}),
      metadata: decodeJson(row.metadata_json, {}),
      acl: decodeJson(row.acl_json, []),
      fingerprint: row.fingerprint,
    }));
  }
}
