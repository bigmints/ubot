import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConnectorRegistry } from './registry.js';
import { IntegrationService } from './service.js';
import type {
  ConnectorDefinition,
  IntegrationConfigStore,
  IntegrationConnection,
  IntegrationRepository,
  IntegrationSyncState,
} from './types.js';
import type { ExternalRecord } from './schemas.js';

class MemoryConfigStore implements IntegrationConfigStore {
  values = new Map<string, unknown>();
  async get(id: string) { return this.values.get(id) ?? null; }
  async set(id: string, value: unknown) { this.values.set(id, value); }
  async delete(id: string) { this.values.delete(id); }
}

class MemoryRepository implements IntegrationRepository {
  connections = new Map<string, IntegrationConnection>();
  states = new Map<string, IntegrationSyncState>();
  records: ExternalRecord[] = [];
  async initialize() {}
  async createConnection(value: IntegrationConnection) { this.connections.set(value.id, value); }
  async getConnection(id: string) { return this.connections.get(id) ?? null; }
  async listConnections() { return [...this.connections.values()]; }
  async updateConnection(id: string, updates: Partial<IntegrationConnection>) {
    this.connections.set(id, { ...this.connections.get(id)!, ...updates });
  }
  async deleteConnection(id: string) { this.connections.delete(id); }
  async getSyncState(id: string, stream: string) { return this.states.get(`${id}:${stream}`) ?? null; }
  async saveSyncState(state: IntegrationSyncState) { this.states.set(`${state.connectionId}:${state.stream}`, state); }
  async upsertRecords(_id: string, records: ExternalRecord[]) { this.records.push(...records); return records.length; }
  async searchRecords(query: string) { return this.records.filter((record) => record.text.includes(query)); }
}

function connector(failAfterFirstBatch = false): ConnectorDefinition<{ token: string }> {
  return {
    manifest: {
      protocolVersion: '1.0', id: 'test-source', name: 'Test Source',
      description: 'Connector used by protocol tests.', version: '1.0.0',
      auth: { type: 'api_key' },
      capabilities: { incrementalSync: true, webhooks: false, actions: false },
      streams: [{
        name: 'items', title: 'Items', description: 'Test items.',
        primaryKey: ['externalId'], supportsIncremental: true,
      }],
      actions: [],
    },
    configSchema: z.object({ token: z.string().min(1) }),
    async check({ config }) { return { ok: config.token === 'valid' }; },
    async *read() {
      yield {
        records: [{ sourceId: 'untrusted', stream: 'wrong', externalId: '1', text: 'first', data: {} }],
        state: { cursor: 1 },
      };
      if (failAfterFirstBatch) throw new Error('remote read failed');
      yield {
        records: [{ sourceId: 'untrusted', stream: 'wrong', externalId: '2', text: 'second', data: {} }],
        state: { cursor: 2 },
      };
    },
  };
}

describe('IntegrationService', () => {
  it('validates config, connects, normalizes records, and checkpoints batches', async () => {
    const registry = new ConnectorRegistry();
    registry.register(connector());
    const repository = new MemoryRepository();
    const configs = new MemoryConfigStore();
    const service = new IntegrationService(registry, repository, configs);

    await expect(service.connect({ connectorId: 'test-source', config: { token: '' } })).rejects.toThrow();
    const connection = await service.connect({
      connectorId: 'test-source', connectionId: 'source-1', config: { token: 'valid' },
    });
    const result = await service.sync(connection.id);

    expect(result.records).toBe(2);
    expect(repository.records.map((record) => [record.sourceId, record.stream])).toEqual([
      ['test-source', 'items'], ['test-source', 'items'],
    ]);
    expect(repository.states.get('source-1:items')?.state).toEqual({ cursor: 2 });
    expect(repository.connections.get('source-1')?.status).toBe('connected');
  });

  it('keeps the last stored checkpoint and reports stream errors', async () => {
    const registry = new ConnectorRegistry();
    registry.register(connector(true));
    const repository = new MemoryRepository();
    const service = new IntegrationService(registry, repository, new MemoryConfigStore());
    await service.connect({ connectorId: 'test-source', connectionId: 'source-2', config: { token: 'valid' } });

    await expect(service.sync('source-2')).rejects.toThrow('remote read failed');
    expect(repository.records).toHaveLength(1);
    expect(repository.states.get('source-2:items')).toMatchObject({
      state: { cursor: 1 }, recordsSynced: 1, lastError: 'remote read failed',
    });
    expect(repository.connections.get('source-2')).toMatchObject({
      status: 'error', lastError: 'remote read failed',
    });
  });

  it('rejects duplicate connector IDs and exposes JSON config schemas', () => {
    const registry = new ConnectorRegistry();
    registry.register(connector());
    expect(() => registry.register(connector())).toThrow('already registered');
    expect(registry.list()[0].configSchema).toMatchObject({ type: 'object' });
  });
});
