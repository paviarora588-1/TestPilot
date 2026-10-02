# TestPilot AI Publication Security Audit

## Scope

Publication preparation inspected the current v2 application, legacy application, workspace/dependency/configuration files, automation tooling, documentation and local runtime-data locations. The directory initially had no Git repository, so there was no existing local Git history to rewrite or preserve. The owner explicitly authorized excluding company material and confirmed permission to publish the remaining application source.

Automated scans covered candidate source/documentation/configuration content for API-key patterns, private keys, JWTs, credential assignments, credential-bearing connection strings, private hosts, company references, local account paths, binary/large artifacts and exact matches against secret values from local environment files. Matches were reported by file and variable name without displaying values. Dependency/build trees and binary/runtime captures were excluded from the publication set rather than claimed to be fully content-inspected.

## Findings and actions

- Local environment files and database contents remain private and excluded.
- A credential-bearing local troubleshooting script and an authentication-token cache were found and excluded. Neither was committed.
- Company-derived knowledge, captured HTML, generated company automation, execution evidence, targeted diagnostics and old interview dossiers were excluded.
- Company-specific source comments, test selectors, transaction examples and UI examples were sanitized into generic/synthetic examples.
- Default JWT signing and integration-encryption secrets were removed; runtime configuration is required.
- The seed no longer has a shared password or prints passwords. It requires a unique configured password of at least 12 characters.
- Browser E2E helpers read test-account credentials from the environment instead of a shared literal.
- Docker Compose no longer contains a fixed database password/credential-bearing URL. Docker build contexts exclude private files and runtime data.
- `.gitignore` covers secrets, dependencies, build output, generated clients, databases, logs, evidence, tool downloads, local configuration and diagnostic artifacts.
- Safe backend/frontend environment templates contain empty credential fields. A generic legacy SQLite path is configuration, not a password-bearing connection string.
- Repository-local Git identity uses a GitHub noreply address. Unrelated global Git configuration was not changed.

Existing synthetic test doubles, placeholder strings and the historical design's masked token display are test/design data; no production mock AI fallback was added.

## Excluded material

Exclusions preserve files locally. They do not delete application data or significant functionality. Runtime storage and generated runner tests are recreated by normal operations. Dependencies and the generated Prisma client are restored by installation/generation. Local company-derived files, private account configuration, token caches, credentials, databases, screenshots, logs and downloaded tools must not be copied into a public clone.

## Remaining issues

The root npm dependency audit reported **32 advisories: 1 critical, 19 high and 12 moderate**. This is not a clean application-security result. Some suggested fixes require major dependency changes; publication preparation did not force upgrades or redesign working code. The current Next.js advisory and other dependencies need a dedicated remediation/compatibility pass before deployment.

Existing architecture risks include publicly served scan/execution assets, incomplete Golden Rule enforcement, optional AI-review availability, live v2 subprocess runners without enforcement of the legacy disable flag, permissive runner TLS settings, in-process/shared execution state, and limited structured-output/path validation. These are described in architecture and verification documents. No claim of hardened deployment security is made.

Automated secret scanning does not prove the absence of every possible confidential detail or vulnerability. Review newly added data, binaries and integration settings before future commits. Rotate credentials if they were ever shared elsewhere; this preparation did not publish the identified local secrets.
