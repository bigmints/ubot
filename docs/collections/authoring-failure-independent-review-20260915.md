# Collections authoring failure: independent review

Date: 2026-09-15. Reviewer: separate Codex agent `/root/collection_failure_review`, using reviewer Spacecrew session `session_12d9a4b3-5fd3-417a-92ad-1b11e4890f31`. Implementation was performed by other agents; this reviewer made no source edits.

Verdict: **passed for the scoped authoring failure repair**, with the live provider and running app recovery check still separate. This is not a release approval or a new visual acceptance verdict.

## Reviewed source

| File | SHA256 |
| --- | --- |
| `youbot-core/src/concierge/collections/routes.ts` | `3ad50a4c547cc685d541d42e5ea68ee0039565108812ca8b1c73e030cabbaf26` |
| `youbot-core/src/concierge/collections/__tests__/routes.test.ts` | `7f19a45e52e73076a7fefe104cc591f7f3b5e4d00ca50850e5cff413a9471010` |
| `youbot-core/web-ui/app/concierge/collections/page.tsx` | `577b8044cf6a067c25d8e0e3de40fd378f55200c4549aed8ae2142a7fec4a2ae` |

The frontend hash includes a concurrent collection-name breadcrumb import/effect outside this repair. It was preserved. The scoped review covers authoring failure, recovery actions, notices and history; it is not a review of the surrounding unrelated working tree.

## Findings and resolution

- The host prompt now gives the exact operation contract (`kind`, `values`, evidence arrays and allowed evidence keys). Host validation rejects malformed operations before saving generated data and requires material changes to cite the actual supplied source. The reusable engine continues to enforce its own final validation and authorization.
- Invalid model output receives at most two generation attempts per organization attempt. Repeated invalid output leaves the original source saved, with a pending recoverable job and an honest warning. It does not become a proposal-ready success.
- Legacy jobs with invalid saved generated data expose recovery to the owner. Retry clears the invalid generated payload under the existing job lease and reuses the existing source and ingestion. A payload-specific proposal request key avoids replaying the earlier invalid payload's idempotency receipt.
- The UI exposes interrupted jobs on the owner screen, including empty collections, and hides that recovery panel in visitor preview. Failed concierge history no longer displays its old proposal-ready wording. Publication remains an explicit separate action.
- Initial review found that retry success copy still trusted `needs-review` without a proposal. The implementer fixed this: success now requires a returned proposal or the matching proposal in the returned view. The banner heading was also corrected to “needs attention” so non-recoverable clarification states do not promise a retry action.
- No blocking regression was identified in these scoped changes. Existing collection navigation, source request guards and published-item preview selection remain intact. The older collection-ID-only completion guards in some mutation handlers were not expanded by this repair; an exhaustive A-to-B-to-A race audit was not performed here.

## Independently executed checks

| Check | Result |
| --- | --- |
| `npx vitest run src/concierge/collections/__tests__/routes.test.ts` in `youbot-core` | Passed: 13 tests, including malformed response repair, bounded invalid regeneration, legacy job recovery, one persisted source/ingest/proposal, authorization and existing retry/concurrency coverage. |
| `npx eslint app/concierge/collections/page.tsx` in `youbot-core/web-ui` | Passed on final frontend hash. |
| `npx tsc --noEmit --pretty false` in `youbot-core/web-ui` | Passed earlier in this review before the final copy/gate edits and concurrent breadcrumb effect. This reviewer did not claim it as final-hash build evidence. |

These checks use deterministic model fixtures. They establish the repaired contract and persistence behavior, not semantic reliability of a live LLM. The implementation team's full suite/build results and the coordinator's actual saved-job recovery in the running app must be recorded in their own evidence. No independent browser, live provider, installed package or external visitor-channel check was performed in this review.

The coordinator's [runtime evidence](evidence/authoring-live-failure-20260915.md) reports the repaired build running on port 5080. Actual configured-model replay of the saved job remains pending owner login after restart. That runtime boundary was read for this review; the reviewer did not perform the login or model replay. Source hashes were rechecked unchanged before attaching this verdict to work revision 32.

This report relates to Factory task `collections-ui-two-step-20260915` and Spacecrew CC-S07 `work_d13698d7-9a40-4614-a77d-21b713a145f8` revision 32, particularly visible failure/recovery and source-preserving authoring. Historical whole-feature acceptance and visual approval boundaries remain unchanged.
