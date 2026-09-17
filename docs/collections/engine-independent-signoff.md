# Independent reusable-engine planning signoff

Date: 2026-09-14. Reviewer: `/root/engine_plan_reviewer`, a separate Codex specialist session. Actual host thread: `01a09f15-dbcd-7e02-8d2b-e13ed1738ea9`; parent session: `01a09d0e-5d28-79c0-a7ca-e3a4152da877`.

**Verdict: pass for revision-2 planning completeness and persisted specialist handoffs only.** No blocking planning finding remains. This reviewer authored none of the specification, plan, contracts, manifest, profiles, validation report, or verification plan. The quality specialist authored the verification plan and correctly labeled that subset self-verification in its report; this separate review includes that subset independently.

## Reviewed boundaries

The proposed core owns collections, typed values, source/import state, proposals, revisions, publication, query enforcement and declarative view descriptions. Youbot is the first host. Authentication, current policy, trusted context, source storage, parsing/extraction integration, provider protocol normalization, model SDKs/credentials, UI and channel dispatch belong to explicit host ports/adapters. SQLite and React remain optional companion packages. No hidden server, worker, credential discovery or provider loop is part of core import/construction.

The API names three public entry points and 23 concrete named LLM tools with their principal inputs and enforcement/results. Complete executable JSON Schemas are a delivery requirement, not claimed implemented by this contract draft. Direct APIs and tool execution share validation/authorization. Model arguments cannot select trusted actor/entity/audience or approve publication. Server-issued source handles, exact-action intent verification, current-policy checks, revision CAS, scoped idempotency, immutable receipts and fenced import steps establish explicit implementation boundaries. PDF/model extraction remains untrusted proposal generation; host-loop proposal mode uses the same validator and job binding. Current eligibility is checked again for response dispatch, with transport coordination owned by the host.

## Independently reproduced checks

- All 33 file SHA-256 values in the `engine-planning-validation.json` snapshot checked at `2026-09-14T08:43:51.498521+00:00` matched current file bytes. The coordinator may extend that report with this signoff before final evidence capture. All seven digest entries in `engine-planning-review.md` also matched. This signoff records its reviewed input digests below; its own subsequently created file is intentionally outside those earlier snapshots.
- The manifest contains 14 unique stories assigned to nine specialist profiles. The dependency graph is acyclic. S14 depends transitively on all 13 earlier stories and maps all 32 canonical requirements.
- `spacecrew work.get` was executed for every one of the 14 manifest work IDs. All live revisions, `blocked` statuses, native acceptance arrays, specialist identifiers, direct dependency work IDs and mandatory supplement text matched the manifest. S01–S12 remain their existing work identities with native acceptance preserved; their 23 revision-2 supplements are mandatory handoff text. S13 has four native criteria; S14 has five and explicitly aggregates original native acceptance, every supplement, S13 and all 32 spec criteria. Original-story completion alone cannot establish reusable-engine readiness.
- The independent review assessed Q01–Q38, including the original lifecycle/security checks and the new provider-neutral tool, trusted-context/intent, policy-revocation, adapter-failure, source confinement, migration/versioning, process-isolation and portability checks. All 32 canonical requirement IDs have explicit scenario mappings. Final portability requires actual packed tarballs installed outside the repository, only public exports, unrelated headless consumption, persistent restart, dependency inspection and two normalized protocol fixtures. Fixture conformance is clearly separated from live provider compatibility and installed/production evidence.
- `spacecrew context.get` with reviewer role and 50,000-character budget returned `readyForWork: true`, no warnings, and `completeness: partial`. Optional omissions remain visible and assigned originals were read directly. The default smaller budget rejected the oversized mandatory context rather than silently truncating it.
- Live `spacecrew health.check` returned healthy, 26 registered originals / 24 active originals, no active digest mismatches, no stale evidence and no stale review evidence at inspection.
- Live `spacecrew run.list` contained only the unrelated blocked relay redesign run `run_ddc98743-1111-4b35-98e0-e38f8d50d347`, scoped to `youbot-core/webchat-relay/public/index.html`. No collections implementation run was present. Concurrent relay work is outside this review and has not been altered.

## Explicit limits and next decision

Specification revision 2 is draft. The user authorized the reusable-package direction and planning updates; this signoff is not exact human product/design approval, implementation acceptance, package publishing or release permission. No collection engine package has been built, packed, installed or tested. No application/runtime/provider/network test or live visitor delivery was performed in this planning review. Native Codex MCP activation and the Fikr Studio MCP handoff remain unavailable/unverified; the prepared handoff remains pending. Existing concierge specification drift is inherited and remains separate from this planning verdict.

The next decision is review of the exact draft product and design boundaries before dependent implementation. S01 must settle supported runtime, adapter capabilities, schema/transaction details and measured limits; S13/S14 retain package evidence obligations. Local Spacecrew session actor identities are caller-declared; actual review independence comes from this separately delegated non-authoring specialist session, not the actor string alone.

## Reviewed input digests

| Original | SHA-256 |
| --- | --- |
| `.factory/product/specs/conversational-collections.md` | `2bc4920ce753b6f36f362b8c7bb1f446ab9c9a8cf599d10297c303bdb1455016` |
| `docs/collections/README.md` | `815ef72b6e283aed884a295ac1b630af76bdc3a20b09c3e67574d4da69a3fb1f` |
| `docs/collections/engine-api.md` | `950ded3b344fa41ca8504da42ba31e24ce970e3d47d616a7f9738cd5af8ee6d7` |
| `docs/collections/architecture.md` | `9350d8c34d3f24d6a81f45aa27a63f7f37437bfbae377182f603a5e890c1b09e` |
| `docs/collections/implementation-plan.md` | `e2677126db35e2f7161f5fbabe1ce889a5d1476f5043f7fe2efd2218eb076038` |
| `docs/collections/stories.md` | `caa4a20bbb3bcff0a142a06bdfcd815bd3450094959a0311d50929665a806d1a` |
| `docs/collections/story-manifest.json` | `f42220c1a2ad8b70c308e5147cd49313f6b3998ce28a408824ea2f04b65306a5` |
| `docs/collections/verification-plan.md` | `73fba2d8d42fa2b5b51ee5655ed9e8b139961e9886b51415ea779152e29808e0` |
| `docs/collections/engine-planning-review.md` | `ac4e26720b5e38ed26ef9b685dd4be1a9642d8b92f510bc4290199cdc58c4954` |
