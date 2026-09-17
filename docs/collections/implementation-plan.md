# Reusable collection engine implementation plan

This plan records the local implementation completed against Factory-approved [conversational-collections revision 3](../../.factory/product/specs/conversational-collections.md). The earlier exact result remains frozen in [implementation-validation.json](implementation-validation.json) and the [original independent review](implementation-final-independent-signoff.md). The current S01/S02 repairs are identified by the [supplemental closeout evidence](evidence/s01-s02-closeout-20260914T152657Z/README.md) and [supplemental independent review](s01-s02-independent-signoff.md).

## Boundary

The reusable package starts after extraction. A host supplies bounded crude text, segments, or records with provenance and upstream coverage metadata. The package validates input and organization proposals, preserves canonical revisions, controls publication, answers structured queries, and returns portable view descriptors.

Hosts own file uploads, PDF/OCR parsing, original-file storage, provider credentials, LLM loops, file-processing jobs, channels, authentication, and presentation. The core package has no parser port, binary importer, required extraction callback, hidden provider call, or Youbot/UI dependency.

## Delivered components

1. **Reusable package — `packages/collection-engine`.** Nineteen provider-neutral tools, direct APIs, trusted execution context, concrete input/output schemas, revisions, provenance, proposal reconciliation, manual-field protection, publication, freshness evidence, typed search, declarative views, ESM/CommonJS exports, and zero runtime dependencies.
2. **Persistence — package JSON repository.** Atomic checked writes, independent-instance/process coordination, restart readback, entity scoping, `RepositoryPort` conformance, and schema-0-to-schema-1 migration with exact-byte backup and safe interrupted-migration recovery.
3. **Youbot host adapter — `youbot-core/src/concierge/collections`.** Entity-bound persistence, owner lifecycle routes, 14 owner-safe model tools, six visitor-safe reads, source passage inspection, published-only answer preview, durable authoring jobs, retry fencing, and conflict preservation.
4. **Host parsing — Youbot only.** Text and PDF intake use Youbot-owned libraries and keep originals private. The engine receives extracted text or segments. Current PDF limits are 10 MiB, 250 pages, 1,000,000 extracted characters, 2,000 segments, and 30 seconds of processing time.
5. **Visitor integration.** Collection evidence persists across turns and is revalidated inside the final transport callback. Publication generation, expiry, and referenced-item checks prevent withdrawn or stale content from being sent.
6. **Owner UI — `youbot-core/web-ui/app/concierge/collections`.** Collections first shows all collections and Add collection. A focused create screen asks for name and type; the focused editor shows a unified text/PDF composer when empty and item cards with an Add items action once populated. Text/PDF authoring, proposal review, cards/gallery/agenda views, visitor preview, source inspection, publication controls, reload recovery, and accessible dialogs remain wired to the same host operations.

## Completed verification

The current reviewed package artifact is `docs/collections/evidence/s01-s02-closeout-20260914T152657Z/tested-youbot-collection-engine-0.1.0.tgz`, SHA-256 `862e556ef7079dec6043f3536b10d148375d4549cc8ed1c90251cff471ee6807`.

