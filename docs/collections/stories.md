# Conversational collections implementation stories

Baseline: [specification revision 3](../../.factory/product/specs/conversational-collections.md), draft. The user explicitly excluded file importing and parsing from the reusable package. No implementation is dispatched.

The engine ingests already-extracted crude text, segments or records, then supports LLM-driven organization through validated tools. Youbot owns external file libraries, originals, upload/parse jobs and its LLM loop. Core owns canonical state, revisions, supplied-data provenance, publication, retrieval and declarative views.

## Acceptance continuity

Existing Spacecrew work IDs and native acceptance arrays remain immutable. Native PDF/import job criteria describe Youbot host behavior, never new package responsibilities. `revision2Acceptance` in the manifest is retained as historical data and is superseded by `revision3Acceptance`; obsolete parser/blob/extraction-runner package requirements are not current gates. The current supplements below and canonical revision 3 govern implementation. S14 verifies every story and all 32 current requirements. Prior review/validation files are historical revision-1/2 evidence and do not verify this revision.

Factory owns acceptance and the [manifest](story-manifest.json); Spacecrew stores assignments and handoffs linking those originals.

<a id="cc-s01"></a>
## CC-S01 — Define raw-data package contracts and host boundaries

**Assigned specialist:** `collections_architect` · **Role:** `architect` · assigned, not dispatched.

**Requirements:** CC-02, CC-03, CC-04, CC-06, CC-10, CC-18, CC-21, CC-22, CC-25, CC-26, CC-27, CC-28, CC-29, CC-30, CC-31 · **Dependencies:** exact product approval before implementation.

**Original native acceptance (preserved; host file-processing scope applies):**

- Record schema/transaction, authenticated entity scope, published-snapshot, source revision, typed query and generation-aware dispatch contracts with failure semantics.
- Evaluate current DatabaseConnection transaction gap and pdf-parse TextResult contract; select documented input page/byte/runtime limits against a representative corpus without silently reducing product scope.
- Record provider credential reuse/configuration decision through the existing authorized provider boundary; no new credentials or provider calls are assumed approved.

**Current revision-3 acceptance:**

- Define bounded raw text, segments and record batch contracts with provenance, upstream completeness, idempotency and explicit resource limits.
- The core exposes no file importer, ParserPort, BlobPort, PDF/OCR dependency, file-processing job runner or required ExtractionPort; hosts own those operations and their LLM loops.

**File boundaries:**

- `docs/collections/architecture.md`
- `docs/collections/implementation-plan.md`
- `docs/collections/engine-api.md`
- `packages/collection-engine/ (proposed public contracts)`
- `youbot-core/src/concierge/collections/ (first-host adapter only)`

**Next action:** Review specification revision 3 and current revision3Acceptance; after recorded product approval and dependency evidence, implement the assigned scope. Assignment only; no implementation dispatched.

<a id="cc-s02"></a>
## CC-S02 — Persist supplied data, typed collections and revisions

**Assigned specialist:** `collections_backend` · **Role:** `engineer` · assigned, not dispatched.

**Requirements:** CC-02, CC-03, CC-04, CC-10, CC-21, CC-25, CC-27, CC-28, CC-31 · **Dependencies:** CC-S01.

**Original native acceptance (preserved; host file-processing scope applies):**

- Store entity-owned collections/items, typed attributes, parent-child relationships, provenance references, revision history and separate published snapshots with migrations.
- Use atomic checked writes; concurrent edits reject a stale expected revision without losing either the committed change or submitted proposal.
- Restart and rebuild derived state without losing canonical records; reject cross-entity references and unsupported temporal conversions.

**Current revision-3 acceptance:**

- Store immutable supplied-data revisions and provenance with transactional ingestion receipts, canonical items and publication revisions.
- Persist no original binary through the engine; upstream references are opaque metadata and never authority to read paths, fetch URLs or access host files.

**File boundaries:**

- `packages/collection-engine/src/ (state, ports and checked operations)`
- `packages/collection-engine-sqlite/ (proposed optional persistent adapter)`
- `youbot-core/src/data/database/`
- `youbot-core/src/concierge/collections/ (storage adapter wiring)`

**Next action:** Review specification revision 3 and current revision3Acceptance; after recorded product approval and dependency evidence, implement the assigned scope. Assignment only; no implementation dispatched.

<a id="cc-s03"></a>
## CC-S03 — Separate host file processing from engine raw-data ingestion

