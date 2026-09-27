# Youbot production-readiness remediation — 2026-09-27

## Outcome

The three defects from the [readiness assessment](../production-readiness-20260927/README.md) are fixed in the working tree. The local release candidate passes clean dependency installation, builds, 546 automated tests on Node 22.23.2, independent review, and a real installed-runtime authorization/backup/restore/restart check.

**Implementation is verified locally; production rollout is not complete.** No application deployment, real visitor message, provider call, or production-data mutation was performed. The current production dependency audit passes with zero known vulnerabilities across all four packages. Deployed relay ingress/readback remains a release gate. Do not treat the historical September 17 release decision as approval of this working tree.

Baseline: `7e6c8b9c2b33e2459efb98ad10457fe1f90e481c` plus the changes fingerprinted in `source-manifest.json` and the independent review. Existing untracked work was preserved.

## Repairs

- **Owner boundaries:** a shared route policy runs before protected API dispatch and direct server handlers. Non-owner clients cannot read relay credentials, owner configuration, provider discovery, uploads, logs or metrics, change model routing, or shut down the runtime. SSO now preserves and checks the full authenticated privilege result instead of reducing it to a boolean.
- **Client isolation:** credential-derived identities replace display-name session prefixes. Submission, history, listing, creation, rename, clear, deletion and async-job polling stay within the authenticated client's namespace. Keys with identical display names remain isolated. Owner behavior is preserved. Historical display-name sessions are not silently reassigned; owners retain visibility. SSO non-owners need a stable unique `clientId`; administrative SSO identities need explicit `isOwner: true`.
- **Installation:** `make install` materializes both engine module formats into the installed dependency tree and checks its CommonJS entry before replacing installed libraries. It no longer copies an unusable source-relative package link. Both installer regression suites are included in `make test`.
- **Relay abuse limits:** direct requests ignore forwarded identity by default. Explicit trusted proxy hops are counted from the right, parsed as IP addresses, and invalid input falls back to the socket peer. Quota-map growth is bounded and message traffic has a tenant-wide cap as well as a per-client cap. Deployment config selects one hop for direct managed ingress; the actual live ingress chain still requires validation.

The operations guide describes the new client/SSO contracts and relay trust boundary. No dependency versions changed.

## Executed verification

All application checks below ran against an isolated source snapshot overlaid with the scoped edits, not against the real runtime home. Fresh `npm ci --offline --no-audit` succeeded for the engine, core, dashboard and relay using cached lockfile packages. This verifies lockfile installation on this macOS host, not a clean-device network download or current vulnerability scan. npm warned about install-script approvals; the resulting native SQLite package loaded successfully under Node 22 and passed real runtime/restore verification.

| Check | Result | Evidence |
| --- | --- | --- |
| Core, supported Node 22.23.2 | 503 tests / 54 files passed | `core-node22-tests.log` |
| Collections engine, Node 22 | 22 tests passed, ESM/CommonJS built | `engine-node22-tests.log` |
| Relay/website, Node 22 | 21 tests passed | `relay-node22-tests.log` |
| Core production build, Node 22 | Passed | `core-node22-build.log` |
| Dashboard production export, Node 22 | Passed | `web-node22-build.log` |
| Dashboard lint | 0 errors, 80 pre-existing warnings | `web-lint.log` |
| Standalone dependency fixture | Passed with source moved away | `make-install.log` |
| Public installer fixture suite, Node 22 | Passed, including interactive flow | `installer-node22.log` |
| Installed runtime HTTP checks | Passed | `runtime-smoke.json`, `runtime-smoke.log` |
| Installed CLI backup/verify/restore/restart | Passed | `runtime-smoke.json` |
| Independent scoped review | Passed; SSO gap found and fixed during review | `independent-review.md` |
| Shell syntax and diff whitespace | Passed | `static-checks.json` |
| Current production dependency audit | All four packages: zero known vulnerabilities, exit 0 | `dependency-audit-summary.json`, `audit-*.json` |

`runtime-smoke.cjs` records the reproducible fixture driver. It used a fresh temporary home and the real `make install` recipe with already-built artifacts, then launched the installed backend. It verified unauthenticated denial, non-owner configuration/log/model-routing/shutdown denial, owner login and settings access, distinct same-name-key sessions, protection from foreign-session deletion, backup integrity, restoration of a changed configuration marker, and health after restart. Test credentials and records were synthetic. The fixture process was stopped at completion.

The independent reviewer ran authorization tests, installer dependency tests, relay security tests, and an isolated production SSO routing check. Broader runtime checks above were run by the implementation session and are not mislabeled as independently executed.

## Remaining release gates

1. **Dependency audit completed:** after explicit user approval, `npm audit --omit=dev --json` completed on 2026-09-27 at 11:07 UTC for core, dashboard, relay and collection engine. Every package returned exit 0 and zero known vulnerabilities at all severities. Reports retain lockfile hashes. This is a current production-dependency advisory check, not a guarantee against unknown vulnerabilities or a development-dependency audit.
2. **Deployment/readback:** deploy the reviewed artifacts only with release authorization; record image/source identity, verify health, and confirm that spoofed forwarded prefixes cannot change quotas through the actual public ingress. No claim is made that the live service contains these repairs.
3. **Platform and operational scope:** tested on macOS and supported Node 22, not a clean Linux or Windows device. Real-provider/channel delivery, production-volume restore, capacity/SLO/alert ownership, and multi-instance operation are not proven by these checks. The established profile remains a single loopback owner runtime plus the separate relay. Dashboard lint warnings remain quality debt.

The Fikr Studio handoff is pending: no Fikr Studio MCP write tool is available in this session. The retained handoff text is in `fikr-studio-handoff.md`.

Factory task: `request-9f52a604cf149f21b8723e15` (follow-up intake `request-1a01be44f122217d59cfc7f4` linked to this task).
Spacecrew work: `work_4b0acc41-14bb-43da-adf4-5f9342023444`.