| Check | Result | What it proves |
| --- | --- | --- |
| Package suite | 21/21 passed | Public/private lifecycle, schemas, revisions, provenance, concurrency, publication, expiry, reconciliation, unit safety, migration, and interrupted-migration recovery |
| Packed external consumer | Passed | Actual tarball, ESM/CommonJS, 19 tools, zero runtime dependencies, restart behavior, and consumption through public exports |
| Youbot focused integration | 13 files / 97 tests passed | Routes, host parsing, durable jobs, retry fencing, owner/visitor bindings, and response safety |
| Backend build | Passed | Current TypeScript integration compiles |
| Dense PDF fixture | 36 pages / 1,728 rows / >100,000 characters | Real-parser extraction covers representative property, class, and service data through first and last pages |
| Deadline and cleanup probe | Passed | Stalled cleanup cannot block the `PDF_TIMEOUT` response boundary |
| Durable authoring overlap probe | Passed | Concurrent retries invoke the model once and preserve one canonical ingestion/proposal identity |
| Restart and takeover probes | Passed | Abandoned leases recover and stale delayed completion cannot overwrite the takeover result |
| Migration interruption probes | Passed | Unsafe dangling state leaves primary untouched; interrupted schema-0 migration retries without losing publication or privacy boundaries |
| S01 supplemental review | Revision 14 passed | `review_16eab662-d056-466b-b2eb-0598b68db6d7` independently verified the host/package boundary and bounded PDF runtime |
| S02 supplemental review | Revision 13 passed | `review_46a54176-7ddc-4872-9da4-0543f3194e17` independently verified migration, backup, interruption, and restart behavior |
| S07 workspace rebuild review | Revision 17 passed | `review_ceac6ee7-4d43-4ca1-af9b-663c20fbb18b` independently verified the continuous-workspace source revision, catalogue-first DOM order, retained handlers, preview boundaries, targeted lint, TypeScript, and production build; responsive visual inspection remains author-attributed |
| S07 two-screen replacement | Revision 23 passed | `review_bc0d821f-9594-4473-82c5-96b153dffffe` independently verified the frozen source, lint, TypeScript, production build, stable item-grid rendering, stale owner-search discard, published-only preview derivation, source-navigation guards, and unchanged hashes; browser visual observations remain author-attributed |

The earlier [implementation validation](implementation-validation.json) remains intentionally unchanged as a historical frozen result. Its report SHA-256 is `80d415cd54fb8c6545b48f7b3fa831f96abd4bc85877ed05924c2e027a9cc895`, and its tested tarball SHA-256 is `0479c8be9f0262011f2be5d889905613dbfbd8fb745859a7820301dbbda1d676`.

## Remaining gates

1. **CC-S07 revision 4 UI review.** Factory records the owner-approved direction before implementation. Independent exact-revision review and owner judgment of the running result remain required for closeout.
2. **CC-S11 — full quality corpus.** Execute the versioned 39-scenario, two-entity lifecycle report with aggregate coverage, duplicate, critical-field accuracy, and source-reference metrics. Keep deterministic fixtures separate from live-provider evidence.
3. **CC-S12 — installation and release evidence.** Test clean supported Mac and Windows installations, backup/migration/restore, and packaged-host startup. Assemble a release-decision record without publishing or deploying.
4. **CC-S14 — aggregate portability and release evidence.** Verify all 32 requirements on the final exact revision, add a real persistent-adapter path, run a framework-free independent second host, and inspect package/adapter dependency and migration behavior.

## Operational limits

The JSON repository needs reliable atomic filesystem `mkdir` and `rename`. Its lock wait and stale-lock recovery do not establish power-loss or multi-host safety. Deployments requiring those guarantees should implement `RepositoryPort` over a transactional database and run the conformance suite.

The PDF deadline cannot preempt CPU-bound work that starves the JavaScript event loop. Worker/RSS isolation, customer-document accuracy, clean-platform migration, sudden-power-loss `fsync`, and distributed-filesystem behavior remain outside current evidence.

No package-registry publication, deployment, live-provider call, real external message, or release action is included in the completed scope. Fikr Studio transmission remains pending because no callable Fikr Studio MCP surface is available in this task.

### Editor follow-up — 2026-09-15

CC-S07 retains the gallery/create/editor flow and replaces the large authoring form with a compact composer. Proposal review precedes authoring; applying changes returns to the items. Empty search, preview and publish controls are withheld until relevant. Text survives attachment removal, failed submission, and composer close/reopen. The shared engine and backend are unchanged. Current verification: [editor evidence](evidence/ui-editor-reimagine-20260915.md), [independent review](ui-editor-independent-review-20260915.md).

### Authoring contract repair — 2026-09-15

Real generation exposed malformed operations that fixtures had not exercised. Host-only validation, exact prompting, bounded repair and source-preserving retry now cover this failure. UI no longer claims reviewable changes without a proposal. Tests: full collections 24/24 and independently repeated routes 13/13; backend/frontend builds pass. The configured-model recovery check is pending signed-in browser access after restart. See [evidence](evidence/authoring-live-failure-20260915.md).

