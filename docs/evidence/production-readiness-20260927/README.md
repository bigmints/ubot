# Youbot production readiness check — 2026-09-27

## Verdict

**Do not approve an unrestricted production release from this revision.** Two confirmed defects affect supported access/installation paths. A third finding needs trusted-proxy validation or remediation. The public relay is currently healthy, but health is not an authorization, delivery, or recovery test.

Scope: the documented single-user, single-process, loopback-bound SQLite owner runtime and separate public relay. Managed paid hosting, direct internet exposure of the owner dashboard, and horizontal scaling are outside the established production profile. No product code was changed or deployed during this assessment.

Source: `7e6c8b9c2b33e2459efb98ad10457fe1f90e481c`. Tests/builds used `git archive HEAD` under `/tmp/youbot-readiness-20260927` on macOS, Node 26.7.0. Existing installed dependencies were reused through symlinks; this was **not** a fresh `npm ci` or clean-device install. The core's local engine dependency resolves to the existing checkout's built engine. Tracked source had no pre-existing modifications; pre-existing untracked files were preserved. See `git-status.txt`.

The September 17 audit in `youbot-core/docs/production-readiness-audit.md` is historical evidence for its recorded revision, not proof that these findings are absent.

## Findings

### P1 — Non-owner API clients can read owner conversations and relay credentials

At `youbot-core/src/api/index.ts:2007`, `handleChatRoutes` runs before the owner guard at line 2010. The chat handler only prefixes non-owner sessions for chat submission; session listing, history, job lookup, chat configuration, and mutation routes do not apply equivalent ownership checks.

An isolated route-level probe supplied `auth.isOwner=false`, a chat-only scope, and fixture owner data. `/api/chat/sessions`, `/api/chat/history`, and `/api/chat/config` all returned 200. Results included the owner session, owner message text, `webchatBotSecret`, and `webchatOwnerKey`. No real credentials or conversations were used. See `auth-probe-results.json`, `auth-probe.log`, and `readiness-auth-probe.test.ts`.

Trigger: a configured non-owner API key accessing a reachable owner API. The outer server gate accepts valid API keys; it does not turn them into owners. Unauthenticated internet access to the loopback dashboard is not claimed.

Impact: owner conversation confidentiality and relay credential isolation fail. Source inspection also finds non-owner session clear/delete and config-update paths before the owner guard; those mutations were not exercised against a runtime.

Fix: classify routes before dispatch, require owner access for configuration and owner administration, and enforce client ownership on every session/job read and mutation. Add HTTP-level owner/non-owner regressions and verify existing owner behavior.

### P1 — The documented `make install` path ships a broken collection-engine dependency

`Makefile:61` copies `youbot-core/node_modules` to the installed home without replacing its local `@youbot/collection-engine` symlink. The link is `../../../packages/collection-engine`. In the source tree this resolves; from an installed home it points outside the application to a missing package.

A disposable copy using the same `cp -R` behavior retained the link and resolved to a nonexistent target. See `make-install-link.json`. This can prevent the installed backend from loading its collections imports. The public `install.sh` already materializes this dependency at lines 382–387; the Makefile does not.

Fix: package the engine into the installed dependency tree, as the public installer does, then start the installed runtime with the original source checkout inaccessible. Verify update and rollback on a disposable home. No installation was made into the user's real home.

### P2 — Relay throttling trusts caller-controlled forwarded headers

`youbot-core/webchat-relay/server.js:98–100` chooses the first `X-Forwarded-For` value for registration and message throttling. A local HTTP probe sent invalid registrations: the 21st request returned 429, then changing only that header returned 400 again, reaching body validation with a fresh quota. See `relay-rate-probe.log` and `relay-rate-probe.cjs`.

Impact: abuse limits can be bypassed where the ingress preserves a caller-supplied first value. This was reproduced locally, **not against live registration or messaging**. The production proxy's header sanitization was not verified, so live exploitability is conditional.

Fix: derive the client address from a verified proxy chain, reject untrusted forwarded identity, and add tenant/global bounds or ingress enforcement. Verify the actual Cloud Run ingress behavior without creating production test tenants.

## Verification results

| Check | Result | Evidence |
| --- | --- | --- |
| Backend suite | 495 tests / 53 files passed | `core-tests.log` |
| Backend TypeScript build | Passed | `core-build.log` |
| Collections ESM/CommonJS build and suite | 22 tests passed with TypeScript 5.9.3 | `engine-tests-locked-ts.log` |
| Relay and website suite | 19 tests passed | `relay-tests-unrestricted.log` |
| Dashboard production build | Passed; static export generated | `web-build.log` |
| Dashboard lint | 0 errors, 80 warnings | `web-lint.log` |
| Disposable-home installer suite | Passed, including interactive flow | `installer-tests-unrestricted.log` |
| Shell syntax and diff whitespace | Passed | `static-checks.json` |
| Non-owner authorization probe | Reproduced defect using fixtures | `auth-probe-results.json` |
| Relay rate-limit probe | Reproduced local header bypass | `relay-rate-probe.log` |
| Manual-install dependency copy | Broken target confirmed | `make-install-link.json` |
| Public HTTPS health | HTTP success; status ok, version 2.3.0, Firestore | `live-health.json` |
| Production dependency audit | Core/dashboard/relay unverified; engine has no runtime dependencies | `audit-0.json` through `audit-3.json` |

The 536 existing tests passing do not cover the newly reproduced defects. The additional fixture-based authorization probe passed by asserting the current insecure behavior; it is reproduction evidence, not a security pass.

Initial relay tests could not bind loopback sockets in the sandbox; they passed with approved local socket access. Initial installer tests stopped at pseudo-terminal creation (exit 125); the approved unrestricted disposable-home run passed. The engine initially selected global TypeScript 6 because its own `node_modules` directory lacked the locked compiler. Reusing the core's installed TypeScript 5.9.3 (matching the lockfile) passed. These initial failures are retained and classified as environment issues, not product build defects.

## Remaining evidence and next actions

1. Fix and verify the two P1 findings before a new release decision. Resolve the relay's trusted-proxy assumptions before relying on its abuse limits.
2. Obtain a current vulnerability audit. Sandboxed npm requests failed DNS resolution. Automatic approval review rejected a network-enabled retry because npm audit sends dependency metadata to the external registry without explicit disclosure approval. No vulnerability-free claim is made; approval to send that metadata remains required.
3. Run fresh lockfile installation and packaged startup on supported Node 22 and clean macOS/Linux hosts. The disposable installer suite uses build fixtures and is not full clean-device startup evidence. Windows parity is not established by these checks.
4. The core suite includes SQLite migration and backup/restore fixture tests. A production-like volume restore, restart recovery, actual channel delivery, authenticated deployed persistence, provider/SSO flows, load/capacity, and failure recovery were not exercised in this audit.
5. Live `/health` does not establish the Cloud Run revision/image digest, IAM, secret rotation, TTL policy, backup freshness, alerts/SLO ownership, or source-to-image provenance. Those remain operational evidence gaps; earlier records should be revalidated for the intended release.
6. Existing dashboard lint warnings remain debt. No new visual/accessibility review was performed.

Factory task: `request-9f52a604cf149f21b8723e15`.
Spacecrew work: `work_4b0acc41-14bb-43da-adf4-5f9342023444`.
This is an assessment by this session; it has not received a separate reviewer signoff and grants no release permission.
