import { randomUUID } from 'crypto';
import { connectorCheckResultSchema, connectorStreamSchema, externalRecordSchema } from './schemas.js';
import type { ConnectorRegistry } from './registry.js';
import type {
  IntegrationConfigStore,
  IntegrationConnection,
  IntegrationRepository,
  IntegrationSyncState,
} from './types.js';

export interface ConnectIntegrationInput {
  connectorId: string;
  connectionId?: string;
  name?: string;
  config: unknown;
  enabledStreams?: string[];
}

export interface SyncResult {
  connectionId: string;
  streams: Array<{ stream: string; records: number; state: unknown | null }>;
  records: number;
}

export class IntegrationService {
  private readonly activeSyncs = new Map<string, Promise<SyncResult>>();

  constructor(
    readonly registry: ConnectorRegistry,
    private readonly repository: IntegrationRepository,
    private readonly configs: IntegrationConfigStore,
  ) {}

  initialize(): Promise<void> {
    return this.repository.initialize();
  }

  listConnectors() {
    return this.registry.list();
  }

  listConnections(): Promise<IntegrationConnection[]> {
    return this.repository.listConnections();
  }

  async connect(input: ConnectIntegrationInput): Promise<IntegrationConnection> {
    const connector = this.registry.get(input.connectorId);
    if (!connector) throw new Error(`Unknown connector "${input.connectorId}"`);
    const config = connector.configSchema.parse(input.config);
    const connectionId = input.connectionId || `${input.connectorId}-${randomUUID()}`;
    if (await this.repository.getConnection(connectionId)) {
      throw new Error(`Connection "${connectionId}" already exists`);
    }

    const check = connectorCheckResultSchema.parse(await connector.check({ connectionId, config }));
    if (!check.ok) throw new Error(check.message || 'Connector check failed');

    const discovered = connector.discover
      ? await connector.discover({ connectionId, config })
      : connector.manifest.streams;
    const streams = discovered.map((stream) => connectorStreamSchema.parse(stream));
    const available = new Set(streams.map((stream) => stream.name));
    const enabledStreams = input.enabledStreams || streams.map((stream) => stream.name);
    const invalid = enabledStreams.filter((stream) => !available.has(stream));
    if (invalid.length > 0) throw new Error(`Unknown stream(s): ${invalid.join(', ')}`);

    const now = new Date().toISOString();
    const connection: IntegrationConnection = {
      id: connectionId,
      connectorId: input.connectorId,
      name: input.name || connector.manifest.name,
      status: 'connected',
      enabledStreams,
      lastCheckedAt: now,
      lastSyncAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };

    await this.configs.set(connectionId, config);
    try {
      await this.repository.createConnection(connection);
    } catch (error) {
      await this.configs.delete(connectionId);
      throw error;
    }
    return connection;
  }

  async check(connectionId: string): Promise<ReturnType<typeof connectorCheckResultSchema.parse>> {
    const { connection, connector, config } = await this.resolve(connectionId);
    const result = connectorCheckResultSchema.parse(await connector.check({ connectionId, config }));
    const now = new Date().toISOString();
    await this.repository.updateConnection(connection.id, {
      status: result.ok ? 'connected' : 'error',
      lastCheckedAt: now,
      lastError: result.ok ? null : result.message || 'Connector check failed',
      updatedAt: now,
    });
    return result;
  }

  async discover(connectionId: string) {
    const { connector, config } = await this.resolve(connectionId);
    const streams = connector.discover
      ? await connector.discover({ connectionId, config })
      : connector.manifest.streams;
    return streams.map((stream) => connectorStreamSchema.parse(stream));
  }

  sync(connectionId: string, requestedStreams?: string[], signal?: AbortSignal): Promise<SyncResult> {
    const existing = this.activeSyncs.get(connectionId);
    if (existing) return existing;
    const sync = this.performSync(connectionId, requestedStreams, signal)
      .finally(() => this.activeSyncs.delete(connectionId));
    this.activeSyncs.set(connectionId, sync);
    return sync;
  }