**Assigned specialist:** `collections_import` · **Role:** `engineer` · assigned, not dispatched.

**Requirements:** CC-02, CC-05, CC-06, CC-07, CC-21, CC-22, CC-25, CC-27, CC-28, CC-29 · **Dependencies:** CC-S01, CC-S02.

**Original native acceptance (preserved; host file-processing scope applies):**

- Accept owner text and supported PDFs into private versioned sources with validated configured limits and progress/coverage/terminal status.
- A real text-PDF roundtrip reads pdf-parse v2 TextResult.text/pages/total correctly and proves page/source text preservation; no String(object) or silent 100,000-character cutoff counts as success.
- Retry interruption using durable checkpoints/leases/idempotency without duplicate sources; empty, encrypted, scanned-only, malformed, over-limit and partial inputs report honest recoverable outcomes.

**Current revision-3 acceptance:**

- Youbot alone uses external libraries for file upload, private original storage, PDF parsing, file-processing limits, progress, cancellation and retry.
- The package accepts already-extracted crude text/segments/records through bounded idempotent ingestion; validates payload and supplied provenance, reports accepted/rejected data, and preserves upstream partial/unknown coverage without claiming document completeness.
- Verify host PDF handling separately from engine tests; core ingestion works with a literal raw-text payload and no parser, file store, model SDK or background worker installed.

**File boundaries:**

- `packages/collection-engine/src/ (raw-data ingestion and receipts only)`
- `youbot-core/src/concierge/collections/ (host upload/parser/library orchestration only)`

**Next action:** Review specification revision 3 and current revision3Acceptance; after recorded product approval and dependency evidence, implement the assigned scope. Assignment only; no implementation dispatched.

<a id="cc-s04"></a>
## CC-S04 — Organize supplied data through validated LLM proposals

**Assigned specialist:** `collections_import` · **Role:** `engineer` · assigned, not dispatched.

**Requirements:** CC-03, CC-04, CC-05, CC-07, CC-08, CC-09, CC-22, CC-25, CC-28, CC-29, CC-30 · **Dependencies:** CC-S02, CC-S03.

**Original native acceptance (preserved; host file-processing scope applies):**

- Produce draft properties, classes/sessions or generic items with material fact provenance, explicit unknown values and source coverage.
- Reimport matches strong identifiers to stable items, surfaces ambiguous merges and critical-field uncertainty, preserves manual corrections, and never infers deletion or availability from absence.
- Validated model proposals cannot run instructions found in a source, mutate live data directly, or invent recurrence/currency/basis; partial outcomes remain reviewable.

**Current revision-3 acceptance:**

- Host LLM uses supplied raw-data references and public tools to propose typed collections/items; engine validates candidate shapes, evidence and schema versions before reconciliation.
- No core extraction runner or mandatory model callback; preserve unknown facts, stable identities, owner corrections and ambiguous merge review, and never infer deletions from an incomplete resubmission.

**File boundaries:**

- `packages/collection-engine/src/ (proposal validation and reconciliation)`
- `youbot-core/src/concierge/collections/ (host LLM conversation and semantic organization)`

**Next action:** Review specification revision 3 and current revision3Acceptance; after recorded product approval and dependency evidence, implement the assigned scope. Assignment only; no implementation dispatched.

<a id="cc-s05"></a>
## CC-S05 — Apply owner changes, publication and freshness safely

**Assigned specialist:** `collections_backend` · **Role:** `engineer` · assigned, not dispatched.

**Requirements:** CC-02, CC-08, CC-09, CC-10, CC-11, CC-12, CC-13, CC-21, CC-25, CC-26, CC-27, CC-29, CC-31 · **Dependencies:** CC-S02, CC-S04.

**Original native acceptance (preserved; host file-processing scope applies):**

- Bounded owner operations support draft corrections, change history, checked undo, explicit reviewed publication, unpublish/archive and owner-set valid-through dates.
- Ambiguous conversational changes request focused clarification; explicit publication of a selected eligible batch does not publish blocked or private fields.
- Working edits preserve previous published snapshots; withdrawal invalidates visitor eligibility immediately and concurrent expected-revision conflicts preserve proposals.

**Current revision-3 acceptance:**

- All direct and tool operations share trusted-context policy, expected revisions, idempotency and typed errors.
- Ingestion and semantic proposals cannot publish implicitly; apply, publish, archive, unpublish and undo retain checked revision/intent boundaries.

