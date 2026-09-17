# Reusable collection engine architecture

Date: 2026-09-14. Status: proposed technical design; exact product specification and UI approval remain pending. No collection functionality is implemented by this document. Factory owns canonical specifications and documentation; Spacecrew assignments reference these originals.

Source exploration: [research](../conversational-collections-research.md). Delivery sequence: [implementation plan](implementation-plan.md). Public integration contract: [engine API and tool catalogue](engine-api.md). Canonical product contract: [conversational-collections revision 3](../../.factory/product/specs/conversational-collections.md). Product acceptance and story IDs are owned by that specification. The Factory approval record governs the exact specification decision; this document grants no design, release or registry-publication approval.

## Decision and boundaries

Build a headless TypeScript ESM package at `packages/collection-engine` for multiple projects and LLM orchestrators. Youbot is its first host, providing a dedicated owner content conversation and a saved visual view. The package ingests crude text, segments or records already obtained by the host. Files, PDF/OCR processing, external parser integrations and host LLM orchestration are outside its boundary. Imports must not depend on Youbot authentication/configuration, database singletons, a model/parser SDK, React, Next.js, filesystem layout, channels or process-global state. New credentials, hosted parsing, OCR, vector infrastructure, arbitrary generated application code, booking execution, live stock and shared hosted deployment remain outside the initial slice.

The core owns typed canonical content, scope enforcement, validation, revisions, audited state transitions, reconciliation, publication, query semantics and declarative view validation. Hosts own authentication, policy decisions, exact user intent, file/extraction pipelines, LLM/provider orchestration and credentials, storage provisioning, upstream scheduling, transport, rendering and outbound messages. The core accepts bounded raw-data batches and model-proposed operations; it does not run import/extraction jobs. A host-injected policy port reauthorizes each operation; passing an audience enum or filtering advertised tools does not authorize execution.

| Package/boundary | Responsibility |
| --- | --- |
| `packages/collection-engine` | Headless state/service layer, types/runtime schemas, provider-neutral tools/executor, idempotent raw-data ingestion, conformance fixtures. No network listener or automatic worker loop on import. |
| Bundled repository adapters | `packages/collection-engine/src/repository.ts` exports in-memory and JSON-file repositories. Youbot currently uses the JSON-file adapter; no SQLite collection adapter/package is delivered. |
| Future optional adapters/renderers | A SQLite implementation of `RepositoryPort` or separate React companion may be added later. Neither is a delivered package; current Youbot renders the public DTOs directly. |
| Host adapters | Trusted context, policy authorization, storage provisioning and provider-envelope normalization. File/parsing/model pipelines are external host features, not engine ports. An optional MCP adapter exposes the same executor; no required daemon. |
| Youbot adapter | `youbot-core/src/concierge/collections/` constructs the engine and binds public APIs to current auth, provider, API, tools, concierge policy and channels. Domain logic remains in the package. |

Input flow is explicit: the host imports files or obtains text/records; its own tools parse/extract as needed; it calls engine ingestion with the crude results; its LLM uses the engine's proposal/apply/search/view tools to organize and maintain those results. No injected extraction callback, parser adapter or blob storage is required by the package.

Youbot implements text and clean text-PDF intake in its host service and routes, with explicit extraction coverage reporting; the numerical bounds and evidence limits are documented below. The reusable engine itself receives only already-supplied text/segments/records. Properties and classes exercise contrasting schemas; unfamiliar content uses general cards and typed fields. Class dated sessions must be explicit; unsupported recurrence remains unresolved source text. Neither engine nor gallery rendering implies automatic photo extraction, matched images or live seats.

Property/class presets are optional versioned schema/view data, not mandatory domain branches in the core. A second project can use only generic typed collections without importing Youbot's vocabulary, prompt or visual assets. Supported schema capabilities constrain all domains equally; arbitrary new executable validators or runtime plugins supplied by source text are not permitted.

Three representations have distinct authority:

1. Immutable supplied-source revisions preserve raw text/records and attributed host provenance. Original file bytes, extraction and private-original access remain host-owned.
2. Canonical collection and item revisions hold validated facts, review state and publication pointers.
3. View definitions and search projections derive from canonical revisions. Rebuilding them must not change content or publication.

