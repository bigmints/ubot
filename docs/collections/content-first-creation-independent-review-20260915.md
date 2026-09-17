# Content-first collection creation: independent review

Date: 2026-09-15. Reviewer: separate Codex agent `/root/collection_failure_review`. The reviewer made no implementation edits.

Verdict: **passed for the scoped content-first creation implementation and deterministic route regressions**. Actual configured-model creation and rendered browser acceptance remain separate checks. This review does not grant release permission.

## Exact source

| File | SHA256 |
| --- | --- |
| `youbot-core/web-ui/app/concierge/collections/page.tsx` | `0462a840cad1bdc65cd4d97693647674f7785e5795771e0f0c0886202d174fd8` |
| `youbot-core/src/concierge/collections/routes.ts` | `a26a9bea8fcbb6be723ce97972445e6c1a40c61250b3efa121839586b10d241c` |
| `youbot-core/src/concierge/collections/__tests__/routes.test.ts` | `22dd3b47e388545187fced99fe4d23e58c56573705a0080781eb5b6115b6d40b` |

Review targets canonical conversational collections specification revision 5, particularly CC-01 content-first creation and CC-02 owner boundaries. Concurrent toolbar, layout and breadcrumb changes are preserved in these files but are not represented as independently reviewed by this scoped verdict.

## Review findings

- The creation screen accepts text or a PDF directly. The host first obtains a bounded, validated name/preset/category suggestion, then creates the collection and submits the same source through the existing authoring pipeline. It does not require the old manual name/type form or automatically publish data.
- `/suggest` requires an authenticated owner before PDF parsing or model generation. It only derives metadata: the route does not create a collection, ingest a source or save original PDFs. PDF extraction stays in Youbot; the reusable engine remains unchanged.
- Suggestion validation allows only the documented keys and presets, bounds the name, and requires a short category slug. Whitespace-only names already fail `proposalString` because it rejects empty trimmed strings. Invalid model suggestions stop after two attempts with a truthful retryable error.
- The frontend caches the accepted suggestion and stable create/content operation IDs before saving. A lost response retry in the same mounted page reuses the exact name/category, source and request IDs, preventing an accidental new collection or source. The existing engine/host handles idempotent mutations. The cache is in memory; this review does not claim recovery after page reload or browser crash.
- Navigation generation checks prevent late suggestion, creation or authoring responses from redirecting the user away from another screen. The current creation attempt can resume after returning to the creation screen.
- Review identified that locking the input after saving began initially left no way to abandon a failed attempt. The implementer added **Use different information**, which explicitly clears the cached attempt and unlocks the preserved input while explaining that any saved draft remains in Collections. Ordinary **Try again** retains the existing operation identities.
- Errors keep the supplied text/PDF available. Failed/pending organization reaches the existing editor recovery states; successful copy is conditioned on an actual proposal. Existing explicit publication and visitor-preview boundaries remain intact.

No blocking finding remained in the reviewed changes.

## Independent verification

- `npx vitest run src/concierge/collections/__tests__/routes.test.ts` in `youbot-core`: **16/16 passed**. Added scenarios cover text suggestions without mutation, category preservation and idempotent creation, PDF suggestion through host extraction without source persistence, and bounded invalid suggestions. Existing authoring repair, retry, provenance and visitor-preview regressions also passed.
- `npx eslint app/concierge/collections/page.tsx` in `youbot-core/web-ui`: **passed on the final frontend hash**.
- Source inspection covered creation request ordering, preserved inputs/IDs, navigation guards, owner authorization, name/category validation and the explicit reset action.

The tests use deterministic model fixtures. This reviewer did not perform a browser/network-fault simulation, real PDF/provider creation in the running UI, live owner login, installed-package verification or external visitor-channel testing. The coordinator is recording build and browser evidence separately; a sign-in screen is not evidence of a completed live creation.

This scoped verdict is attached to Spacecrew CC-S07 `work_d13698d7-9a40-4614-a77d-21b713a145f8` revision 35. The coordinator's [implementation evidence](evidence/content-first-creation-20260915.md) is separate. Signed-in visual and actual configured-model verification remain pending; a passing code/automated-check verdict does not complete those checks.
