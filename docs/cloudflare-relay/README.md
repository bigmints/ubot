# Cloudflare relay migration and operation

The Cloudflare relay runs on Workers with SQLite-backed Durable Objects and Workers assets. Bot and visitor connections use the WebSocket Hibernation API. Incoming messages wake the relay; waiting for the local model does not hold an HTTP request open. Youbot still needs to run on the owner's computer/server to generate replies.

Implementation: [`youbot-core/webchat-relay/cloudflare`](../../youbot-core/webchat-relay/cloudflare). Canonical acceptance: [Factory specification `cloudflare-relay`, revision 1](../../.factory/product/specs/cloudflare-relay.md). The user explicitly requested deleting the Cloud Run service first, preserving Firestore and its signing secret, then migrating DNS through the provided Spaceship management page. This accepts an outage during migration and removes immediate service rollback. This document is the canonical operational runbook, not evidence that deletion, deployment or migration has happened.

## Free plan boundary

Use a **Workers Free account**, SQLite Durable Objects (`new_sqlite_classes`), and the included `workers.dev` hostname initially. Do not enable a paid Workers subscription, paid storage backend, paid logging, or another billable service as a migration shortcut. A custom domain is optional and its registration is separate.

Cloudflare currently provides 100,000 Durable Object requests/day, 13,000 GB-seconds/day, 5 million SQLite rows read/day, 100,000 rows written/day, and 5 GB storage across the account. Free plan operations fail when their allowance is exceeded; daily allowances reset at midnight UTC. The outer Worker has separate quotas. A chat uses multiple operations, so these limits are not chat counts. Source: [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), checked 2026-09-27.

The free target depends on using `state.acceptWebSocket` and hibernation-compatible handlers, with no recurring timer or held request to keep objects active. Protocol ping or configured WebSocket auto-response can maintain idle connections without running an application handler. Source: [Cloudflare WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).

Workers assets are included, but requests configured to run Worker code first still count against Worker request/CPU limits. Source: [Workers assets limits](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/). Migration also consumes destination requests/storage writes, and reading existing Firestore data can consume its existing billed reads. This work does not promise that existing Google storage, logs, or other services become free before retirement.

## Credentials and identity

- Preserve the **exact existing `RELAY_SIGNING_SECRET`** in the new Worker. It derives tenant IDs, bot secrets and owner keys. Changing it breaks existing tenants and saved links; copying Firestore alone cannot recover that identity. It is not stored in the migration JSONL.
- Also preserve the earlier relay's distinct signing value as **`LEGACY_RELAY_SIGNING_SECRET`**. The real source snapshot contains 18 tenants signed by the primary value and 2 signed by the earlier value. The Worker resolves credentials against the tenant signature and uses that same value for bot/owner authentication. Keep both signing secrets after migration; the legacy secret is not the temporary migration secret.
- Keep installation IDs, tenant IDs, existing bot secrets, slugs and original session IDs. A connector update must change the relay origin while retaining the installation identity. Do not re-register installations with new IDs. Registration checks both signed candidates against the durable registry, resumes a unique existing identity, and uses the primary key only for new installations. If both identities already exist for one installation, registration fails with HTTP 409 and requires operator reconciliation; it never silently merges data.
- Store secrets through `wrangler secret put`, using its hidden prompt or a secret manager pipe. Never put values in command arguments, config files, screenshots, task notes or committed files.
- `MIGRATION_SECRET` is a separate temporary random secret of at least 32 characters. The local importer reads its matching value from `RELAY_MIGRATION_SECRET`. Remove the Worker secret and local environment value after verified cutover.
- The checked-in deployed configuration now has `MIGRATION_MODE="false"`. Enable migration mode explicitly only for a closed, planned import, with public registration and writes blocked; restore it to false and remove the temporary migration secret afterward. Import is a privileged endpoint, never an exposed general data API.
- Snapshots contain private conversations, tenant configuration and replay receipts. Store them outside the checkout in an owner-only directory on encrypted storage. Generated snapshots/manifests/checkpoints are not documentation or test fixtures and must never be committed.

## Prepare and test

Run from the repository root:

```sh
npm --prefix youbot-core/webchat-relay/cloudflare ci
npm --prefix youbot-core/webchat-relay/cloudflare test
npm --prefix youbot-core/webchat-relay/cloudflare run check
node --test youbot-core/webchat-relay/cloudflare/scripts/migration.test.mjs
```

`check` bundles a dry-run deployment. It does not publish. To exercise local Workers/SQLite/WebSockets, use `npm --prefix youbot-core/webchat-relay/cloudflare run dev`. Local development needs private development secrets; use the local configuration convention supported by Wrangler, with test values only. Use a separate local storage directory for rehearsal and production migration tests.

Before live cutover, install the updated WebSocket-capable Youbot connector on **every** active installation. An old polling client must not silently keep running against Google. Verify browser assets are the updated asynchronous message/reply version and cache refresh is accounted for. Preserve installation credentials when updating binaries/configuration.

## Snapshot format and tooling

The source is `relay_tenants/{tenantId}` and `relay_slugs/{slug}`. The exporter retains every document field in these trees:

| JSONL kind | Firestore source | Identity |
| --- | --- | --- |
| `tenant` | `relay_tenants/{tenantId}` | `id=tenantId` |
| `slug` | `relay_slugs/{slug}` | `id=slug`, `tenantId=data.tenantId` |
| `session` | tenant `sessions/{sessionKey}` | `id=sessionKey`, original `sessionId` |
| `event` | session `events/{eventDocId}` | `id=eventDocId`, original `sessionId` |
| `message` | tenant `messages/{messageId}` | `id=messageId` |
| `receipt` | tenant `sent_replies/{requestId}` | `id=requestId` |

Each line is `{kind, tenantId, id, sessionId?, data}`. Firestore dates/timestamps recursively become ISO UTC strings; unsupported field types stop export instead of silently changing them. Session document keys must match SHA-256/base64url of the original session ID. Event document ID and the public `data.id` are distinct and both are retained. The accompanying `.manifest.json` records schema version, explicit Google project/database, counts by kind, source freeze assertion and a SHA-256 of the complete JSONL. The manifest checksum detects local corruption; it is not an independent proof that the source was frozen or every source document was read.

Dry-run commands are safe defaults: export reads source data/counts without writing files; import validates the local snapshot/checksum/topology without any network call. Explicit `--write` saves export files. Explicit `--apply` sends destination writes. `--verify` asks the destination to compare **every** snapshot record against imported data and its active representation. Neither exporter nor importer writes to Google.

```sh
# Read-only source inventory. Google Application Default Credentials are needed.
node youbot-core/webchat-relay/cloudflare/scripts/export-firestore.mjs \
  --project GOOGLE_PROJECT_ID

# During the confirmed source freeze, save a snapshot outside the checkout.
node youbot-core/webchat-relay/cloudflare/scripts/export-firestore.mjs \
  --project GOOGLE_PROJECT_ID --output /PRIVATE_BACKUP/relay-final.jsonl \
  --source-frozen --write

# Offline validation (the default).
node youbot-core/webchat-relay/cloudflare/scripts/import-snapshot.mjs \
  --input /PRIVATE_BACKUP/relay-final.jsonl

# Writes require the destination migration mode and matching local secret.
node youbot-core/webchat-relay/cloudflare/scripts/import-snapshot.mjs \
  --input /PRIVATE_BACKUP/relay-final.jsonl --url https://WORKER_HOST --apply

# Separate full verification; does not trust the import progress checkpoint.
node youbot-core/webchat-relay/cloudflare/scripts/import-snapshot.mjs \
  --input /PRIVATE_BACKUP/relay-final.jsonl --url https://WORKER_HOST --verify
```

Substitute explicit paths/project/hostname. Do not run those placeholders verbatim. Use `--database ID` if the source uses a named Firestore database. Authentication setup belongs to the operator. Google CLI login is not automatically Application Default Credentials; pass `--gcloud-auth` to reuse the active Google CLI account through a short-lived token held only in memory. This option never prints or saves the access token. Large exports taking longer than token lifetime should be resumed using a newly captured token.

Interrupted export: repeat the same export with `--resume`. Its private `.partial` file is rescanned against source, preventing duplicate records; changed/deleted prior records cause failure. An incomplete final line requires a new output path. Interrupted import: repeat with `--apply --resume`. The private checkpoint binds completed records to the exact snapshot hash and destination origin. Requests that succeeded but lost their acknowledgement can be repeated safely because destination upserts are idempotent during migration. Neither workflow automatically retries forever or silently changes targets. Keep partial files/checkpoints for diagnosis; never treat them as a completed snapshot.

## Current domain route