## Inspected integration boundaries

These are source observations, not installed-package or production evidence.

| Existing boundary | Observation and integration boundary |
| --- | --- |
| `youbot-core/src/concierge/profile.ts` | Validates up to 30 notes and 30,000 total content characters; embeds enabled notes in visitor instructions. Preserve notes and all knowledge/price/booking preferences. Collections are a separate persisted content source. |
| `youbot-core/src/api/routes/concierge.ts` | Owner concierge API and revision checks already exist. Add a dedicated collection route using equivalent owner authorization, without extending every existing route. |
| `youbot-core/src/api/routes/chat.ts` | Saves uploads and uses `pdf-parse`; extracted text is truncated at 100,000 characters. Reuse parsing knowledge, not the truncated prompt attachment as an authoritative import. The installed parser returns structured text/pages, so prove the new adapter reads `result.text` and `result.pages` with a real PDF; do not assume stringifying its result extracts text. Any original-file download and its authorization remain host-owned; the engine exposes only already-supplied text/record evidence. |
| `youbot-core/src/data/database/types.ts` | Existing Youbot SQL connection API is not the collection repository. The collection host service constructs the bundled JSON-file repository; no SQL transaction adapter is delivered. |
| `youbot-core/src/data/database/sqlite.ts` | Existing Youbot data uses SQLite with WAL/foreign keys/busy timeout. Those properties must not be attributed to collection persistence, which uses its separate JSON file. |
| `youbot-core/src/data/database/connection.ts` | Current factory returns SQLite, despite a Supabase option in configuration types. A type declaration does not establish hosted backend support. |
| `youbot-core/src/api/job-store.ts` | Tracks asynchronous jobs/results, including read-modify-write event updates; it does not establish leases, checkpoints or resumable import work. Any future durable file/extraction work is a host concern; the engine uses atomic raw-input batches and must not depend on this job store. |
| `youbot-core/src/engine/tools.ts`, `src/engine/orchestrator.ts` | Owner/visitor tool selection and repeated visitor-safe execution checks exist. Register bounded collection reads through both selection and execution enforcement. Owner content authoring gets an explicit restricted tool context. |
| `youbot-core/src/engine/handler.ts`, `src/concierge/store.ts` | Incoming visitor handling and inbox revision checks protect takeover and dispatch. Extend the dispatch eligibility check with content generation; retain existing inbox checks. |
| `youbot-core/web-ui/app/concierge/page.tsx`, `web-ui/lib/concierge.ts` | Agent settings include Knowledge notes and an owner API helper. Link collection management from Knowledge; preserve the current concierge/inbox organization. |
| `youbot-core/web-ui/components/ui/*`, `web-ui/components/app-sidebar.tsx` | Reuse established components and navigation. Do not edit generated `youbot-core/web/` output directly. |

The delivered core implementation is in [engine.ts](../../packages/collection-engine/src/engine.ts), with [types](../../packages/collection-engine/src/types.ts), [schemas](../../packages/collection-engine/src/schemas.ts), [repositories](../../packages/collection-engine/src/repository.ts), public exports and conformance helpers. Youbot constructs it in [service.ts](../../youbot-core/src/concierge/collections/service.ts); its routes, file pipeline and UI remain host code. A future module split or SQLite adapter is a design option, not current package evidence.

## Canonical data contract

Use stable opaque IDs issued through an injected ID service. An item retains its ID through rename, correction, archive and reimport. Entity/actor scope comes from host-created trusted `ExecutionContext`, never model arguments. In Youbot's single-workspace runtime, persist a real workspace entity ID; do not use a caller-supplied tenant ID or assume an all-zero owner identifier is a tenant boundary. The same scope invariant applies to every consumer.

The current JSON state groups data under `entities[entityId]`; nested collections, sources, ingests, evidence and idempotency records inherit that scope. Collection state contains working items, separate published item snapshots, revision/publication counters, proposals, changes and saved view data. There are no collection SQL rows or per-entity SQL tables. Preserve these scope and working-versus-published boundaries when implementing future repository adapters. Richer immutable schema/view history remains a target to verify against story acceptance, not a consequence of JSON storage alone.