**File boundaries:**

- `packages/collection-engine/src/ (operations/policy/publication/history)`
- `youbot-core/src/concierge/collections/ (trusted host operation binding)`
- `youbot-core/src/api/routes/concierge.ts`

**Next action:** Review specification revision 3 and current revision3Acceptance; after recorded product approval and dependency evidence, implement the assigned scope. Assignment only; no implementation dispatched.

<a id="cc-s06"></a>
## CC-S06 — Design host authoring and portable collection views

**Assigned specialist:** `collections_designer` · **Role:** `designer` · assigned, not dispatched.

**Requirements:** CC-01, CC-05, CC-09, CC-11, CC-13, CC-14, CC-15, CC-20, CC-30 · **Dependencies:** CC-S01.

**Original native acceptance (preserved; host file-processing scope applies):**

- Prepare reviewable desktop/narrow layouts inside Your concierge: content conversation, property gallery, class agenda, generic cards, item detail, source inspector, change review and visitor preview.
- Cover empty/loading/partial/error/conflict, draft/published/unavailable/outdated/needs-review states, keyboard focus, direct edits and supported layout alternatives without a CRM grid.
- Record human visual approval of the exact reviewed design before UI implementation, preserving the existing concierge navigation and no-general-chat boundary.

**Current revision-3 acceptance:**

- Keep declarative allowlisted view descriptions in core and rendering optional; show source-data coverage separately from host file-processing status.
- Original-file preview and download use authorized host UI routes, never a core file-access tool.

**File boundaries:**

- `docs/collections/ (exact visual design artifact)`
- `packages/collection-engine/ (presentation descriptor contract context)`
- `youbot-core/web-ui/app/concierge/page.tsx`
- `youbot-core/web-ui/components/ (existing design system context)`

**Next action:** Review specification revision 3 and current revision3Acceptance; after recorded product approval and dependency evidence, implement the assigned scope. Assignment only; no implementation dispatched.

<a id="cc-s07"></a>
## CC-S07 — Build host collection views from public engine data

**Assigned specialist:** `collections_frontend` · **Role:** `engineer` · assigned, not dispatched.

**Requirements:** CC-01, CC-05, CC-11, CC-12, CC-13, CC-14, CC-15, CC-25, CC-30 · **Dependencies:** CC-S05, CC-S06.

**Original native acceptance (preserved; host file-processing scope applies):**

- Render saved allowlisted gallery/agenda/card layouts and safe fallback details from canonical data, preserving layout choice after restart without new generation calls.
- Owners inspect source provenance and status, directly correct a field, resolve/review changes and publish selected eligible items through the shared checked backend.
- Implement approved responsive/accessibility and honest state designs, with no exposure of original sources or owner controls to visitor contexts.

**Current revision-3 acceptance:**

- Consume engine descriptors/results for cards, galleries, agendas and direct edits; React and Youbot dependencies remain outside core.
- Show supplied segment/record evidence in core review and resolve any original document link through separately authorized host code.

**File boundaries:**

- `youbot-core/web-ui/app/concierge/page.tsx`
- `youbot-core/web-ui/components/collections/ (first-host views)`
- `youbot-core/web-ui/lib/concierge.ts`
- `packages/collection-engine-react/ (optional companion only if justified)`

**Next action:** Review specification revision 3 and current revision3Acceptance; after recorded product approval and dependency evidence, implement the assigned scope. Assignment only; no implementation dispatched.

<a id="cc-s08"></a>
## CC-S08 — Connect host uploads and conversation to ingestion tools

**Assigned specialist:** `collections_frontend` · **Role:** `engineer` · assigned, not dispatched.

**Requirements:** CC-01, CC-06, CC-07, CC-08, CC-09, CC-10, CC-15, CC-22, CC-26, CC-27, CC-29, CC-30 · **Dependencies:** CC-S05, CC-S06, CC-S07, CC-S13.

**Original native acceptance (preserved; host file-processing scope applies):**

- Provide text/PDF authoring within Collections that shows durable job progress, draft proposals, focused clarifications and saved change results reflected in the adjacent canonical view.
- Retry failed/partial processing without duplicate imports; preserve drafts on conflicts and show concrete changes rather than claiming upload means complete import.
- Keep this conversation scoped to maintaining content and preserve existing general-chat exclusion and inbox operation.

