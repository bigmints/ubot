# Conversational collections planning review

Date: 2026-09-14. Reviewer: `collections_quality`, separate specialist session `/root/collections_quality`.

**Verdict: pass for the planning package and persisted assignment handoff, with the explicit boundaries below.** This is not product approval, implementation acceptance, a live model/provider verdict, installed application verification, native Codex MCP activation proof, or release permission.

## Review scope and independence

Reviewed the current package README, setup handoff, Factory draft specification revision 1, architecture, implementation plan, stories, final manifest and specialist profiles. Independently compared actual Spacecrew CLI readback with those files. The reviewer did not author the specification, architecture, plan, stories, manifest, project initialization or assignment records. The reviewer authored the verification plan, so verification-plan coverage checks are self-verification; they are not represented as independent review of that document's authorship. This review file records planning findings only and does not mutate harness evidence or approve implementation.

## Independently observed evidence

| Check | Observed result |
| --- | --- |
| `spacecrew work.list` and sampled `work.get` | Twelve implementation records match manifest work IDs, revision 2, exact acceptance text, named specialist/profile and dependency work IDs. All twelve are `blocked`; each next action explicitly says assignment only and no execution dispatched. One additional active planning record is `work_77530189-4a00-4a53-b867-3c3fc3956d67`, observed at revision 1 during this review. |
| Assignment/dependency validation | Exactly 12 distinct story IDs, eight distinct named specialists with existing persistent profile files, complete CC-01 through CC-24 requirement coverage, valid direct dependency references, matching dependency work IDs and an acyclic graph. All twelve explicit `cc-s01` through `cc-s12` story anchors exist. |
| `spacecrew knowledge.list` plus local SHA-256 comparison | All 21 registered documents match their current file digests after the coordinator refreshed the setup document. No digest mismatch remains in this readback. |
| `spacecrew health.check` | Database integrity `ok`, `healthy: true`, `runs: []`, no stale evidence, no stale review evidence and no review-due records. This establishes the observed local project state, not application runtime behavior. |
| Selected `spacecrew context.get` | Reviewer role, CC-S11 work ID and `maxCharacters: 50000` returned project `project_5959df4c-f72a-4e90-b42a-3e8371153e7f`, `readyForWork: true`, no warnings and no blocked reasons. Context completeness was `partial`; readiness does not mean every optional document was included. Other role checks were coordinator-reported, not rerun by this reviewer. |
| Documentation links and boundaries | Required reviewed source documents and profile targets exist. At inspection, README links to this new review and the coordinator's forthcoming `planning-validation.json` were pending; final package validation must confirm both artifacts exist before closeout. Specification remains draft; assignment records do not imply active implementation agents or a scheduler. |

The setup initially showed one changed registered digest for `spacecrew-setup.md`. The coordinator refreshed that original through the supported registration operation, and the reviewer reran health and all registered digest comparisons successfully. No internal harness database was edited by this reviewer.

## Product and technical consistency

The stories and technical plan preserve the proposed outcome: dedicated collection authoring inside Your concierge, typed properties/classes/generic content, private sources, draft review, explicit publication and visitor answers from current permitted canonical content. Current PDF extraction/truncation and transaction-interface gaps are identified as implementation work, not described as validated foundations.

The acceptance and verification coverage includes reimport identity and correction precedence; unknown typed values; explicit dated sessions and unsupported recurrence; concurrent edits/undo; source/privacy isolation; stale index, conversation and queued-dispatch content; owner-set expiry; visitor preview without side effects; and existing `answerFromKnowledge`, takeover, financial and booking policies. Migration and restore evidence is deferred to isolated installed-runtime checks. No source/schema declaration is used as proof of successful rollback or deployed persistence.

Earlier actionable planning inconsistencies were resolved and reread: architecture module scope now agrees with the stories, known per-term price basis is represented, preview resolves only the current publication server-side, and release stories identify the actual root launcher/package scripts. No unresolved blocking inconsistency was found in this planning scope.

## Reviewed source identities

| Original | SHA-256 |
| --- | --- |
| `.factory/product/specs/conversational-collections.md` | `f1c35298bdc9ce24e969d0725c0165d7c76ee180c4aa52db64a1d63373e11a66` |
| `docs/collections/story-manifest.json` | `5c324d41f431c19af754ce20c30d917b6696936c53723c91784a2bc0c2882ef0` |
| `docs/collections/architecture.md` | `bb3bea0915471a09d787267c4d7ed62c9657abc4f3d60dcde5616414e08d2c0e` |
| `docs/collections/implementation-plan.md` | `5e9adef0af04fed92fd22c0ddc7543459e40477225cc91ab1c28be4b72510f15` |
| `docs/collections/README.md` | `ddc631c4b70bb30268093e98393be1d9b4829785e7ac4a0e793c51b29a73594b` |
| `docs/collections/spacecrew-setup.md` | `4256e2ccb04a0653aa2277ffb94db0b6bf503109f7b0b82b161a04504099f626` |

## Remaining decisions and evidence limits

- Human approval of the exact new product revision and the existing visual approval are pending. The setup records inherited Factory drift on the prior `concierge-v1-experience` approved baseline. That coordinator-reported concern must be reconciled before accepting its amendment; current Spacecrew digest freshness does not restore historical Factory approval.
- Spacecrew 0.5.9 persists assignment through named profiles and explicit `nextAction` text. The manifest is the direct dependency mapping. These are durable handoffs, not native assignee fields, enforced dependency scheduling or running implementation sessions.
- The coordinator reports that a direct MCP client discovered 25 tools and the correct project identity. This reviewer independently checked the CLI boundary only and did not rerun that MCP transport test. Fresh-task native Codex activation remains unverified.
- Fikr Studio summary transmission remains pending a callable/configured MCP connection. The saved summary is recovery content, not evidence of delivery.
- All collection feature, model/provider, responsive application, authenticated application persistence, migration, installed package and external visitor-delivery checks remain future implementation work. None passed merely because this planning review passed.

The coordinator should register the final review/validation artifacts, retain their exact digests and obtain the separate supported work-review decision on the final planning work revision. Changes after these identities require appropriate rereview; this document does not approve unseen revisions.
