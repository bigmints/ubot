export const PACKAGE_VERSION = '0.1.0' as const;
export const TOOL_CONTRACT_VERSION = '1' as const;
export const PERSISTENCE_SCHEMA_VERSION = 1 as const;
export const MIGRATABLE_PERSISTENCE_SCHEMA_VERSIONS = [0] as const;
export const VIEW_CONTRACT_VERSION = '1' as const;

export type Audience = 'owner' | 'visitor';

export type ExecutionContext = Readonly<{
  actorId: string;
  entityId: string;
  audience: Audience;
  authorizationHandle: string;
  correlationId: string;
  intentReceipt?: string;
}>;

export type ToolCall = {
  name: string;
  arguments: unknown;
  toolVersion: '1';
  requestId: string;
};

export type ErrorCode =
  | 'INVALID_ARGUMENT'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND_OR_FORBIDDEN'
  | 'REVISION_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INTENT_REQUIRED'
  | 'UNSUPPORTED_VERSION'
  | 'UNSUPPORTED_CAPABILITY'
  | 'LIMIT_EXCEEDED'
  | 'INPUT_INCOMPLETE'
  | 'PROPOSAL_INVALID'
  | 'PUBLICATION_BLOCKED'
  | 'STALE_EVIDENCE'
  | 'STORAGE_UNAVAILABLE';

export type EngineWarning = { code: string; message: string };
export type OperationReceipt = {
  id: string;
  operation: string;
  actorId: string;
  entityId: string;
  requestId: string;
  occurredAt: string;
  revision?: number;
  historical?: boolean;
};
export type EvidenceReceipt = {
  id: string;
  entityId: string;
  collectionId: string;
  publicationRevision: number;
  collectionRevisions: Record<string, number>;
  itemReferences: Array<{ collectionId: string; itemId: string; itemRevision: number; publicationRevision: number }>;
  entityRevision?: number;
  checkedAt: string;
  validThrough?: string;
};

export type ToolResult =
  | { ok: true; toolVersion: '1'; requestId: string; data: unknown; receipt?: OperationReceipt; evidence?: EvidenceReceipt; warnings: EngineWarning[] }
  | { ok: false; toolVersion: '1'; requestId: string; error: { code: ErrorCode; message: string; retryable: boolean; details?: Record<string, unknown> } };

export type JsonSchema = Record<string, unknown>;
export type ToolDefinition = {
  name: string;
  description: string;
  toolVersion: '1';
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  metadata: { access: 'read' | 'write'; effect: 'none' | 'draft' | 'publication' | 'withdrawal'; audiences: Audience[] };
};

export type ReferenceValue = { collectionId: string; itemId: string };
export type FieldValue = string | number | boolean | null | { amount: number; currency: string } | ReferenceValue | string[] | ReferenceValue[];
export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'money' | 'enum' | 'reference';
export type FieldDefinition = {
  id: string;
  label: string;
  type: FieldType;
  required?: boolean;
  public?: boolean;
  multiple?: boolean;
  unit?: string;
  enumValues?: string[];
  identity?: 'strong' | 'candidate';
};
export type CollectionViewDefinition = {
  version: '1';
  layout: 'cards' | 'gallery' | 'agenda' | 'detail';
  titleField?: string;
  subtitleField?: string;
  imageField?: string;
  startField?: string;
  endField?: string;
  groupByField?: string;
  visibleFields?: string[];
};

export type PolicyRequest = {
  context: ExecutionContext;
  action: string;
  resource: { collectionId?: string; itemId?: string; sourceRevisionId?: string; proposalId?: string; evidenceReceiptId?: string };
  exactIntent?: { payloadHash?: string; expectedRevision?: number };
};
export type PolicyDecision = { allowed: boolean; policyRevision?: string; reason?: string };
export interface PolicyPort {
  authorize(request: PolicyRequest): Promise<PolicyDecision | boolean>;
}

export interface ClockPort { now(): Date }
export interface IdPort { next(prefix: string): string }
export type TelemetryEvent = { action: string; ok: boolean; entityId: string; correlationId: string; errorCode?: ErrorCode };
export interface TelemetryPort { emit(event: TelemetryEvent): void | Promise<void> }

