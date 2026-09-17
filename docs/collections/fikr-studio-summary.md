# Fikr Studio handoff: collection engine implementation

## Current closeout

Youbot now contains a reusable provider-neutral collection engine and its first host integration, implemented against Factory-approved conversational-collections revision 4.

The package accepts already-extracted crude text, segments, or records. It validates and organizes supplied data, preserves provenance and revisions, protects manual fields, controls publication, performs typed queries, and returns declarative view descriptors. Host applications retain responsibility for uploads, PDF/OCR parsing, original files, provider credentials, LLM orchestration, processing jobs, channels, authentication, and UI.

The package exposes 19 schema-validated tools through ESM and CommonJS with zero runtime dependencies. It includes a JSON repository with atomic checked writes, restart readback, independent-process coordination, and a schema-0-to-schema-1 migration. Migration creates an exact-byte, create-only `0600` backup, replaces the primary atomically, resumes from a matching interrupted backup, and fails without changing the primary for malformed, unsupported, conflicting, unreadable, or dangling-backup states.

Youbot provides private text/PDF intake, bounded extraction, entity-bound persistence, durable authoring jobs, source inspection, 14 owner-safe model tools, six visitor-safe reads, owner and visitor previews, and final-send evidence revalidation. The Collections UI now opens to all collections with one Add collection action. Add opens a focused name/type screen; opening or creating a collection moves to a focused editor led by Add items. The earlier simultaneous rail, catalogue and assistant workspace is superseded. Durable authoring retries use stable source, ingestion, and proposal identities and an atomic lease fencing token, so concurrent retries do not duplicate model invocation, ingestion, or proposals and stale delayed completion cannot overwrite the takeover result.

Youbot PDF intake enforces a 30-second application deadline across asynchronous module loading, parser setup, extraction, result construction, and cleanup. Timeout returns recoverable `PDF_TIMEOUT` / HTTP 408 with split-file guidance. Current limits are 10 MiB, 250 pages, 1,000,000 extracted characters, and 2,000 segments.

## Verification

- Current tested tarball: `docs/collections/evidence/s01-s02-closeout-20260914T152657Z/tested-youbot-collection-engine-0.1.0.tgz`
- Current tarball SHA-256: `862e556ef7079dec6043f3536b10d148375d4549cc8ed1c90251cff471ee6807`
- Package suite: 21/21 passed.
- Packed external consumer: passed for all 19 tools, ESM/CommonJS, zero runtime dependencies, restart, multi-instance writes, policy revocation, visitor denial, and runtime schema validation.
- Youbot focused backend integration: 13 files / 97 tests passed.
- Youbot TypeScript build: passed.
- Dense real-parser PDF fixture: 36 pages, 1,728 property/class/service rows, more than 100,000 characters, and complete first/last-page coverage.
- Independent deadline probe: stalled parser cleanup did not block the timeout response.
- Independent migration probes: dangling backup preserved the primary; real child-process interruption after backup creation recovered the schema-0 store on retry with publication and privacy boundaries intact.
- CC-S01 revision 14 independently passed as `review_16eab662-d056-466b-b2eb-0598b68db6d7`.
- CC-S02 revision 13 independently passed as `review_46a54176-7ddc-4872-9da4-0543f3194e17`.
- CC-S07 revision 23 independently passed as `review_bc0d821f-9594-4473-82c5-96b153dffffe`. Fresh lint, TypeScript, production build, deferred search/preview/source navigation probes, and unchanged-hash checks passed. Browser visual observations remain author-attributed; owner visual judgment remains separate.
- Factory task `request-9e0775599353a807b60d95e4` is recorded as implemented with verification passed.

The earlier frozen validation remains historical: report SHA-256 `80d415cd54fb8c6545b48f7b3fa831f96abd4bc85877ed05924c2e027a9cc895`, tested tarball SHA-256 `0479c8be9f0262011f2be5d889905613dbfbd8fb745859a7820301dbbda1d676`.

## Remaining gates

- The earlier revision-3 workspace is superseded. Factory revision 4 records the owner-approved two-screen direction before implementation.
- CC-S11 still requires the full 39-scenario extraction-quality metrics report.
- CC-S12 still requires clean supported Mac and Windows installation, migration, restore, packaged-host, and release-decision evidence.
- CC-S14 still requires aggregate evidence for all 32 revision-4 requirements, a real persistent adapter path, a framework-free second host, and registry/release verification.
- CPU-bound parser work that starves the JavaScript event loop cannot be preempted by the current deadline. Worker/RSS isolation, sudden-power-loss `fsync`, distributed filesystems, and customer-document accuracy remain outside current evidence.

No deployment, package publication, live-provider call, or real external visitor delivery occurred.

## Transmission status

Transmission to Fikr Studio is pending. No callable Fikr Studio MCP tool is available in this task. This file retains the handoff payload and does not prove delivery.


## Pending editor follow-up — 2026-09-15

Youbot Collections retains a gallery with Add collection and a focused name/type screen. The editor has been reimagined with a compact header and one text/PDF composer when empty; populated collections lead with item cards and on-demand authoring. Proposals precede authoring, applying changes returns to cards, and publication remains explicit. Empty-state clutter is removed, while errors, source review, draft recovery and visitor preview remain available.

Local lint, TypeScript and production build passed. Browser fixture checks passed at 833px and mobile width, including review/apply, draft retention, preview isolation and explicit publication. Independent review found no blocking regression. Canonical evidence: docs/collections/evidence/ui-editor-reimagine-20260915.md. No deployment or live visitor message occurred. Final visual acceptance remains with the owner.

Delivery attempt: Fikr Studio project listing succeeded; unrelated General note reads were blocked by approval review. Dedicated Youbot project creation returned Unauthorized. This exact summary is retained for delivery after authorization is restored.


