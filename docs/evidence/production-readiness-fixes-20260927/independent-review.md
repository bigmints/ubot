# Independent review — production readiness fixes

Date: 2026-09-27. Reviewer: separate Codex reviewer session `/root/readiness_review`.
Factory task: `request-9f52a604cf149f21b8723e15`.
Spacecrew work: `work_4b0acc41-14bb-43da-adf4-5f9342023444`.

## Initial review findings

- **Resolved during review — P1: SSO direct-route authorization dropped privileges.** `authenticateSsoRequest` in `youbot-core/src/index.ts` reduces an auth-hook result to its `authenticated` boolean. The server access gate uses that boolean to authorize direct administrative routes, including `/api/logs` and `/api/shutdown`, without checking `isOwner` or applying `canAccessApiRoute`. An authenticated non-owner SSO identity therefore bypasses the new owner check on direct routes. Reported to implementation session, which corrected the SSO gate to preserve the full result and apply `canAccessApiRoute`. The updated source was re-inspected and the non-owner denial and owner success were executed independently.
- An initial concern about API-key-only local configurations bypassing the outer gate was **withdrawn**: startup generates a password and assigns `resolvedAuth.password` before requests are accepted.

## Inspected

Read the working-tree changes to `Makefile`, `src/api/middleware/access.ts`, `auth.ts`, `src/api/index.ts`, `src/api/routes/chat.ts`, `src/index.ts`, `src/hooks/extensions.ts`, relay `server.js`, and `deploy-relay.sh`; read the three added regression suites. Paths under `src/` are within `youbot-core`.

The client policy denies non-chat endpoints by default; session IDs derive from credential identity rather than mutable display names; history and mutating session routes apply the same namespace; jobs are checked against owning sessions. Owner access is preserved. Installer materializes both engine formats and verifies the staged CommonJS entry before replacing the installed directories; the engine has no runtime dependencies.

Relay code defaults to socket identity, reads configured proxy hops from the right, validates forwarded IPs, bounds the rate-key map, and adds a tenant message quota. The deployment script sets one trusted proxy hop. This review has **not** verified the actual Cloud Run/custom-domain forwarded-header chain; deployment configuration must be validated separately.

## Executed independently

- `npm test -- --run src/api/routes/chat-access.test.ts` in `youbot-core`: **7/7 passed**.
- `bash test/make-install.test.sh`: **passed**, including dependency resolution after moving the fixture source directory away.
- `node --test youbot-core/webchat-relay/test/rate-limit-security.test.js`: **2/2 passed**. Initial sandbox run could not bind loopback (`EPERM`); rerun with explicit tool permission succeeded on an ephemeral loopback port.

No real runtime/configuration, production service, application code, or workflow records were changed by this reviewer. This document records review evidence only. No unresolved concrete blocker was found in the reviewed fixes after the SSO correction. Live ingress verification remains a release boundary, and this review does not approve deployment. Further product-source changes require a follow-up review.

## SSO correction verification

Executed the actual `handleRequest`, `shouldApplyServerAccessGate`, and `canAccessApiRoute` function bodies extracted through the TypeScript AST in an isolated VM, with request/response/auth-hook stubs and `NODE_ENV=production`. This avoids importing the application entrypoint and touching real config or databases. For `GET /api/logs`, an authenticated SSO identity with `isOwner=false` returned **403**, while `isOwner=true` returned **200**. This is an isolated wiring check, not a deployed-service test.

## Final source freeze review

Inspected the added `server-security.test.ts` production-mode gate regression: it invokes real `handleRequest` for five sensitive administrative endpoints with a non-owner key, expects 403, and restores the environment and test key cache in `finally`. It exercises the previously untested outer gate rather than only the policy helper. Also verified the remaining API router change is indentation only. No additional defect found; independent review remains passing for these frozen sources.

Read `runtime-smoke.json`, which records the implementation session’s successful Node 22.23.2 disposable installed-runtime authorization, session isolation, backup verification, offline restore, and restart checks. These were **not independently rerun by this reviewer**. Full-suite/build results reported by the implementation session likewise remain implementation verification, separate from the reviewer-executed checks above.

SHA-256 fingerprints of the reviewed final product and regression files:

| File | SHA-256 |
| --- | --- |
| `Makefile` | `20c6f3baf0b093a76f8d1abf10910751936c922fe58bbe702cad86b2a1b152f1` |
| `youbot-core/deploy-relay.sh` | `c4c9d10cf89eb277df0bfe8e2009119270c2d30c296a01a0653bfd8297df3b95` |
| `youbot-core/src/api/index.ts` | `9b2a8057bafa68cc998cc177b61132db00403c99cc9a6eea685b868f224e6c67` |
| `youbot-core/src/api/middleware/access.ts` | `020a4edf3415b84aeeca988d7a016e74f74f69e249c140d44bc43d69f91a01d5` |
| `youbot-core/src/api/middleware/auth.ts` | `a45fb60bd4dfa278fe5e0fde5fdde33c9ffc98dd776f5122ffa5e53f432046a2` |
| `youbot-core/src/api/routes/chat.ts` | `dadb117b050d6b87d1d52c234143d48acd62b24a6ec181afe618b077eaf5e196` |
| `youbot-core/src/hooks/extensions.ts` | `b3ea0724a544b8be7cb544e9533586c6e24c97b3b89154674ffaa058ec46d717` |
| `youbot-core/src/index.ts` | `9c8593cb181cd08661d10c8978b50907bce6af3ddad6fd2d498d65cd4191aba4` |
| `youbot-core/webchat-relay/server.js` | `846d143957afe1ec0fcceb579adabe0695c4700c5efb282c557b5627eb01ca27` |
| `youbot-core/src/api/routes/chat-access.test.ts` | `229152d7fcca42c1a98166eb216349e04fd22fa7fc281690b89c4e869b6f533d` |
| `youbot-core/src/server-security.test.ts` | `1e918881eddfdef83052cab04548a787229871b8c13fda4563afead476a0d2d1` |
| `test/make-install.test.sh` | `bb168c02b83512d17cf362408533a17b876053831aa3ed8f3d35a05e0b8c1f78` |
| `youbot-core/webchat-relay/test/rate-limit-security.test.js` | `dc596614ddeca198c1226938d5bd982b9657e4d9975a8a8e16d26267d2afc002` |

## Recorded assessment scope

The exact Spacecrew revision 6 acceptance concerns truthful readiness assessment and evidence, not an unconditional production release. Read the frozen remediation report and verified all 15 entries in `source-manifest.json` against current file SHA-256 values. The scoped fixes and assessment pass independent review. Current npm vulnerability audit remains unrun pending metadata-egress authorization, and live deployment, actual ingress trust-chain validation, and deployed readback remain release gates. This pass does not close unrelated Collections acceptance or approve production rollout.
