# Collection engine API and tool catalogue

Date: 2026-09-14. Status: API guide for the source implementation of [specification revision 3](../../.factory/product/specs/conversational-collections.md), with target contract gaps distinguished from delivered exports below. Package and focused test evidence do not establish release or registry publication. Files, parsing/OCR, external parser integrations and host model orchestration are outside the package. [Architecture](architecture.md) defines invariants; [implementation plan](implementation-plan.md) assigns delivery.

## Package exports and a minimal host

The delivered package is `@youbot/collection-engine` 0.1.0 at `packages/collection-engine`. Its [manifest](../../packages/collection-engine/package.json) declares Node >=20, ESM and CommonJS entry points, TypeScript declarations and a `./conformance` export. In-memory and JSON-file repositories are bundled. No SQLite collection adapter or React companion package is delivered; either can be added later behind public contracts. Consumers use public exports, not repository-relative source imports.

Core public entry points:

```ts
createCollectionEngine(options: EngineOptions): CollectionEngine
getCollectionToolDefinitions(engine, context): Promise<ToolDefinition[]>
executeCollectionTool(engine, context, call): Promise<ToolResult>
```

Public exports include `ExecutionContext`, `EngineOptions`, `ToolCall`, `ToolResult`, `ToolDefinition`, `FieldValue`, `CollectionViewDefinition`, state/proposal/evidence DTOs, the ports below and package/tool/persistence/view constants. The conformance kit is exported under `./conformance`. `createJsonFileCollectionRepository` and `createMemoryCollectionRepository` are additional root exports. No function has hidden access to Youbot globals.

