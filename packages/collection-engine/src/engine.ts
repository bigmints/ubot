import { createHash, randomUUID } from 'node:crypto';
import type {
  CollectionEngine, CollectionState, CollectionViewDefinition, EngineLimits, EngineOptions, EntityState,
  EvidenceReceipt, ExecutionContext, FieldDefinition, FieldValue, ItemState, OperationReceipt, PolicyRequest,
  ProposalOperation, ProposalState, RepositoryState, ToolCall, ToolResult,
} from './types.js';
import { COLLECTION_TOOL_DEFINITIONS, COLLECTION_TOOL_NAMES, matchesJsonSchema } from './schemas.js';

const defaults: EngineLimits = {
  maxBatchBytes: 2_000_000,
  maxTextLength: 1_000_000,
  maxSegments: 2_000,
  maxRecords: 2_000,
  maxRecordDepth: 8,
  maxOperations: 200,
  maxPageSize: 200,
};
const mutationTools = new Set([
  'collections_create', 'collections_ingest', 'collections_change_propose', 'collections_change_apply',
  'collections_publish', 'collections_unpublish', 'collections_archive', 'collections_undo', 'collections_view_propose',
]);
const intentTools = new Set(['collections_publish', 'collections_unpublish', 'collections_archive']);

class EngineFault extends Error {
  constructor(
    readonly code: ToolResult extends { ok: false } ? never : import('./types.js').ErrorCode,
    message: string,
    readonly retryable = false,
    readonly details?: Record<string, unknown>,
  ) { super(message); }
}

const fail = (code: import('./types.js').ErrorCode, message: string, retryable = false, details?: Record<string, unknown>): never => {
  throw new EngineFault(code, message, retryable, details);
};
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const asObject = (value: unknown, path = 'arguments'): Record<string, unknown> => {
  if (!isObject(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('INVALID_ARGUMENT', `${path} must be a plain object`, false, { path });
  return value as Record<string, unknown>;
};
const keys = (value: Record<string, unknown>, allowed: string[], required: string[] = [], path = 'arguments'): void => {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail('INVALID_ARGUMENT', `Unknown property at ${path}.${key}`, false, { path: `${path}.${key}` });
  for (const key of required) if (!(key in value)) fail('INVALID_ARGUMENT', `Missing required property at ${path}.${key}`, false, { path: `${path}.${key}` });
};
const str = (value: unknown, path: string, max = 256): string => {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) fail('INVALID_ARGUMENT', `${path} must be a non-empty string of at most ${max} characters`, false, { path });
  return value as string;
};
const optStr = (value: unknown, path: string, max = 256): string | undefined => value === undefined ? undefined : str(value, path, max);
const int = (value: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) fail('INVALID_ARGUMENT', `${path} must be an integer between ${min} and ${max}`, false, { path });
  return value as number;
};
const clone = <T>(value: T): T => structuredClone(value);

function canonical(value: unknown): string {
  // Optional fields omitted by an organizer and explicit JSON null both mean
  // "unknown" to collection filters. Keep that semantic stable across hosts.
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const digest = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');

function entity(state: RepositoryState, entityId: string): EntityState {
  const owned = state.entities[entityId] ??= { catalogRevision: 0, collections: {}, sources: {}, ingests: {}, evidence: {}, idempotency: {} };
  owned.catalogRevision ??= 0;
  return owned;
}
function collection(source: Readonly<RepositoryState>, entityId: string, collectionId: string): CollectionState {
  const found = source.entities[entityId]?.collections[collectionId];
  if (!found) fail('NOT_FOUND_OR_FORBIDDEN', 'The requested resource is unavailable');
  return found;
}
function source(sourceState: Readonly<RepositoryState>, entityId: string, sourceRevisionId: string) {
  const found = sourceState.entities[entityId]?.sources[sourceRevisionId];
  if (!found) fail('NOT_FOUND_OR_FORBIDDEN', 'The requested resource is unavailable');
  return found;
}
function contextCheck(context: ExecutionContext): void {
  if (!isObject(context)) fail('UNAUTHORIZED', 'Trusted execution context is required');
  str(context.actorId, 'context.actorId'); str(context.entityId, 'context.entityId');
  str(context.authorizationHandle, 'context.authorizationHandle', 2000); str(context.correlationId, 'context.correlationId');
  if (context.audience !== 'owner' && context.audience !== 'visitor') fail('UNAUTHORIZED', 'Trusted execution context is invalid');
}
async function authorize(engine: CollectionEngine, context: ExecutionContext, action: string, resource: PolicyRequest['resource'], exactIntent?: PolicyRequest['exactIntent']): Promise<void> {
  const request: PolicyRequest = exactIntent === undefined ? { context, action, resource } : { context, action, resource, exactIntent };
  const decision = await engine.policy.authorize(request);
  if (decision === false || (typeof decision === 'object' && !decision.allowed)) fail('UNAUTHORIZED', 'The requested action is not authorized');
}
function receipt(engine: CollectionEngine, context: ExecutionContext, call: ToolCall, revision?: number): OperationReceipt {
  const result: OperationReceipt = { id: engine.ids.next('receipt'), operation: call.name, actorId: context.actorId, entityId: context.entityId, requestId: call.requestId, occurredAt: engine.clock.now().toISOString() };
  if (revision !== undefined) result.revision = revision;
  return result;
}
const success = (call: ToolCall, data: unknown, operationReceipt?: OperationReceipt, evidence?: EvidenceReceipt, warnings: import('./types.js').EngineWarning[] = []): ToolResult => {
  const result: ToolResult = { ok: true, toolVersion: '1', requestId: call.requestId, data, warnings };
  if (operationReceipt) result.receipt = operationReceipt;
  if (evidence) result.evidence = evidence;
  return result;
};

function idsArg(value: unknown, path: string, max = 500): string[] {
  if (!Array.isArray(value) || value.length > max) fail('INVALID_ARGUMENT', `${path} must be an array with at most ${max} IDs`, false, { path });
  const result = (value as unknown[]).map((entry, index) => str(entry, `${path}[${index}]`));
  if (new Set(result).size !== result.length) fail('INVALID_ARGUMENT', `${path} contains duplicate IDs`, false, { path });
  return result;
}
function page(args: Record<string, unknown>, limits: EngineLimits): { cursor: number; pageSize: number } {
  return { cursor: args.cursor === undefined ? 0 : int(args.cursor, 'arguments.cursor'), pageSize: args.pageSize === undefined ? 50 : int(args.pageSize, 'arguments.pageSize', 1, limits.maxPageSize) };
}
function assertJson(value: unknown, path: string, depth: number, maxDepth: number): void {
  if (depth > maxDepth) fail('LIMIT_EXCEEDED', `${path} exceeds maximum nesting depth`, false, { path });
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) { value.forEach((item, index) => assertJson(item, `${path}[${index}]`, depth + 1, maxDepth)); return; }
  if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('INVALID_ARGUMENT', `Unsafe property at ${path}.${key}`, false, { path: `${path}.${key}` });
      assertJson(item, `${path}.${key}`, depth + 1, maxDepth);
    }
    return;
  }
  fail('INVALID_ARGUMENT', `${path} contains a non-JSON value`, false, { path });
}

