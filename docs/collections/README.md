# Conversational collections

The reusable collection engine and its first Youbot integration are included in the current Youbot source release and have passed focused local verification. The [original final review](implementation-final-independent-signoff.md) passed seven implementation stories and requested repairs for CC-S01 and CC-S02. The [supplemental independent review](s01-s02-independent-signoff.md) passes those two repaired stories on their exact reviewed revisions.

The evidence in this folder records source and local-runtime verification. Public source publication, website deployment, and live-channel behavior are reported separately and must not be inferred from local checks.

The engine accepts already-extracted text, segments, or records. It validates and organizes supplied data, preserves provenance and revisions, manages publication, answers structured queries, and returns declarative view descriptors. Host applications own uploads, PDF/OCR parsing, original files, provider credentials, LLM orchestration, processing jobs, channels, authentication, and UI. The package never reads a PDF, invokes a model, or sends a visitor message.

## Canonical documents

- [Factory specification revision 4](../../.factory/product/specs/conversational-collections.md) defines the approved product boundary and the two-screen Youbot Collections flow.
- [Engine API](engine-api.md) and [architecture](architecture.md) define the reusable package contracts.
- [Implementation plan](implementation-plan.md) records what was built, verified, and left open.
- [Stories](stories.md), [story manifest](story-manifest.json), and [verification plan](verification-plan.md) preserve assignments and the full acceptance scope.
- [Implementation validation](implementation-validation.json) and the [original final review](implementation-final-independent-signoff.md) retain the earlier frozen implementation evidence and historical verdicts.
- [S01/S02 closeout evidence](evidence/s01-s02-closeout-20260914T152657Z/README.md) and the [supplemental independent review](s01-s02-independent-signoff.md) identify the final PDF-runtime and migration repairs.
- [Current two-screen flow evidence](evidence/ui-two-screen-flow-20260915.md) records the owner-approved collection gallery, focused creation, and focused editor flow. Earlier workspace rebuild evidence is historical and superseded.
- [Fikr Studio handoff](fikr-studio-summary.md) remains local because no callable Fikr Studio MCP tool is available in this task.

- [Current two-screen independent review](ui-two-screen-independent-review-20260915.md) records exact revision 23 pass and the defects found and repaired during review.

## Delivered behavior

- [`@youbot/collection-engine`](../../packages/collection-engine/README.md) provides 19 provider-neutral, schema-validated tools through ESM and CommonJS exports with zero runtime dependencies.
- The engine ingests model-supplied or direct crude data, protects manual fields, records provenance, maintains revisions, controls publication, performs typed queries, and emits portable view descriptors.
- Its JSON repository supports atomic checked writes, concurrent-process coordination, restart readback, and an explicit schema-0-to-schema-1 migration. Migration creates an exact-byte, create-only `0600` backup and fails without replacing the primary store when recovery state is unsafe.
- Youbot owns text and PDF extraction and supplies extracted segments to the engine. Current PDF limits are 10 MiB, 250 pages, 1,000,000 extracted characters, 2,000 segments, and a 30-second processing deadline.
- Private source passages and originals remain owner-only. Fourteen owner tools support organization and publication; six visitor tools expose only eligible published facts.
- Durable authoring jobs support list, get, and retry operations; conflict preservation; restart readback; stable source, ingestion, and proposal identities; atomic retry leases; and fencing of stale completion.
- The Collections screen uses a responsive workspace: a secondary collection rail, central catalogue canvas, and sticky private assistant on the right. On narrow screens the assistant stacks before the catalogue. Text/PDF authoring, proposal review, direct edits, selected publication, search, cards/gallery/agenda views, source inspection, visitor answer previews, reload recovery, and keyboard-safe dialogs remain available.
- Final response handling remembers collection evidence across turns and revalidates it inside the transport callback so withdrawn or expired facts are held before send.

## Current verification

