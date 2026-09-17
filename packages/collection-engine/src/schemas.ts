import type { Audience, JsonSchema, ToolDefinition } from './types.js';

const object = (properties: Record<string, JsonSchema>, required: string[] = [], additionalProperties = false): JsonSchema => ({ type: 'object', properties, required, additionalProperties });
const string = (maxLength = 256): JsonSchema => ({ type: 'string', minLength: 1, maxLength });
const integer: JsonSchema = { type: 'integer', minimum: 0 };
const nullableInteger: JsonSchema = { type: ['integer', 'null'], minimum: 0 };
const ids: JsonSchema = { type: 'array', items: string(), maxItems: 500, uniqueItems: true };
const jsonRecord: JsonSchema = { type: 'object', additionalProperties: true, maxProperties: 500 };
const money = object({ amount: { type: 'number' }, currency: string(3) }, ['amount', 'currency']);
const reference = object({ collectionId: string(), itemId: string() }, ['collectionId', 'itemId']);
const fieldValue: JsonSchema = { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }, money, reference, { type: 'array', maxItems: 500, items: { oneOf: [{ type: 'string' }, reference] } }] };
const values: JsonSchema = { type: 'object', additionalProperties: fieldValue, maxProperties: 500 };
const field = object({ id: string(), label: string(200), type: { enum: ['string', 'number', 'boolean', 'date', 'datetime', 'money', 'enum', 'reference'] }, required: { type: 'boolean' }, public: { type: 'boolean' }, multiple: { type: 'boolean' }, unit: string(50), enumValues: ids, identity: { enum: ['strong', 'candidate'] } }, ['id', 'label', 'type']);
const view = object({ version: { const: '1' }, layout: { enum: ['cards', 'gallery', 'agenda', 'detail'] }, titleField: string(), subtitleField: string(), imageField: string(), startField: string(), endField: string(), groupByField: string(), visibleFields: ids }, ['version', 'layout']);
const sourceReference = object({ sourceRevisionId: string(), inputId: string(), fieldId: string() }, ['sourceRevisionId']);
const itemOperationCommon = { itemId: string(), values, status: { enum: ['unknown', 'available', 'unavailable'] }, validThrough: { type: ['string', 'null'] }, evidence: { type: 'array', maxItems: 100, items: sourceReference } };
const operation: JsonSchema = { oneOf: [
  object({ kind: { const: 'create_item' }, ...itemOperationCommon }, ['kind', 'values']),
  object({ kind: { const: 'update_item' }, ...itemOperationCommon }, ['kind', 'itemId', 'values']),
  object({ kind: { const: 'set_schema_field' }, field }, ['kind', 'field']),
  object({ kind: { const: 'set_view' }, view }, ['kind', 'view']),
] };
const filter = object({ fieldId: string(), operator: { enum: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'contains'] }, value: fieldValue, unit: string(50) }, ['fieldId', 'operator', 'value']);
const sort = object({ fieldId: string(), direction: { enum: ['asc', 'desc'] }, currency: string(3), unit: string(50) }, ['fieldId']);
const pagination = { cursor: integer, pageSize: { type: 'integer', minimum: 1, maximum: 200 } };
const collection = { collectionId: string() };