const fieldTypes = new Set(['string', 'number', 'boolean', 'date', 'datetime', 'money', 'enum', 'reference']);
function isRealCalendarDate(value: string): boolean { const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : undefined; return Boolean(parsed && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value); }
function isRealTemporal(value: string): boolean { const datePart = value.match(/^(\d{4}-\d{2}-\d{2})(?:T|$)/)?.[1]; const deterministicZone = !value.includes('T') || /(?:Z|[+-]\d{2}:\d{2})$/.test(value); return Boolean(datePart && deterministicZone && isRealCalendarDate(datePart) && !Number.isNaN(Date.parse(value))); }
function fieldDefinition(value: unknown, path: string): FieldDefinition {
  const input = asObject(value, path);
  keys(input, ['id', 'label', 'type', 'required', 'public', 'multiple', 'unit', 'enumValues', 'identity'], ['id', 'label', 'type'], path);
  const type = str(input.type, `${path}.type`) as FieldDefinition['type'];
  if (!fieldTypes.has(type)) fail('INVALID_ARGUMENT', `Unsupported field type at ${path}.type`, false, { path: `${path}.type` });
  const result: FieldDefinition = { id: str(input.id, `${path}.id`), label: str(input.label, `${path}.label`, 200), type };
  for (const booleanKey of ['required', 'public', 'multiple'] as const) if (input[booleanKey] !== undefined) {
    if (typeof input[booleanKey] !== 'boolean') fail('INVALID_ARGUMENT', `${path}.${booleanKey} must be boolean`, false, { path: `${path}.${booleanKey}` });
    result[booleanKey] = input[booleanKey] as boolean;
  }
  if (input.unit !== undefined) result.unit = str(input.unit, `${path}.unit`, 50);
  if (input.enumValues !== undefined) result.enumValues = idsArg(input.enumValues, `${path}.enumValues`, 100);
  if (input.identity !== undefined) { const identity = str(input.identity, `${path}.identity`); if (identity !== 'strong' && identity !== 'candidate') fail('INVALID_ARGUMENT', `${path}.identity must be strong or candidate`); result.identity = identity as 'strong' | 'candidate'; }
  return result;
}
function valueForField(value: unknown, field: FieldDefinition, path: string): FieldValue {
  if (value === null) return null;
  if (field.type === 'reference') {
    const parseReference = (candidate: unknown, referencePath: string) => { const reference = asObject(candidate, referencePath); keys(reference, ['collectionId', 'itemId'], ['collectionId', 'itemId'], referencePath); return { collectionId: str(reference.collectionId, `${referencePath}.collectionId`), itemId: str(reference.itemId, `${referencePath}.itemId`) }; };
    if (field.multiple) { if (!Array.isArray(value)) fail('INVALID_ARGUMENT', `${path} must be an array of references`, false, { path }); return (value as unknown[]).map((candidate, index) => parseReference(candidate, `${path}[${index}]`)); }
    return parseReference(value, path);
  }
  if (field.multiple) {
    if (!Array.isArray(value) || !value.every((part) => typeof part === 'string')) fail('INVALID_ARGUMENT', `${path} must be a string array`, false, { path });
    return value as string[];
  }
  if (field.type === 'string' || field.type === 'date' || field.type === 'datetime' || field.type === 'enum') {
    const result = str(value, path, 10000);
    if (field.type === 'date' && !isRealCalendarDate(result)) fail('INVALID_ARGUMENT', `${path} must be a real ISO calendar date`, false, { path });
    if (field.type === 'datetime' && (!result.includes('T') || !isRealTemporal(result))) fail('INVALID_ARGUMENT', `${path} must be a real ISO datetime`, false, { path });
    if (field.type === 'enum' && field.enumValues && !field.enumValues.includes(result)) fail('INVALID_ARGUMENT', `${path} is not an allowed enum value`, false, { path });
    return result;
  }
  if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail('INVALID_ARGUMENT', `${path} must be a finite number`, false, { path });
    return value as number;
  }
  if (field.type === 'boolean') {
    if (typeof value !== 'boolean') fail('INVALID_ARGUMENT', `${path} must be boolean`, false, { path });
    return value as boolean;
  }
  const money = asObject(value, path); keys(money, ['amount', 'currency'], ['amount', 'currency'], path);
  if (typeof money.amount !== 'number' || !Number.isFinite(money.amount)) fail('INVALID_ARGUMENT', `${path}.amount must be finite`, false, { path: `${path}.amount` });
  return { amount: money.amount as number, currency: str(money.currency, `${path}.currency`, 3).toUpperCase() };
}
function values(value: unknown, schema: FieldDefinition[], path: string): Record<string, FieldValue> {
  const input = asObject(value, path); const fields = new Map(schema.map((field) => [field.id, field])); const result: Record<string, FieldValue> = {};
  for (const [id, item] of Object.entries(input)) {
    const field = fields.get(id); if (!field) fail('INVALID_ARGUMENT', `Unknown field at ${path}.${id}`, false, { path: `${path}.${id}` });
    result[id] = valueForField(item, field, `${path}.${id}`);
  }
  return result;
}
function validateReferences(candidateValues: Record<string, FieldValue>, schema: FieldDefinition[], entityState: EntityState, path: string): void {
  const fields = new Map(schema.map((field) => [field.id, field]));
  for (const [fieldId, raw] of Object.entries(candidateValues)) {
    if (fields.get(fieldId)?.type !== 'reference' || raw === null) continue;
    const references = Array.isArray(raw) ? raw : [raw];
    references.forEach((candidate, index) => {
      if (!isObject(candidate)) fail('INVALID_ARGUMENT', `${path}.${fieldId} contains an invalid reference`);
      const reference = candidate as Record<string, unknown>; const targetCollection = entityState.collections[String(reference.collectionId)];
      if (!targetCollection?.items[String(reference.itemId)]) fail('PROPOSAL_INVALID', 'A referenced collection item is unavailable in this entity', false, { path: `${path}.${fieldId}${Array.isArray(raw) ? `[${index}]` : ''}` });
    });
  }
}
function viewDefinition(value: unknown, schema: FieldDefinition[], path: string): CollectionViewDefinition {
  const input = asObject(value, path);
  keys(input, ['version', 'layout', 'titleField', 'subtitleField', 'imageField', 'startField', 'endField', 'groupByField', 'visibleFields'], ['version', 'layout'], path);
  if (input.version !== '1') fail('UNSUPPORTED_VERSION', 'Unsupported view contract version');
  if (!['cards', 'gallery', 'agenda', 'detail'].includes(String(input.layout))) fail('INVALID_ARGUMENT', `${path}.layout is unsupported`, false, { path: `${path}.layout` });
  const fieldIds = new Set(schema.map((field) => field.id));
  const result: CollectionViewDefinition = { version: '1', layout: input.layout as CollectionViewDefinition['layout'] };
  for (const key of ['titleField', 'subtitleField', 'imageField', 'startField', 'endField', 'groupByField'] as const) if (input[key] !== undefined) {
    const id = str(input[key], `${path}.${key}`); if (!fieldIds.has(id)) fail('INVALID_ARGUMENT', `${path}.${key} references an unknown field`, false, { path: `${path}.${key}` }); result[key] = id;
  }
  if (input.visibleFields !== undefined) { const visible = idsArg(input.visibleFields, `${path}.visibleFields`, 100); visible.forEach((id) => { if (!fieldIds.has(id)) fail('INVALID_ARGUMENT', `${path}.visibleFields references an unknown field`); }); result.visibleFields = visible; }
  if (result.layout === 'agenda' && !result.startField) fail('INVALID_ARGUMENT', 'Agenda views require startField', false, { path: `${path}.startField` });
  return result;
}
function evidenceRefs(value: unknown, entityState: EntityState, path: string): ItemState['evidence'] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) fail('INVALID_ARGUMENT', `${path} must be a bounded array`, false, { path });
  return (value as unknown[]).map((entry, index) => {
    const item = asObject(entry, `${path}[${index}]`); keys(item, ['sourceRevisionId', 'inputId', 'fieldId'], ['sourceRevisionId'], `${path}[${index}]`);
    const sourceRevisionId = str(item.sourceRevisionId, `${path}[${index}].sourceRevisionId`);
    const citedSource = entityState.sources[sourceRevisionId]; if (!citedSource) fail('PROPOSAL_INVALID', 'A cited source is unavailable', false, { path: `${path}[${index}].sourceRevisionId` });
    const result: { sourceRevisionId: string; inputId?: string; fieldId?: string } = { sourceRevisionId };
    if (item.inputId !== undefined) { result.inputId = str(item.inputId, `${path}[${index}].inputId`); const entries = Array.isArray(citedSource.data) ? citedSource.data : []; if (!entries.some((entry) => isObject(entry) && entry.inputId === result.inputId)) fail('PROPOSAL_INVALID', 'A cited source input is unavailable', false, { path: `${path}[${index}].inputId` }); }
    if (item.fieldId !== undefined) result.fieldId = str(item.fieldId, `${path}[${index}].fieldId`);
    return result;
  });
}

