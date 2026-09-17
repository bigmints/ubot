# Youbot production-readiness audit

**Audit date:** 2026-09-17
**Supported profile:** single host, single process, loopback-bound dashboard, local SQLite persistence
**Release boundary:** source and local runtime verification only; no external deployment or live visitor delivery was authorized or performed

## Assessment

The checkout is suitable for the supported single-host profile after the remediations below and successful local verification. It is not approved as a directly internet-facing dashboard, a multi-process service, or a horizontally scaled application.

The public webchat relay has separate Cloud Run and Firestore boundaries. Its source, container inputs, persistence health, tests, and deployment script are covered here, but the relay was not deployed during this audit.

## Remediations completed

### Authentication and request handling

- API keys and local credentials use digest-based timing-safe comparison.
- Authentication bodies and shared API body readers enforce explicit size limits.
- Failed local logins are rate-limited and protected routes fail closed.
- SSO validation failure denies access; only HTTP(S) login URLs are accepted.
- Auto-generated credentials are written to protected configuration and no longer printed to logs.
- Interactive setup suppresses terminal echo for passwords, service keys, and database connection strings.

### Runtime and data safety

- The server binds to `127.0.0.1` by default.
- `/health` checks SQLite and the production dashboard export, while returning minimal public detail.
- Configuration writes are atomic and mode `0600`; runtime directories use mode `0700`.
- Start, stop, and installed CLI scripts validate PID ownership, refuse unrelated port occupants, wait for readiness, and create logs as mode `0600`.
- Upload and provider request bodies are bounded. Transcription temporary files are removed on success and failure.
- Tracked live SQLite, WAL, and SHM files were removed from the Git index and remain ignored.

### Privacy and observability

- Logs no longer include message bodies, generated replies, transcription snippets, approval text, scheduled prompts, visitor/contact identifiers, WhatsApp addresses, webchat token values, or generated dashboard passwords.
- Public health output no longer exposes process, memory, channel, MCP, or tool inventory details.
- Operational logs retain status, counts, timing, and failure categories needed for diagnosis.

### Backup and recovery

- `youbot backup`, `youbot backup-verify`, and `youbot restore` provide a supported recovery path.
- Backups use SQLite `VACUUM INTO`, `PRAGMA integrity_check`, SHA-256 manifests, private directories, and explicit exclusions for unstable or reproducible data.
- Verification detects changed file sets and content and reruns SQLite integrity checking.
- Restore requires a stopped runtime, creates a pre-restore safety backup, retains replaced state, and rolls back partial swaps.
- The operator procedure and recovery drill are documented in [operations.md](operations.md).

### Relay deployment

- Relay health now probes persistence and returns HTTP 503 when Firestore is unavailable.
- The deployment script uses strict shell behavior, a dedicated service account, Secret Manager-backed signing secrets, and accessor IAM.
- Legacy plaintext signing secrets are migrated into Secret Manager.
- Repeat deployment updates only Youbot-owned variables and preserves unrelated Cloud Run environment configuration.

### Build and release reproducibility

- The core, dashboard, relay, and collection engine have deterministic build/test entry points.
- The collection engine now has its own dependency lockfile and has no production dependencies.
- `make verify` covers all component tests, production builds, dashboard lint, production dependency audits, shell syntax, and patch hygiene.

## Verified evidence

The final evidence must be read together; a green source test is not evidence of a live production deployment.

- Core TypeScript production build: passed.
- Core automated suite: 468/468 tests passed across 224 suites.
- Collection engine build and automated suite: 21/21 tests passed.
- Dashboard lint: passed with 0 errors and 80 warnings.
- Dashboard production build: passed and generated 31 static pages.
- Relay automated suite: 17/17 tests passed when allowed to bind a temporary loopback port.
- Shell syntax: `start.sh`, `stop.sh`, installed CLI, core deployment, and relay deployment scripts passed `bash -n`.
- Patch hygiene: `git diff --check` passed.
- Dashboard production dependency audit: 0 vulnerabilities.
- Collection engine production dependency audit: 0 vulnerabilities and 0 production dependencies.
- Core production dependency audit: 0 high, 0 critical, 4 moderate.
- Relay production dependency audit: 0 high, 0 critical, 6 moderate.
- Manual installed-CLI check: quoted configuration values survived atomic writes, default config display redacted secrets, and config mode was `0600`.
- Isolated production-mode runtime smoke: loopback startup passed; `/health` reported database and dashboard ready, the dashboard returned HTTP 200, a protected API returned HTTP 401 without credentials, security headers were present, graceful shutdown exited cleanly, and the port closed.

## Accepted residual risks

1. **Telegram dependency chain:** four moderate advisories remain through `node-telegram-bot-api@0.67.0` and its legacy request dependencies. The available remediation is an API-breaking major upgrade and needs dedicated Telegram adapter and live channel regression testing.
2. **Firestore dependency chain:** six moderate advisories remain in the relay's Firestore v7 transitive tree. The available remediation is a major Firestore upgrade and needs emulator plus deployed persistence regression testing.
3. **Dashboard warnings:** ESLint reports warnings but no errors. They are quality debt, not current build blockers; warnings involving React effects and stale closures should be reduced before large UI expansion.
4. **Single-process security state:** local sessions and request throttles are in memory. Restart revokes sessions and clears counters. Multi-instance deployment requires a shared expiry-aware store.
5. **Local secret storage:** `config.json` and backups contain plaintext secrets protected by host filesystem permissions. Off-host backups require operator-managed encryption and access control.
6. **External services:** provider, Telegram, WhatsApp, Google, SSO, MCP, Firestore, DNS, and Cloud Run behavior was not exercised against live production accounts in this audit.
7. **Monitoring:** the local profile has readiness checks and private logs but no centralized SLO, paging, or incident automation.
8. **Workflow evidence:** the Spacecrew run was blocked by its unresponsive local service. Factory remains the durable record; the Spacecrew result must not be represented as completed.

## Promotion gates for a broader profile

Before exposing the dashboard or scaling beyond one process:

- terminate TLS at a configured reverse proxy and test trusted-forwarded-header behavior;
- replace local sessions and rate limits with a shared store;
- move concurrency-sensitive persistence to a managed database and validate migrations on a production-like copy;
- use centralized secret management for every runtime secret;
- test real SSO login, callback, logout, expiry, revocation, and tenant isolation;
- add centralized structured logs, error aggregation, availability checks, alert ownership, and incident runbooks;
- stage the release, verify authenticated read/write paths and channel delivery/readback, and prove rollback;
- obtain explicit human release approval.