**Current revision-3 acceptance:**

- Youbot coordinates upload/parsing with external libraries and reports their progress; only extracted data/provenance crosses the engine ingestion boundary.
- Youbot owns the LLM conversation and passes trusted context separately; use engine ingest/propose/apply results for saved readback and never claim parse/upload completion is canonical organization or publication.

**File boundaries:**

- `youbot-core/web-ui/components/collections/`
- `youbot-core/web-ui/app/concierge/page.tsx`
- `youbot-core/web-ui/lib/concierge.ts`
- `youbot-core/src/concierge/collections/ (owner model-loop/tool binding)`

**Next action:** Review specification revision 3 and current revision3Acceptance; after recorded product approval and dependency evidence, implement the assigned scope. Assignment only; no implementation dispatched.

<a id="cc-s09"></a>
## CC-S09 — Query canonical content and validate response evidence

**Assigned specialist:** `collections_retrieval` · **Role:** `engineer` · assigned, not dispatched.

**Requirements:** CC-02, CC-13, CC-16, CC-17, CC-18, CC-21, CC-22, CC-25, CC-27, CC-28, CC-29, CC-31 · **Dependencies:** CC-S02, CC-S05.

**Original native acceptance (preserved; host file-processing scope applies):**

- Provide validated typed filters/counts/order/pagination for prices/units/bedrooms and explicit dated sessions, excluding unknown/incompatible/expired facts from current exact claims.
- Combine descriptive retrieval with exact constraints and per-item current revision/projection checks; distinguish bounded ranked selections from exhaustive results.
- Rebuild delayed derived indexes safely, recheck permission/publication/freshness in canonical storage, and degrade honestly when complete retrieval is unavailable.

**Current revision-3 acceptance:**

- Structured predicates, counts, search and evidence eligibility use reviewed canonical content and supplied-data provenance; no source URL fetching or PDF processing during search.

**File boundaries:**

- `packages/collection-engine/src/retrieval/`
- `packages/collection-engine/src/ports/ (query/index adapters)`
- `youbot-core/src/concierge/collections/ (query adapter wiring)`

**Next action:** Review specification revision 3 and current revision3Acceptance; after recorded product approval and dependency evidence, implement the assigned scope. Assignment only; no implementation dispatched.

<a id="cc-s10"></a>
## CC-S10 — Bind visitor and preview flows to engine tools

**Assigned specialist:** `collections_retrieval` · **Role:** `engineer` · assigned, not dispatched.

**Requirements:** CC-05, CC-17, CC-18, CC-19, CC-20, CC-22, CC-26, CC-27, CC-29, CC-30 · **Dependencies:** CC-S09, CC-S07, CC-S13.

**Original native acceptance (preserved; host file-processing scope applies):**

- Use bounded read-only collection retrieval through supported existing concierge channel routes and the owner preview, identifying supporting permitted published item revisions.
- Respect answerFromKnowledge, takeover and existing approval/financial/booking boundaries; source or visitor instructions cannot gain owner tool access.
- Invalidate/recheck already-loaded context and pending dispatch on publication generation changes; owner preview is labeled and sends no message or mutation.

**Current revision-3 acceptance:**

- Host owns visitor identity, LLM loop, preview and channel dispatch; visitors cannot access raw private payloads or host originals through forged tool arguments.

**File boundaries:**

- `youbot-core/src/concierge/collections/ (visitor/preview tool adapter)`
- `youbot-core/src/concierge/profile.ts`
- `youbot-core/src/engine/handler.ts`
- `youbot-core/src/engine/prompt-builder/`
- `youbot-core/src/channels/`
- `youbot-core/web-ui/components/collections/`

**Next action:** Review specification revision 3 and current revision3Acceptance; after recorded product approval and dependency evidence, implement the assigned scope. Assignment only; no implementation dispatched.

<a id="cc-s11"></a>
## CC-S11 — Verify first-host pipeline and engine lifecycle separately

**Assigned specialist:** `collections_quality` · **Role:** `reviewer` · assigned, not dispatched.

**Requirements:** CC-01, CC-02, CC-03, CC-04, CC-05, CC-06, CC-07, CC-08, CC-09, CC-10, CC-11, CC-12, CC-13, CC-14, CC-15, CC-16, CC-17, CC-18, CC-19, CC-20, CC-21, CC-22, CC-23, CC-25, CC-26, CC-27, CC-28, CC-29, CC-30, CC-31 · **Dependencies:** CC-S08, CC-S10, CC-S13.

