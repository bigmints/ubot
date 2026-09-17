# Reusable collection engine planning review

Date: 2026-09-14. Reviewer: `collections_quality`, separate specialist session `/root/collections_quality`.

**Verdict: pass for the reusable-engine planning package and persisted revision-2 assignments.** This verdict covers the reviewed source identities and observed planning state below. It is not exact human specification/UI approval, implementation acceptance, actual provider compatibility, installed-package readiness or release permission.

## Scope and independence

Reviewed the canonical specification revision 2, architecture, new public API/tool catalogue, implementation plan, stories, manifest, package README/setup and specialist profiles. Independently queried the installed Spacecrew CLI, compared registered file digests and checked assignment/requirement/dependency consistency. The reviewer did not author those documents or registrations. The reviewer authored the verification plan; its 38-scenario coverage check is self-verification and is explicitly separate from independent review of the other planning artifacts.

This is new evidence for the engine revision. The original `planning-review.md` and `planning-validation.json` remain byte-for-byte unchanged and describe their earlier revision-1 snapshots. Their retired knowledge registrations keep old approval evidence out of current role context without rewriting that history.

## Independently observed planning evidence

| Check | Result |
| --- | --- |
| Work readback | Fourteen distinct implementation work records match final manifest IDs, observed revisions, `blocked` status, native acceptance text, named specialist/profile and direct dependency work IDs. Their next actions identify revision 2 and assignment without implementation dispatch. |
| Story migration | The original twelve work identities and native acceptance arrays are preserved; the canonical manifest adds 23 mandatory `revision2Acceptance` supplements across those stories. S13 and S14 add native engine criteria. The aggregate S14 gate explicitly requires every original native criterion, every supplement, S13 acceptance and all 32 specification criteria. Original-story completion alone cannot establish engine readiness. |
| Ownership/dependencies | Nine distinct named specialists have persistent profile files. All 32 requirement IDs are covered, all dependency IDs resolve, the graph is acyclic and all fourteen explicit story anchors are unique. S13 provides early packed-consumer/tool evidence; S11 checks first-host integration; S12 prepares final artifacts; S14 performs the final independent aggregate review. |
| Knowledge/digests | At review, 25 registered originals included 23 active and two retired historical planning artifacts. Every active registration matched its current SHA-256 file digest. |
| Health | `health.check` returned healthy with no stale evidence. It showed one existing blocked product-stage run, `run_ddc98743-1111-4b35-98e0-e38f8d50d347`. Independent `run.get` identified that request as a separate public relay chat redesign limited to `youbot-core/webchat-relay/public/index.html`; it is excluded from this planning scope. No collections implementation run was observed. |
| Selected role context | Reviewer context for S14 at 50,000 characters returned `readyForWork: true`, no warnings and no blocked reasons. Completeness was `partial`; optional omissions still require specialists to read their assigned originals. No other role context run is claimed by this reviewer. |
| New planning work | `work_eab3a3af-5ea7-4441-8f7b-55d7e90680cd` was observed at revision 1 during these read-only checks. A separate exact-revision work review must follow the coordinator's final validation/evidence update. |
| Links | Existing specification, API, architecture, story and profile file targets resolve. The only pending README targets at inspection were this newly created review and the coordinator's forthcoming `engine-planning-validation.json`; final closeout validation must confirm both exist. |

The first structural checker used a case-sensitive revision-label assertion and stopped on the capitalized `Revision 2` text of S13/S14. Inspecting those actual records confirmed the same revision meaning. The corrected case-insensitive comparison passed; no harness or product record was changed to satisfy the checker.

## Contract review findings

The proposed core is headless `packages/collection-engine`, with a supplied optional SQLite adapter and a separately optional React renderer. Youbot is the first host adapter and must consume public exports. Core code has no authority to select models, load provider credentials, own host sessions, send messages or silently start network/worker processes. The second unrelated host must install actual packed artifacts outside the repository; monorepo source imports are insufficient portability evidence.

The 23 distinct proposed tool definitions share a provider-neutral schema/dispatcher boundary with direct public APIs. Trusted execution context is passed separately from model arguments. `PolicyPort` validates live authorization and exact-action intent receipts bound to actor, tenant, operation content and reviewed revision. Tool filtering complements execution enforcement; it cannot grant or replace authorization. Spoofed model context, `approved: true`, forged receipts and arbitrary source paths/URLs are explicitly denied.

