# TestPilot AI Publication Verification

Verified on 2 October 2026. These results cover local build/unit checks and publication preparation, not live enterprise automation or deployment certification.

| Check | Result | Evidence / limit |
| --- | --- | --- |
| Current dependency inventory | PASS | `npm ls --depth=0` completed successfully |
| Root lockfile install validation | PASS | `npm ci --dry-run --ignore-scripts` completed successfully; existing installed dependencies retained |
| Prisma client generation | PASS | `npx prisma generate` from `backend-v2` |
| Backend v2 build | PASS | Nest build emits `dist/src/main.js` |
| Frontend v2 build | PASS | Next.js production build completed |
| Backend unit tests | PASS | 20 suites, 275 tests; final run with `--runInBand --detectOpenHandles` exited 0 |
| Frontend unit tests | PASS | 2 files, 14 tests |
| Backend lint | FAIL | Existing full check reported 2,441 errors and 11 warnings, mostly formatting plus typed lint debt |
| Frontend lint | PASS with warnings | Final check: 0 errors, 3 warnings |
| Legacy Python compile | PASS | `python -m compileall backend-legacy/app` |
| Legacy backend tests | PASS | 34 passed; 4 collection warnings |
| Legacy frontend install/build | PASS | `npm ci --ignore-scripts`, then TypeScript/Vite build |
| Backend HTTP | PASS | `/api` returns `Hello World!`; reachability only |
| Frontend HTTP | PASS | Port 3000 returned HTTP 200 |
| Configured provider health | PASS | Existing local Ollama configuration returned `healthy: true` |
| OpenAI missing-key handling | PASS at provider initialization | V2 constructor returns the exact required missing-key message, with the key removed only in an isolated subprocess |
| Legacy health/missing-key behavior | PASS in unit checks | Health TestClient and missing-key agent tests passed |
| Dependency vulnerability audit | ISSUES FOUND | 32 advisories: 1 critical, 19 high, 12 moderate |
| Live AI generation | NOT RUN | External provider costs/authentication and application data required |
| Live browser/SAP/Selenium execution | NOT RUN | Could affect external applications and create evidence/data |
| Real journey E2E | NOT RUN | Requires isolated seeded test data, credentials, browsers and authorized targets |
| Secret/publication review | Candidate set reviewed | Sensitive local files and company-derived runtime material excluded; not a guarantee of complete application security |

## Minor repairs included

- Removed known default authentication/encryption secrets and required configuration.
- Removed shared seed password/password logging and moved E2E credentials to environment variables.
- Added ephemeral test-only secrets and encryption tests covering randomized ciphertext, tamper rejection and missing-key failure.
- Corrected `start:prod` to match the emitted backend entry point.
- Replaced mutable navigation render bookkeeping with equivalent previous-item lookup, resolving the frontend lint error.
- Replaced obsolete/starter README content with implementation-based documentation and safe setup templates.

The normal backend unit command emitted an asynchronous-operation warning after successful tests but ultimately exited 0. A final `--detectOpenHandles` run also passed and exited 0. No forced Jest exit was used to conceal failures.

Development watch mode stopped during repeated source changes/build verification due to a Nest CLI process-tree termination race. The backend was relaunched and HTTP/provider health rechecked. This is an operational observation, not a production-readiness guarantee.

Startup reconciliation on the existing Prisma Dev installation has emitted bind-parameter and connection-termination warnings. Backend startup and base/provider HTTP checks succeeded, but startup reconciliation and database workflows require further investigation; the base route does not establish complete database readiness.

## Reproduce

Use the commands in the root README and run guide. Detailed local logs remain under `.runlogs` and are intentionally excluded from Git because logs can contain private data. New installations must configure their own environment files, database, admin account, AI authentication and optional runner tools. Browser/enterprise E2E checks should use a disposable database and explicitly authorized test targets.