Recommended persistence groups:

| Group | Essential fields/behavior |
| --- | --- |
| Collections and schemas | Collection ID, entity ID, name, domain hint, schema revision, working revision, published snapshot ID, content generation. Stable field IDs with human labels. |
| Items and revisions | Item ID, collection ID, monotonically increasing revision, typed values, explicit business status, archived flag, field evidence references, source/update timestamps, optional owner-set valid-through time and actor/time metadata. |
| Supplied sources and revisions | Engine-issued source/revision IDs, raw text or crude records, digest, segment/record IDs, opaque external source reference, supplied locators and explicitly attributed upstream completeness. No original bytes, storage keys or parser implementation. |
| Ingest receipts and proposals | Immutable raw-data batch receipt, request fingerprint, received counts/manifest validation, source revisions, expected collection revision, candidate changes and unresolved issues. No engine file-processing job or worker state. |
| Changes and publication | Change ID, actor, request fingerprint, expected/base revisions, before/after references, publication snapshot, content generation and reversible inverse metadata. |
| Derived search/view state | Projection generation, item revision and typed query projections; view contract version and validated field mappings. |

JSON is the persistence format, while `FieldDefinition`/`FieldValue` validation and the engine query implementation provide the logical typed model. Current predicates/search traverse canonical state; no SQL field-value projection, FTS table or separately maintained text index is delivered. Future database adapters must preserve precise query and atomic revision semantics rather than exposing unvalidated JSON as query authority.

The exact delivered field shapes are exported from [types.ts](../../packages/collection-engine/src/types.ts); consumers should use those exports and advertised tool schemas, not copy an earlier proposed union. Precision, valid calendar dates, reference integrity and compatible currency/unit comparisons remain contract requirements. The independent review found gaps in the reviewed artifact; fixes require new exact-source tests before claiming those requirements met. No SQL numeric behavior is implied by the JSON adapter.

Stable field IDs outlive label changes. Adding an optional field is a new schema revision; renaming a label retains its ID. Type/unit/cardinality changes create an explicit migration proposal, with old published revisions still readable by their original schema. Reject unsupported schema versions and give a safe read-only view; never coerce old records silently. V1 item relationships may link courses to sessions or buildings to units, but should avoid a general graph editor or arbitrary cyclic schema generation.

## Invariants and state transitions

- Every read, supplied-source lookup, ingest, mutation and undo enforces the server-resolved entity scope. Private supplied source passages and internal review notes never enter visitor results by default; original-file permissions are the host responsibility.
- Draft/review/publication state is distinct from available/unavailable/unknown business status. Being published does not mean available.
- Optional valid-through times use a validated instant/timezone contract; no expiry default is invented. Expired time-sensitive facts cannot support present-tense availability or price claims. Freshness is checked against the clock at retrieval and dispatch even when no revision/generation has changed.
- Every factual field records source revision plus page/segment/quote, or an explicit owner assertion with message ID. A parser confidence score is not proof of correctness.
- Ingestion only saves crude data. Host LLM calls create validated proposals; neither ingestion nor a proposal can publish, change permissions, execute instructions embedded in input or overwrite owner corrections automatically.
- Atomic mutations compare expected revisions, write history, update typed projections and store the idempotency result together. A stale revision returns a conflict with no partial changes.
- Publishing validates an exact reviewed snapshot and changes its pointer and generation atomically. New draft edits leave the previous snapshot visible. Unpublish/archive changes visitor eligibility immediately.
- Archive is an explicit operation with host-verified visible-effect intent, distinct from ordinary draft change application. It atomically archives and withdraws the selected items; a model cannot smuggle archive into a draft correction. Undo restores a working revision without republishing it.
- A host may report incomplete extraction. The engine preserves that claim separately from its own batch receipt and unresolved item issues; saving every received segment does not establish that an unseen original catalogue was fully extracted.
- Undo creates a new inverse revision, retaining history. It requires the expected current revision; conflicting later edits require review. Undoing a draft does not silently republish earlier content.

