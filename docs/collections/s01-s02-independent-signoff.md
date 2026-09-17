# Independent S01/S02 supplemental signoff

Date: 2026-09-14. **Verdict: PASS for both repaired native stories on the exact revisions below.** Reviewer `/root/engine_plan_reviewer` is a separate non-authoring specialist. The earlier [implementation review](implementation-independent-signoff.md) and [final implementation signoff](implementation-final-independent-signoff.md) remain unchanged historical evidence; this supplement resolves only their S01/S02 findings against the new frozen input.

Fresh reviewer actor: `codex:01a09f15-dbcd-7e02-8d2b-e13ed1738ea9:s01-s02-supplemental-review-05b630d5-7bc7-4c2e-b8c5-2873bdc25878`; session `session_de126d38-b51c-415b-a570-20bd9563019e`. Actual independence comes from the separate non-authoring specialist, not a caller-declared actor label. Spacecrew context was ready with no warnings/blocked reasons, and native acceptance/status/revisions were read directly before review.

## Exact evidence

- Retained evidence: [S01/S02 closeout](evidence/s01-s02-closeout-20260914T152657Z/README.md), SHA-256 `e0c103c5876a9ea442f6ef3dbfd37fc9df28433482c4a93dc62b843b34655fcc`.
- Captured package: `docs/collections/evidence/s01-s02-closeout-20260914T152657Z/tested-youbot-collection-engine-0.1.0.tgz`, SHA-256 `862e556ef7079dec6043f3536b10d148375d4549cc8ed1c90251cff471ee6807`.
- Every retained `SHA256SUMS` entry and all five current files in `independent-source-hashes.json` matched. The exact retained tarball was extracted outside the repository for public-export migration probes.
- The repository remains a dirty implementation tree; baseline HEAD alone is not the tested identity. The retained artifact, source hashes and this supplemental scope identify the review.

## Independent checks and outcomes

| Check executed by this reviewer | Outcome |
| --- | --- |
| `npm test -- src/concierge/collections/__tests__/pdf-intake.test.ts src/concierge/collections/__tests__/pdf-intake-timeout.test.ts` from youbot-core |6/6 pass on frozen matching source: real PDF parser, dense36-page/1,728-row property/class/service fixture above100,000 extracted characters, malformed/partial inputs, setup/getText/cleanup deadline cases. |
| `node /Users/pretheesh/Projects/youbot/youbot-core/node_modules/vitest/vitest.mjs run --root /tmp/s01-deadline-independent deadline.test.ts` |1/1 pass. The independent previously failing case has getText resolve immediately while destroy never resolves; the whole application operation now rejects by the configured deadline instead of remaining pending. |
| `node /tmp/s02-migration-independent/probe.mjs` against the extracted retained tarball |PASS. A valid v0 primary plus dangling backup symlink now fails initialization while leaving primary bytes unchanged. Backup ENOENT is no longer interpreted as missing primary. |
| `node /tmp/s02-migration-independent/interruption.mjs` against that tarball |PASS. A real child exits73 immediately after writing the migration backup. Original v0 primary and exact-byte0600 backup remain intact. Only after observing child exit, the test removes the orphan lock through the documented recovery step. Reopen migrates successfully; the canonical entity is unchanged except catalogRevision, public/private visitor readback is correct, and a second restart succeeds. |
| `npm test` from the package during independent pre-freeze execution, followed by final source/artifact identity matching |21/21 pass, including valid migration, unsupported/missing/malformed version rejection, conflicting/dangling backup preservation, concurrency, public contracts and previous engine regressions. This suite was executed independently before freeze on the same five matched inputs; the decisive probes above were rerun after freeze. |

The source copies of all three reviewer probes are preserved in the retained closeout directory, with matching hashes. Their temporary execution copies use isolated fixture data only. Retained external-consumer and13-file/97-test host logs were checked and attributed to their recorded runner; they are not falsely claimed as new reviewer executions here.

## Native criterion decisions

| Story / exact revision | Decision and basis |
| --- | --- |
| **CC-S01** `work_62ce2939-c249-4b6d-b017-bdf73845c30d` **revision14** |**PASS.** Criterion1: current architecture/API describe the actual JSON repository, checked transaction/snapshot/source/query/dispatch and trusted identity boundaries. Criterion2: the existing size/page/content limits now have a configured30-second application lifecycle deadline, real-parser sparse boundary observations, and a dense multi-domain text-PDF fixture demonstrating page/content retention beyond the old100k cutoff. The independently reproduced cleanup hang is repaired. Criterion3: provider access stays behind the existing authorized host configuration/model boundary; no new credentials or provider calls were introduced by this work. The tested supported clean text-PDF workload and application deadline fulfill the native implementation decision; broad customer/adversarial capacity is not claimed. |
| **CC-S02** `work_8127313b-be59-4886-a9db-ae19bba4d263` **revision13** |**PASS.** Criterion1: a documented supported pre-release schema0-to1 path now preserves entity collections, typed values/relations, source/provenance, changes, publication, evidence and idempotency state; it derives catalogRevision, saves exact prior bytes and atomically replaces primary state under the repository lock. Criterion2: checked writes and stale revisions retain their prior passing evidence; migration backup conflicts/failures cannot reset primary data. Criterion3: independent process interruption, explicit stale-lock recovery, migration retry and restarted visitor readback demonstrate canonical preservation. Earlier typed-reference and temporal rejection evidence remains applicable. Unsupported formats fail closed rather than receiving invented conversions. |

## Limits retained

The application deadline is not hard CPU preemption: event-loop starvation can delay timer delivery, and parser CPU/RSS isolation is not established. The dense fixture is deterministic clean text covering the intended domains, not a production accuracy/latency guarantee for every customer PDF, adversarial layout, OCR or other operating system. These limits remain explicit and must not be erased from release planning.

The migration guarantee is the declared pre-release schema0-to1 format and reliable local atomic filesystem behavior. Process-interruption recovery was exercised; sudden power-loss/fsync durability, arbitrary historical schemas, distributed writers/filesystems, clean-machine installation and broad platform rollout were not. Stale-lock removal in the test occurred only after confirming the writer process exited. The backup is private data and preserved exactly.

This supplement grants no deployment, package publication, product/design change or release permission. It does not review or close other stories. Factory remains canonical authority; full system/acceptance and release gates retain their own evidence requirements. No implementation files were edited by this reviewer and no external handoff is claimed.