### Content-first creation follow-up — 2026-09-15

Approved revision 5 CC-01 replaces the name/type form with content-first creation. Backend specialist owns the host-only /suggest endpoint and category persistence; frontend owns the composer and stable staged retry identities. The separate reviewer checks the final implementation. Automated backend/frontend checks pass. Authenticated visual/model verification and prior live saved-job recovery remain pending sign-in; see [evidence](evidence/content-first-creation-20260915.md). No reusable-engine scope expansion or deployment.

## Five-business end-to-end remediation plan — 2026-09-17

This plan responds to the [five-business audit](evidence/five-business-e2e-20260917/) and its independent `changes_requested` verdict. It restores already-approved conversational-collections revision 7 behavior; it does not add a competing specification or authorize deployment, real visitor messages, relay cleanup, or release.

### Exit criteria

The remediation is complete only when all of the following are true on one exact recorded source revision:

1. An authorized, signed-in provider organizes the doctor, real-estate, freelance-design, guitar-teacher, and beauty-salon inputs through the real owner composer. Each source reaches proposal, review, explicit publication, restart, and authenticated readback without fixture seeding replacing the authoring journey (CC-01, CC-07, CC-11, CC-21).
2. Every ordinary-language question in the five-business visitor matrix returns a grounded answer from current published fields, or a truthful limitation. Exact filters, counts, money, units, dates, unknowns, unavailable status, safety requirements, and owner-confirmation boundaries remain intact (CC-13, CC-16 through CC-20).
3. Draft, private, withdrawn, expired, other-collection, and other-entity facts remain absent from preview and answer text. Supporting item IDs/revisions and evidence receipts are revalidated immediately before the result is returned (CC-02, CC-05, CC-11, CC-12, CC-18, CC-27).
4. Starting Youbot with Webchat disabled performs no relay provisioning, network request, credential creation, configuration write, connection attempt, or log claiming provisioning.
5. Deterministic tests, signed-in browser evidence, provider evidence, and any later live-channel evidence are reported separately. An independent reviewer can replay the retained fixtures and issues a passing verdict; no task closeout is treated as release approval (CC-23, CC-24).

### Workstream 0 — freeze the failing cases

- Promote the five source texts and visitor question matrices into versioned test fixtures. Keep expected public answers, private canaries, typed constraints, item revisions, and required caveats explicit rather than snapshotting prose alone.
- Add a source manifest containing the relevant dirty-file hashes, runtime configuration shape, fixture version, and exact test commands. Reuse the current evidence scripts where they already exercise structured reads.
- Preserve the existing failing audit unchanged as the before-state. New evidence goes in a new dated remediation directory.

### Workstream 1 — prevent disabled-Webchat side effects

- Move the `enabled === false` guard in `youbot-core/src/api/index.ts` ahead of `ensureManagedWebchatRelay()` and ahead of any connection setup.
- Extract the startup decision into a small injectable unit if necessary so tests can supply a network/config-write trap without starting the full application.
- Add regression coverage proving that disabled Webchat calls neither provisioning nor fetch/save/connect dependencies when credentials are absent. Retain existing enabled, already-provisioned, and first-time provisioning tests.
- Treat the relay registration created during the audit as a separate operator cleanup item. Identify it using retained management data if available, then request explicit authorization before deletion; do not make remote cleanup part of application startup.

### Workstream 2 — make owner authoring reproducible without weakening credentials

- Reproduce the 401 with provider/app-server diagnostics that reveal status and error category but never tokens. Confirm the selected provider, executable, effective isolated Codex home, account status, and model route.
- Run the isolated acceptance instance with its own explicitly authorized ChatGPT/Codex sign-in, or with another provider explicitly chosen by the owner. Do not copy desktop credentials into temporary data or silently reroute the five business texts.
- If the signed-in isolated app-server succeeds, classify the original 401 as a harness/configuration failure and add a readiness preflight that blocks the test before authoring. If it still returns 401, repair the `codex-app-server`/provider-access lifecycle and cover start, authentication expiry, reauthentication, structured generation, and redacted errors.
- Keep the current source-preserving retry behavior. Provider failure must retain the owner's text and one stable source/job identity; successful retry must not duplicate collections, sources, ingests, or proposals.