Owner-authorized reversible draft changes may be saved through chat or direct controls without redundant confirmations. The backend requires a concrete structured change proposal and expected revision. Publication is an explicit owner action over the exact reviewed content; the approved interaction design must make the target revision and selected eligible items reviewable. Assistant assertions never substitute for saved readback.

## Atomicity, concurrency and process boundaries

The delivered `RepositoryPort` exposes scoped state readers and `transact` callbacks plus `atomic-state`, `durable-restart` and `idempotency` capability labels. `createMemoryCollectionRepository` serializes callbacks and clones state for tests. `createJsonFileCollectionRepository({ filePath })` is the supplied persistent implementation used by Youbot: it serializes local writers, acquires a sibling lock directory, reloads current state, writes a private temporary file and renames it over the state file. Repository callbacks do not use Youbot's database singleton.

The JSON adapter waits up to 10 seconds for its lock, polling every 10 milliseconds. A killed writer may leave `<filePath>.lock`; remove it only after confirming that no writer is active, as documented in the [package README](../../packages/collection-engine/README.md). It depends on reliable atomic filesystem `mkdir`/`rename`; it does not establish distributed-filesystem, power-loss, fsync durability or automatic stale-lock recovery guarantees. Full-state JSON serialization also lacks a demonstrated large-catalogue throughput bound. The 10-second lock wait is unrelated to PDF parsing runtime.

A future SQLite/other transactional database adapter can satisfy `RepositoryPort` for larger or distributed hosts. It must pass the same isolation/idempotency/restart contracts and define migration/recovery behavior; no `packages/collection-engine-sqlite` artifact or `createSQLiteCollectionRepository` export is delivered. Do not retrofit unsupported SQL transactions into current Youbot connections to satisfy an obsolete planning assumption.

Host parsing/model work happens outside engine calls. Applying a resulting proposal uses current authorization and expected canonical revisions in a short transaction. Scoped unique request keys fingerprint validated payloads: exact retries return immutable receipts after current authorization; different payloads conflict. Repository transactions, not process-local mutexes, establish durable atomicity. No engine lease, file-processing queue or background-worker loop is required.

## Raw-data ingestion and reconciliation

The [engine API](engine-api.md) defines two bounded ingestion operations: `collections_ingest` atomically accepts supplied text/segments/records; `collections_ingest_get` reads the saved receipt. These are not asynchronous job start/status calls. Each accepted batch records exactly which crude values were saved, their scope/digest/source locators and the host's upstream completeness statement. Invalid input commits nothing; identical retries do not duplicate data.

1. The host obtains crude data using its own file pipeline, external tool, database read or direct text input. It authenticates the caller and calls the engine with trusted context outside model JSON. No filename, source reference or supplied URL authorizes the engine to fetch a resource.
2. The engine enforces text length, batch bytes, segment/record counts, nesting and declared-manifest consistency, preserves input and issues immutable source/batch references. Host metadata can say complete/partial/unknown; only actual batch acceptance is engine-verified. Full coverage of an original the engine never received cannot be certified.
3. The host LLM reads the supplied crude data and invokes `collections_change_propose` with typed candidates/operations and source references. The engine validates schema versions, field types, cited raw-data spans or record pointers, entity relationships and expected base revisions. It runs deterministic reconciliation without an LLM call.
4. Strong identifiers suggest stable matches; ambiguous names remain review issues. Corrections made by the owner retain precedence until an explicit reviewed replacement. Missing records in a later input do not mean deletion, unavailability or sold-out status.
5. The owner reviews added/changed/unchanged/conflicting candidates, preserved source passages and unresolved/partial upstream coverage. An accepted proposal applies once to a new working revision; publishing requires the separate explicit reviewed action. A restart between ingest and apply retains input without claiming items have been created.

The host owns upstream cancellation, progress, retries, extraction quality and original-file inspection. Engine retries are idempotent request replay, not background task resumption. User-facing state must distinguish host extraction, raw data saved, proposal ready, draft saved and publication. Routine logs contain IDs, counts and safe errors, not private passages or credentials.

## Bounded service and tool contracts

