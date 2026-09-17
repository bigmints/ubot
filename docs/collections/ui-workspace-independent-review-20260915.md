# Collections workspace redesign: independent review

Date: 2026-09-15 (Asia/Dubai). Story: CC-S07, `work_d13698d7-9a40-4614-a77d-21b713a145f8`, revision **12**.

Reviewer: separate non-authoring Codex specialist session `01a09f15-dbcd-7e02-8d2b-e13ed1738ea9` (`/root/engine_plan_reviewer`). No implementation changes were made during this review.

## Verdict and scope

**Pass for the three-pane workspace redesign at this revision.** No actionable regression was found in the requested layout, retained handlers, owner-preview boundaries, or dialog implementation. This is a source-and-build review of the redesign, with the author's browser measurements explicitly attributed below. It does not independently establish every domain/layout semantic edge, clean-machine persistence, full keyboard/browser coverage, product approval, or release readiness.

## Exact source identity

The following SHA-256 values were captured before verification and checked unchanged afterward:

| File | SHA-256 |
| --- | --- |
| `youbot-core/web-ui/app/concierge/collections/page.tsx` | `3bf72792182ed20f27f628c3fec596460906e08bacc98210d61b511c70eaf83f` |
| `youbot-core/web-ui/components/ui/dialog.tsx` | `0596a93da7e192fd71780e43d1b7d9dcb55e98590b9f1240c3b3a14a06e63b91` |
| `youbot-core/web-ui/lib/concierge.ts` | `97bfc2aed52859a79ea47c869ee9cfa6601eb031dd35c0cb92130b6dc1101bda` |
| `docs/collections/evidence/ui-workspace-redesign-20260915.md` | `95e3a500273eb91a74e8cc60396b99bb60acfcfef59318fdefb3883489141441` |

## Independently executed checks

Working directory: `youbot-core/web-ui`.

- `./node_modules/.bin/eslint app/concierge/collections/page.tsx`: exit 0, no diagnostics.
- `./node_modules/.bin/tsc --noEmit`: exit 0, no diagnostics.
- `npm run build`: exit 0; production export includes `/concierge/collections`.

## Acceptance and regression assessment

1. **Saved views and canonical data:** the redesign continues to read the saved view descriptor and collection schema for displayed item fields and layout fallback. It does not introduce a view-generation request or replace the canonical data path. Restart persistence and the semantics of every allowlisted layout were not rerun in this focused review.
2. **Owner review and publication:** source inspection, direct correction, proposal review/application, selected publication, search, PDF authoring, durable-job retry/hydration, and answer-preview handlers remain wired. Item selection/editing, source links, and proposal application are gated out of preview. Reviewed publication still uses the shared backend API; this review did not independently replay each mutation.
3. **Responsive layout, accessibility and privacy:** the outer desktop grid reserves a 240 px collection rail. The inner grid places catalogue first and the 360 px private assistant second at `xl`; explicit order classes put the assistant before the catalogue on mobile. The assistant is absent in preview. Source/editor dialogs use the shared Radix modal primitives, accessible titles/descriptions, labelled controls, and explicit restoration to the recorded connected opener through `onCloseAutoFocus`. The prior custom-dialog implementation is no longer present. Published items are used for the owner visitor preview; bounded source passages stay in the owner inspector. Owner-authenticated preview state is not a public visitor endpoint.

The author evidence records desktop rail/catalogue/assistant x coordinates of 288/544/868 and mobile (390 x 844) rail/assistant/catalogue y coordinates of 188/507/1168. These support the inspected breakpoint classes. The reviewer did **not** independently replay browser geometry, keyboard interactions, or the application health request, and does not claim those measurements as independent observations.

Non-blocking observation: in desktop visitor preview the hidden assistant leaves the inner grid's reserved second column. This does not invalidate the requested authoring layout; a wider preview canvas can be considered separately.

## Workflow context

Spacecrew context was ready for work with no blocking sources. It warned that registered architecture and engine API documents had changed and were excluded. This review read the current implementation and original redesign evidence directly; it does not attest that those unrelated registrations are fresh. Story review does not grant product or release approval.
