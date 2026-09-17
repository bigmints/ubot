# Youbot Spacecrew setup and specialist handoff

Initialized 2026-09-14 with installed Spacecrew 0.5.9 and pinned `spacecrew-core@0.1.2`.

Project ID: `project_5959df4c-f72a-4e90-b42a-3e8371153e7f`.
Project root: `/Users/pretheesh/Projects/youbot`.
Planning work ID: `work_77530189-4a00-4a53-b867-3c3fc3956d67`.

## Authority and originals

Factory remains authoritative for canonical product intent, acceptance and documents under the existing root guidance. Spacecrew is the integration for assigned implementation work, role context and evidence. It registers the original files by path and digest. No duplicate specification or migrated historical approval was created.

The original Factory draft is `.factory/product/specs/conversational-collections.md`. Its planned narrow amendment to the existing owner-chat exclusion is explicit and does not silently alter the previously approved concierge contract.

## What was initialized and verified

- Project metadata, runtime/core lock, default role registry and local workflow store were created with `spacecrew init`.
- The project-local Codex MCP adapter was generated at `.codex/config.toml`, pinned to this project's ID and root. Installation required permitted access to the protected adapter directory; trust and permission settings were not altered.
- A real MCP client connected through stdio, discovered 25 tools and read back the matching project identity and version. This proves server/protocol operation. The current Codex task did not dynamically gain native Spacecrew tool entries; native activation in a fresh trusted task remains unverified.
- Eight project core-role complements live in `.spacecrew/agents/`; eight named collection specialist profiles live in `docs/collections/agents/`.
- Twelve story records were persisted using the Spacecrew operation API with unique request IDs and expected revisions. Their IDs and assignments were read back. No implementation run was launched.

## Assignment mechanism in this release

Spacecrew 0.5.9 `work.create` / `work.update` have no native assignee or dependency fields. Each story's `nextAction` records the named specialist, core role, profile path, direct prerequisite story/work IDs and specific next action. The [manifest](story-manifest.json) carries the same explicit mapping. Role profiles are responsibilities; actual host-session identities are recorded when sessions accept work.

The assigned stories are marked `blocked` pending the exact product decision and their dependencies. The coordinator must read these prerequisites before dispatch; Spacecrew does not automatically enforce this manifest graph or schedule the named specialists.

## Resume commands

```sh
spacecrew work list --project /Users/pretheesh/Projects/youbot
spacecrew work.get --project /Users/pretheesh/Projects/youbot --input '{"id":"WORK_ID_FROM_MANIFEST"}'
spacecrew context.get --project /Users/pretheesh/Projects/youbot --input '{"role":"engineer","query":"conversational collections","workId":"WORK_ID_FROM_MANIFEST","maxCharacters":50000}'
```

Use `spacecrew schema session.open`, `spacecrew schema work.update` and the actual host identity before handoff mutations. Read the current work revision and use a unique request ID. Resume the existing story instead of creating another. Invoke a feature execution workflow only when implementation is authorized and its actual commands, prerequisites and scope are known.

Re-register changed originals with `knowledge.register` and resolve context freshness before use. Spacecrew state/evidence is local and ignored by its generated `.gitignore`; Factory metadata is also ignored by the repository. Use the supported `spacecrew backup` workflow before moving or handing off the project; Git alone does not preserve this planning state. No backup or remote publication was performed in this task.

## Remaining external verification

Fresh-task native Codex MCP activation and fikr-studio summary delivery remain unverified. Application extraction, rendering, persistence migrations, provider behavior, visitor transport delivery and installed-package readiness belong to the implementation stories and have not been tested by setup checks.

## Inherited baseline concern

Factory reports source drift on the existing `concierge-v1-experience` revision 1: the registered approved digest differs from its current file. This task did not edit that specification; the new collections revision 1 is registered as draft with no drift. Reconcile the existing exact approved baseline before accepting the proposed amendment. Its source was preserved, and no historical approval was recreated.

## Reusable engine planning revision

The later user direction requires a reusable package and provider-neutral LLM tools. The current [planning index](README.md), [engine API](engine-api.md) and [story manifest](story-manifest.json) supersede the original package scope. The original twelve work IDs are retained with mandatory revision-2 handoff supplements; two new stories cover tool bindings and final cross-project package verification. Initial setup counts above describe the original initialization, not a claim that revision-1 scope proves the reusable engine. Revision-2 engine planning work was `work_eab3a3af-5ea7-4441-8f7b-55d7e90680cd`. No collections implementation was launched by this planning revision.

## Revision 3: raw-data boundary

The current specification and existing 14 story handoffs now place file importing/parsing in hosts. Native work IDs and acceptance arrays remain unchanged; current revision3Acceptance supersedes historical revision2Acceptance. The prior planning work remains a closed revision-2 record, not approval or verification of revision 3. No implementation run was launched.