The [engine API](engine-api.md) is the sole catalogue and contract reference. Core tools cover bounded raw-data ingest/read receipts, typed proposals, reads/search, draft application, explicit publish/unpublish, undo, source review and saved views. Provider-neutral JSON Schemas and the executor work through host wrappers that normalize OpenAI, Anthropic, local-model or optional MCP envelopes; the core has no provider-specific protocol dependency.

`executeCollectionTool(engine, context, call)` and direct services run the same policy and validation pipeline. Context is supplied by trusted host code outside model JSON and never spread from tool arguments. Reauthorize every operation/resource: actor, entity, audience, field permissions and action. Publication requires a host-verified exact-target intent receipt, bound to actor/entity/payload/revision. Tool enumeration is advisory, not enforcement. Reauthorize receipt/source reads and every new host-submitted proposal, even when earlier ingestion was allowed. Unknown properties, forged context, arbitrary status and unsupported operators fail closed.

No SQL, arbitrary paths, generic URL fetching or entity/audience overrides appear in model arguments. Owner source inspection is separate from visitor retrieval. Natural-language answer generation and preview belong to the host, using the same current published retrieval/evidence path; the core does not invoke an answer LLM or send messages. A draft simulation cannot count as current visitor behavior.

## Search and answering

Translate supported exact constraints into validated typed predicates. Parameterize values and allowlist field/operator/sort identifiers. Numeric comparisons and counts operate on the typed projection of the current published snapshot, never on an embedding or a capped semantic top-k. Queries for all matching items return exact count plus explicit pagination; do not claim an exhaustive list after truncating results.

Current text retrieval searches canonical values in the engine; there is no FTS5 or vector-service dependency. Exact filtering and text selection operate over the current permitted state. A future SQLite FTS or semantic index is optional and requires capability/conformance and representative-query evidence; it is not a shipped fallback or performance guarantee.

Track current publication/item eligibility in evidence receipts. The delivered implementation reads canonical JSON state; separate typed/text projections are a future option. If text indexing becomes asynchronous, current canonical publication and field eligibility must be checked before model input; an out-of-date index also risks omissions, so provide a current fallback or explicit degraded result rather than claiming completeness. Rehydrate result fields from the current permitted revision, not stale text snippets.

Conversation history can contain earlier prices or now-private content. Collection-backed facts must be revalidated on each relevant answer; obsolete collection tool results must not be reused as factual context. Mark messages/tool evidence with item revision and content generation, and filter/invalidate stale evidence before generation. Preserve `answerFromKnowledge`, `askBeforePrice`, `askBeforeBooking` and all existing safety constraints: catalogued price information does not authorize a financial or booking commitment.

The host must reauthorize the current actor/audience and field policy before dispatch, even if data generation is unchanged, and compare the answer's content generation with the current generation as well as existing inbox takeover/revision state, and re-evaluate expiry against the clock. If eligibility changed, re-retrieve/regenerate or request owner assistance rather than sending stale facts. The local dispatch eligibility critical section must serialize against publication pointer changes without holding a database transaction across slow model generation. Document the boundary: once transport dispatch has started, an already accepted external message cannot be recalled. Test change-before-dispatch separately from post-dispatch edits.

## Persistent constrained visual view

The core stores and validates a versioned `CollectionViewDefinition`; the host or optional React package renders it. It contains a layout enum (`cards`, `gallery`, `agenda` initially), stable field mappings, grouping, sort, visible filter IDs, and allowed detail sections. Runtime validators check every field reference, type and version. AI proposes this JSON; ordinary trusted components render it. No generated HTML/React, eval, unrestricted style strings, network URLs or actions supplied by source text.

Save the accepted definition and use it on subsequent visits without a model call. Schema changes validate view compatibility; missing/unsupported mappings fall back to general cards with an owner-visible repair notice. An agenda requires valid session/timezone data. A gallery can use approved assets or a text presentation when no verified image exists; never invent a property photograph.

The owner's view displays saved item details, draft/published indication, source inspector, unresolved issues, change review and direct editing. Distinguish saving, saved readback, failure, conflict, empty collection and import progress. All critical operations remain keyboard accessible and work on narrow screens. UI labels remain ordinary product language; database schemas and harness state do not belong in visitor flows.

