# Collection engine

`@youbot/collection-engine` is a headless, provider-neutral TypeScript package for organizing already-extracted text, segments, or records into reviewed collections. It exposes JSON-schema LLM tool definitions and an executor that keeps trusted host context separate from model arguments.

The package does not upload or parse files, run OCR, invoke a model, render UI, or send messages. Hosts own those concerns and provide authentication/policy decisions.

Reference fields use `{ collectionId, itemId }` values and must resolve inside the caller's trusted entity. Fields may mark `identity: "strong"` for deterministic exact matching or `identity: "candidate"` for owner-reviewed possible matches. Source-backed proposals cannot silently replace fields previously saved as manual corrections.

Exact money ordering requires a three-letter `currency` in the sort clause. Numeric fields with incompatible units require a `unit`. Incompatible values are excluded and reported through `excludedIncompatibleCount`, `complete: false`, and a warning; the engine never orders raw amounts from different currencies as though they were comparable.

```ts
import {
  createCollectionEngine,
  createJsonFileCollectionRepository,
  executeCollectionTool,
  getCollectionToolDefinitions,
} from '@youbot/collection-engine';

const repository = await createJsonFileCollectionRepository({ filePath: './collections.json' });
const engine = createCollectionEngine({ repository, policy });
const definitions = await getCollectionToolDefinitions(engine, trustedContext);
const result = await executeCollectionTool(engine, trustedContext, providerCall);
```

The bundled JSON-file repository demonstrates durable restart behavior for small installations. Each mutation acquires a sibling lock directory, reloads the latest committed file, writes a private temporary file, and atomically replaces the state file. This prevents acknowledged writes from separate adapter instances or cooperating processes from overwriting one another.

### Persistence compatibility and migration

`PERSISTENCE_SCHEMA_VERSION` is `1`. `MIGRATABLE_PERSISTENCE_SCHEMA_VERSIONS` is `[0]`, and the JSON repository advertises `migration-v0-to-v1` after opening successfully. Version 0 is the supported pre-release JSON shape: it has `{ schemaVersion: 0, entities }`, and each entity has the same `collections`, `sources`, `ingests`, `evidence`, and `idempotency` maps as version 1 but no `catalogRevision`. Opening it derives `catalogRevision` from the number of persisted collections. Collection IDs, revisions, draft and published items, source/provenance data, evidence, and idempotency results are otherwise preserved in the migrated state.

Migration runs while holding the same sibling lock used by writes. Before replacing the state, the repository saves the exact version 0 bytes to `<filePath>.schema-0.backup` with create-only behavior, then writes version 1 through a private temporary file and atomic rename. If the process stops before replacement, the version 0 state remains authoritative and a later open can retry when the backup matches. If a backup already exists with different bytes or cannot be read, including a dangling backup symlink, migration stops without changing the primary or backup path. Unsupported versions, missing version metadata, malformed version 0 entity maps, and temporary-write or rename failures likewise cannot enter the new-store path and do not intentionally rewrite the primary.

For an application rollback, stop all writers and copy the backup over the state file; a later version 1 open will migrate those same bytes again. Preserve the displaced version 1 file separately if post-migration writes may need recovery. The backup contains the complete private repository and needs the same access controls and retention policy as the primary state.

The JSON adapter waits up to 10 seconds for its lock. A process terminated while holding the lock can leave `<filePath>.lock`; an operator must remove that directory only after confirming no writer is active. Filesystems without reliable atomic `mkdir` and `rename` semantics are unsupported. Production and distributed hosts should implement `RepositoryPort` with their transactional database and run the exported conformance checks.

Process-interruption behavior around the backup and atomic replacement is tested. The adapter does not call `fsync`, so sudden power-loss durability is not established; the existing atomic-filesystem and single-host limits still apply.
