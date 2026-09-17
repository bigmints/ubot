# Independent review: collections workspace rebuild

Date: 2026-09-15 (Asia/Dubai). CC-S07, `work_d13698d7-9a40-4614-a77d-21b713a145f8`, exact revision **17**. Separate non-authoring reviewer session: `01a09f15-dbcd-7e02-8d2b-e13ed1738ea9` (`/root/engine_plan_reviewer`).

**Verdict: pass for the scoped workspace rebuild and retained behavior.** No blocking source or build regression was found. This technical review does not approve the visual design on the owner's behalf; the owner's rejection of revision 12 is not superseded by a technical pass.

The revision 14 review attempt was rejected because the story was active. After the coordinator corrected DOM order and submitted revision 17, this reviewer inspected the final source and reran all checks below.

## Independent verification

All commands ran from `youbot-core/web-ui` and exited 0:

- `./node_modules/.bin/eslint app/concierge/collections/page.tsx`
- `./node_modules/.bin/tsc --noEmit`
- `npm run build` (production export includes `/concierge/collections`)

Before/after SHA-256 comparison found every reviewed file unchanged:

| File | SHA-256 |
| --- | --- |
| `youbot-core/web-ui/app/concierge/collections/page.tsx` | `52fa933747daeed8321a7b8bf5583de988a212f26ae3afce4dff04da63ad8c90` |
| `youbot-core/web-ui/components/ui/dialog.tsx` | `0596a93da7e192fd71780e43d1b7d9dcb55e98590b9f1240c3b3a14a06e63b91` |
| `youbot-core/web-ui/lib/concierge.ts` | `97bfc2aed52859a79ea47c869ee9cfa6601eb031dd35c0cb92130b6dc1101bda` |
| `docs/collections/evidence/ui-workspace-rebuild-a11y-20260915.md` | `673ea5e3a7556923cf6c9863544765590e51d5791077466dfe9c96f6bd3a872c` |

## Source assessment

- **Hierarchy:** one border-divided workspace replaces the competing outer cards. The page title and new-collection action are explicit. The collection rail uses `xl:grid-cols-[212px_minmax(0,1fr)]`; the content/assistant split uses `xl:grid-cols-[minmax(0,1fr)_336px]`. The catalogue receives the flexible region. The assistant is a flush muted panel; item cards have no hover translation or heavy shadow. Actual proportional prominence still depends on viewport width.
- **Narrow layout and source order:** the catalogue now precedes the assistant in the DOM, with no CSS order override on either panel. The natural narrow visual order and reading/focus sequence therefore begin with the catalogue; desktop grid placement retains the assistant on the right. The collection strip scrolls horizontally below `xl`. This resolves the source-order concern observed in revision 14; actual keyboard and screen-reader interactions were not replayed.
- **Criteria 1–2, retained behavior:** saved view/schema data still drives rendering, including agenda sorting and the detail fallback. Authoring, PDF processing, durable-job retry/hydration, proposal application, direct correction, source inspection, search, answer preview and selected publication remain connected. Publication still retrieves the reviewed payload hash and posts the selected IDs with revision checks. The rebuild introduces no replacement generation or persistence path. Full layout semantics and restart behavior were not retested.
- **Criterion 3, boundaries and dialogs:** preview uses published items and the visitor-audience request. Assistant, proposal application, item selection/editing and source links are guarded out of preview; publication is disabled there. The owner preview remains authenticated owner UI, not a public visitor surface. The unchanged Radix dialog component, accessible titles/descriptions, field labels and connected-opener focus restoration remain in place.

## Evidence limits

The author's [rebuild report](evidence/ui-workspace-rebuild-20260915.md) and [accessibility follow-up](evidence/ui-workspace-rebuild-a11y-20260915.md) report desktop and narrow Chrome inspection with no horizontal overflow. Those are author observations; this reviewer performed source inspection and the commands above, not a new browser or keyboard session. No implementation changes were made. Spacecrew context was ready with no warnings or blocking sources. This review does not establish full story acceptance, human design approval, or release readiness.