  private async performSync(
    connectionId: string,
    requestedStreams?: string[],
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const { connection, connector, config } = await this.resolve(connectionId);
    const discovered = connector.discover
      ? await connector.discover({ connectionId, config, signal })
      : connector.manifest.streams;
    const streamMap = new Map(discovered.map((stream) => [stream.name, connectorStreamSchema.parse(stream)]));
    const streamNames = requestedStreams || connection.enabledStreams;
    const unknown = streamNames.filter((stream) => !streamMap.has(stream));
    if (unknown.length > 0) throw new Error(`Unknown stream(s): ${unknown.join(', ')}`);

    const startedAt = new Date().toISOString();
    await this.repository.updateConnection(connectionId, {
      status: 'syncing', lastError: null, updatedAt: startedAt,
    });

    const result: SyncResult = { connectionId, streams: [], records: 0 };
    try {
      for (const streamName of streamNames) {
        if (signal?.aborted) throw new Error('Sync aborted');
        const stream = streamMap.get(streamName)!;
        const previous = await this.repository.getSyncState(connectionId, streamName);
        let checkpoint = previous?.state ?? null;
        let streamRecords = 0;

        try {
          for await (const batch of connector.read({
            connectionId, config, stream, state: checkpoint, signal,
          })) {
            if (signal?.aborted) throw new Error('Sync aborted');
            const records = batch.records.map((record) => externalRecordSchema.parse({
              ...record,
              sourceId: connector.manifest.id,
              stream: streamName,
            }));
            streamRecords += await this.repository.upsertRecords(connectionId, records);
            if (batch.state !== undefined) checkpoint = batch.state;
            await this.repository.saveSyncState({
              connectionId,
              stream: streamName,
              state: checkpoint,
              recordsSynced: (previous?.recordsSynced || 0) + streamRecords,
              lastSyncAt: new Date().toISOString(),
              lastError: null,
            });
          }
        } catch (error: any) {
          await this.repository.saveSyncState({
            connectionId,
            stream: streamName,
            state: checkpoint,
            recordsSynced: (previous?.recordsSynced || 0) + streamRecords,
            lastSyncAt: previous?.lastSyncAt || null,
            lastError: error.message,
          });
          throw error;
        }

        result.streams.push({ stream: streamName, records: streamRecords, state: checkpoint });
        result.records += streamRecords;
      }

      const completedAt = new Date().toISOString();
      await this.repository.updateConnection(connectionId, {
        status: 'connected', lastSyncAt: completedAt, lastError: null, updatedAt: completedAt,
      });
      return result;
    } catch (error: any) {
      await this.repository.updateConnection(connectionId, {
        status: 'error', lastError: error.message, updatedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  async executeAction(connectionId: string, action: string, input: Record<string, unknown>): Promise<unknown> {
    const { connector, config } = await this.resolve(connectionId);
    if (!connector.executeAction) throw new Error(`Connector "${connector.manifest.id}" does not support actions`);
    if (!connector.manifest.actions.some((candidate) => candidate.name === action)) {
      throw new Error(`Unknown action "${action}"`);
    }
    return connector.executeAction({ connectionId, config, action, input });
  }

  async handleWebhook(
    connectionId: string,
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
  ): Promise<{ records: number }> {
    const { connector, config } = await this.resolve(connectionId);
    if (!connector.handleWebhook) {
      throw new Error(`Connector "${connector.manifest.id}" does not support webhooks`);
    }
    const batch = await connector.handleWebhook({ connectionId, config, headers, body });
    if (!batch) return { records: 0 };
    const records = batch.records.map((record) => externalRecordSchema.parse({
      ...record,
      sourceId: connector.manifest.id,
    }));
    return { records: await this.repository.upsertRecords(connectionId, records) };
  }

  search(query: string, options?: { connectionId?: string; stream?: string; limit?: number }) {
    return this.repository.searchRecords(query, options);
  }

  async disconnect(connectionId: string): Promise<void> {
    if (!await this.repository.getConnection(connectionId)) {
      throw new Error(`Connection "${connectionId}" not found`);
    }
    await this.repository.deleteConnection(connectionId);
    await this.configs.delete(connectionId);
  }

  private async resolve(connectionId: string) {
    const connection = await this.repository.getConnection(connectionId);
    if (!connection) throw new Error(`Connection "${connectionId}" not found`);
    const connector = this.registry.get(connection.connectorId);
    if (!connector) throw new Error(`Connector "${connection.connectorId}" is not installed`);
    const storedConfig = await this.configs.get(connectionId);
    if (storedConfig === null) throw new Error(`Configuration for "${connectionId}" is missing`);
    const config = connector.configSchema.parse(storedConfig);
    return { connection, connector, config };
  }
}
