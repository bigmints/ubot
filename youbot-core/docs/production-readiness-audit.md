# Youbot production-readiness audit

**Audit date:** 2026-09-17

**Verified application source:** `48535b17e34c328060cb600dfa5084b06a88ab8a`

**Public service:** `https://youbot.live`

**Supported local profile:** one user, one process, loopback-bound dashboard, local SQLite persistence

**Supported public profile:** Cloud Run website and webchat relay with Firestore persistence

## Release decision

The documented self-hosted profile and public website/relay are released and verified for production use within the boundaries above. The owner dashboard is not approved for direct internet exposure or horizontal scaling. The public relay does not run a user's AI model; a self-hosted Youbot computer must remain awake and connected to answer visitors.

The public source omission discovered during the first live installer run has been corrected. The root ignore rules now apply only to repository runtime directories, and all required `youbot-core/src/data` modules are present in the public archive. A clean archive of the corrected commit builds without relying on ignored local files.

## Release evidence

### Public source and installer

- Public repository: `Bigmints-com/ubot`.
- Deployment-time public `master` readback: `983bc3307b2a9944d34bba675ec9a5c3d9610e67`.
- `https://youbot.live/install.sh`: HTTP 200 with `text/x-shellscript`.
- Live installer SHA-256: `6fea3c23c1bc2b544fc8275d6fcf2a530a42b3867a8211200372386b772fd9b7`.
- A disposable macOS user home installed directly from the live URL and, before the documentation-only follow-up commits, resolved corrected application commit `48535b17e34c328060cb600dfa5084b06a88ab8a`.
- The installed CLI was configured on isolated port `19091`, started successfully, and returned:

  ```json
  {"status":"ok","version":"1.0.0","checks":{"database":true,"dashboard":true}}
  ```

- CLI status reported the expected isolated home and dashboard URL. The process then stopped cleanly.
- Installer and runtime files remained user-scoped; no `sudo` or system security-policy changes were used.

The installer supports 64-bit macOS and Linux. This release evidence includes a clean macOS run. A clean Linux-device run and the separate Windows launcher remain platform-specific follow-up evidence and are not inferred from the macOS result.

### Public Cloud Run service

- Google Cloud project: `youbot-live`.
- Service and region: `youbot`, `europe-west1`.
- Ready revision: `youbot-00009-5qs`.
- Traffic: 100% to the ready revision.
- Cloud Run URL: `https://youbot-3kzxahjtza-ew.a.run.app`.
- Canonical domain: `https://youbot.live`.
- Live health: HTTP 200 with `status: ok`, version `2.3.0`, and Firestore storage.
- Homepage and installation guide: HTTP 200.

The source-only correction did not require another container deployment because the deployed installer resolves public `master` at installation time. The live clean-install readback proves that the deployed `/install.sh` fetched the corrected commit.

### Clean committed-archive verification

The verification directory was created from `git archive HEAD`, not from the working tree.

- Collection engine: 22/22 tests passed; ESM and CommonJS builds passed.
- Core: TypeScript production build passed; 494/494 tests passed across 53 test files.
- Dashboard: lint completed with 0 errors and 80 warnings; production build passed.
- Webchat relay and website: 19/19 tests passed.
- Production dependency audits: 0 known vulnerabilities for core, dashboard, relay, and the dependency-free collection engine runtime.
- Patch hygiene: `git diff --check` passed.
- A filesystem-to-Git audit found no other ignored or untracked source/build inputs required by the installer.

## Production controls

### Authentication and request handling

- Local API keys and credentials use digest-based, timing-safe comparison.
- Shared API body readers enforce explicit request-size limits.
- Failed local logins are rate-limited and protected routes fail closed.
- SSO validation failures deny access; only HTTP(S) login URLs are accepted.
- Generated credentials are written to protected configuration and are not printed in logs.
- Interactive setup suppresses terminal echo for passwords, service keys, and database connection strings.

### Runtime and data safety

- The owner server binds to `127.0.0.1` by default.
- `/health` checks SQLite and the production dashboard export while exposing only minimal public detail.
- Configuration writes are atomic with mode `0600`; runtime directories use mode `0700`.
- Start and stop validate PID ownership, refuse unrelated port occupants, wait for readiness, and keep logs private.
- Upload and provider request bodies are bounded. Transcription temporary files are removed on success and failure.
- SQLite databases, WAL/SHM files, credentials, browser profiles, and runtime workspaces remain excluded from source control.

### Privacy and observability

- Operational logs avoid message bodies, generated replies, visitor/contact identifiers, channel addresses, and credential values.
- Public health output does not expose process, memory, channel, MCP, or tool inventories.
- Logs retain status, count, timing, and failure categories needed for diagnosis.

### Backup and recovery

- `youbot backup`, `youbot backup-verify`, and `youbot restore` provide the supported recovery path.
- Backups use SQLite `VACUUM INTO`, `PRAGMA integrity_check`, SHA-256 manifests, private directories, and explicit exclusions for unstable or reproducible data.
- Restore requires a stopped runtime, creates a pre-restore safety backup, retains replaced state, and rolls back partial swaps.
- The operator procedure is documented in [operations.md](operations.md).

### Relay deployment

- Relay health probes persistence and returns HTTP 503 when Firestore is unavailable.
- Deployment uses strict shell behavior, a dedicated service account, Secret Manager-backed signing secrets, and scoped accessor IAM.
- Repeat deployments update Youbot-owned variables while preserving unrelated Cloud Run configuration.
- The runtime container runs as a non-root user and owns the copied application files.

## Accepted limitations

1. Dashboard lint has warnings but no errors. React effect and stale-closure warnings remain quality debt.
2. Local sessions and request throttles are in memory. A restart revokes sessions and clears counters; multi-instance service requires a shared expiry-aware store.
3. Local `config.json` and backups can contain plaintext credentials protected by host filesystem permissions. Off-host backups require operator-managed encryption and access control.
4. AI-provider, Telegram, WhatsApp, Google, SSO, and MCP behavior depends on user credentials and external availability. The release verification did not send real visitor messages or modify external accounts.
5. Clean-device installation was executed on macOS. Linux is supported by the same script but still needs separate clean-device evidence; Windows uses the documented launcher rather than `install.sh`.
6. The public service has health checks and Cloud Run logs, but centralized SLO ownership, paging, and incident automation remain operational follow-up work.
7. GitHub dependency reporting may include development or historical default-branch findings that are outside the installed production dependency trees. The release gate uses the clean archive's `npm audit --omit=dev` results recorded above.
8. Live Cloud Run behavior and revision traffic are verified, but the release record does not retain an immutable deployed image digest or source-to-image attestation.

## Gates for a broader profile

Before exposing the owner dashboard or scaling it beyond one process:

- terminate TLS at a configured reverse proxy and verify trusted forwarded-header behavior;
- replace local sessions and rate limits with a shared expiry-aware store;
- move concurrency-sensitive persistence to a managed database and verify migrations on a production-like copy;
- use centralized secret management for every runtime secret;
- test real SSO login, callback, logout, expiry, revocation, and tenant isolation;
- add centralized structured logs, error aggregation, availability checks, alert ownership, and incident runbooks;
- stage the release, verify authenticated read/write paths and channel delivery/readback, and prove rollback.