## Rollout and compatibility

Versioned package and adapter migrations, additive tables and a Youbot opt-in collection feature flag preserve existing notes, inbox, channels, owner controls and generic chat contracts. Do not automatically turn old notes or historical chat attachments into published items. Owner-selected migration of content is a later explicit import operation with evidence and review.

Back up the engine database (including supplied raw data) before a migration; the host separately backs up any original-file store; test restore in an isolated workspace. Run versioned migrations atomically and retain old-reader behavior until validation completes. Roll back application exposure by disabling collection routes/tools/navigation and returning to the prior compatible application version; keep additive data rather than destructively dropping it. If a schema change cannot be read by the previous version, use the tested backup/restore procedure and disclose the loss window before any production rollback. Rebuild derived indexes from canonical publication after restore.

Local workspace scope is the initial deployment target. Shared hosted operation additionally needs authenticated tenant routing, scoped storage and downloads, database isolation policies, quotas, host pipeline scheduling, migration coordination, auditing and cross-tenant adversarial tests. None follows automatically from entity IDs or the presence of Supabase dependencies. Do not advertise hosted multitenancy based on this design.

## Host PDF limits: implementation, rationale and evidence

The constants in [pdf-intake.ts](../../youbot-core/src/concierge/collections/pdf-intake.ts) are Youbot host limits. They do not add parsing or file ownership to the reusable engine. These are initial engineering guardrails, not thresholds selected by a completed representative-corpus benchmark. A [local catalogue/PDF-limit benchmark](evidence/pdf-limit-benchmark-20260914.md) now records 24 real-parser runs on synthetic property/class/generic and page-scale fixtures, including 250 accepted pages and 251 rejected pages. It is not a broad customer-corpus benchmark or a historical measurement used to select these exact values. The rationale below explains their engineering role without inventing that evidence.

| Bound | Actual enforcement and rationale | Practical limit of the evidence |
| --- | --- | --- |
| **10 MiB PDF bytes** (`10 * 1024 * 1024`) | Rejects an oversized buffer before parsing; base64 payload length is also bounded before decoding. This bounds admitted source size and decode amplification for local intake. | It does not bound decompressed PDF resources or parser peak memory. The unit test covers one byte above the limit; no workload study establishes 10 MiB as an optimal capacity. |
| **250 pages** | Checks `getText()`'s reported total and rejects a larger result. A simple page ceiling bounds accepted catalogue/page-review volume. | The check runs after `getText()`, so it is not a pre-parse resource safeguard. Three 250-page fixture runs succeeded (median 514.0 ms); all three 251-page runs rejected after comparable work. Dense/customer-corpus threshold performance remains unmeasured. |
| **1,000,000 extracted characters** | Sums normalized page strings and rejects excess instead of silently truncating. This aligns the host ceiling with the engine's default `maxTextLength`. | JavaScript string length counts UTF-16 code units, not UTF-8 bytes or model tokens. The engine separately limits serialized batch size to **2,000,000 bytes**; multibyte text/metadata can hit that limit first. |
| **2,000 segments** | Matches the engine's default maximum segment count, avoiding a host payload that exceeds the downstream segment contract. | Current PDF intake emits one segment per nonempty page, so the 250-page ceiling is tighter and the segment check is defensive/redundant for this parser shape. It is not proof of a 2,000-page capability. |
| **Parsing runtime** | The current function awaits `parser.getText()` and destroys the parser in `finally`. No explicit parse deadline, CPU quota, worker isolation or memory ceiling is implemented here. | The local benchmark observed roughly half-second cold-process parsing and up to 698.7 MiB lifetime process maxRSS for sparse fixtures. These are observations, not a parser resource/latency bound. A deadline/concurrency decision needs representative, dense and adversarial workloads. |