function validateProposalOperations(raw: unknown, collectionState: CollectionState, entityState: EntityState, limits: EngineLimits): ProposalOperation[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > limits.maxOperations) fail('LIMIT_EXCEEDED', `operations must contain 1-${limits.maxOperations} entries`);
  let prospectiveSchema = clone(collectionState.schema);
  const result: ProposalOperation[] = [];
  (raw as unknown[]).forEach((entry, index) => {
    const path = `arguments.operations[${index}]`; const item = asObject(entry, path); const kind = str(item.kind, `${path}.kind`);
    if (kind === 'set_schema_field') {
      keys(item, ['kind', 'field'], ['kind', 'field'], path); const field = fieldDefinition(item.field, `${path}.field`);
      const old = prospectiveSchema.find((candidate) => candidate.id === field.id);
      if (old && (old.type !== field.type || Boolean(old.multiple) !== Boolean(field.multiple))) fail('PROPOSAL_INVALID', 'Changing a field type or cardinality requires an explicit migration not supported in v1');
      prospectiveSchema = [...prospectiveSchema.filter((candidate) => candidate.id !== field.id), field]; result.push({ kind, field }); return;
    }
    if (kind === 'set_view') { keys(item, ['kind', 'view'], ['kind', 'view'], path); result.push({ kind, view: viewDefinition(item.view, prospectiveSchema, `${path}.view`) }); return; }
    if (kind !== 'create_item' && kind !== 'update_item') fail('PROPOSAL_INVALID', `Unsupported proposal operation ${kind}`);
    const allowed = ['kind', 'itemId', 'values', 'status', 'validThrough', 'evidence']; keys(item, allowed, kind === 'update_item' ? ['kind', 'itemId', 'values'] : ['kind', 'values'], path);
    const status = item.status === undefined ? undefined : str(item.status, `${path}.status`) as ItemState['status'];
    if (status && !['unknown', 'available', 'unavailable'].includes(status)) fail('INVALID_ARGUMENT', `${path}.status is unsupported`);
    const validThrough = item.validThrough === undefined ? undefined : item.validThrough === null ? null : str(item.validThrough, `${path}.validThrough`);
    if (typeof validThrough === 'string' && !isRealTemporal(validThrough)) fail('INVALID_ARGUMENT', `${path}.validThrough must be a real ISO date or datetime`);
    const candidateValues = values(item.values, prospectiveSchema, `${path}.values`); validateReferences(candidateValues, prospectiveSchema, entityState, `${path}.values`);
    const common = { values: candidateValues, evidence: evidenceRefs(item.evidence, entityState, `${path}.evidence`) };
    if (kind === 'create_item') {
      const operation: Extract<ProposalOperation, { kind: 'create_item' }> = { kind: 'create_item', ...common }; if (item.itemId !== undefined) operation.itemId = str(item.itemId, `${path}.itemId`); if (status) operation.status = status; if (typeof validThrough === 'string') operation.validThrough = validThrough; result.push(operation);
    } else {
      const operation: Extract<ProposalOperation, { kind: 'update_item' }> = { kind: 'update_item', itemId: str(item.itemId, `${path}.itemId`), ...common }; if (!collectionState.items[operation.itemId]) fail('PROPOSAL_INVALID', 'An update target is unavailable'); if (status) operation.status = status; if (validThrough !== undefined) operation.validThrough = validThrough; result.push(operation);
    }
  });
  return result;
}

function reconcileOperations(operations: ProposalOperation[], target: CollectionState, sourceRevisionIds: string[]): { operations: ProposalOperation[]; issues: string[]; reconciliation: ProposalState['reconciliation'] } {
  const reconciled: ProposalOperation[] = [];
  const issues: string[] = [];
  const counts = { added: 0, changed: 0, unchanged: 0, conflicting: 0 };
  const strongFields = target.schema.filter((field) => field.identity === 'strong');
  const candidateFields = target.schema.filter((field) => field.identity === 'candidate');
  const reconcileUpdate = (operation: Extract<ProposalOperation, { kind: 'update_item' }>) => {
    const existing = target.items[operation.itemId]!;
    const nextValues: Record<string, FieldValue> = {};
    const sourceBacked = sourceRevisionIds.length > 0 || (operation.evidence?.length ?? 0) > 0;
    for (const [fieldId, value] of Object.entries(operation.values)) {
      if (sourceBacked && existing.manualFields?.includes(fieldId)) {
        const hasFieldProvenance = operation.evidence?.some((reference) => reference.fieldId === fieldId) ?? false;
        issues.push(hasFieldProvenance
          ? `Manual correction preserved for ${operation.itemId}.${fieldId}; explicitly resolve replacement.`
          : `Manual correction preserved for ${operation.itemId}.${fieldId}; source-backed replacements require field-level provenance and explicit resolution.`);
        counts.conflicting += 1;
        continue;
      }
      nextValues[fieldId] = value;
    }
    const changed = Object.entries(nextValues).some(([fieldId, value]) => canonical(existing.values[fieldId]) !== canonical(value)) || operation.status !== undefined || operation.validThrough !== undefined;
    reconciled.push({ ...operation, values: nextValues });
    if (changed) counts.changed += 1; else counts.unchanged += 1;
  };
  for (const operation of operations) {
    if (operation.kind === 'create_item' && !operation.itemId) {
      const matchBy = (fields: FieldDefinition[]) => Object.values(target.items).filter((item) => fields.length > 0 && fields.every((field) => operation.values[field.id] !== undefined && canonical(item.values[field.id]) === canonical(operation.values[field.id])));
      const strongMatches = matchBy(strongFields.filter((field) => operation.values[field.id] !== undefined));
      if (strongMatches.length === 1) {
        const { kind: _kind, itemId: _itemId, ...update } = operation;
        reconcileUpdate({ kind: 'update_item', itemId: strongMatches[0]!.id, ...update });
        continue;
      }
      if (strongMatches.length > 1) { issues.push('Strong identifiers match more than one existing item; choose the intended item.'); counts.conflicting += 1; reconciled.push(operation); continue; }
      const candidateMatches = matchBy(candidateFields.filter((field) => operation.values[field.id] !== undefined));
      if (candidateMatches.length > 0) { issues.push(`Possible match for new item: ${candidateMatches.map((item) => item.id).join(', ')}. Confirm whether to merge or create.`); counts.conflicting += 1; reconciled.push(operation); continue; }
      reconciled.push(operation); counts.added += 1; continue;
    }
    if (operation.kind === 'update_item') {
      reconcileUpdate(operation);
      continue;
    }
    reconciled.push(operation); counts.changed += 1;
  }
  return { operations: reconciled, issues, reconciliation: counts };
}

function publicItem(collectionState: CollectionState, item: ItemState): ItemState {
  const allowed = new Set(collectionState.schema.filter((field) => field.public !== false).map((field) => field.id));
  return { ...clone(item), values: Object.fromEntries(Object.entries(item.values).filter(([key]) => allowed.has(key))), evidence: [] };
}
function publicView(collectionState: CollectionState): CollectionViewDefinition {
  const allowed = new Set(collectionState.schema.filter((field) => field.public !== false).map((field) => field.id));
  const current = clone(collectionState.view);
  for (const key of ['titleField', 'subtitleField', 'imageField', 'startField', 'endField', 'groupByField'] as const) if (current[key] && !allowed.has(current[key]!)) delete current[key];
  if (current.visibleFields) current.visibleFields = current.visibleFields.filter((id) => allowed.has(id));
  if (current.layout === 'agenda' && !current.startField) return { version: '1', layout: 'cards', visibleFields: current.visibleFields ?? [...allowed] };
  return current;
}
function validThroughIsCurrent(validThrough: string | undefined, now: Date): boolean { if (!validThrough) return true; const expiresAt = /^\d{4}-\d{2}-\d{2}$/.test(validThrough) ? Date.parse(`${validThrough}T00:00:00.000Z`) + 86_400_000 : Date.parse(validThrough); return expiresAt > now.getTime(); }
function isCurrent(item: ItemState, now: Date): boolean { return !item.archived && validThroughIsCurrent(item.validThrough, now); }
function isMoneyValue(value: unknown): value is { amount: number; currency: string } { return isObject(value) && typeof value.amount === 'number' && typeof value.currency === 'string'; }
function publishHash(collectionState: CollectionState, selectedIds: string[]): string {
  return digest({ collectionId: collectionState.id, revision: collectionState.revision, items: [...selectedIds].sort().map((id) => ({ id, revision: collectionState.items[id]?.revision })) });
}

export function createCollectionEngine(options: EngineOptions): CollectionEngine {
  if (!options?.repository || !options.policy) throw new TypeError('repository and policy are required');
  if (!options.repository.capabilities.includes('atomic-state') || !options.repository.capabilities.includes('idempotency')) throw new TypeError('Repository lacks required atomic-state/idempotency capabilities');
  const clock = options.clock ?? { now: () => new Date() };
  const ids = options.ids ?? { next: (prefix: string) => `${prefix}_${randomUUID()}` };
  const engine: CollectionEngine = { repository: options.repository, policy: options.policy, clock, ids, limits: { ...defaults, ...options.limits } };
  if (options.telemetry) return { ...engine, telemetry: options.telemetry };
  return engine;
}