**Original native acceptance (preserved; host file-processing scope applies):**

- Run the versioned corpus and two-entity owner/visitor lifecycle on the exact implementation revision; record per-requirement outcomes and independent reviewer identity.
- Measure extraction coverage, duplicates and critical-field accuracy with source references; include partial/malicious inputs, conflicting updates, stale context/index/dispatch and restart/recovery.
- Keep source/unit/browser/persisted/transport/provider evidence distinct; failures and unrun checks remain open and block relevant readiness claims.

**Current revision-3 acceptance:**

- Provide separate host PDF-pipeline evidence and engine raw-payload/proposal evidence, plus their end-to-end boundary handoff.
- Verify every current story supplement and canonical criterion, preserving lifecycle, isolation, authorization and freshness coverage.

**File boundaries:**

- `docs/collections/verification-plan.md`
- `docs/collections/evidence/ (future revision-2 execution reports)`
- `packages/collection-engine/ (conformance/contract/security tests)`
- `youbot-core/src/concierge/collections/ (first-host integration tests)`
- `youbot-core/web-ui/`

**Next action:** Review specification revision 3 and current revision3Acceptance; after recorded product approval and dependency evidence, implement the assigned scope. Assignment only; no implementation dispatched.

<a id="cc-s12"></a>
## CC-S12 — Prepare package artifacts and host handoff evidence

**Assigned specialist:** `collections_release` · **Role:** `release` · assigned, not dispatched.

**Requirements:** CC-06, CC-13, CC-21, CC-23, CC-24, CC-25, CC-28, CC-31, CC-32 · **Dependencies:** CC-S11.

**Original native acceptance (preserved; host file-processing scope applies):**

- Update owner guidance for supported imports/limits, corrections, draft/publication, privacy, freshness and recovery using verified product behavior.
- Record built-package migration/persistence/restart and supported clean Mac/Windows installation evidence separately from source and browser checks; preserve explicit gaps.
- Assemble release decision evidence on the independently reviewed exact revision, without deploying, sending real visitor messages or claiming release authorization from task closure.

**Current revision-3 acceptance:**

- Document separately engine payload limits and host file/parser limits; packaged core does not bundle binary parsers, OCR, upload jobs or mandatory LLM dependencies.
- Keep release/registry publication authorization separate from artifact preparation and final S14 verification.

**File boundaries:**

- `README.md`
- `packages/collection-engine/ (README/export/version/packing docs)`
- `packages/collection-engine-sqlite/ (adapter docs)`
- `youbot-core/webchat-relay/website/docs/ (app owner guidance)`
- `scripts/package-release.mjs; scripts/start-desktop.mjs; scripts/start-windows.ps1`
- `docs/collections/evidence/`

**Next action:** Review specification revision 3 and current revision3Acceptance; after recorded product approval and dependency evidence, implement the assigned scope. Assignment only; no implementation dispatched.

<a id="cc-s13"></a>
## CC-S13 — Implement provider-neutral ingestion and collection tools

**Assigned specialist:** `collections_package` · **Role:** `engineer` · assigned, not dispatched.

**Requirements:** CC-25, CC-26, CC-27, CC-28, CC-29, CC-30, CC-31, CC-32 · **Dependencies:** CC-S01, CC-S05, CC-S09.

**Original native acceptance (preserved; host file-processing scope applies):**

- Export documented public engine operations and a versioned serializable tool catalogue with stable names, descriptions, JSON input/output schemas and read/write metadata; validate every dispatcher input and output against its schema, rejecting unknown/invalid arguments before execution (CC-25, CC-26, CC-31).
- Dispatch and direct APIs enforce the same typed revision/idempotency/domain rules and authorize trusted actor/entity/capability/request context supplied separately by the host; forged model context/approval and source path/URL arguments cannot grant access, including visitor invocation of hidden owner tools (CC-26, CC-27).
- Wire documented storage/transaction, blob, job, extraction and policy ports, predictable missing-capability/version errors, cancellation/retry semantics and host-supplied bounded extraction or validated proposal paths; engine executes no hidden provider/network/model call and hosts own credentials, LLM loops and dispatch (CC-28, CC-29, CC-31).
- Keep generic headless operation independent of Youbot, Next.js, React, model SDKs and optional domain/renderer adapters; implement the independent packed-package consumer fixtures and provide Youbot owner/visitor binding examples using public contracts, with preliminary external packed-consumer smoke without workspace source links (CC-25, CC-30, CC-32).

