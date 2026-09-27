# Migration evidence — 2026-09-27

Factory task: `request-9b92557504b774af1f64f5cd`; approved specification: `cloudflare-relay@1`. Spacecrew work: `work_06e40e2c-692c-4525-a4ea-338c24745f90`. The Cloudflare Worker is deployed, the source data is imported and verified, and the live delivery canary passed. The installed bot connector is upgraded with automatic startup recovery. Public-domain DNS propagation, TLS and a real-bot round-trip remain pending; this record does not yet declare full migration completion.

## Google retirement and source preservation

At the user's explicit request, deleted Cloud Run services `youbot` and `youbot-webchat-relay` in `youbot-live`, `europe-west1`. A subsequent all-region service listing was empty. Firestore, Secret Manager and container artifacts were retained. This deliberately started an outage before the Cloudflare destination was deployed. The replacement Worker is now reachable at its workers.dev hostname; availability of the original public domain is tracked below.

Private service configuration backups and two independent frozen Firestore snapshots are in `/private/tmp/youbot-cloud-run-retirement/` (directory 0700, files 0600). These contain private data and must not be committed. Source data is still retained in Google; the temporary local directory is not a permanent backup policy.

Both snapshots have SHA256 `2f080871f3e752fd44f1033f3babf8c62dceccfe8ebdf17ae4b0579a5c6878d2`: 20 tenants, 1 slug, 9 sessions, 53 history events, 0 messages and 0 reply receipts. Eighteen tenants validate with the primary signing secret and two with the older service secret. Preserve both secrets, all signed URLs and credentials.

## Cloudflare deployment and production data

The user explicitly approved the full Wrangler OAuth access request, and the authorization completed. The earlier expired request and automatic-approval rejection were resolved by that later approval; they are no longer current blockers. The Cloudflare account is `c6663484f96b52d2803e1a262cc272fe`. Both the zone Free plan and the separate **Workers Free subscription at $0** were confirmed.