An ordinary host can use the bundled JSON-file repository; this is the repository constructed by [Youbot's collection service](../../youbot-core/src/concierge/collections/service.ts):

```ts
const repository = await createJsonFileCollectionRepository({ filePath });
const engine = createCollectionEngine({
  repository,
  policy: hostPolicy,
  clock: systemClock,
  ids: randomIds,
  limits: approvedLimits,
});
const context = await resolveAuthenticatedContext(request); // trusted host code
const tools = await getCollectionToolDefinitions(engine, context);
const call = normalizeProviderToolCall(providerCall); // host-specific envelope
const result = await executeCollectionTool(engine, context, call);
```

This sketch uses delivered exports; `hostPolicy`, trusted context resolution and provider-envelope normalization remain host-supplied functions. The host first extracts or obtains crude text, segments or records using its own pipeline, then sends those values to `collections_ingest`. Its own LLM loop calls proposal, apply, search and view tools to organize and maintain that input. The engine invokes no model, parses no file and has no file-upload, blob-store, parser or background-import dependency. Construction opens no listeners, starts no worker and chooses no provider. Supplied raw data is persisted privately through the repository alongside its provenance.

## Trusted execution and ports

```ts
type ExecutionContext = Readonly<{
  actorId: string;
  entityId: string;
  audience: 'owner' | 'visitor';
  authorizationHandle: string; // opaque handle verified by PolicyPort
  correlationId: string;
  intentReceipt?: string;     // trusted exact-action approval, when required
}>;

type ToolCall = {
  name: string;
  arguments: unknown;
  toolVersion: '1';
  requestId: string;          // host issues and preserves on retries
};
```

Context is a separate trusted argument, not a tool schema property and not merged from tool JSON. TypeScript types are insufficient security: `PolicyPort` verifies the live authentication/delegation handle and current resource/action/field policy every call. The host adapter must not let client JSON construct a privileged context. Direct engine services use the same enforcement as the dispatcher. If a host automates ingestion, its authenticated service identity still needs explicit scoped permission; there is no engine worker role that bypasses current policy.

| Port | Contract and owner |
| --- | --- |
| `PolicyPort` | Host authenticates current context and authorizes action/resources/fields. Verifies exact-action intent receipts against actor, entity, proposal/snapshot hash and revision. Returns current policy revision/decision; cached audience is insufficient. |
| `RepositoryPort` | Durable scoped reads, atomic validated writes/projections/receipts, expected-revision CAS, idempotent raw-data batches, migrations and capability versions. The bundled JSON-file repository is the current persistent implementation. It grants no policy and accepts no arbitrary model SQL. |
| Clock/IDs/telemetry | Inject clock and stable IDs for testability; optional telemetry receives redacted events. No source prose or secrets in ordinary logs. |

The [package README](../../packages/collection-engine/README.md) documents the JSON repository's sibling lock directory, reload/write/rename lifecycle, 10-second lock wait and stale-lock recovery. Persistence schema `1` is current; exported `MIGRATABLE_PERSISTENCE_SCHEMA_VERSIONS` identifies version `0` as the one supported prior format. Version 0 entities omit `catalogRevision`; opening under the repository lock derives it from the collection count, retains all collection/draft/publication/source/evidence/idempotency state, saves exact prior bytes at `<filePath>.schema-0.backup`, and atomically replaces the primary file. Matching backup plus version 0 primary is retryable after interruption. A conflicting or unreadable backup, including a dangling backup symlink, malformed version 0 data, missing metadata, any other version, or temporary-write/rename failure propagates without treating the primary as absent and without intentionally rewriting it. Reliable atomic filesystem `mkdir`/`rename` is required; file/directory `fsync`, sudden power-loss and distributed-filesystem guarantees are not established. `createMemoryCollectionRepository` supports isolated tests. A future SQLite/database repository must implement `RepositoryPort` and pass the conformance contracts; no SQLite constructor/export or companion artifact is presently available.

## Execution, results and errors

Pipeline: resolve registered name/version → validate arguments/limits → authorize current context and scoped resources → inspect expected revision/idempotency → execute bounded operation → atomically persist transition and immutable receipt → return audience-permitted readback. Mutation commit re-checks current authorization. Host model work happens before the call; a resulting proposal must still pass current authorization and revision checks. Authorization errors do not disclose cross-entity existence. Source passages are owner-only even if an item is public.

Idempotency is scoped by entity, actor, operation and host request ID; a canonical fingerprint includes validated payload and tool version. Retry of identical input returns its immutable operation receipt after current authorization; different input under the same key yields `IDEMPOTENCY_CONFLICT`. Fingerprints and private receipts are not leaked to unauthorized callers. A stale successful receipt is labeled historical and must not be treated as a current item read; current readback is freshly filtered.

```ts
type ToolResult =
  | { ok: true; toolVersion: '1'; requestId: string;
      data: unknown; receipt?: OperationReceipt;
      evidence?: EvidenceReceipt; warnings: EngineWarning[] }
  | { ok: false; toolVersion: '1'; requestId: string;
      error: { code: ErrorCode; message: string; retryable: boolean;
               details?: SafeErrorDetails } };
```

**Delivered S13 contract:** [schemas.ts](../../packages/collection-engine/src/schemas.ts) exports 19 versioned definitions with explicit access, effect and audience metadata; bounded nested input schemas; and operation-specific output schemas. [ToolDefinition](../../packages/collection-engine/src/types.ts) exposes that metadata. [The dispatcher](../../packages/collection-engine/src/engine.ts) validates both tool inputs and returned results against the advertised runtime schema before returning them. Unknown properties, malformed nested operations and malformed outputs fail closed. `unknown` in the TypeScript envelope above is only the shared compile-time union surface; each runtime tool definition narrows its own `data`, `receipt`, `evidence` and error shape. The packed-consumer verifier and package regressions cover metadata, nested schema rejection and output validation without a provider SDK.

Stable error categories: `INVALID_ARGUMENT`, `UNAUTHORIZED`, `NOT_FOUND_OR_FORBIDDEN`, `REVISION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `INTENT_REQUIRED`, `UNSUPPORTED_VERSION`, `UNSUPPORTED_CAPABILITY`, `LIMIT_EXCEEDED`, `INPUT_INCOMPLETE`, `PROPOSAL_INVALID`, `PUBLICATION_BLOCKED`, `STALE_EVIDENCE`, `STORAGE_UNAVAILABLE`. Error details contain permitted field paths/recovery hints, never raw credentials, source contents, SQL or cross-entity identifiers. Retryability does not authorize an unlimited retry loop.

Operation and ingestion receipts are append-only records of what actually happened, including actor, entity, operation, relevant revisions, timestamp, request identity and outcome. An ingest receipt reports what the engine actually accepted; host-supplied coverage metadata is labeled separately. Callers cannot set canonical publication or audit outcomes directly. Receipt lookups always reauthorize.

## Provider-neutral tool catalogue

The catalogue below describes the intended operation boundary; exact runtime argument names and supported schemas are exported from [schemas.ts](../../packages/collection-engine/src/schemas.ts). All entries use `ToolCall.requestId` for durable mutations; all referenced IDs are re-scoped and authorized on the server. `expectedRevision` and proposal/snapshot hashes identify exact reviewed data. Tool descriptions/schema examples are guidance to an LLM; the executor independently enforces every condition. The host may expose a smaller tool list by task, but hiding tools is not the authorization boundary.

| Tool | Principal inputs | Result / enforcement |
| --- | --- | --- |
| `collections_list` | cursor, pageSize | Permitted collection summaries; visitor sees current published collections only. |
| `collections_get` | collectionId | Schema/metadata and allowed current revision; draft read requires owner authorization. |
| `collections_create` | name, supported optional schema/domain preset | New draft collection ID/revision; owner only, no publication. Presets are optional data definitions. |
| `collections_item_get` | collectionId, itemId | Current allowed facts and evidence handle; no visitor history/draft override. |
| `collections_search` | collectionIds, typed filters, optional text, sort, cursor, pageSize | Permitted matches, exact-count semantics, continuation/completeness, revisions and evidence receipt. |
| `collections_ingest` | raw text/segments/records, optional opaque source reference and completeness metadata | Atomically saves a bounded immutable raw-data batch, engine-issued source/segment IDs and receipt. Does not parse files, infer canonical items, run a model or publish. |
| `collections_ingest_get` | ingestId | Current-authorized receipt, accepted counts/digest and labeled completeness metadata. This is a saved-batch read, not a processing-job status. |
| `collections_source_get` | sourceRevisionId | Metadata for already supplied raw text/records and provenance. Never resolves an original file or private storage key. |
| `collections_source_review` | sourceRevisionId, bounded segment/record selection | Authorized owner review of the supplied raw text/records, including supplied page labels. Original files remain solely in the host pipeline. |
| `collections_proposal_get` | proposalId | Source-linked diff, unresolved issues and exact base revision for owner review. |
| `collections_change_propose` | collectionId, expectedRevision, bounded typed operations/candidates, supplied source/segment references | Validated source-linked draft proposal and reconciliation diff; supports item create/edit, schema evolution and reviewed relationship changes. Archive is a distinct visible-effect operation. |
| `collections_change_apply` | proposalId, expectedRevision | New working revision and immutable receipt; no automatic publication. |
| `collections_publish` | collectionId, selected eligible revisions, expectedPublicationRevision, reviewedPayloadHash | Atomic current snapshot and generation. Policy verifies trusted intent receipt supplied through context; model `approved: true` is invalid. |
| `collections_unpublish` | collectionId, selected item IDs or exact snapshot, expectedPublicationRevision | Explicit removal from current visitor eligibility; action requires owner policy/intent appropriate to this visible effect. |
| `collections_archive` | collectionId, selected item IDs, expectedRevision, expectedPublicationRevision | Explicit audited archive and immediate visitor withdrawal in one atomic operation; requires a host-verified exact-target intent receipt. Ordinary draft application cannot archive a published item. |
| `collections_undo` | changeId, expectedRevision | New inverse working revision or conflict. Retains history and does not republish old content. |
| `collections_view_get` | collectionId | Current permitted validated view definition with stable field mappings and version. |
| `collections_view_propose` | collectionId, expectedRevision, view definition | Validated view change proposal applied through `collections_change_apply`; no executable UI. |
| `collections_evidence_validate` | evidenceReceiptId | Fresh policy/publication/item revision/expiry eligibility and time of check. Returns stale/forbidden safely; host still owns dispatch coordination. |

The exact permitted read revision is determined by trusted context and policy, not an audience or entity property inside tool arguments. History/source review uses distinct owner services. Schema operations have allowlisted type/unit/cardinality transitions; they never become arbitrary DDL. View schemas contain allowed layouts, field mappings, grouping and filters, without React/HTML/JavaScript or arbitrary network actions.

Draft change application never alters the current published snapshot. Archive and unpublish use their explicit operations so an ordinary correction cannot silently withdraw published content. Undoing archive restores a new working revision only; publishing restored content is another explicit reviewed action.

## Bounded raw-data ingestion

`collections_ingest` accepts one bounded JSON batch of crude data, for example:

```json
{
  "kind": "segments",
  "source": {
    "reference": "catalogue-revision-7",
    "label": "September classes",
    "reportedCoverage": "partial",
    "coverageNote": "Host supplied text from pages 1–3"
  },
  "segments": [
    { "inputId": "page-1-section-2", "text": "Beginner pottery — AED 180 per session",
      "locator": { "pageLabel": "1", "section": "Classes" } }
  ]
}
```

The final input schema permits bounded `text`, `segments`, or `records` with explicit discriminants; the example illustrates one form. Crude records are plain JSON values, not trusted canonical item rows. Reject executable values, binary/base64 file payloads, unknown authority fields, oversize values and unsupported nesting. Source references and page labels are opaque descriptive data and confer no fetch, file, tenant or tool permission. The host supplies limits visible in its UI; the engine independently enforces configured batch bytes, text length, segment/record count and nesting bounds.

A successful submission atomically persists all accepted batch values, scoped immutable source/segment references and a receipt. Invalid batches commit nothing. Exact retries use the host-issued request ID and normalized payload fingerprint; matching retries return the authorized receipt without duplicate raw records. A different payload under the same request ID conflicts. A new submission can reference a previous source revision as a proposed successor; it never overwrites an immutable revision or automatically replaces owner corrections.

Completeness has two distinct meanings. The engine can verify that the submitted batch satisfies its declared segment/record manifest and was saved in full. `reportedCoverage: complete | partial | unknown` is an attributed upstream claim, never engine-certified extraction coverage. Metadata arriving as model arguments is untrusted submitter metadata; it cannot become a verified host assertion merely by naming the host. Missing coverage defaults to unknown. The engine cannot verify an original PDF it never received. Missing declared records cause an explicit incomplete-input result; no source count, absent page or absent item is guessed. Multiple external batches remain separately identified, and no last-batch heuristic claims an entire catalogue complete. A host may provide a bounded manifest linking batches for review, but batch saving is not a background processing job.

The host owns file import, parser/OCR selection, upload/private-original storage, extraction errors, upstream cancellation/retries and LLM invocation. It may retry an engine ingest request safely after a connection failure using the same request ID. Engine ingestion has no asynchronous start/poll/cancel/retry worker lifecycle. Any host progress UI distinguishes upstream processing, engine input saved, proposal ready, draft saved and published.

After ingestion the host can give its LLM the crude data or bounded owner-authorized source reads. The LLM calls `collections_change_propose` with typed candidates/operations and source references; the engine validates schema values, source spans/record pointers, stable identities, reconciliation policy and base revision. It returns added/changed/unchanged/conflicting candidates with unresolved facts. Evidence checks prove a cited span exists in supplied data, not that an external parser or LLM understood an unseen original correctly. Raw input is untrusted reference data and cannot change authority.

Strong identifiers can propose updates to stable items; ambiguous matches require owner resolution, manual corrections remain protected, absence never implies deletion, and complex recurrence/currency/basis is not guessed. Valid proposals apply through `collections_change_apply` to working revisions. Publication is a separate explicit reviewed action with trusted intent. A crash between ingestion and proposal application leaves durable raw data and no implied canonical change; re-read and retry the bounded call, without reconstructing an engine job queue.

## Answering, preview and renderers

The engine returns current facts and evidence, not prose answers or channel messages. The host orchestrates its chosen LLM with `collections_search`/`collections_item_get`, invalidates stale facts from prior conversation history, and preserves host business rules such as Youbot's knowledge, pricing, booking and takeover policy. Visitor preview creates a trusted visitor-context execution path server-side, uses current publication only and sends nothing.

Before dispatch, the host reauthorizes and calls evidence validation for policy changes, publication changes and valid-through expiry, including cases with unchanged content generation. A successful eligibility check is not a send guarantee: the host coordinates the final check with publication/inbox state and its transport boundary. An external message already accepted cannot be recalled by the engine.

The saved view and tool responses describe the same canonical revision. Optional React rendering or a custom host renderer consumes these DTOs through host bindings; the owner sees source/review/conflict states, while visitor views expose only permitted facts. Unsupported layout versions produce a safe generic rendering with a visible limitation. No host needs React to use the engine.

## Host file limits are outside this API

Youbot currently limits PDF intake to **10 MiB, 250 pages, 1,000,000 extracted UTF-16 code units and 2,000 segments**. The engine itself receives only extracted data and enforces its own defaults, including a **2,000,000-byte** serialized batch ceiling. These are initial guardrails, not benchmark-certified capacity. A [retained local benchmark](evidence/pdf-limit-benchmark-20260914.md) measured 24 real-parser calls over synthetic property/class/generic and 1–251-page fixtures; 250 pages passed and 251 pages rejected in all repetitions. The parser currently has no explicit runtime deadline; page/character rejection occurs after text extraction. See [host limit rationale and evidence](architecture.md#host-pdf-limits-implementation-rationale-and-evidence) for enforcement points, redundant segment/page bounds, tests, local timing/process-memory observations and the still-uncompleted broad representative-corpus evaluation. The repository's 10-second lock wait is not a PDF timeout.

## Version and portability acceptance

Version package exports with semver and tool/schema/view/receipt contracts explicitly. Reject unknown major versions; test supported old data snapshots/tool fixtures and migration/rollback. Feature capability reporting identifies unavailable typed/text-search capabilities; unsupported capabilities never silently degrade into a completeness claim.

S13 owns neutral schema/metadata/dispatcher conformance and host normalization fixtures; the source status above must be rechecked after repairs. S14 must install packed the core tarball with its bundled JSON repository in an external framework-free consumer, use only public exports, supply two isolated entities and restart persisted data. Exercise at least two provider protocol fixtures, crude text/record ingestion, policy revocation, malformed tool arguments, a duplicate request and an unsupported version. The second consumer supplies already-extracted input without file, parser, worker or extraction callbacks. Inspect dependency graph/package contents for Youbot/React/provider SDK imports, secrets and cwd assumptions. This proves reusable packaging and contract behavior; it is separate from real-provider accuracy and production evidence.