[PDF intake tests](../../youbot-core/src/concierge/collections/__tests__/pdf-intake.test.ts) exercise real page-aware text extraction, a blank-page partial result, empty/scanned-only/encrypted/malformed inputs, invalid base64 and over-byte-limit rejection. They do not provide a full byte/page/character/segment threshold matrix or broad runtime/accuracy corpus. The retained benchmark adds exact 250/251-page and per-domain runtime/process-memory observations, with source hashes and all 24 measurements. The [independent review](implementation-independent-signoff.md) passed S03's tested supported-PDF scope while requesting S01 evidence improvements. The new local measurements address the missing local runtime/page-boundary evidence; they do not establish broad-corpus quality, peak-memory guarantees or independent acceptance closure.

The host must retain upstream coverage as host-reported evidence; accepted engine segments do not certify complete extraction of an original PDF. Any future limit increase or parse timeout needs explicit tests for boundary behavior and usable failure/recovery messages, and a measured host workload. No new limit, timeout or parser behavior is introduced by this documentation change.

### Current PDF runtime decision

The Youbot host now enforces `maxProcessingMs: 30_000` around the `pdf-parse` text operation. Expiry returns recoverable `PDF_TIMEOUT` / HTTP 408, requests parser destruction, and does not wait indefinitely for stalled cleanup. The retained benchmark paragraphs above describe the historical pre-deadline implementation and remain unchanged evidence of that earlier revision.

The focused parser suite now processes a deterministic 36-page, 1,728-row property/class/service catalogue with more than 100,000 extracted characters and complete page coverage. A separate fake-timer test uses parser work and cleanup that never settle; it proves the host returns at the configured deadline and requests cleanup. Thirty seconds leaves substantial headroom over the historical local sparse-parser range of 469.5-633.2 ms. This application deadline does not preempt CPU-bound work, guarantee prompt timer delivery during event-loop starvation, isolate parser memory, or establish broad customer/adversarial corpus capacity.

Any future byte, page, character, segment or deadline change needs explicit boundary tests, usable failure and recovery messages, and measured host workloads. Host-reported coverage remains distinct from engine acceptance; accepted segments do not certify complete extraction from an original PDF.

## Open decisions and verification requirements

The package source declares `@youbot/collection-engine` 0.1.0, Node >=20, ESM/CommonJS entries, tool/view version 1 and persistence schema 1. These source/export declarations do not establish registry publication or clean-machine compatibility. The [API document](engine-api.md) identifies current schema metadata versus outstanding S13 conformance evidence. Remaining S01 evidence includes representative-corpus/runtime behavior; the bounds below are not a substitute for that measurement. S06 must provide a reviewable UI before claiming a custom view has been approved. Provider configuration can be inspected without secrets, but paid inference or new credentials are not authorized by this planning document.

Evidence must include restart and idempotent raw-data retries, ambiguous and repeated entries, interrupted migrations, cross-entity API/tools/supplied-source denial, competing edits, undo conflicts, host-reported partial coverage versus actual batch acceptance, typed comparisons, exhaustive counts/pagination, draft and private-field exclusion, stale history/index/dispatch handling, preview parity and unchanged concierge policy. Measure extraction results against annotated real sample catalogues before making accuracy/cost claims. Layout screenshots prove appearance; only authenticated saved readback and visitor retrieval establish the end-to-end behavior.

## Package and second-host proof

Build and pack the core, including its bundled JSON repository, then install that tarball in a temporary consumer outside this repository. The actual distribution supports ESM and CommonJS; no second SQLite adapter tarball is required or delivered. That framework-free consumer supplies explicit context/policy, already-extracted crude text/records and a fresh JSON state file, performs create/ingest/propose/review/apply/publish/query/revoke/undo/restart through only public exports, and does not import any Youbot or React code. Feed at least two provider-protocol fixtures through host normalization into the same executor, including malformed arguments and forged authority. This proves package independence and adapter contracts; fixtures do not establish live provider compatibility or extraction accuracy.

Semver covers package exports; explicit tool, canonical schema, view and receipt contract versions cover persisted or wire data. Reject unsupported major versions with stable errors. Additive compatible fields are versioned, and migrations preserve old published revisions or provide an explicit tested upgrade path. Importing the package must not read credentials, start workers, connect to a database or infer a workspace from cwd. Persistence, restart and tarball dependency inspection are required in addition to TypeScript builds. The independent consumer needs no files, parser, model callback or background runner to organize supplied data through public tools.