async function mutation(engine: CollectionEngine, context: ExecutionContext, call: ToolCall, args: Record<string, unknown>, resource: PolicyRequest['resource'], exactIntent: PolicyRequest['exactIntent'] | undefined, writer: (state: RepositoryState, entityState: EntityState) => ToolResult | Promise<ToolResult>): Promise<ToolResult> {
  if (intentTools.has(call.name) && !context.intentReceipt) fail('INTENT_REQUIRED', 'A trusted exact-action intent receipt is required');
  await authorize(engine, context, call.name, resource, exactIntent);
  const fingerprint = digest({ toolVersion: call.toolVersion, name: call.name, arguments: args });
  return engine.repository.transact(async (state) => {
    await authorize(engine, context, call.name, resource, exactIntent);
    const owned = entity(state, context.entityId); const key = `${context.actorId}:${call.name}:${call.requestId}`; const prior = owned.idempotency[key];
    if (prior) { if (prior.fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT', 'The request ID was already used with a different payload'); return clone(prior.result); }
    const result = await writer(state, owned); owned.idempotency[key] = { fingerprint, result: clone(result) }; return result;
  });
}

async function dispatch(engine: CollectionEngine, context: ExecutionContext, call: ToolCall): Promise<ToolResult> {
  const args = asObject(call.arguments); const now = engine.clock.now();
  switch (call.name) {
    case 'collections_list': {
      keys(args, ['cursor', 'pageSize']); const p = page(args, engine.limits); await authorize(engine, context, call.name, {});
      return engine.repository.read((state) => {
        const all = Object.values(state.entities[context.entityId]?.collections ?? {}).filter((value) => context.audience === 'owner' || Object.keys(value.published).some((id) => isCurrent(value.published[id]!, now)));
        const data = all.slice(p.cursor, p.cursor + p.pageSize).map((value) => ({ id: value.id, name: value.name, domain: value.domain, revision: context.audience === 'owner' ? value.revision : undefined, publicationRevision: value.publicationRevision, itemCount: context.audience === 'owner' ? Object.keys(value.items).length : Object.values(value.published).filter((item) => isCurrent(item, now)).length }));
        return success(call, { items: data, totalCount: all.length, nextCursor: p.cursor + data.length < all.length ? p.cursor + data.length : null, complete: true });
      });
    }
    case 'collections_get': {
      keys(args, ['collectionId', 'selectedItemIds'], ['collectionId']); const collectionId = str(args.collectionId, 'arguments.collectionId'); if (context.audience === 'visitor' && args.selectedItemIds !== undefined) fail('UNAUTHORIZED', 'The requested action is not authorized'); const reviewedIds = args.selectedItemIds === undefined ? undefined : idsArg(args.selectedItemIds, 'arguments.selectedItemIds'); await authorize(engine, context, call.name, { collectionId });
      return engine.repository.read((state) => { const value = collection(state, context.entityId, collectionId); const itemIds = context.audience === 'owner' ? Object.keys(value.items) : Object.keys(value.published).filter((id) => isCurrent(value.published[id]!, now)); const selection = reviewedIds ?? itemIds.filter((id) => !value.items[id]?.archived); if (context.audience === 'owner') selection.forEach((id) => { if (!value.items[id] || value.items[id]!.archived) fail('PUBLICATION_BLOCKED', 'A publication selection is unavailable'); }); const publicationReview = context.audience === 'owner' ? { selectedItemIds: selection, itemRevisions: Object.fromEntries(selection.map((id) => [id, value.items[id]!.revision])), reviewedPayloadHash: publishHash(value, selection) } : undefined; const proposalIds = context.audience === 'owner' ? Object.values(value.proposals).filter((proposal) => !proposal.appliedChangeId).map((proposal) => proposal.id) : undefined; return success(call, { id: value.id, name: value.name, domain: value.domain, revision: context.audience === 'owner' ? value.revision : undefined, publicationRevision: value.publicationRevision, schema: value.schema.filter((field) => context.audience === 'owner' || field.public !== false), itemIds, proposalIds, view: context.audience === 'owner' ? value.view : publicView(value), publicationReview }); });
    }
    case 'collections_create': {
      keys(args, ['name', 'domain', 'schema', 'view'], ['name']); if (context.audience !== 'owner') fail('UNAUTHORIZED', 'The requested action is not authorized');
      const schema = args.schema === undefined ? [] : (() => { if (!Array.isArray(args.schema) || args.schema.length > 100) fail('INVALID_ARGUMENT', 'schema must be a bounded array'); const result = (args.schema as unknown[]).map((field, index) => fieldDefinition(field, `arguments.schema[${index}]`)); if (new Set(result.map((field) => field.id)).size !== result.length) fail('INVALID_ARGUMENT', 'schema field IDs must be unique'); return result; })();
      const view = args.view === undefined ? { version: '1', layout: 'cards' } as const : viewDefinition(args.view, schema, 'arguments.view');
      return mutation(engine, context, call, args, {}, undefined, (_state, owned) => { const id = engine.ids.next('collection'); const timestamp = now.toISOString(); const value: CollectionState = { id, name: str(args.name, 'arguments.name', 200), revision: 1, publicationRevision: 0, schema, items: {}, published: {}, view, proposals: {}, changes: {}, createdAt: timestamp, updatedAt: timestamp }; const domain = optStr(args.domain, 'arguments.domain', 100); if (domain) value.domain = domain; owned.collections[id] = value; owned.catalogRevision = (owned.catalogRevision ?? 0) + 1; const opReceipt = receipt(engine, context, call, 1); return success(call, { collectionId: id, revision: 1, publicationRevision: 0, view }, opReceipt); });
    }
    case 'collections_ingest': {
      keys(args, ['kind', 'source', 'text', 'segments', 'records', 'manifest'], ['kind', 'source']); if (context.audience !== 'owner') fail('UNAUTHORIZED', 'The requested action is not authorized');
      const kind = str(args.kind, 'arguments.kind') as 'text' | 'segments' | 'records'; if (!['text', 'segments', 'records'].includes(kind)) fail('INVALID_ARGUMENT', 'kind must be text, segments, or records');
      const rawSource = asObject(args.source, 'arguments.source'); keys(rawSource, ['reference', 'label', 'reportedCoverage', 'coverageNote', 'previousSourceRevisionId'], [], 'arguments.source');
      const provided = ['text', 'segments', 'records'].filter((key) => args[key] !== undefined); if (provided.length !== 1 || provided[0] !== kind) fail('INVALID_ARGUMENT', `Exactly the ${kind} payload must be supplied`);
      let data: unknown; let acceptedCount: number;
      if (kind === 'text') { data = str(args.text, 'arguments.text', engine.limits.maxTextLength); acceptedCount = 1; }
      else { if (!Array.isArray(args[kind])) fail('INVALID_ARGUMENT', `arguments.${kind} must be an array`); const maximum = kind === 'segments' ? engine.limits.maxSegments : engine.limits.maxRecords; if ((args[kind] as unknown[]).length > maximum) fail('LIMIT_EXCEEDED', `${kind} exceeds configured limit`); data = clone(args[kind]); acceptedCount = (data as unknown[]).length; assertJson(data, `arguments.${kind}`, 0, engine.limits.maxRecordDepth); if (kind === 'segments') (data as unknown[]).forEach((segment, index) => { const value = asObject(segment, `arguments.segments[${index}]`); keys(value, ['inputId', 'text', 'locator'], ['inputId', 'text'], `arguments.segments[${index}]`); str(value.inputId, `arguments.segments[${index}].inputId`); str(value.text, `arguments.segments[${index}].text`, engine.limits.maxTextLength); if (value.locator !== undefined) assertJson(value.locator, `arguments.segments[${index}].locator`, 0, 4); }); }
      if (kind === 'segments') { const inputIds = (data as Array<Record<string, unknown>>).map((entry) => entry.inputId); if (new Set(inputIds).size !== inputIds.length) fail('INVALID_ARGUMENT', 'Segment input IDs must be unique'); }
      if (Buffer.byteLength(canonical(data), 'utf8') > engine.limits.maxBatchBytes) fail('LIMIT_EXCEEDED', 'Supplied batch exceeds configured byte limit');
      if (args.manifest !== undefined) { const manifest = asObject(args.manifest, 'arguments.manifest'); keys(manifest, ['declaredCount'], ['declaredCount'], 'arguments.manifest'); if (int(manifest.declaredCount, 'arguments.manifest.declaredCount') !== acceptedCount) fail('INPUT_INCOMPLETE', 'Saved batch count does not match declared manifest'); }
      return mutation(engine, context, call, args, {}, undefined, (_state, owned) => {
        const sourceRevisionId = engine.ids.next('source'); const ingestId = engine.ids.next('ingest'); const timestamp = now.toISOString();
        const reportedCoverage = rawSource.reportedCoverage === undefined ? 'unknown' : str(rawSource.reportedCoverage, 'arguments.source.reportedCoverage') as 'complete' | 'partial' | 'unknown'; if (!['complete', 'partial', 'unknown'].includes(reportedCoverage)) fail('INVALID_ARGUMENT', 'reportedCoverage is unsupported');
        const sourceMeta: { reference?: string; label?: string; reportedCoverage: 'complete' | 'partial' | 'unknown'; coverageNote?: string; previousSourceRevisionId?: string } = { reportedCoverage };
        for (const [key, maximum] of [['reference', 1000], ['label', 300], ['coverageNote', 1000], ['previousSourceRevisionId', 256]] as const) if (rawSource[key] !== undefined) sourceMeta[key] = str(rawSource[key], `arguments.source.${key}`, maximum);
        if (sourceMeta.previousSourceRevisionId && !owned.sources[sourceMeta.previousSourceRevisionId]) fail('NOT_FOUND_OR_FORBIDDEN', 'The requested resource is unavailable');
        const contentDigest = digest(data); owned.sources[sourceRevisionId] = { id: sourceRevisionId, ingestId, kind, source: sourceMeta, data, acceptedCount, digest: contentDigest, createdAt: timestamp };
        owned.ingests[ingestId] = { id: ingestId, sourceRevisionId, acceptedCount, digest: contentDigest, reportedCoverage, createdAt: timestamp };
        return success(call, { ingestId, sourceRevisionId, acceptedCount, digest: contentDigest, reportedCoverage, engineVerifiedSavedBatch: true }, receipt(engine, context, call));
      });
    }
    case 'collections_ingest_get': {
      keys(args, ['ingestId'], ['ingestId']); const ingestId = str(args.ingestId, 'arguments.ingestId'); if (context.audience !== 'owner') fail('UNAUTHORIZED', 'The requested action is not authorized'); await authorize(engine, context, call.name, {}); return engine.repository.read((state) => { const found = state.entities[context.entityId]?.ingests[ingestId]; if (!found) fail('NOT_FOUND_OR_FORBIDDEN', 'The requested resource is unavailable'); return success(call, clone(found)); });
    }
    case 'collections_source_get': {
      keys(args, ['sourceRevisionId'], ['sourceRevisionId']); const sourceRevisionId = str(args.sourceRevisionId, 'arguments.sourceRevisionId'); if (context.audience !== 'owner') fail('UNAUTHORIZED', 'The requested action is not authorized'); await authorize(engine, context, call.name, { sourceRevisionId }); return engine.repository.read((state) => { const found = source(state, context.entityId, sourceRevisionId); const { data: _private, ...metadata } = found; return success(call, metadata); });
    }
    case 'collections_source_review': {
      keys(args, ['sourceRevisionId', 'inputIds', 'cursor', 'pageSize'], ['sourceRevisionId']); const sourceRevisionId = str(args.sourceRevisionId, 'arguments.sourceRevisionId'); if (context.audience !== 'owner') fail('UNAUTHORIZED', 'The requested action is not authorized'); const p = page(args, engine.limits); const requested = args.inputIds === undefined ? undefined : idsArg(args.inputIds, 'arguments.inputIds'); await authorize(engine, context, call.name, { sourceRevisionId }); return engine.repository.read((state) => { const found = source(state, context.entityId, sourceRevisionId); if (found.kind === 'text') return success(call, { sourceRevisionId, kind: found.kind, text: found.data, complete: true }); const entries = found.data as unknown[]; const filtered = requested ? entries.filter((entry) => isObject(entry) && requested.includes(String(entry.inputId))) : entries; const selected = filtered.slice(p.cursor, p.cursor + p.pageSize); return success(call, { sourceRevisionId, kind: found.kind, entries: selected, totalCount: filtered.length, nextCursor: p.cursor + selected.length < filtered.length ? p.cursor + selected.length : null, complete: true }); });
    }
    case 'collections_proposal_get': {
      keys(args, ['proposalId'], ['proposalId']); const proposalId = str(args.proposalId, 'arguments.proposalId'); if (context.audience !== 'owner') fail('UNAUTHORIZED', 'The requested action is not authorized'); await authorize(engine, context, call.name, { proposalId }); return engine.repository.read((state) => { const owned = state.entities[context.entityId]; const found = owned && Object.values(owned.collections).map((item) => item.proposals[proposalId]).find(Boolean); if (!found) fail('NOT_FOUND_OR_FORBIDDEN', 'The requested resource is unavailable'); return success(call, clone(found)); });
    }
    case 'collections_change_propose': {
      keys(args, ['collectionId', 'expectedRevision', 'operations', 'sourceRevisionIds', 'unresolvedIssues'], ['collectionId', 'expectedRevision', 'operations']); const collectionId = str(args.collectionId, 'arguments.collectionId'); if (context.audience !== 'owner') fail('UNAUTHORIZED', 'The requested action is not authorized');
      return mutation(engine, context, call, args, { collectionId }, undefined, (_state, owned) => { const target = collection( { schemaVersion: 1, entities: { [context.entityId]: owned } }, context.entityId, collectionId); const expected = int(args.expectedRevision, 'arguments.expectedRevision'); if (target.revision !== expected) fail('REVISION_CONFLICT', 'The collection changed after the proposal base revision', true, { currentRevision: target.revision }); const sourceRevisionIds = args.sourceRevisionIds === undefined ? [] : idsArg(args.sourceRevisionIds, 'arguments.sourceRevisionIds'); sourceRevisionIds.forEach((id) => { if (!owned.sources[id]) fail('PROPOSAL_INVALID', 'A cited source is unavailable'); }); const validatedOperations = validateProposalOperations(args.operations, target, owned, engine.limits); const reconciled = reconcileOperations(validatedOperations, target, sourceRevisionIds); const unresolvedIssues = [...(args.unresolvedIssues === undefined ? [] : idsArg(args.unresolvedIssues, 'arguments.unresolvedIssues', 100)), ...reconciled.issues]; const proposalId = engine.ids.next('proposal'); const proposal: ProposalState = { id: proposalId, collectionId, baseRevision: expected, operations: reconciled.operations, unresolvedIssues, sourceRevisionIds, payloadHash: digest({ collectionId, expected, operations: reconciled.operations, sourceRevisionIds }), reconciliation: reconciled.reconciliation, createdAt: now.toISOString() }; target.proposals[proposalId] = proposal; return success(call, clone(proposal), receipt(engine, context, call, target.revision)); });
    }
    case 'collections_view_propose': {
      keys(args, ['collectionId', 'expectedRevision', 'view'], ['collectionId', 'expectedRevision', 'view']); const collectionId = str(args.collectionId, 'arguments.collectionId'); if (context.audience !== 'owner') fail('UNAUTHORIZED', 'The requested action is not authorized');
      return mutation(engine, context, call, args, { collectionId }, undefined, (_state, owned) => { const target = owned.collections[collectionId]; if (!target) fail('NOT_FOUND_OR_FORBIDDEN', 'The requested resource is unavailable'); const expected = int(args.expectedRevision, 'arguments.expectedRevision'); if (target.revision !== expected) fail('REVISION_CONFLICT', 'The collection changed after the proposal base revision', true, { currentRevision: target.revision }); const proposalId = engine.ids.next('proposal'); const operations: ProposalOperation[] = [{ kind: 'set_view', view: viewDefinition(args.view, target.schema, 'arguments.view') }]; const proposal: ProposalState = { id: proposalId, collectionId, baseRevision: expected, operations, unresolvedIssues: [], sourceRevisionIds: [], payloadHash: digest({ collectionId, expected, operations }), reconciliation: { added: 0, changed: 1, unchanged: 0, conflicting: 0 }, createdAt: now.toISOString() }; target.proposals[proposalId] = proposal; return success(call, clone(proposal), receipt(engine, context, call, target.revision)); });
    }
    case 'collections_change_apply': {
      keys(args, ['proposalId', 'expectedRevision'], ['proposalId', 'expectedRevision']); const proposalId = str(args.proposalId, 'arguments.proposalId'); if (context.audience !== 'owner') fail('UNAUTHORIZED', 'The requested action is not authorized');
      return mutation(engine, context, call, args, { proposalId }, undefined, (_state, owned) => { const target = Object.values(owned.collections).find((item) => item.proposals[proposalId]); if (!target) fail('NOT_FOUND_OR_FORBIDDEN', 'The requested resource is unavailable'); const proposal = target.proposals[proposalId]!; if (proposal.appliedChangeId) return success(call, { collectionId: target.id, revision: target.revision, publicationRevision: target.publicationRevision, changeId: proposal.appliedChangeId, publishablePayloadHash: publishHash(target, Object.keys(target.items).filter((id) => !target.items[id]!.archived)) }, receipt(engine, context, call, target.revision)); const expected = int(args.expectedRevision, 'arguments.expectedRevision'); if (target.revision !== expected || proposal.baseRevision !== expected) fail('REVISION_CONFLICT', 'The collection changed after this proposal was created', true, { currentRevision: target.revision }); if (proposal.unresolvedIssues.length) fail('PROPOSAL_INVALID', 'Resolve proposal issues before applying'); const changeId = engine.ids.next('change'); const change = { id: changeId, collectionId: target.id, kind: 'proposal' as const, beforeItems: clone(target.items), beforeSchema: clone(target.schema), beforeView: clone(target.view), revision: target.revision + 1, createdAt: now.toISOString(), actorId: context.actorId }; target.changes[changeId] = change;
        let schema = clone(target.schema); for (const operation of proposal.operations) { if (operation.kind === 'set_schema_field') { schema = [...schema.filter((field) => field.id !== operation.field.id), clone(operation.field)]; target.schema = schema; } else if (operation.kind === 'set_view') target.view = clone(operation.view); else if (operation.kind === 'create_item') { const id = operation.itemId ?? engine.ids.next('item'); if (target.items[id]) fail('PROPOSAL_INVALID', 'A create item ID already exists'); const evidence = clone(operation.evidence ?? []); const item: ItemState = { id, revision: 1, values: clone(operation.values), evidence, status: operation.status ?? 'unknown', archived: false, manualFields: Object.keys(operation.values).filter((fieldId) => !evidence.some((reference) => reference.fieldId === fieldId)), updatedAt: now.toISOString() }; if (operation.validThrough) item.validThrough = operation.validThrough; target.items[id] = item; } else { const item = target.items[operation.itemId]; if (!item) fail('PROPOSAL_INVALID', 'An update target is unavailable'); item.manualFields ??= []; for (const fieldId of Object.keys(operation.values)) { const sourceDerived = operation.evidence?.some((reference) => reference.fieldId === fieldId) ?? false; if (!sourceDerived && !item.manualFields.includes(fieldId)) item.manualFields.push(fieldId); } item.values = { ...item.values, ...clone(operation.values) }; item.evidence = [...item.evidence, ...clone(operation.evidence ?? [])]; if (operation.status) item.status = operation.status; if (operation.validThrough === null) delete item.validThrough; else if (operation.validThrough) item.validThrough = operation.validThrough; item.revision += 1; item.updatedAt = now.toISOString(); } }
        for (const field of target.schema.filter((candidate) => candidate.identity === 'strong')) { const seen = new Set<string>(); for (const item of Object.values(target.items).filter((candidate) => !candidate.archived && candidate.values[field.id] !== undefined)) { const key = canonical(item.values[field.id]); if (seen.has(key)) fail('PROPOSAL_INVALID', `Strong identifier ${field.id} must be unique`); seen.add(key); } }
        target.revision += 1; target.updatedAt = now.toISOString(); proposal.appliedChangeId = changeId; return success(call, { collectionId: target.id, revision: target.revision, publicationRevision: target.publicationRevision, changeId, publishablePayloadHash: publishHash(target, Object.keys(target.items).filter((id) => !target.items[id]!.archived)) }, receipt(engine, context, call, target.revision)); });
    }
    case 'collections_publish': {
      keys(args, ['collectionId', 'selectedItemIds', 'expectedPublicationRevision', 'reviewedPayloadHash'], ['collectionId', 'selectedItemIds', 'expectedPublicationRevision', 'reviewedPayloadHash']); const collectionId = str(args.collectionId, 'arguments.collectionId'); const selected = idsArg(args.selectedItemIds, 'arguments.selectedItemIds'); const reviewedPayloadHash = str(args.reviewedPayloadHash, 'arguments.reviewedPayloadHash');
      return mutation(engine, context, call, args, { collectionId }, { payloadHash: reviewedPayloadHash }, (_state, owned) => { const target = owned.collections[collectionId]; if (!target) fail('NOT_FOUND_OR_FORBIDDEN', 'The requested resource is unavailable'); const expected = int(args.expectedPublicationRevision, 'arguments.expectedPublicationRevision'); if (target.publicationRevision !== expected) fail('REVISION_CONFLICT', 'The publication changed after it was reviewed', true, { currentPublicationRevision: target.publicationRevision }); if (publishHash(target, selected) !== reviewedPayloadHash) fail('PUBLICATION_BLOCKED', 'Reviewed payload hash does not match selected current item revisions'); const next: Record<string, import('./types.js').PublishedItem> = {}; for (const id of selected) { const item = target.items[id]; if (!item || item.archived) fail('PUBLICATION_BLOCKED', 'A selected item is unavailable'); for (const field of target.schema.filter((field) => field.required)) if (item.values[field.id] === undefined || item.values[field.id] === null) fail('PUBLICATION_BLOCKED', `A selected item is missing required field ${field.id}`); next[id] = { ...clone(item), publishedAt: now.toISOString() }; } target.published = next; target.publicationRevision += 1; target.updatedAt = now.toISOString(); return success(call, { collectionId, publicationRevision: target.publicationRevision, publishedItemIds: Object.keys(next) }, receipt(engine, context, call, target.publicationRevision)); });
    }
    case 'collections_unpublish': {
      keys(args, ['collectionId', 'selectedItemIds', 'expectedPublicationRevision'], ['collectionId', 'selectedItemIds', 'expectedPublicationRevision']); const collectionId = str(args.collectionId, 'arguments.collectionId'); const selected = idsArg(args.selectedItemIds, 'arguments.selectedItemIds');
      const expectedPublicationRevision = int(args.expectedPublicationRevision, 'arguments.expectedPublicationRevision');
      return mutation(engine, context, call, args, { collectionId }, { payloadHash: digest({ collectionId, selectedItemIds: selected, expectedPublicationRevision }), expectedRevision: expectedPublicationRevision }, (_state, owned) => { const target = owned.collections[collectionId]; if (!target) fail('NOT_FOUND_OR_FORBIDDEN', 'The requested resource is unavailable'); const expected = int(args.expectedPublicationRevision, 'arguments.expectedPublicationRevision'); if (target.publicationRevision !== expected) fail('REVISION_CONFLICT', 'The publication changed after it was reviewed', true); selected.forEach((id) => delete target.published[id]); target.publicationRevision += 1; return success(call, { collectionId, publicationRevision: target.publicationRevision, unpublishedItemIds: selected }, receipt(engine, context, call, target.publicationRevision)); });
    }
    case 'collections_archive': {
      keys(args, ['collectionId', 'selectedItemIds', 'expectedRevision', 'expectedPublicationRevision'], ['collectionId', 'selectedItemIds', 'expectedRevision', 'expectedPublicationRevision']); const collectionId = str(args.collectionId, 'arguments.collectionId'); const selected = idsArg(args.selectedItemIds, 'arguments.selectedItemIds');
      const expectedRevision = int(args.expectedRevision, 'arguments.expectedRevision'); const expectedPublicationRevision = int(args.expectedPublicationRevision, 'arguments.expectedPublicationRevision');
      return mutation(engine, context, call, args, { collectionId }, { payloadHash: digest({ collectionId, selectedItemIds: selected, expectedRevision, expectedPublicationRevision }), expectedRevision }, (_state, owned) => { const target = owned.collections[collectionId]; if (!target) fail('NOT_FOUND_OR_FORBIDDEN', 'The requested resource is unavailable'); const expected = int(args.expectedRevision, 'arguments.expectedRevision'); const publicationExpected = int(args.expectedPublicationRevision, 'arguments.expectedPublicationRevision'); if (target.revision !== expected || target.publicationRevision !== publicationExpected) fail('REVISION_CONFLICT', 'The collection or publication changed after it was reviewed', true); const changeId = engine.ids.next('change'); target.changes[changeId] = { id: changeId, collectionId, kind: 'archive', beforeItems: clone(target.items), beforeSchema: clone(target.schema), beforeView: clone(target.view), revision: target.revision + 1, createdAt: now.toISOString(), actorId: context.actorId }; selected.forEach((id) => { const item = target.items[id]; if (!item) fail('NOT_FOUND_OR_FORBIDDEN', 'The requested resource is unavailable'); item.archived = true; item.revision += 1; item.updatedAt = now.toISOString(); delete target.published[id]; }); target.revision += 1; target.publicationRevision += 1; return success(call, { collectionId, revision: target.revision, publicationRevision: target.publicationRevision, archivedItemIds: selected, changeId }, receipt(engine, context, call, target.revision)); });
    }
    case 'collections_undo': {
      keys(args, ['collectionId', 'changeId', 'expectedRevision'], ['collectionId', 'changeId', 'expectedRevision']); const collectionId = str(args.collectionId, 'arguments.collectionId'); const changeId = str(args.changeId, 'arguments.changeId');
      return mutation(engine, context, call, args, { collectionId }, undefined, (_state, owned) => { const target = owned.collections[collectionId]; if (!target) fail('NOT_FOUND_OR_FORBIDDEN', 'The requested resource is unavailable'); const expected = int(args.expectedRevision, 'arguments.expectedRevision'); if (target.revision !== expected) fail('REVISION_CONFLICT', 'The collection changed after the undo base revision', true); const old = target.changes[changeId]; if (!old || old.undoneBy) fail('NOT_FOUND_OR_FORBIDDEN', 'The requested resource is unavailable'); if (old.revision !== target.revision) fail('REVISION_CONFLICT', 'Only the current head change can be undone safely', true); const undoId = engine.ids.next('change'); target.changes[undoId] = { id: undoId, collectionId, kind: 'undo', beforeItems: clone(target.items), beforeSchema: clone(target.schema), beforeView: clone(target.view), revision: target.revision + 1, createdAt: now.toISOString(), actorId: context.actorId }; target.items = clone(old.beforeItems); target.schema = clone(old.beforeSchema); target.view = clone(old.beforeView); target.revision += 1; old.undoneBy = undoId; return success(call, { collectionId, revision: target.revision, publicationRevision: target.publicationRevision, changeId: undoId, restoredFrom: changeId }, receipt(engine, context, call, target.revision)); });
    }
    case 'collections_item_get': {
      keys(args, ['collectionId', 'itemId'], ['collectionId', 'itemId']); const collectionId = str(args.collectionId, 'arguments.collectionId'); const itemId = str(args.itemId, 'arguments.itemId'); await authorize(engine, context, call.name, { collectionId, itemId });
      return engine.repository.transact((state) => { const target = collection(state, context.entityId, collectionId); const item = context.audience === 'owner' ? target.items[itemId] : target.published[itemId]; if (!item || (context.audience === 'visitor' && !isCurrent(item, now))) fail('NOT_FOUND_OR_FORBIDDEN', 'The requested resource is unavailable'); const evidence: EvidenceReceipt = { id: engine.ids.next('evidence'), entityId: context.entityId, collectionId, publicationRevision: target.publicationRevision, collectionRevisions: { [collectionId]: context.audience === 'owner' ? target.revision : target.publicationRevision }, itemReferences: [{ collectionId, itemId, itemRevision: item.revision, publicationRevision: target.publicationRevision }], checkedAt: now.toISOString() }; if (item.validThrough) evidence.validThrough = item.validThrough; entity(state, context.entityId).evidence[evidence.id] = evidence; return success(call, context.audience === 'visitor' ? publicItem(target, item) : clone(item), undefined, evidence); });
    }
    case 'collections_search': {
      keys(args, ['collectionIds', 'filters', 'text', 'sort', 'cursor', 'pageSize']); const requestedCollections = args.collectionIds === undefined ? undefined : idsArg(args.collectionIds, 'arguments.collectionIds'); const p = page(args, engine.limits); const textQuery = args.text === undefined ? undefined : str(args.text, 'arguments.text', 1000).toLocaleLowerCase(); await authorize(engine, context, call.name, {});
      const filters = args.filters === undefined ? [] : (() => { if (!Array.isArray(args.filters) || args.filters.length > 20) fail('INVALID_ARGUMENT', 'filters must be a bounded array'); return (args.filters as unknown[]).map((raw, index) => { const filter = asObject(raw, `arguments.filters[${index}]`); keys(filter, ['fieldId', 'operator', 'value', 'unit'], ['fieldId', 'operator', 'value'], `arguments.filters[${index}]`); const operator = str(filter.operator, `arguments.filters[${index}].operator`); if (!['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'contains'].includes(operator)) fail('INVALID_ARGUMENT', 'Unsupported filter operator'); assertJson(filter.value, `arguments.filters[${index}].value`, 0, 3); const result: { fieldId: string; operator: string; value: unknown; unit?: string } = { fieldId: str(filter.fieldId, `arguments.filters[${index}].fieldId`), operator, value: filter.value }; if (filter.unit !== undefined) { if (typeof filter.value !== 'number') fail('INVALID_ARGUMENT', `arguments.filters[${index}].unit is only valid for numeric filters`, false, { path: `arguments.filters[${index}].unit` }); result.unit = str(filter.unit, `arguments.filters[${index}].unit`, 50); } return result; }); })();
      const sorts = args.sort === undefined ? [] : (() => { if (!Array.isArray(args.sort) || args.sort.length > 5) fail('INVALID_ARGUMENT', 'sort must be a bounded array'); return (args.sort as unknown[]).map((raw, index) => { const sort = asObject(raw, `arguments.sort[${index}]`); keys(sort, ['fieldId', 'direction', 'currency', 'unit'], ['fieldId'], `arguments.sort[${index}]`); const direction = sort.direction === undefined ? 'asc' : str(sort.direction, `arguments.sort[${index}].direction`); if (direction !== 'asc' && direction !== 'desc') fail('INVALID_ARGUMENT', 'Sort direction must be asc or desc'); const result: { fieldId: string; direction: string; currency?: string; unit?: string } = { fieldId: str(sort.fieldId, `arguments.sort[${index}].fieldId`), direction }; if (sort.currency !== undefined) { const currency = str(sort.currency, `arguments.sort[${index}].currency`, 3).toUpperCase(); if (!/^[A-Z]{3}$/.test(currency)) fail('INVALID_ARGUMENT', 'Sort currency must be a three-letter code'); result.currency = currency; } if (sort.unit !== undefined) result.unit = str(sort.unit, `arguments.sort[${index}].unit`, 50); return result; }); })();
      return engine.repository.transact((state) => { const owned = state.entities[context.entityId]; const collections = Object.values(owned?.collections ?? {}).filter((item) => !requestedCollections || requestedCollections.includes(item.id)); for (const [index, filter] of filters.entries()) { if (typeof filter.value !== 'number') continue; const units = new Set(collections.map((target) => target.schema.find((field) => field.id === filter.fieldId && field.type === 'number')).filter(Boolean).map((field) => field!.unit ?? '')); if (units.size > 1 && !filter.unit) fail('INPUT_INCOMPLETE', `Exact numeric filtering by ${filter.fieldId} requires one unit`, false, { path: `arguments.filters[${index}].unit` }); } let rows: Array<{ collection: CollectionState; item: ItemState }> = []; let filterExcludedIncompatibleCount = 0; let sortExcludedIncompatibleCount = 0; const compare = (actual: unknown, operator: string, expected: unknown): boolean => { if (operator === 'eq') return canonical(actual) === canonical(expected); if (operator === 'ne') return canonical(actual) !== canonical(expected); if (operator === 'in') return Array.isArray(expected) && expected.some((entry) => canonical(entry) === canonical(actual)); if (operator === 'contains') return typeof actual === 'string' && typeof expected === 'string' && actual.toLocaleLowerCase().includes(expected.toLocaleLowerCase()); let left: number; let right: number; if (typeof actual === 'number' && typeof expected === 'number') { left = actual; right = expected; } else if (isMoneyValue(actual) && isMoneyValue(expected) && actual.currency === expected.currency) { left = actual.amount; right = expected.amount; } else if (typeof actual === 'string' && typeof expected === 'string' && !Number.isNaN(Date.parse(actual)) && !Number.isNaN(Date.parse(expected))) { left = Date.parse(actual); right = Date.parse(expected); } else return false; return operator === 'lt' ? left < right : operator === 'lte' ? left <= right : operator === 'gt' ? left > right : left >= right; };
        for (const target of collections) { const items = context.audience === 'owner' ? target.items : target.published; for (const item of Object.values(items)) { if (!isCurrent(item, now)) continue; const permittedItem = context.audience === 'visitor' ? publicItem(target, item) : item; const incompatibleFilter = filters.some((filter) => { if (!filter.unit || typeof permittedItem.values[filter.fieldId] !== 'number') return false; const field = target.schema.find((candidate) => candidate.id === filter.fieldId && candidate.type === 'number'); return Boolean(field) && (field!.unit ?? '') !== filter.unit; }); if (incompatibleFilter) { filterExcludedIncompatibleCount += 1; continue; } if (!filters.every((filter) => compare(permittedItem.values[filter.fieldId], filter.operator, filter.value))) continue; if (textQuery && !canonical(permittedItem.values).toLocaleLowerCase().includes(textQuery)) continue; rows.push({ collection: target, item: permittedItem }); } }
        for (const sort of sorts) {
          const hasMoney = rows.some((row) => isMoneyValue(row.item.values[sort.fieldId]));
          if (hasMoney && !sort.currency) fail('INPUT_INCOMPLETE', `Exact ordering by ${sort.fieldId} requires one currency`, false, { path: 'arguments.sort.currency' });
          const units = new Set(rows.filter((row) => typeof row.item.values[sort.fieldId] === 'number').map((row) => row.collection.schema.find((field) => field.id === sort.fieldId)?.unit ?? ''));
          if (units.size > 1 && !sort.unit) fail('INPUT_INCOMPLETE', `Exact ordering by ${sort.fieldId} requires one unit`, false, { path: 'arguments.sort.unit' });
          const before = rows.length;
          rows = rows.filter((row) => { const value = row.item.values[sort.fieldId]; if (isMoneyValue(value)) return value.currency === sort.currency; const fieldUnit = row.collection.schema.find((field) => field.id === sort.fieldId)?.unit; if (sort.unit && typeof value === 'number') return fieldUnit === sort.unit; return true; });
          sortExcludedIncompatibleCount += before - rows.length;
        }
        const sortable = (value: FieldValue | undefined): string | number | undefined => isMoneyValue(value) ? value.amount : typeof value === 'string' || typeof value === 'number' ? value : undefined;
        rows.sort((a, b) => { for (const sort of sorts) { const left = sortable(a.item.values[sort.fieldId]); const right = sortable(b.item.values[sort.fieldId]); if (left === right) continue; if (left === undefined) return 1; if (right === undefined) return -1; const compared = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right)); if (compared) return sort.direction === 'desc' ? -compared : compared; } return a.collection.id.localeCompare(b.collection.id) || a.item.id.localeCompare(b.item.id); }); const selected = rows.slice(p.cursor, p.cursor + p.pageSize); const publicationRevision = Math.max(0, ...selected.map(({ collection }) => collection.publicationRevision)); const evidence: EvidenceReceipt = { id: engine.ids.next('evidence'), entityId: context.entityId, collectionId: selected.length === 1 ? selected[0]!.collection.id : '*', publicationRevision, collectionRevisions: Object.fromEntries(collections.map((target) => [target.id, context.audience === 'owner' ? target.revision : target.publicationRevision])), itemReferences: selected.map(({ collection: target, item }) => ({ collectionId: target.id, itemId: item.id, itemRevision: item.revision, publicationRevision: target.publicationRevision })), checkedAt: now.toISOString() }; const expiringRows = rows.filter(({ item }) => item.validThrough).sort((left, right) => { const leftTime = /^\d{4}-\d{2}-\d{2}$/.test(left.item.validThrough!) ? Date.parse(`${left.item.validThrough}T00:00:00.000Z`) + 86_400_000 : Date.parse(left.item.validThrough!); const rightTime = /^\d{4}-\d{2}-\d{2}$/.test(right.item.validThrough!) ? Date.parse(`${right.item.validThrough}T00:00:00.000Z`) + 86_400_000 : Date.parse(right.item.validThrough!); return leftTime - rightTime; }); if (expiringRows[0]?.item.validThrough) evidence.validThrough = expiringRows[0].item.validThrough; if (!requestedCollections) evidence.entityRevision = owned?.catalogRevision ?? 0; entity(state, context.entityId).evidence[evidence.id] = evidence; const excludedIncompatibleCount = filterExcludedIncompatibleCount + sortExcludedIncompatibleCount; const warnings: import('./types.js').EngineWarning[] = []; if (filterExcludedIncompatibleCount) warnings.push({ code: 'INCOMPATIBLE_FILTER_VALUES_EXCLUDED', message: `${filterExcludedIncompatibleCount} item(s) used an incompatible unit and were excluded from exact filtering.` }); if (sortExcludedIncompatibleCount) warnings.push({ code: 'INCOMPATIBLE_ORDERING_VALUES_EXCLUDED', message: `${sortExcludedIncompatibleCount} item(s) used an incompatible currency or unit and were excluded from exact ordering.` }); return success(call, { items: selected.map(({ collection: target, item }) => ({ collectionId: target.id, item: context.audience === 'visitor' ? publicItem(target, item) : clone(item) })), totalCount: rows.length, nextCursor: p.cursor + selected.length < rows.length ? p.cursor + selected.length : null, complete: excludedIncompatibleCount === 0, exact: true, excludedIncompatibleCount }, undefined, evidence, warnings); });
    }
    case 'collections_view_get': {
      keys(args, ['collectionId'], ['collectionId']); const collectionId = str(args.collectionId, 'arguments.collectionId'); await authorize(engine, context, call.name, { collectionId }); return engine.repository.read((state) => { const target = collection(state, context.entityId, collectionId); if (context.audience === 'visitor' && !Object.values(target.published).some((item) => isCurrent(item, now))) fail('NOT_FOUND_OR_FORBIDDEN', 'The requested resource is unavailable'); return success(call, { collectionId, view: context.audience === 'owner' ? clone(target.view) : publicView(target), revision: context.audience === 'owner' ? target.revision : target.publicationRevision }); });
    }
    case 'collections_evidence_validate': {
      keys(args, ['evidenceReceiptId'], ['evidenceReceiptId']); const evidenceReceiptId = str(args.evidenceReceiptId, 'arguments.evidenceReceiptId'); await authorize(engine, context, call.name, { evidenceReceiptId }); return engine.repository.read((state) => { const owned = state.entities[context.entityId]; const evidence = owned?.evidence[evidenceReceiptId]; if (!evidence) fail('NOT_FOUND_OR_FORBIDDEN', 'The requested resource is unavailable'); if (!evidence.collectionRevisions || !evidence.itemReferences) fail('STALE_EVIDENCE', 'Legacy evidence lacks unambiguous collection-item identity'); const entityCurrent = evidence.entityRevision === undefined || (owned.catalogRevision ?? 0) === evidence.entityRevision; const collectionsCurrent = Object.entries(evidence.collectionRevisions).every(([collectionId, revision]) => { const target = owned.collections[collectionId]; return Boolean(target) && (context.audience === 'owner' ? target.revision : target.publicationRevision) === revision; }); const itemsCurrent = evidence.itemReferences.every((reference) => { const target = owned.collections[reference.collectionId]; if (!target || (context.audience === 'visitor' && target.publicationRevision !== reference.publicationRevision)) return false; const item = context.audience === 'owner' ? target.items[reference.itemId] : target.published[reference.itemId]; return item?.revision === reference.itemRevision && isCurrent(item, now); }); const scopeCurrent = validThroughIsCurrent(evidence.validThrough, now); if (!entityCurrent || !collectionsCurrent || !itemsCurrent || !scopeCurrent) fail('STALE_EVIDENCE', 'Evidence is no longer current'); return success(call, { evidenceReceiptId, current: true, checkedAt: now.toISOString() }); });
    }
    default: fail('INVALID_ARGUMENT', 'Unknown collection tool');
  }
}

export async function getCollectionToolDefinitions(engine: CollectionEngine, context: ExecutionContext) {
  contextCheck(context); await authorize(engine, context, 'collections_tools_list', {});
  const visitorTools = new Set(['collections_list', 'collections_get', 'collections_item_get', 'collections_search', 'collections_view_get', 'collections_evidence_validate']);
  return clone(context.audience === 'visitor' ? COLLECTION_TOOL_DEFINITIONS.filter((definition) => visitorTools.has(definition.name)) : COLLECTION_TOOL_DEFINITIONS);
}

export async function executeCollectionTool(engine: CollectionEngine, context: ExecutionContext, call: ToolCall): Promise<ToolResult> {
  let requestId = 'invalid-request';
  try {
    contextCheck(context); const input = asObject(call, 'call'); keys(input, ['name', 'arguments', 'toolVersion', 'requestId'], ['name', 'arguments', 'toolVersion', 'requestId'], 'call');
    requestId = str(call.requestId, 'call.requestId'); if (call.toolVersion !== '1') fail('UNSUPPORTED_VERSION', 'Unsupported tool contract version'); const name = str(call.name, 'call.name'); if (!COLLECTION_TOOL_NAMES.includes(name)) fail('INVALID_ARGUMENT', 'Unknown collection tool'); if (context.audience === 'visitor' && mutationTools.has(name)) fail('UNAUTHORIZED', 'The requested action is not authorized');
    const result = JSON.parse(JSON.stringify(await dispatch(engine, context, call))) as ToolResult; const definition = COLLECTION_TOOL_DEFINITIONS.find((candidate) => candidate.name === name)!; if (!matchesJsonSchema(result, definition.outputSchema)) throw new Error(`Internal output contract violation for ${name}`); await engine.telemetry?.emit({ action: name, ok: true, entityId: context.entityId, correlationId: context.correlationId }); return result;
  } catch (error) {
    const fault = error instanceof EngineFault ? error : new EngineFault('STORAGE_UNAVAILABLE', 'The operation could not be completed', true);
    await engine.telemetry?.emit({ action: typeof call?.name === 'string' ? call.name : 'unknown', ok: false, entityId: context?.entityId ?? 'unknown', correlationId: context?.correlationId ?? 'unknown', errorCode: fault.code });
    const result: ToolResult = { ok: false, toolVersion: '1', requestId, error: { code: fault.code, message: fault.message, retryable: fault.retryable } }; if (fault.details) result.error.details = fault.details; const definition = COLLECTION_TOOL_DEFINITIONS.find((candidate) => candidate.name === call?.name); if (definition && !matchesJsonSchema(result, definition.outputSchema)) return { ok: false, toolVersion: '1', requestId, error: { code: 'STORAGE_UNAVAILABLE', message: 'The operation returned an invalid contract result', retryable: false } }; return result;
  }
}
