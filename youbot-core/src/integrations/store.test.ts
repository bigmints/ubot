import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import type { DatabaseConnection, QueryResult } from '../data/database/types.js';
import { IntegrationStore } from './store.js';

class TestDatabase implements DatabaseConnection {
  constructor(private readonly db: Database) {}
  is_connected() { return true; }
  close() { void this.db.close(); }
  query<T>(sql: string, params: any[] = []) { return this.db.all<T[]>(sql, ...params) as Promise<T[]>; }
  async get<T>(sql: string, params: any[] = []) { return await this.db.get<T>(sql, ...params) || null; }
  async execute(sql: string, params: any[] = []): Promise<QueryResult> {
    const result = await this.db.run(sql, ...params);
    return { changes: result.changes || 0, lastInsertRowid: result.lastID || 0 };
  }
}

describe('IntegrationStore', () => {
  let db: Database;
  let store: IntegrationStore;

  beforeEach(async () => {
    db = await open({ filename: ':memory:', driver: sqlite3.Database });
    store = new IntegrationStore(new TestDatabase(db));
    await store.initialize();
  });

  afterEach(async () => {
    await db.close();
  });

  it('persists connections, stream state, records, search, and cleanup', async () => {
    const now = new Date().toISOString();
    await store.createConnection({
      id: 'connection-1', connectorId: 'example', name: 'Example', status: 'connected',
      enabledStreams: ['documents'], lastCheckedAt: now, lastSyncAt: null,
      lastError: null, createdAt: now, updatedAt: now,
    });
    await store.saveSyncState({
      connectionId: 'connection-1', stream: 'documents', state: { cursor: 42 },
      recordsSynced: 1, lastSyncAt: now, lastError: null,
    });
    await store.upsertRecords('connection-1', [{
      sourceId: 'example', stream: 'documents', externalId: 'doc-1', updatedAt: now,
      text: 'Quarterly planning notes', data: { title: 'Plan' }, metadata: {}, acl: [],
    }]);

    expect(await store.getConnection('connection-1')).toMatchObject({ enabledStreams: ['documents'] });
    expect(await store.getSyncState('connection-1', 'documents')).toMatchObject({ state: { cursor: 42 } });
    expect(await store.searchRecords('planning')).toMatchObject([{ externalId: 'doc-1' }]);

    await store.deleteConnection('connection-1');
    expect(await store.getConnection('connection-1')).toBeNull();
    expect(await store.searchRecords('planning')).toEqual([]);
  });
});
