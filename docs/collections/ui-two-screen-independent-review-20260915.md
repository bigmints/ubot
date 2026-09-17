# Independent review: Collections two-screen flow

Date: 2026-09-15 (Asia/Dubai). Story CC-S07: `work_d13698d7-9a40-4614-a77d-21b713a145f8`. Reviewer: separate non-authoring Codex session `01a09f15-dbcd-7e02-8d2b-e13ed1738ea9` (`/root/engine_plan_reviewer`).

## Final exact revision 23 verdict: pass for the focused flow review

Page SHA-256: `8e196a5769685a07479ca1479d57e1551bd6584c7122e7c85091257def6eabdd`. Author evidence SHA-256: `d1cfc156fba30270740276f4937d224b8ccb6ea4042c791fb238a48dd59f2204`. Factory specification remains approved revision 4, SHA-256 `18a32b15095746817c8c854034d0d0abd51a28960e989359535fd13aad7d0a82`. The reviewed page, specification, author evidence, shared dialog and API client hashes were captured before checks and verified unchanged afterward.

The final source implements the approved CC-01 direction: landing does not auto-select; Add opens focused name/type creation; successful creation replaces the creation URL with its editor URL; existing collection links open that focused editor; All collections and browser popstate return to the appropriate screen. List refresh no longer changes navigation, and detail responses are scoped to collection, navigation revision and request generation. `renderItemGrid()` retains stable DOM identity without a nested component boundary.

The remaining revision 21 findings are corrected. Search generations invalidate late owner responses on audience/navigation changes, and preview item selection unconditionally ignores owner search results. Source inspection checks request generation, navigation revision and collection identity; navigation invalidates the pending inspector and closes its UI. Loading-source dialogs already disallow normal dismissal until loading finishes; the relevant repaired navigation case is browser Back while the request is pending.

Independent source-derived harnesses executed the final `runSearch`, `inspectSource`, and `visibleItems` selection logic with deferred API responses. Results were `{ "staleSearchDiscarded": true, "sourceAfterNavigationDiscarded": true, "previewIgnoresDraftSearch": true }`.

Fresh independent checks on revision 23 all exited 0 from `youbot-core/web-ui`:

- `./node_modules/.bin/eslint app/concierge/collections/page.tsx`
- `./node_modules/.bin/tsc --noEmit`
- `npm run build` (production export includes `/concierge/collections`)

Retained view descriptors, agenda sorting, direct correction, source provenance, PDF/text authoring, jobs, proposals, checked selected publication and answer-preview handlers remain present. Owner controls/source links are excluded from preview, and preview uses published item data. Shared Radix dialogs and opener restoration remain. The focused source/async checks found no remaining blocker in these reviewed paths.

This pass is independent source/build and deferred-response verification. Browser visuals and live lifecycle actions remain author-attributed; this review does not claim independent browser-history, screen-reader, keyboard or full story/release verification. Human assessment of visual design remains separate.

## Historical revision 21 assessment: changes requested, not recorded

Reviewed page SHA-256: `60fd6d836a4566ca7764264e7e4af02434b6a69fe78174d5207bab2ee9d586a8`. Factory specification revision 4 SHA-256: `18a32b15095746817c8c854034d0d0abd51a28960e989359535fd13aad7d0a82`. Author evidence SHA-256: `1e7d39811eaf346b164ae890690bd6d7483618dcfbd2b87a0b4cba7a44d5ea05`. These and the unchanged dialog/API client files remained stable before and after final checks. Spacecrew context was refreshed and ready, without warnings or blockers.

The initial nested-component and forced-reselection defects below are corrected: `renderItemGrid()` now renders JSX without a new component boundary; list refresh no longer sets navigation state; detail loading checks collection identity, navigation revision and request generation. Landing, focused creation and editor branches implement CC-01 in source, with explicit URL changes and popstate synchronization.

Two asynchronous correctness issues remain:

1. **Published-only preview can render owner draft search results (criterion 3, CC-20).** Start a search in collection A, switch to Visitor preview before the search resolves, then resolve the owner search with an unpublished item. The preview switch clears results, but `runSearch` checks only the still-equal collection ID before storing its response. `visibleItems` returns `searchResults` before checking `preview`, so the unpublished item appears under Published items. A source-derived deferred-response harness executed the current `runSearch` function with its mocked API and followed the actual result-selection expression: `{ "preview": true, "publishedCount": 0, "visibleItemIds": ["draft-only"] }`. This verifies owner-preview misrepresentation; it is not evidence of leakage through a public endpoint. Invalidate search on audience/navigation changes and ensure preview selection cannot prefer owner search results.
2. **A source inspector can reopen after navigation (criterion 3).** `inspectSource` unconditionally stores its response. Browser Back while the request remains outstanding can leave the collection, after which a late response repopulates `sourceReview`; the globally rendered dialog opens again with the previous collection's source. Guard the request with source-request/navigation identity and invalidate it on navigation. This was source-inspected, not independently replayed in a browser. The initial account incorrectly suggested normal dismissal while loading; source inspection confirms that dismissal was already disabled during loading.

Independent commands, all from `youbot-core/web-ui`, exited 0 on the exact revision 21 source:

- `./node_modules/.bin/eslint app/concierge/collections/page.tsx`
- `./node_modules/.bin/tsc --noEmit`
- `npm run build` (includes `/concierge/collections` in the production export)

No independent browser, keyboard, or live mutation replay is claimed. Author browser observations remain attributed to the author. Build success does not close the two findings above. This is a focused flow/retained-behavior review, not exhaustive story or release verification.

## Initial revision 19 findings

Review began against Factory `conversational-collections` revision 4, particularly CC-01, and the story's retained view, mutation, accessibility and privacy criteria. The initial author evidence named page SHA-256 `8bf64470021b5ec6bb2df0724428258d92338137c49a7f105994db8899e97ab9`.

1. **Search and dialog focus regression:** `ItemGrid` was defined inside `CollectionsPage` and rendered through `<ItemGrid/>`. A parent state change creates a different React component type, remounting the grid. Search typing updates parent state, so the input loses its DOM identity/focus. Opening a source/editor dialog similarly disconnects the saved opener before focus restoration. Keep the grid component type stable or render its JSX without creating a nested component boundary.
2. **Navigation overwritten by delayed completion:** mutation completion called `loadCollections(selectedCollection.id)`, which unconditionally changed `selectedId`. Navigating back to the list or another collection during an in-flight mutation could therefore reopen the original collection without changing the URL. Detail requests also committed results without checking whether their navigation target remained current. Decouple refresh from navigation and discard or scope stale completion effects.

The initial source otherwise showed the requested list, focused creation, and focused editor branches. List loading no longer auto-selected the first collection; explicit navigation used `pushState`, creation used `replaceState`, and `popstate` synchronized query state. Those nominal paths alone do not resolve the asynchronous cases above.

## Initial verification status

The source changed while review was underway. Targeted ESLint and TypeScript passed on interim page SHA-256 `c1d6ec8fac75bc169ae6fdbf8007cf6e7b07739132ae89680c49674e10f7bd0f`; these are not an exact revision 19 signoff. The independent production-build attempt stopped because another Next.js build held the build lock, so no build pass is claimed for that attempt.

Spacecrew initially reported `readyForWork=false` because the required canonical specification registration was stale. The coordinator refreshed that original registration before the final review. No implementation changes were made by this reviewer, and no revision 19 or 21 verdict was recorded against source that changed during review. The revision 23 assessment above is the final review.