The deployed configuration binds `youbot.live/*` to `youbot-relay` and sets `PUBLIC_BASE_URL=https://youbot.live`. The separate custom-domain attachment encountered existing apex DNS conflicts. The route covers every path: assets are served by the Workers `ASSETS` binding and relay traffic by Durable Objects, with no Google-origin forwarding in Worker code. Keep the hostname proxied and the route enabled. Cloudflare requires an active zone and a proxied DNS record for this routing mechanism; see [Workers routes](https://developers.cloudflare.com/workers/configuration/routing/routes/). The [dated migration evidence](migration-20260927.md) records delegation/DNSSEC status and live checks; do not infer completed DNS propagation from Wrangler route configuration alone.

## Rehearsal, final catch-up and cutover

1. **Preserve identity, then delete Cloud Run as requested.** Confirm the exact `youbot-live` source service/project/region. Securely preserve its signing secret and source Firestore project/database before deletion; record the container image, service settings and domain mapping needed to recreate the service if recovery is required. Stop old bot connections, then delete only the requested Cloud Run service. Preserve Firestore, Secret Manager values/versions, container images and backups. Confirm service deletion rather than assuming stopped polling removed charges. This deliberately starts an outage; no temporary serving fallback is promised.
2. **Prepare and rehearse separately.** Confirm the destination account is Workers Free and operator access works. Inventory public domains, the old direct `run.app` URL and active installations. Save source backup and configuration recovery instructions.  Use synthetic data or a consented private snapshot with an isolated test Worker/DO namespace and test clients. Exercise import retries, the independent verify pass, tenant/slug routes, history, offline queue recovery and duplicate reply protection. Do not point a production bot at the rehearsal destination. An early inventory/snapshot is preparation, not the final source of truth.
3. **Verify source writers have stopped.** Confirm the deleted service cannot receive visitor ingress on either the custom hostname or its direct Cloud Run hostname; stop source-connected bots and wait for any already-running local LLM operation to settle. Account for administrative configuration writes, Firestore TTL deletion and scheduled jobs as writers too. Record the freeze time. The `--source-frozen` flag records the operator's assertion; it does not perform or verify the freeze.
4. **Take the final snapshot.** Export all six record types after the freeze, validate counts and topology, and compare a second complete read if freeze correctness is uncertain. This final export is the catch-up for every change since rehearsal. The tool is not a live change stream and does not delete destination records absent from later exports: use a fresh production namespace or one populated only by this exact final snapshot. Do not repeatedly import changing snapshots into a reused canary namespace.
5. **Deploy the closed destination.** From `youbot-core/webchat-relay/cloudflare`, check `npx wrangler whoami`, put the preserved `RELAY_SIGNING_SECRET`, `LEGACY_RELAY_SIGNING_SECRET` and temporary `MIGRATION_SECRET`, and publish with `MIGRATION_MODE=true`. `npm run deploy` is a real external deployment. Keep registration and all application writes blocked until the complete registry and tenant data are imported. Registering fresh tenants first can create conflicting slugs/identities.
6. **Import then verify.** Import the final frozen snapshot; run the separate full verification. Check manifest counts and confirm active tenant config, slug resolution, session/history order, message state and replay receipts. Source `pending`, `resolved` and `timed_out` states and claim/expiry timestamps need deliberate preservation; replaying already resolved/timed-out messages as new work is not acceptable. Keep source writes frozen until destination checks succeed.
7. **Canary the actual destination.** Disable migration mode only after verification and update the retained configuration value so the next deploy cannot re-enable it accidentally. Connect an updated test installation first with the retained credentials. Send one visitor message, receive one reply, disconnect/reconnect both sides, and confirm history, typing, session sends, duplicate reply idempotency and tenant isolation. Confirm an idle connection performs no repeating HTTP poll. Canary messages written to production count as destination data for rollback.
8. **Switch clients and Spaceship DNS.** Use the user-provided Spaceship management page to inspect existing DNS and change only the relay/website records needed for the verified Cloudflare hostname. Preserve mail and unrelated records. Cloudflare may require domain onboarding/nameserver changes before its Worker custom-domain flow works; inspect the actual zone state rather than assuming a plain CNAME to `workers.dev` is sufficient. Update all saved relay origins/embedded widget URLs and publish routing only after the canary succeeds. Verify authoritative DNS, Cloudflare custom-domain activation and TLS separately. A `run.app` hostname cannot move to Cloudflare; existing hard-coded Google URLs must change. Keep the same path/slugs and signing secret. Existing browser history may need renewed session cookies after an origin change even though server-side history is preserved.
9. **Close migration access.** Keep `MIGRATION_MODE=false`, remove `MIGRATION_SECRET`, unset local `RELAY_MIGRATION_SECRET`, and retain the encrypted final snapshot plus verification evidence. Monitor destination error rates, reconnects, queue completion and daily quotas. Confirm the old Cloud Run service is absent and no replacement Google relay is receiving continued bot/visitor traffic before claiming its idle CPU problem is removed.

## Rollback and retirement

Because service deletion is explicitly requested before migration, there is no running Google relay to switch back to. Before destination traffic is enabled, recovery would require recreating the Cloud Run service from its saved image/settings with the original signing secret and preserved Firestore, verifying its URL/domain mapping, then restoring client/ingress routing. Recreation would resume Google hosting charges and needs a deliberate recovery decision. Never run both relays as competing writers for the same tenant.

After the destination has accepted real messages, **DNS rollback alone can lose conversations and repeat replies**. Freeze both sides, save all destination records written since the final source snapshot, and reconcile messages, histories and reply receipts into the chosen source before enabling it. The supplied tooling is one-way Firestore → Cloudflare; automatic reverse migration is not implemented. Stop and preserve data if forward recovery/reconciliation has not been validated. Do not declare post-cutover rollback safe solely because the old service still starts.

Cloud Run service deletion is the specifically authorized first step. **Do not extend that deletion to Firestore collections, signing-secret versions, container images or source backups.** Retain those through successful data verification, client/ingress cutover and a stable observation period; retire them only under a separate explicit decision. Review remaining Google resources individually because deleting the service does not remove stored data or all unrelated cloud charges.

## Verification evidence to retain

Record package/commit version, source project/database and freeze time, destination Worker/namespace, manifest checksum/counts, import and independent verification outcomes, updated installation count, canary results, quota observations and the precise rollback/retirement state. Never record plaintext credentials or conversation contents. Link the evidence from the existing Factory task and Spacecrew work item; do not invent deployment success when account authentication or production verification remains pending.