- Current tested tarball: `docs/collections/evidence/s01-s02-closeout-20260914T152657Z/tested-youbot-collection-engine-0.1.0.tgz`
- Current tarball SHA-256: `862e556ef7079dec6043f3536b10d148375d4549cc8ed1c90251cff471ee6807`
- Package suite: 21/21 passed.
- Packed external consumer: passed for all 19 tools, ESM/CommonJS, zero runtime dependencies, restart behavior, and public package imports.
- Youbot focused backend integration: 13 files / 97 tests passed.
- Youbot TypeScript build: passed.
- Dense real-parser PDF fixture: 36 pages, 1,728 property/class/service rows, more than 100,000 extracted characters, and complete first/last-page coverage.
- Deadline probe: stalled parser cleanup returned `PDF_TIMEOUT` without blocking the 30-second response boundary.
- Migration probes: dangling backup preserved the primary store; real child-process interruption after backup creation retained the original schema-0 store and recovered it on retry with publication and privacy boundaries intact.
- Exact Spacecrew reviews: CC-S01 revision 14 passed as `review_16eab662-d056-466b-b2eb-0598b68db6d7`; CC-S02 revision 13 passed as `review_46a54176-7ddc-4872-9da4-0543f3194e17`.
- CC-S07 revision 17 passed focused independent review `review_ceac6ee7-4d43-4ca1-af9b-663c20fbb18b`: targeted lint, TypeScript, production build, catalogue-first DOM order, retained handlers, and owner/visitor boundaries passed. Desktop and mobile visual inspection remains author-attributed browser evidence; owner visual approval remains separate.

The earlier validation report remains a historical frozen record with SHA-256 `80d415cd54fb8c6545b48f7b3fa831f96abd4bc85877ed05924c2e027a9cc895`. Its tested tarball SHA-256 was `0479c8be9f0262011f2be5d889905613dbfbd8fb745859a7820301dbbda1d676`. The supplemental evidence above is the current closeout result.

## Remaining release evidence

- CC-S06 and CC-S07 retain the historical pre-implementation visual-approval gap. Current human review can assess the delivered UI, but it cannot recreate that earlier approval sequence.
- CC-S11 still requires the full 39-scenario extraction-quality report with aggregate coverage, duplicate, critical-field accuracy, and source-reference metrics.
- CC-S12 still requires clean supported-platform installation, backup/migration/restore, packaged-host startup, and a release-decision record.
- CC-S14 still requires aggregate evidence for all 32 revision-4 requirements, a real persistent adapter path, a framework-free second host, and release/registry verification.
- A PDF deadline cannot preempt CPU-bound work that starves the JavaScript event loop. Worker/RSS isolation, sudden-power-loss `fsync`, distributed filesystems, and customer-document accuracy remain outside the proven boundary.

No package-registry publication, deployment, live-provider call, or real external visitor message is claimed. The latest Fikr Studio handoff remains pending because its write endpoint returned Unauthorized.

### Editor refinement — 2026-09-15

The owner requested another editor redesign. Empty collections now show one writing surface with an attachment button, while populated collections lead with item cards. Source naming and history are disclosed on demand; publishing remains explicit. See [editor evidence](evidence/ui-editor-reimagine-20260915.md) and [independent review](ui-editor-independent-review-20260915.md). This refines the approved revision-4 flow; final visual acceptance belongs to the owner.

### Dense workspace shell — 2026-09-15

The owner subsequently requested one Outlook-like layout pattern across functional workspaces. Collections now uses the permanent app sidebar, a compact collection navigator, and an edge-to-edge collection canvas. The top bar is the semantic page title and shows `Collections > collection name` for an open collection. Conversations, Contacts, collection navigation, and collection items share the same compact search, filter, sort, result-count, and reset pattern. Profile section rails collapse to a selector before they would squeeze the editing canvas. “Add items” uses the shared optional assistant surface: it overlays from the right when a populated collection is being edited, while an empty collection keeps the same composer in the main canvas. This is a presentation and navigation refinement only; collection persistence, publication, owner preview, authorization, and visitor behavior are unchanged.

### Live authoring failure repair — 2026-09-15

A real model response used an invalid operation format. The host now provides and validates the operation contract, bounds repair attempts, and lets legacy failed jobs regenerate from their saved source. The owner screen shows truthful failure/retry status. Focused tests and independent review pass; actual recovery of the reported saved job awaits the owner signing in after restart. See [failure and recovery evidence](evidence/authoring-live-failure-20260915.md).

### Content-first creation — 2026-09-15

The new collection screen now starts with text or a PDF; AI derives the name and category before the existing reviewable authoring flow. Revision 5 CC-01 supersedes the name/type form. [Implementation and validation](evidence/content-first-creation-20260915.md) distinguishes passing automated checks from the still-pending authenticated browser/model check.

[Independent content-first review](content-first-creation-independent-review-20260915.md) passed the scoped code and regression checks; it does not attest a live model run.