### Workstream 3 — replace literal preview search with the visitor answer path

- Introduce one host-level collection answer service used by owner preview and supported visitor answering. It receives trusted actor/entity/collection scope separately from the question and can call only visitor-safe collection tools.
- Translate ordinary questions into validated `collections_search`/`collections_item_get` arguments. Exact constraints such as bedrooms, AED thresholds, age, price, duration, dates, availability, and ordering must become typed engine arguments; descriptive retrieval may rank candidates but must not claim exhaustive counts.
- Give answer composition the complete visitor-safe values for each supporting item. Remove insertion-order rendering (`Object.entries(...).slice(0, 4)`) and never use a fixed field count as the truth boundary.
- Compose only grounded facts and attach supporting item IDs/revisions plus evidence receipts. Revalidate publication, current revision, expiry, and permitted fields immediately before returning preview text. If the provider or retrieval layer is unavailable, show a truthful unavailable/partial result instead of reporting “no matching information.”
- Preserve business-critical caveats whenever they are material to the question: safety/requirements, available/unavailable/unknown status, variable or unknown price, live-seat/booking uncertainty, owner/staff confirmation, and date/time basis. Do not infer appointments, viewings, seats, bookings, discounts, emergency service, or quotes.
- Keep preview side-effect free: no outbound message, contact/memory update, booking, owner escalation, collection mutation, or conversation-history mutation. The UI should continue to label it as not sent and should distinguish no match from answer-generation failure.

### Workstream 4 — behavioral verification

1. **Unit and route tests:** add semantic-question, typed-filter, late-field, unknown-price, unavailable-status, safety-caveat, booking-boundary, provider-failure, evidence-staleness, and disabled-Webchat network-trap cases. Replace the current literal-title-only preview assertion with ordinary questions while retaining private/draft/withdrawn denial checks.
2. **Five-business deterministic integration:** seed through owner contracts only for lower-level repeatability, then run every doctor, real-estate, designer, guitar, and salon question against the shared answer service. Assert facts and prohibitions separately so safe omissions cannot pass merely because an answer is empty.
3. **Two-entity isolation:** duplicate at least one tempting identifier/value across two entities and prove owner routes, visitor tools, answer text, evidence receipts, and caches cannot cross the boundary.
4. **Signed-in browser lifecycle:** on a new isolated loopback runtime, author all five inputs through the real composer, review/publish them, restart, and replay the complete visitor matrix. Capture request/response evidence and persisted readback; do not send external messages.
5. **Regression/build checks:** run the collection-engine suite/build, focused host collection/visitor/provider/Webchat tests, backend build, web lint/build, and any affected relay tests. Record pre-existing warnings separately.
6. **Independent review:** a reviewer distinct from implementation replays retained commands and browser acceptance, compares exact source hashes, and checks every exit criterion before recommending pass.

### Delivery sequence

1. Land the disabled-Webchat guard and regression first so subsequent isolated tests cannot create more remote state.
2. Add the fixture corpus and provider readiness classification/preflight.
3. Implement the shared visitor answer service and preview integration without changing the reusable engine's provider-neutral boundary.
4. Complete deterministic tests, then signed-in five-business browser acceptance, then independent review.
5. Only after a passing review, update Factory/Spacecrew evidence and the canonical remaining-gates status. Deployment, live-channel delivery, remote relay deletion, and release remain separately authorized actions.

### Expected implementation surfaces

- `youbot-core/src/api/index.ts` and focused Webchat startup/provisioning tests.
- `youbot-core/src/concierge/collections/routes.ts`, a focused host answer-service module, and collection route/service tests.
- Existing visitor orchestration/provider-access code only where required to share grounded answer behavior or fix a reproduced signed-in app-server defect.
- `youbot-core/web-ui/app/concierge/collections/page.tsx` and `youbot-core/web-ui/lib/concierge.ts` only for truthful preview states and evidence display; no Collections layout redesign is planned.
- Versioned fixtures and evidence under `docs/collections/evidence/`; no production data, credentials, or customer content.
