# Independent review: focused collection editor

Date: 2026-09-15 (Asia/Dubai). CC-S07: `work_d13698d7-9a40-4614-a77d-21b713a145f8`. Separate non-authoring reviewer session: `01a09f15-dbcd-7e02-8d2b-e13ed1738ea9` (`/root/engine_plan_reviewer`). Review began at revision 24, recorded an earlier pass at revision 26, and now covers the final proposal-value addition at exact submitted revision **29**. This report does not close the work.

**Historical verdict: pass for the focused editor follow-up at exact revision 26**, recorded as `review_1230afc1-866a-433b-9394-e1006ceaeb29`. No blocking regression was found in the inspected changes. This is source inspection, independent lint/type verification and source-derived deferred-response checking, not independent visual approval or complete story acceptance. The subsequent proposal-value follow-up below requires its own exact-revision record.

## Final revision 29 verdict: pass for the proposal-value follow-up

Inspected frozen page SHA-256 `ec8f21f18d18596f872ff465140b43e7057c34470eb0da79bf00f475fc874332` while work revision 27 was active, then confirmed unchanged at submitted revision 29. No blocking issue was found in this narrow addition. The earlier editor/race review remains applicable to its unchanged surrounding behavior, with the same evidence limits.

Each operation with supplied values now renders a read-only definition list beneath its summary. Labels resolve from the canonical schema, then a matching proposed schema field, then a readable field-ID fallback. Values use the existing `displayValue` helper, including explicit Unknown for absent/null values, readable booleans/arrays and currency-bearing money objects. React text interpolation avoids treating supplied labels/values as HTML, and whitespace/wrapping styles accommodate longer text. Operations without a values object retain their summary. This adds visibility before application without introducing another action or changing approval/publication handlers.

Targeted ESLint and TypeScript no-emit checks were independently rerun on this frozen source and both exited 0. No competing build or new browser replay was run. The reviewer read the final coordinator fixture: it waits for the exact proposed name `Design consultation` before clicking Apply, and its results report `passed: true` with no page errors. Those executed browser/build checks remain coordinator-attributed. The final author evidence SHA-256 is `8b39ad2c97defaac1f71f63ce371dfa577dbb301caf82c63c058e41a9eae3520`; the CSS hash remains unchanged. Work was confirmed at revision 29, status `review`, immediately before recording this verdict.

## Reviewed source

- `youbot-core/web-ui/app/concierge/collections/page.tsx`: SHA-256 `5442658346ee7ffc3c63abbc94cbe4fb0736bc3ebd53826d7ab12057d966f588` after the source-name visibility correction.
- `youbot-core/web-ui/app/globals.css`: SHA-256 `dc7912514c897904dc0e592dbb493ad274544bcf6064beecf97adbe07529bb89`. Only the final `.workspace-content .collections-page .collection-editor h1` rule is within this CSS review's scope.

The scoped title rule matches the page/editor ancestry and makes the editor title 24 px without selecting the collection gallery or creation screen headings.

## Behavior inspected

- The collection gallery and name/type creation branches remain separate from the focused editor. URL push/replace/popstate handling, decoupled list refresh and detail request/navigation guards remain present.
- Empty collections show the composer without a duplicate empty item grid. Populated collections show item cards; Add items opens the composer and requests textarea focus. Closing it hides the composer while retaining the draft for reopening. Collection changes reset draft/source label and composer visibility.
- One form dispatches either text or PDF authoring. A selected PDF shows its filename, disables text entry, and can be removed before submitting; copy explains that existing text is retained. File validation, retry identity, loading feedback and recoverable job controls remain. The optional source-name field is now hidden for PDFs, addressing the review note that the PDF handler does not consume `sourceLabel`.
- A pending proposal appears before the composer/items. Unresolved issues disable application. Applying updates the draft and hides the composer; publication remains a separate action with selected IDs, an explicit confirmation, reviewed payload hash and revision checks. The publication control is disabled while a proposal or operation is active and is absent from visitor preview.
- `renderItemGrid()` remains an ordinary JSX helper, preserving the prior focus-stability repair. Source/editor dialogs still use Radix with titles, labels and connected-opener restoration. Owner authoring, proposal and source controls remain outside the preview branch.

## Independent checks

After the coordinator reported its production build complete, these commands exited 0 from `youbot-core/web-ui`:

- `./node_modules/.bin/eslint app/concierge/collections/page.tsx`
- `./node_modules/.bin/tsc --noEmit`

A source-derived harness executed current search/source-inspection functions with deferred API responses and the current item-selection expression. Results: `{ "staleSearchDiscarded": true, "sourceAfterNavigationDiscarded": true, "previewIgnoresDraftSearch": true }`. These protect the previously identified late-response and published-preview cases.

No competing production build was started, as requested. The coordinator's build/export and browser QA are separately attributed evidence. No independent browser, keyboard/screen-reader, upload, provider, or live publication replay is claimed. The reported blocked Factory controller resume is not treated as a successful controller run or a release gate pass. No product source was changed by this reviewer.

## Historical revision 26 evidence freshness and attribution

Immediately before recording the revision 26 verdict, both reviewed source hashes still matched the values above. Spacecrew status was `review`, and its reviewer context was ready with no warnings or blockers.

The coordinator's final [editor evidence](evidence/ui-editor-reimagine-20260915.md), SHA-256 `4add9d643f68b8b95a9ad74cd0d1199db559ba55103eecfde06fe1bd9505451a`, records the production build/export and browser fixture results. The reviewer read `output/playwright/collections-editor/results.json`: it reports `passed: true`, a 24 px heading, viewport widths 833 and 390, and no page errors. Its checks cover empty controls, overflow, PDF attachment/removal, failed submission, proposal/application, draft retention, Add focus, draft exclusion in preview, explicit publication, and gallery/create/back navigation. These browser results are coordinator-executed fixture evidence, not independently replayed interactions or proof of live parsing/publication/delivery. Final human visual approval and controller completion remain separate.
