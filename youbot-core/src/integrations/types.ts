import type { z } from 'zod';
import type {
  ConnectorCheckResult,
  ConnectorManifest,
  ConnectorStream,
  ExternalRecord,
} from './schemas.js';

export interface ConnectorContext<TConfig = unknown> {
  connectionId: string;
  config: TConfig;
  signal?: AbortSignal;
}
export interface ConnectorReadRequest<TConfig = unknown> extends ConnectorContext<TConfig> {
  stream: ConnectorStream;
  state: unknown | null;
  limit?: number;
}

export interface ConnectorReadBatch {
  records: ExternalRecord[];
  /** A durable checkpoint. It is persisted only after this batch is stored. */
  state?: unknown;
}

export interface ConnectorActionRequest<TConfig = unknown> extends ConnectorContext<TConfig> {
  action: string;
  input: Record<string, unknown>;
}

export interface ConnectorWebhookRequest<TConfig = unknown> extends ConnectorContext<TConfig> {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface ConnectorDefinition<TConfig = unknown> {
  manifest: ConnectorManifest;
  /** Runtime validation for secrets and connector-specific configuration. */
  configSchema: z.ZodType<TConfig>;
  check(context: ConnectorContext<TConfig>): Promise<ConnectorCheckResult>;
  discover?(context: ConnectorContext<TConfig>): Promise<ConnectorStream[]>;
  read(request: ConnectorReadRequest<TConfig>): AsyncIterable<ConnectorReadBatch>;
  executeAction?(request: ConnectorActionRequest<TConfig>): Promise<unknown>;
  handleWebhook?(request: ConnectorWebhookRequest<TConfig>): Promise<ConnectorReadBatch | void>;
}

export interface IntegrationConnection {
  id: string;
  connectorId: string;
  name: string;
  status: 'connected' | 'syncing' | 'error' | 'disabled';
  enabledStreams: string[];
  lastCheckedAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationSyncState {
  connectionId: string;
  stream: string;
  state: unknown | null;
  recordsSynced: number;
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface IntegrationRepository {
  initialize(): Promise<void>;
  createConnection(connection: IntegrationConnection): Promise<void>;
  getConnection(id: string): Promise<IntegrationConnection | null>;
  listConnections(): Promise<IntegrationConnection[]>;
  updateConnection(id: string, updates: Partial<Pick<IntegrationConnection,
    'name' | 'status' | 'enabledStreams' | 'lastCheckedAt' | 'lastSyncAt' | 'lastError' | 'updatedAt'>>): Promise<void>;
  deleteConnection(id: string): Promise<void>;
  getSyncState(connectionId: string, stream: string): Promise<IntegrationSyncState | null>;
  saveSyncState(state: IntegrationSyncState): Promise<void>;
  upsertRecords(connectionId: string, records: ExternalRecord[]): Promise<number>;
  searchRecords(query: string, options?: { connectionId?: string; stream?: string; limit?: number }): Promise<ExternalRecord[]>;
}

export interface IntegrationConfigStore {
  get(connectionId: string): Promise<unknown | null>;
  set(connectionId: string, config: unknown): Promise<void>;
  delete(connectionId: string): Promise<void>;
}