## Pending authoring-failure repair summary — 2026-09-15

A real collection authoring response used an invalid engine operation shape. The host now supplies exact contracts, validates before persistence, bounds regeneration, and repairs legacy failed jobs from saved source without duplicate ingestion. Backend messages and UI failure/retry states are truthful. Backend collections24/24, independent routes13/13, and builds pass. The repaired app is running locally; live saved-job recovery is pending the owner signing in after restart. No publication or deployment. Evidence: docs/collections/evidence/authoring-live-failure-20260915.md. Delivery remains pending the previously observed Fikr Unauthorized write response.

## Pending content-first creation summary — 2026-09-15

Owner-requested content-first collection creation is implemented: paste information or attach a PDF, then AI names/categorizes the collection and proposes organized items for review. The host /suggest endpoint stores nothing; creation and authoring reuse stable identities on same-page retries. Failed requests preserve input, and users can explicitly start again with different information. Reusable engine remains provider-neutral and starts after extraction. Backend 27 tests, independent route checks, frontend lint/typecheck/build pass. Running locally on port 5080; actual model and rendered signed-in UX verification await owner sign-in. Canonical evidence: docs/collections/evidence/content-first-creation-20260915.md. Transmission remains pending the previously observed Unauthorized Fikr Studio write response.

## Pending host source intake summary — 2026-09-16

Factory-approved revision 6 now gives the single content-first composer four host inputs: copied text, one public HTTPS website URL, PDF, and PNG/JPEG/WebP image. Youbot owns website retrieval, PDF parsing, image transcription, durable extraction jobs, and provider access; the reusable `collection-engine` still receives only extracted crude data and provenance and has no network, file, parser, OCR, vision, or provider dependency. Website intake copies the proven SaveADay safety shape with redirect-by-redirect public-network validation, pinned validated addresses, HTTPS-only URLs without credentials or ports, four redirects, a 10-second total deadline, a 1 MB response limit, supported textual media types, and bounded extracted text. Image intake validates canonical base64, filename/MIME agreement, decoded file signatures, and a 6 MB limit before a no-tools vision transcription.

Current checks: Collections backend 64/64, source and route security tests 53/53, backend build, reusable package 21/21, independent packed-consumer verification, focused Collections lint/TypeScript, and web production build all pass. New URL/image sources remain draft, organization is a separate review step, stable retries do not duplicate source work, restart recovery is covered, and visitor reads exclude draft content. Canonical evidence: `docs/collections/evidence/host-source-intake-20260916/README.md`. The rebuilt app is running locally; restart cleared the in-memory browser session, so signed-in live UI verification still requires restoring that session. No publication, visitor message, deployment, or release occurred.

The required Fikr Studio delivery remains pending. A prior external write was rejected by automatic approval review because the payload contained internal implementation and security details; no less safe workaround was attempted.

### Host source intake runtime correction

The final suite is 65/65 Collections tests and 54/54 focused URL/image route and intake tests after a live Node 26 DNS lookup-shape regression was found and fixed. Authenticated local runtime smoke persisted copied text, PDF, image, and public URL sources as drafts. Image and URL extraction/ingestion reached review state; text and PDF organization remained pending with the configured live provider. Visitor item/proposal counts stayed zero for every collection. Restart invalidated the browser's memory-only session, so the signed-in browser flow stopped at the legitimate sign-in screen. No authentication bypass, publication, visitor message, deployment, or release occurred.

### Final live recovery — 2026-09-16

Host structured generation now prefers a forced non-executing function result and validates a plain-JSON fallback. Failed organization persists only bounded static diagnostic fields. A retry may carry a fixed category hint into the next prompt; it never carries source text, model output, provider errors, paths, values, or credentials.

The saved copied-text and PDF jobs both recovered through the configured live provider without re-ingestion. Each reused its original source and ingest identity, produced exactly one proposal, was reviewed and applied to one draft item, survived reload, and appeared in owner search. Pending proposals, published items, visitor items, and visitor proposals were zero afterward. Concurrent URL/image retries preserved their original source and ingest IDs, preserved zero proposals for the sparse samples, exposed no image byte/base64 field, and left visitor/published counts at zero.

Automated checks pass: Collections 65/65, route tests 23/23, structured-generation/provider tests 7/7, engine 21/21, packed independent consumer verification, backend build, web build, focused lint/TypeScript, and relevant diff checks. Canonical evidence is docs/collections/evidence/host-source-intake-20260916/README.md.

Signed-in visual browser verification still waits for the user to sign in after the restart. Automatic session-cookie injection was rejected by approval review and no workaround was attempted. No collection was published, no visitor message was sent, and no deployment or release occurred. Fikr Studio delivery remains pending because the available external write was rejected for containing internal implementation and security details.

### Oversized-output review repair — 2026-09-16

Independent review found that provider output above 200 operations or 100 unresolved issues could be silently truncated. The host now rejects those outputs as recoverable instead of presenting an incomplete catalogue as complete. Source-read, provider, model-output, generated-payload persistence, engine-validation, and transient authoring-store failures now retain distinct bounded diagnostics. New tests cover 201 operations, 101 issues, oversized serialization, source-read failure, and recoverable store failure without draft mutation. Collections pass 67/67, routes 25/25, structured/provider tests 7/7, backend build and diff checks pass, and a separate read-only review found no remaining actionable issue. The reusable collection engine remains unchanged.

The final verified build is not currently running. Automatic approval review blocked reconnecting the configured Webchat, Telegram, and WhatsApp integrations during restart; explicit user authorization is required. Signed-in browser verification therefore remains pending. No publication, visitor message, deployment, or release occurred.