**Current revision-3 acceptance:**

- Expose the revision-3 catalogue and schema-validated executor through public exports; host protocol adapters normalize tool calls without granting argument-supplied authority.
- Packed-consumer fixtures feed crude text/segments/records directly, organize through proposal tools, and require no PDF parser, file storage or extraction callback.

**File boundaries:**

- `packages/collection-engine/src/tools/ (catalogue/dispatcher)`
- `packages/collection-engine/src/index.ts (public exports)`
- `packages/collection-engine/ (schema/conformance/security tests)`
- `youbot-core/src/concierge/collections/ (host tool bindings)`
- `examples/collection-engine-consumer/ (proposed independent fixture)`

**Next action:** Review specification revision 3 and current revision3Acceptance; after recorded product approval and dependency evidence, implement the assigned scope. Assignment only; no implementation dispatched.

<a id="cc-s14"></a>
## CC-S14 — Verify final package reuse and revision-3 requirements

**Assigned specialist:** `collections_quality` · **Role:** `reviewer` · assigned, not dispatched.

**Requirements:** CC-01, CC-02, CC-03, CC-04, CC-05, CC-06, CC-07, CC-08, CC-09, CC-10, CC-11, CC-12, CC-13, CC-14, CC-15, CC-16, CC-17, CC-18, CC-19, CC-20, CC-21, CC-22, CC-23, CC-24, CC-25, CC-26, CC-27, CC-28, CC-29, CC-30, CC-31, CC-32 · **Dependencies:** CC-S12, CC-S13.

**Original native acceptance (preserved; host file-processing scope applies):**

- Independently verify all original CC-S01 through CC-S12 acceptance, every mandatory revision2Acceptance supplement, CC-S13 acceptance and all CC-01 through CC-32 on the exact delivered revision; no original-story closure or revision-1 evidence substitutes for this aggregate revision-2 gate.
- Install hashed packed engine and explicit adapter artifacts in a clean temporary independent second consumer with no workspace symlinks/private source imports/Youbot configuration, browser, React/Next.js, model SDK or provider credentials; exercise create/import/propose/review/publish/search/update/restart and owner/visitor denial using only public exports (CC-25, CC-30, CC-32).
- Roundtrip every advertised tool schema/catalogue and check dispatcher/direct-API equivalence, unknown/invalid argument rejection, trusted context separation, spoofed authority/approval rejection and unauthorized source handle/path/URL denial (CC-26, CC-27).
- Run replaceable storage/transaction/blob/job/extraction port conformance and real persistent-adapter recovery, missing-capability/version/cancellation/retry errors, host extraction/proposal equivalence, and absent-provider/no-hidden-call checks; verify public revision/freshness APIs support dispatch invalidation (CC-28, CC-29, CC-31).
- Inspect packed dependency/export graphs and optional domain/renderer absence; document tool/API/persisted version compatibility and migration proof, exact artifact hashes, independent reviewer identity and per-requirement evidence. Distinguish deterministic second-host fixtures, real provider extraction, built Youbot installation and any separately authorized live channel evidence; unresolved failures block aggregate readiness and no registry/release publication is implied (CC-24, CC-25, CC-30, CC-31, CC-32).

**Current revision-3 acceptance:**

- Install built tarballs outside the repository in a framework-free second consumer and verify raw-data ingestion, semantic proposals, review/apply/publish/search/update/restart and owner/visitor denial.
- Verify all 32 current requirements and all current revision3Acceptance supplements, with original immutable acceptance interpreted at its host or engine boundary.
- Inspect dependency and runtime behavior: no package binary parsing, file imports, OCR, file-job runner or mandatory model callback; provider-protocol fixtures remain distinct from live-model accuracy evidence.

**File boundaries:**

- `docs/collections/verification-plan.md`
- `docs/collections/evidence/ (future independent revision-2 package report)`
- `examples/collection-engine-consumer/ (proposed second host)`
- `packages/collection-engine/ (packed artifact)`
- `packages/collection-engine-sqlite/ (explicit persistent adapter)`

**Next action:** Review specification revision 3 and current revision3Acceptance; after recorded product approval and dependency evidence, implement the assigned scope. Assignment only; no implementation dispatched.