export type EngineLimits = {
  maxBatchBytes: number;
  maxTextLength: number;
  maxSegments: number;
  maxRecords: number;
  maxRecordDepth: number;
  maxOperations: number;
  maxPageSize: number;
};

export type ItemState = {
  id: string;
  revision: number;
  values: Record<string, FieldValue>;
  evidence: Array<{ sourceRevisionId: string; inputId?: string; fieldId?: string }>;
  status: 'unknown' | 'available' | 'unavailable';
  archived: boolean;
  manualFields: string[];
  validThrough?: string;
  updatedAt: string;
};
export type PublishedItem = ItemState & { publishedAt: string };
export type SourceRevision = {
  id: string;
  ingestId: string;
  kind: 'text' | 'segments' | 'records';
  source: { reference?: string; label?: string; reportedCoverage: 'complete' | 'partial' | 'unknown'; coverageNote?: string; previousSourceRevisionId?: string };
  data: unknown;
  acceptedCount: number;
  digest: string;
  createdAt: string;
};
export type ProposalOperation =
  | { kind: 'create_item'; itemId?: string; values: Record<string, FieldValue>; status?: ItemState['status']; validThrough?: string; evidence?: ItemState['evidence'] }
  | { kind: 'update_item'; itemId: string; values: Record<string, FieldValue>; status?: ItemState['status']; validThrough?: string | null; evidence?: ItemState['evidence'] }
  | { kind: 'set_schema_field'; field: FieldDefinition }
  | { kind: 'set_view'; view: CollectionViewDefinition };
export type ProposalState = {
  id: string;
  collectionId: string;
  baseRevision: number;
  operations: ProposalOperation[];
  unresolvedIssues: string[];
  sourceRevisionIds: string[];
  payloadHash: string;
  reconciliation: { added: number; changed: number; unchanged: number; conflicting: number };
  createdAt: string;
  appliedChangeId?: string;
};
export type CollectionState = {
  id: string;
  name: string;
  domain?: string;
  revision: number;
  publicationRevision: number;
  schema: FieldDefinition[];
  items: Record<string, ItemState>;
  published: Record<string, PublishedItem>;
  view: CollectionViewDefinition;
  proposals: Record<string, ProposalState>;
  changes: Record<string, ChangeState>;
  createdAt: string;
  updatedAt: string;
};
export type ChangeState = {
  id: string;
  collectionId: string;
  kind: 'proposal' | 'archive' | 'undo';
  beforeItems: Record<string, ItemState>;
  beforeSchema: FieldDefinition[];
  beforeView: CollectionViewDefinition;
  revision: number;
  createdAt: string;
  actorId: string;
  undoneBy?: string;
};
export type IdempotencyState = { fingerprint: string; result: ToolResult };
export type EntityState = {
  catalogRevision: number;
  collections: Record<string, CollectionState>;
  sources: Record<string, SourceRevision>;
  ingests: Record<string, { id: string; sourceRevisionId: string; acceptedCount: number; digest: string; reportedCoverage: string; createdAt: string }>;
  evidence: Record<string, EvidenceReceipt>;
  idempotency: Record<string, IdempotencyState>;
};
export type RepositoryState = { schemaVersion: 1; entities: Record<string, EntityState> };

export interface RepositoryPort {
  readonly capabilities: ReadonlyArray<'atomic-state' | 'durable-restart' | 'idempotency' | 'migration-v0-to-v1'>;
  read<T>(reader: (state: Readonly<RepositoryState>) => T | Promise<T>): Promise<T>;
  transact<T>(writer: (state: RepositoryState) => T | Promise<T>): Promise<T>;
}

export type EngineOptions = {
  repository: RepositoryPort;
  policy: PolicyPort;
  clock?: ClockPort;
  ids?: IdPort;
  limits?: Partial<EngineLimits>;
  telemetry?: TelemetryPort;
};

export type CollectionEngine = Readonly<{
  repository: RepositoryPort;
  policy: PolicyPort;
  clock: ClockPort;
  ids: IdPort;
  limits: EngineLimits;
  telemetry?: TelemetryPort;
}>;