Injected storage/transaction, private source, parser, extraction and policy ports keep host integration replaceable. Durable job leases/checkpoints and receipts remain engine-owned state transitions. Primary import uses the explicit bounded `ExtractionPort`; an enabled host-proposal mode is an alternative that goes through the same proposal validation/fencing. Worker scope is delegated from an authenticated initiating actor, never taken from extractor output.

Freshness includes host permission changes independent of content generation. The host must reauthorize before dispatch and the engine rechecks around slow work and commits. Revoked actor permissions, changed visibility, expired facts and stale contextual excerpts are covered. A successful eligibility check is not transport delivery, and an already accepted external message cannot be recalled by the engine.

One actionable ambiguity was resolved during review: archive no longer hides inside ordinary draft application. The API now has explicit `collections_archive`, requiring current content/publication revisions and a host-verified exact-target intent receipt. It archives and withdraws atomically; undo only restores a working revision and never republishes. The reviewer reread this change. Duplicate story anchors introduced during supplement insertion were also corrected and independently rechecked.

No unresolved blocking inconsistency remains in the reviewed planning scope. Final schema definitions, concrete supported limits, transaction implementation, provider adapters and package version support are still implementation decisions/tests; explanatory TypeScript and catalogue tables are not shipped functionality.

## Required implementation evidence

The updated verification plan contains 38 scenarios mapped to CC-01–CC-32. New engine coverage requires: external packed-tarball execution with no Youbot/React/cwd aliases; two independent hosts; at least two normalized tool-protocol fixtures; core tenant and receipt enforcement; revocation during jobs/retrieval/dispatch; port cancellation, retry and fingerprint behavior; source SSRF/path/private-excerpt boundaries; optional renderer dependency isolation; and API/tool/data/view compatibility and migration proof.

Fixture protocol conformance cannot prove successful calls to two live model providers. Mock ports cannot establish real persistent-adapter recovery. Source builds cannot establish a clean packed installation. These remain distinct evidence levels and no such implementation checks were executed in this planning task.

## Reviewed source identities

| Original | SHA-256 |
| --- | --- |
| `.factory/product/specs/conversational-collections.md` | `2bc4920ce753b6f36f362b8c7bb1f446ab9c9a8cf599d10297c303bdb1455016` |
| `docs/collections/story-manifest.json` | `f42220c1a2ad8b70c308e5147cd49313f6b3998ce28a408824ea2f04b65306a5` |
| `docs/collections/architecture.md` | `9350d8c34d3f24d6a81f45aa27a63f7f37437bfbae377182f603a5e890c1b09e` |
| `docs/collections/engine-api.md` | `950ded3b344fa41ca8504da42ba31e24ce970e3d47d616a7f9738cd5af8ee6d7` |
| `docs/collections/implementation-plan.md` | `e2677126db35e2f7161f5fbabe1ce889a5d1476f5043f7fe2efd2218eb076038` |
| `docs/collections/stories.md` | `caa4a20bbb3bcff0a142a06bdfcd815bd3450094959a0311d50929665a806d1a` |
| `docs/collections/verification-plan.md` | `73fba2d8d42fa2b5b51ee5655ed9e8b139961e9886b51415ea779152e29808e0` |

Historical artifact digests were also checked unchanged: revision-1 review `50558db629970d6743c172607596b12553e1a23cba32cb91ceb11e7518943023`; revision-1 validation `7fedff8116a497e695999348a58f569beb368b40fc4ccbceaece064a9f6119e8`.

## Remaining boundaries

The reusable-engine direction is user-authorized; exact specification revision 2 remains draft. Existing Youbot visual approval requirements and the disclosed inherited `concierge-v1-experience` approval drift remain separate decisions. Planning assignment/acceptance records grant neither implementation nor release authority.

No native MCP connection or live provider call was needed for this review. Prior direct MCP transport evidence is not rerun evidence here. Fresh-task native Codex activation and Fikr Studio summary delivery remain unverified/pending as documented. No claim of delivery follows from saving the summary.

The coordinator must retain final validation with source identities and then request a distinct exact-revision planning work review. Any changed contract after these reviewed identities requires appropriate rereview; this report does not approve unseen revisions.