Worker `youbot-relay` is deployed at [its workers.dev endpoint](https://youbot-relay.bold-wind-455d.workers.dev). The application deployment was `cdfa3650-feb6-43f1-b80e-17ed41fa74af`. After removal of the temporary migration secret, the final active version is `03a69702-24b0-4e8a-bc3a-efa8d1a36766` (100% traffic, deployment `af1371bb-42f8-4800-bbbd-8e079840107e`). Both preserved signing secrets are configured to retain the 18 primary-key and 2 legacy-key tenant identities.

All **83 source records were imported into production and all 83 were independently verified** against active Durable Object SQLite representations. The operation ran over SSH using in-memory request credentials, with no conversation or secret values printed. `MIGRATION_MODE` is now `false`, and the temporary `MIGRATION_SECRET` has been removed. The public import endpoint was subsequently confirmed closed by the live canary. The source Firestore data remains intact.

## Domain routing and pending delegation

The Worker route **`youbot.live/*` is bound** in the active Wrangler configuration, with `PUBLIC_BASE_URL=https://youbot.live`. The dedicated Worker custom-domain attachment failed because the imported apex DNS records conflicted; the all-path Worker route is the configured serving path. Worker code serves public assets through its `ASSETS` binding and relay requests through Durable Objects. It does not forward requests to the retired Google origin.

The route requires an active Cloudflare zone and proxied DNS for the hostname. Keep the all-path route and proxy enabled; the old Google addresses are not a working fallback. This use of a route is the migration's recorded workaround for the custom-domain conflict, rather than a claim that the separate custom-domain attachment succeeded. See [Cloudflare's primary route documentation](https://developers.cloudflare.com/workers/configuration/routing/routes/).

Spaceship has saved custom nameservers **`patryk.ns.cloudflare.com`** and **`sureena.ns.cloudflare.com`**. The preconfigured Cloudflare DNSSEC delegation record was also saved:

| Field | Value |
| --- | --- |
| Key tag | 2371 |
| Algorithm | 13 |
| Digest type | 2 |
| Digest | `8E7907C1A936777E049D84781241DAC149A52D45ABA460AE0DF342C09F99D047` |

At the latest registry check, delegation still showed the former Spaceship nameservers `launch1.spaceship.net` and `launch2.spaceship.net`; propagation and DNSSEC validation remain pending. A saved registrar change is not proof that authoritative delegation, validating resolvers, HTTPS certificates or the public domain have converged. Recheck those independently before closeout.

For recovery context, the nine records originally scanned from Spaceship (apex TTL 30 minutes) were:

| Type | Value |
| --- | --- |
| A | 216.239.32.21 |
| A | 216.239.34.21 |
| A | 216.239.36.21 |
| A | 216.239.38.21 |
| AAAA | 2001:4860:4802:32::15 |
| AAAA | 2001:4860:4802:34::15 |
| AAAA | 2001:4860:4802:36::15 |
| AAAA | 2001:4860:4802:38::15 |
| TXT | google-site-verification=hQukxUM9wBQRnvTunkQWQRZYLNzBaq4za8ZF9bLU4Ew |

No MX records were displayed in that original inventory. This table records the prior configuration; it is not a fresh authoritative DNS result.

## Verification and remaining work

Real Miniflare/workerd tests exercise SQLite persistence, WebSocket notifications and auto-responses, authentication, migration projection verification and actual built assets. Browser VM tests exercise reconnects, request cancellation, idempotent retries and empty completion. Connector tests exercise capability discovery, notifications and legacy fallback. A local browser sent a synthetic message, received a pushed reply and recovered its composer; [screenshot](local-push-preview.png). This is local evidence only.

The `ubot-server` systemd service originally used an older polling connector in a packaged release. The targeted connector upgrade is installed, preserving configuration, credentials, the canonical relay URL and unrelated code. Final installed SHA256: `988c8442d800b008bcd9b67aa51a40cd30137a8df840ae14d2c015a1b0ecce51`. The service is active (PID 632661), and its local health endpoint reports OK. Repeated startup retries were observed while public DNS still resolves to the retired Google endpoint. Retries use bounded backoff and stop after a healthy connection. The original polling connector backup is `/home/youbot/.youbot/backups/relay-connector-43nf44w1`; the preceding migration connector backup is `/home/youbot/.youbot/backups/relay-connector-startup-6idv5e2w`. Real public-domain push delivery remains unverified until DNS/TLS converge. Source `deploy-relay.sh` now requires explicit `ALLOW_LEGACY_CLOUD_RUN_DEPLOY=true` to prevent accidental recreation of the retired billable service.

Final local checks passed: 21 Workers/runtime/assets/migration tests; 26 legacy relay/browser tests; 31 connector/manual-reply tests (including startup failure recovery); Wrangler deployment dry-run. Both preserved signing secrets were used to import and independently verify all 83 real snapshot records against active SQLite projections. A separate specialist reviewed dual-secret migration and connector reply recovery without actionable findings. Reply retry storage inside the local connector is in memory and does not survive a process restart.

Remaining operational checks: verify authoritative nameserver and DNSSEC convergence, healthy HTTPS and WebSockets on `youbot.live`, and the updated installed bot connector. The final active Worker version after secret removal is recorded above; no plan upgrade was made. Do not close the migration solely because the workers.dev canary passed.

Spacecrew's controller run `run_d3aad81d-e708-4bdf-8205-4cdf9db25e3a` remains blocked by its child CLI failure; ordinary progress was successfully recorded in the existing Spacecrew work and Factory task. Controller recovery remains pending. The required major-change summary to fikr-studio is also pending because no callable fikr-studio tool was available; this document is the retained summary for that handoff.

## Live delivery canary — 2026-09-27 11:10 UTC

The deployed Worker at `https://youbot-relay.bold-wind-455d.workers.dev` passed a synthetic delivery canary from `ubot-server` at `2026-09-27T11:10:40.119Z`. Ordinary HTTPS/WSS certificate verification remained enabled. Custom-domain DNS and the installed production connector are separate checks that remain pending in this record.

All **27 assertions passed** across **22 HTTP requests** and **4 WebSocket connections**. Confirmed live health with migration mode disabled; isolated tenant registration; bot ticket plus bot/visitor ready notifications; automatic ping/pong; HTTP 202 acceptance and work announcement; exclusive message claim; reply and submission idempotency; exactly-once reply history; empty completion without a blank message; manual reply deduplication; offline queue recovery after reconnect; incorrect bot credential rejection; and closed migration endpoints.

The canary created one isolated synthetic tenant/session and three synthetic user messages. Final history contained six events (three user, three assistant), with zero pending messages. Credentials were retained only in process memory and were not logged. No customer conversations, installed bot service, DNS records, or provider plan were changed by this canary. The synthetic tenant/history remain as test records; they are additional to the 83 imported source records.

## Last propagation check — 2026-09-27 11:21 UTC

Spaceship settings were reloaded and still show the saved Cloudflare nameservers, the configured DNSSEC record and `IN PROPAGATION`. The authoritative `.live` registry still returned the old Spaceship NS and DS (key tag 25150), so validating resolvers have not converged. The public hostname still returns the old 404 from the bot server. No DNSSEC/certificate validation bypass was used. Public routing, Cloudflare zone activation/TLS, final DNSSEC validation and a real installed-bot round-trip remain external-state-dependent checks. The migration task stays open.

Deployed HTTPS asset checks from the bot server all returned 200: website `/`, installation docs, `widget.js`, `session-transport.js`, and the canonical installer. The temporary local migration secret and generated bulk secret bundle were removed after the Worker secret was deleted; both historical signing-secret backups remain private.


## Deployment follow-up at 11:51 UTC

The release deployment rechecked `youbot.live`: recursive DNS now returns `patryk.ns.cloudflare.com` and `sureena.ns.cloudflare.com`; HTTPS returns HTTP 200 with ordinary certificate verification through Cloudflare. Earlier propagation observations above are historical. The runtime release and final live checks are recorded in the production deployment evidence.
