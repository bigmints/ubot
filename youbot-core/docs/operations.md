# Youbot operations guide

This guide covers the supported production profile: one Youbot process on one trusted host, bound to loopback, using the local SQLite database and the installed CLI runtime under `~/.youbot`.

It does not approve direct internet exposure, multiple Youbot processes sharing one home directory, or horizontal scaling. Those profiles need TLS termination, trusted-proxy rules, shared sessions and rate limits, centralized secrets, a managed database, and deployment-specific security testing.

## Install and verify

For macOS or Linux, download and review the public user-scoped installer:

```bash
curl --proto '=https' --tlsv1.2 -fsS https://youbot.live/install.sh -o install.sh
less install.sh
bash install.sh
~/.local/bin/youbot start
```

The installer refuses root, supports current 64-bit macOS and Linux systems, verifies its private Node.js 22 runtime when one is needed, resolves source to an immutable commit, and atomically switches versioned releases while preserving `~/.youbot/config.json` and `~/.youbot/data`.

For a manual source checkout, use:

```bash
make verify
make install
youbot doctor
youbot start
```

`make install` builds the backend and dashboard, copies them into `~/.youbot`, sets runtime directories to mode `0700`, and keeps `config.json` at mode `0600`. The public installer instead keeps immutable application releases under `~/.youbot/releases` and points `~/.youbot/current` at the active release. The service binds to `127.0.0.1` unless an operator explicitly configures another host.

After startup, verify readiness:

```bash
curl --fail http://127.0.0.1:11490/health
youbot status
```

The health endpoint is intentionally minimal. It reports readiness only after SQLite is readable and, in production mode, the dashboard export exists.

## Secrets and access

- Keep `~/.youbot/config.json`, channel credentials, provider keys, and backups readable only by the runtime account.
- `youbot config` redacts secret-looking values. Use `youbot config edit` to make local changes.
- Auto-generated dashboard credentials are saved to protected `config.json`; they are not printed to service logs.
- Change the dashboard password before widening network access.
- Never publish the local dashboard directly. If remote access is required, place an authenticated TLS reverse proxy in front of it and validate forwarded-proxy behavior.
- Treat every backup as a secret: it contains configuration, conversations, credentials, workspaces, and the SQLite database. Encrypt backups before copying them off-host.

## Back up

Create a backup while Youbot is running or stopped:

```bash
youbot backup
```

The default destination is `~/.youbot/backups/youbot-<timestamp>`. To use another destination:

```bash
youbot backup /path/to/private-backup-directory
```

The backup command:

- uses SQLite `VACUUM INTO` for a consistent database snapshot;
- runs `PRAGMA integrity_check` on the snapshot;
- excludes logs, browser profiles, local models, nested backups, and SQLite WAL/SHM files;
- records file sizes and SHA-256 hashes in `manifest.json`;
- creates the backup root with private permissions.

Always verify before moving or relying on a backup:

```bash
youbot backup-verify /path/to/private-backup-directory
```

Verification rejects missing, added, changed, symlinked, or corrupt files and reruns SQLite integrity checking.

Keep at least two known-good generations on storage separate from the Youbot host. Periodically perform the restore drill below on a non-production copy.

## Restore

Restores are intentionally offline:

```bash
youbot stop
youbot backup-verify /path/to/private-backup-directory
youbot restore /path/to/private-backup-directory
youbot start
curl --fail http://127.0.0.1:11490/health
```

Restore refuses to run while the configured Youbot PID is active. Before replacing data it creates a verified safety backup under `~/.youbot/backups/pre-restore-<timestamp>`. Replaced state is retained under `~/.youbot/.restore-previous-<timestamp>` for manual recovery. Delete old safety copies only after checking the dashboard, conversations, connected channels, and provider configuration.

## Updates and rollback

Before updating:

```bash
youbot backup
make verify
```

Then stop the current process, install the update, and start the new runtime:

```bash
youbot stop
make update
youbot start
youbot doctor
curl --fail http://127.0.0.1:11490/health
```

If startup or persisted-data checks fail, stop Youbot and restore the pre-update backup. Do not copy a live SQLite database file or its WAL file through Dropbox, iCloud, or another file synchronizer.

## Logs and monitoring

```bash
youbot logs
youbot logs -f
```

Runtime logs are created with mode `0600`. Production logs intentionally omit message bodies, transcription text, visitor identifiers, channel addresses, tokens, and generated credentials. The supported local profile does not include centralized alerting or an external availability SLO; an operator is responsible for host disk space, process supervision, backup completion, and channel health.

## Webchat relay

The shared public webchat relay is a separate Cloud Run workload. `deploy-relay.sh` provisions a dedicated service account, Firestore access, and a Secret Manager-backed signing secret. Repeat deployments preserve unrelated service environment variables and the existing signing secret. Rotating that secret invalidates previously issued tenant links and bot credentials.

Run the relay test and dependency audit before any authorized deployment:

```bash
cd youbot-core/webchat-relay
npm test
npm audit --omit=dev --audit-level=high
```

Deployment remains a separate release decision. Source verification does not prove Cloud Run configuration, production traffic, Firestore data, DNS, or live tenant health.

## Incident minimum

If credentials or a backup may have been exposed:

1. Stop Youbot and restrict host access.
2. Rotate dashboard, provider, channel, Google, Supabase, relay, and MCP credentials that could be present.
3. Revoke active provider or SSO sessions where supported.
4. Preserve private logs and a verified backup for investigation.
5. Restore only from a verified, known-good generation.
6. Start on loopback and validate health before reconnecting channels.