const warning = object({ code: string(), message: string(1000) }, ['code', 'message']);
const receipt = object({ id: string(), operation: string(), actorId: string(), entityId: string(), requestId: string(), occurredAt: string(), revision: integer, historical: { type: 'boolean' } }, ['id', 'operation', 'actorId', 'entityId', 'requestId', 'occurredAt']);
const itemReference = object({ collectionId: string(), itemId: string(), itemRevision: integer, publicationRevision: integer }, ['collectionId', 'itemId', 'itemRevision', 'publicationRevision']);
const evidence = object({ id: string(), entityId: string(), collectionId: string(), publicationRevision: integer, collectionRevisions: jsonRecord, itemReferences: { type: 'array', items: itemReference }, entityRevision: integer, checkedAt: string(), validThrough: string() }, ['id', 'entityId', 'collectionId', 'publicationRevision', 'collectionRevisions', 'itemReferences', 'checkedAt']);
const safeError = object({ code: { enum: ['INVALID_ARGUMENT', 'UNAUTHORIZED', 'NOT_FOUND_OR_FORBIDDEN', 'REVISION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'INTENT_REQUIRED', 'UNSUPPORTED_VERSION', 'UNSUPPORTED_CAPABILITY', 'LIMIT_EXCEEDED', 'INPUT_INCOMPLETE', 'PROPOSAL_INVALID', 'PUBLICATION_BLOCKED', 'STALE_EVIDENCE', 'STORAGE_UNAVAILABLE'] }, message: string(2000), retryable: { type: 'boolean' }, details: jsonRecord }, ['code', 'message', 'retryable']);
const item = object({ id: string(), revision: integer, values, evidence: { type: 'array', items: sourceReference }, status: { enum: ['unknown', 'available', 'unavailable'] }, archived: { type: 'boolean' }, manualFields: ids, validThrough: string(), updatedAt: string(), publishedAt: string() }, ['id', 'revision', 'values', 'evidence', 'status', 'archived', 'manualFields', 'updatedAt']);
const reconciliation = object({ added: integer, changed: integer, unchanged: integer, conflicting: integer }, ['added', 'changed', 'unchanged', 'conflicting']);
const proposal = object({ id: string(), collectionId: string(), baseRevision: integer, operations: { type: 'array', items: operation }, unresolvedIssues: { type: 'array', items: string(1000) }, sourceRevisionIds: ids, payloadHash: string(), reconciliation, createdAt: string(), appliedChangeId: string() }, ['id', 'collectionId', 'baseRevision', 'operations', 'unresolvedIssues', 'sourceRevisionIds', 'payloadHash', 'reconciliation', 'createdAt']);
const publicationReview = object({ selectedItemIds: ids, itemRevisions: jsonRecord, reviewedPayloadHash: string() }, ['selectedItemIds', 'itemRevisions', 'reviewedPayloadHash']);
const collectionSummary = object({ id: string(), name: string(), domain: string(), revision: integer, publicationRevision: integer, itemCount: integer }, ['id', 'name', 'publicationRevision', 'itemCount']);

const dataSchemas: Record<string, JsonSchema> = {
  collections_list: object({ items: { type: 'array', items: collectionSummary }, totalCount: integer, nextCursor: nullableInteger, complete: { type: 'boolean' } }, ['items', 'totalCount', 'nextCursor', 'complete']),
  collections_get: object({ id: string(), name: string(), domain: string(), revision: integer, publicationRevision: integer, schema: { type: 'array', items: field }, itemIds: ids, proposalIds: ids, view, publicationReview }, ['id', 'name', 'publicationRevision', 'schema', 'itemIds', 'view']),
  collections_create: object({ collectionId: string(), revision: integer, publicationRevision: integer, view }, ['collectionId', 'revision', 'publicationRevision', 'view']),
  collections_item_get: item,
  collections_search: object({ items: { type: 'array', items: object({ collectionId: string(), item }, ['collectionId', 'item']) }, totalCount: integer, nextCursor: nullableInteger, complete: { type: 'boolean' }, exact: { const: true }, excludedIncompatibleCount: integer }, ['items', 'totalCount', 'nextCursor', 'complete', 'exact', 'excludedIncompatibleCount']),
  collections_ingest: object({ ingestId: string(), sourceRevisionId: string(), acceptedCount: integer, digest: string(128), reportedCoverage: { enum: ['complete', 'partial', 'unknown'] }, engineVerifiedSavedBatch: { const: true } }, ['ingestId', 'sourceRevisionId', 'acceptedCount', 'digest', 'reportedCoverage', 'engineVerifiedSavedBatch']),
  collections_ingest_get: object({ id: string(), sourceRevisionId: string(), acceptedCount: integer, digest: string(), reportedCoverage: string(), createdAt: string() }, ['id', 'sourceRevisionId', 'acceptedCount', 'digest', 'reportedCoverage', 'createdAt']),
  collections_source_get: object({ id: string(), ingestId: string(), kind: { enum: ['text', 'segments', 'records'] }, source: jsonRecord, acceptedCount: integer, digest: string(), createdAt: string() }, ['id', 'ingestId', 'kind', 'source', 'acceptedCount', 'digest', 'createdAt']),
  collections_source_review: object({ sourceRevisionId: string(), kind: { enum: ['text', 'segments', 'records'] }, text: { type: 'string' }, entries: { type: 'array' }, totalCount: integer, nextCursor: nullableInteger, complete: { type: 'boolean' } }, ['sourceRevisionId', 'kind', 'complete']),
  collections_proposal_get: proposal,
  collections_change_propose: proposal,
  collections_view_propose: proposal,
  collections_change_apply: object({ collectionId: string(), revision: integer, publicationRevision: integer, changeId: string(), publishablePayloadHash: string() }, ['collectionId', 'revision', 'publicationRevision', 'changeId']),
  collections_publish: object({ collectionId: string(), publicationRevision: integer, publishedItemIds: ids }, ['collectionId', 'publicationRevision', 'publishedItemIds']),
  collections_unpublish: object({ collectionId: string(), publicationRevision: integer, unpublishedItemIds: ids }, ['collectionId', 'publicationRevision', 'unpublishedItemIds']),
  collections_archive: object({ collectionId: string(), revision: integer, publicationRevision: integer, archivedItemIds: ids, changeId: string() }, ['collectionId', 'revision', 'publicationRevision', 'archivedItemIds', 'changeId']),
  collections_undo: object({ collectionId: string(), revision: integer, publicationRevision: integer, changeId: string(), restoredFrom: string() }, ['collectionId', 'revision', 'publicationRevision', 'changeId', 'restoredFrom']),
  collections_view_get: object({ collectionId: string(), view, revision: integer }, ['collectionId', 'view', 'revision']),
  collections_evidence_validate: object({ evidenceReceiptId: string(), current: { const: true }, checkedAt: string() }, ['evidenceReceiptId', 'current', 'checkedAt']),
};

type Metadata = ToolDefinition['metadata'];
const read: Metadata = { access: 'read', effect: 'none', audiences: ['owner', 'visitor'] };
const ownerRead: Metadata = { access: 'read', effect: 'none', audiences: ['owner'] };
const draft: Metadata = { access: 'write', effect: 'draft', audiences: ['owner'] };
const publication: Metadata = { access: 'write', effect: 'publication', audiences: ['owner'] };
const withdrawal: Metadata = { access: 'write', effect: 'withdrawal', audiences: ['owner'] };

const entries: Array<[string, string, JsonSchema, Metadata]> = [
  ['collections_list', 'List collections visible to the trusted caller.', object(pagination), read],
  ['collections_get', 'Read a collection and prepare an exact owner publication review.', object({ ...collection, selectedItemIds: ids }, ['collectionId']), read],
  ['collections_create', 'Create an empty draft collection.', object({ name: string(200), domain: string(100), schema: { type: 'array', maxItems: 100, items: field }, view }, ['name']), draft],
  ['collections_item_get', 'Read one permitted current item and evidence.', object({ ...collection, itemId: string() }, ['collectionId', 'itemId']), read],
  ['collections_search', 'Search permitted items with exact filters and compatible ordering.', object({ collectionIds: ids, filters: { type: 'array', maxItems: 20, items: filter }, text: string(1000), sort: { type: 'array', maxItems: 5, items: sort }, ...pagination }), read],
  ['collections_ingest', 'Persist bounded already-extracted text, segments, or records.', object({ kind: { enum: ['text', 'segments', 'records'] }, source: object({ reference: string(1000), label: string(300), reportedCoverage: { enum: ['complete', 'partial', 'unknown'] }, coverageNote: string(1000), previousSourceRevisionId: string() }), text: string(1000000), segments: { type: 'array', maxItems: 2000, items: object({ inputId: string(), text: string(1000000), locator: jsonRecord }, ['inputId', 'text']) }, records: { type: 'array', maxItems: 2000, items: jsonRecord }, manifest: object({ declaredCount: integer }, ['declaredCount']) }, ['kind', 'source']), draft],
  ['collections_ingest_get', 'Read an accepted raw-data batch receipt.', object({ ingestId: string() }, ['ingestId']), ownerRead],
  ['collections_source_get', 'Read private supplied-source metadata.', object({ sourceRevisionId: string() }, ['sourceRevisionId']), ownerRead],
  ['collections_source_review', 'Review bounded private supplied-source content.', object({ sourceRevisionId: string(), inputIds: ids, ...pagination }, ['sourceRevisionId']), ownerRead],
  ['collections_proposal_get', 'Read a source-linked change proposal.', object({ proposalId: string() }, ['proposalId']), ownerRead],
  ['collections_change_propose', 'Reconcile, validate, and save typed change operations.', object({ ...collection, expectedRevision: integer, operations: { type: 'array', minItems: 1, maxItems: 200, items: operation }, sourceRevisionIds: ids, unresolvedIssues: { type: 'array', items: string(1000), maxItems: 100 } }, ['collectionId', 'expectedRevision', 'operations']), draft],
  ['collections_change_apply', 'Apply a validated proposal to a working revision.', object({ proposalId: string(), expectedRevision: integer }, ['proposalId', 'expectedRevision']), draft],
  ['collections_publish', 'Publish exact reviewed eligible item revisions.', object({ ...collection, selectedItemIds: ids, expectedPublicationRevision: integer, reviewedPayloadHash: string(200) }, ['collectionId', 'selectedItemIds', 'expectedPublicationRevision', 'reviewedPayloadHash']), publication],
  ['collections_unpublish', 'Withdraw selected items from visitor eligibility.', object({ ...collection, selectedItemIds: ids, expectedPublicationRevision: integer }, ['collectionId', 'selectedItemIds', 'expectedPublicationRevision']), withdrawal],
  ['collections_archive', 'Archive items and atomically withdraw their snapshots.', object({ ...collection, selectedItemIds: ids, expectedRevision: integer, expectedPublicationRevision: integer }, ['collectionId', 'selectedItemIds', 'expectedRevision', 'expectedPublicationRevision']), withdrawal],
  ['collections_undo', 'Create a checked inverse working revision.', object({ ...collection, changeId: string(), expectedRevision: integer }, ['collectionId', 'changeId', 'expectedRevision']), draft],
  ['collections_view_get', 'Read the current permitted declarative view.', object(collection, ['collectionId']), read],
  ['collections_view_propose', 'Validate a non-executable declarative view proposal.', object({ ...collection, expectedRevision: integer, view }, ['collectionId', 'expectedRevision', 'view']), draft],
  ['collections_evidence_validate', 'Revalidate evidence against current policy and revisions.', object({ evidenceReceiptId: string() }, ['evidenceReceiptId']), read],
];

const output = (data: JsonSchema): JsonSchema => ({ oneOf: [
  object({ ok: { const: true }, toolVersion: { const: '1' }, requestId: string(), data, warnings: { type: 'array', items: warning }, receipt, evidence }, ['ok', 'toolVersion', 'requestId', 'data', 'warnings']),
  object({ ok: { const: false }, toolVersion: { const: '1' }, requestId: string(), error: safeError }, ['ok', 'toolVersion', 'requestId', 'error']),
] });

export const COLLECTION_TOOL_NAMES = entries.map(([name]) => name) as readonly string[];
export const COLLECTION_TOOL_DEFINITIONS: readonly ToolDefinition[] = entries.map(([name, description, inputSchema, metadata]) => ({
  name, description, toolVersion: '1', metadata,
  inputSchema: { $id: `https://schemas.youbot.dev/collection-engine/tools/${name}/1/input`, ...inputSchema },
  outputSchema: { $id: `https://schemas.youbot.dev/collection-engine/tools/${name}/1/output`, ...output(dataSchemas[name]!) },
}));

function typeMatches(value: unknown, type: unknown): boolean {
  if (Array.isArray(type)) return type.some((entry) => typeMatches(value, entry));
  return type === 'null' ? value === null : type === 'array' ? Array.isArray(value) : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) : type === 'integer' ? Number.isInteger(value) : typeof value === type;
}
export function matchesJsonSchema(value: unknown, schema: JsonSchema): boolean {
  if (Array.isArray(schema.oneOf)) return (schema.oneOf as JsonSchema[]).filter((candidate) => matchesJsonSchema(value, candidate)).length === 1;
  if ('const' in schema && value !== schema.const) return false;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
  if (schema.type !== undefined && !typeMatches(value, schema.type)) return false;
  if (typeof value === 'string') { if (typeof schema.minLength === 'number' && value.length < schema.minLength) return false; if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return false; }
  if (typeof value === 'number') { if (typeof schema.minimum === 'number' && value < schema.minimum) return false; if (typeof schema.maximum === 'number' && value > schema.maximum) return false; }
  if (Array.isArray(value)) { if (typeof schema.minItems === 'number' && value.length < schema.minItems) return false; if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) return false; if (schema.uniqueItems && new Set(value.map((entry) => JSON.stringify(entry))).size !== value.length) return false; if (schema.items && !value.every((entry) => matchesJsonSchema(entry, schema.items as JsonSchema))) return false; }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) { const record = value as Record<string, unknown>; const properties = (schema.properties ?? {}) as Record<string, JsonSchema>; if (Array.isArray(schema.required) && !(schema.required as string[]).every((key) => key in record)) return false; if (schema.additionalProperties === false && Object.keys(record).some((key) => !(key in properties))) return false; if (schema.additionalProperties && typeof schema.additionalProperties === 'object' && Object.entries(record).some(([key, item]) => !(key in properties) && !matchesJsonSchema(item, schema.additionalProperties as JsonSchema))) return false; for (const [key, propertySchema] of Object.entries(properties)) if (key in record && !matchesJsonSchema(record[key], propertySchema)) return false; }
  return true;
}
