# Run TestPilot AI v2

See the [root README](../README.md) for a fresh clone. This guide covers normal startup after dependencies, environment files and a database are configured.

## Existing installation

Start the saved local database from `backend-v2`:

```powershell
npx prisma dev start testpilot
```

If using an external PostgreSQL server, start that service instead. Match the configured direct `DATABASE_URL`; do not replace an existing database or reset its schema during normal startup.

Start backend and frontend in separate PowerShell terminals:

```powershell
cd backend-v2
npm run start:dev
```

```powershell
cd frontend-v2
npm run dev
```

Backend: http://localhost:4000/api. Frontend: http://localhost:3000. Run from these directories because backend dotenv loading, storage and workspaces use the process working directory.

Sign in with the configured current account. The initial administrator is created with `npm run prisma:seed` from `backend-v2` after setting `SEED_ADMIN_EMAIL` and a unique `SEED_ADMIN_PASSWORD`. Seeding does not reset an existing user's password.

## Verify

```powershell
Invoke-RestMethod http://localhost:4000/api
Invoke-RestMethod http://localhost:4000/api/health/ai
```

The base route returns `Hello World!` and proves HTTP reachability only. V2 has no general `/api/health`; that route belongs to legacy. The Codex health endpoint performs a real model operation and is not a free readiness probe.

## Optional tools

OpenAI configuration requires a valid private API key. If an existing optional Ollama setup is deliberately selected, check its local service and configured models. Codex features require an installed and authenticated CLI, independently of the selected provider. Browser execution requires `npx playwright install chromium` from `backend-v2`. Selenium needs Java 17 and Maven. SAP requires Windows, SAP GUI and an authorized scripting session.

V2 currently does not enforce `ENABLE_LOCAL_RUNNER=false`; avoid execution workflows unless intending to run them against authorized targets.

## Build and tests

From the root:

```powershell
npm run build --workspace=backend-v2
npm run build --workspace=frontend-v2
npm run test --workspace=backend-v2 -- --runInBand
npm run test --workspace=frontend-v2
```

Built serving uses `npm run start:prod` from `backend-v2` and `npm run start` from `frontend-v2`. Root Docker Compose runs the older application.

## Stop

Press Ctrl+C in the application terminals. For a background process, stop only the known process tree belonging to that server. Stop a saved Prisma database when finished:

```powershell
cd backend-v2
npx prisma dev stop testpilot
```

## Troubleshooting

- Check backend logs and database reachability if port 4000 is unavailable.
- Set required JWT and encryption secrets in your private backend environment file.
- With OpenAI selected, a missing API key prevents provider initialization with a clear configuration error.
- Frontend builds need network access for Google Fonts.
- Do not run the real E2E journey as a startup check: it creates data and can invoke AI or automation.
- Existing lint failures, test timer warnings and startup reconciliation limitations are recorded in `PUBLISH_VERIFICATION.md`.
