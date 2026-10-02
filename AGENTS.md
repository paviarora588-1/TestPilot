# AGENTS.md

## Product Rules

- Product name: **TestPilot AI**.
- Tagline: **Learn the product. Build the library. Automate anything.**
- This is a live full-stack AI product, not a static prototype.
- Do not hardcode SE, AM, ER, TA, Role Catalog, or any module-specific behavior.
- Sample files may include sample module names only as data.

## No Prototype / No Dummy-Only Rule

- Frontend pages must call backend APIs through `frontend/src/services/api.ts`.
- Do not use static arrays as primary app data.
- Reports and history must come from the database.
- Buttons must perform real API actions or clearly be safe placeholders.

## Real OpenAI Required Rule

- Active AI methods must call OpenAI.
- Do not add mock AI fallback.
- If `OPENAI_API_KEY` is missing, return:
  `OPENAI_API_KEY is missing. Real AI mode requires a valid OpenAI API key.`
- If OpenAI returns invalid JSON or fails, return a clear API error. Do not fake success.

## Golden Automation Rule

Script generation is blocked unless:

1. Product knowledge is processed.
2. Object repository contains items.
3. Test case steps are mapped.
4. Mappings are approved or above confidence threshold.
5. Risk score is acceptable.
6. AI script review is completed as part of generation/review workflow.

Blocked responses must include reasons and next actions.

## Backend Standards

- Use FastAPI, SQLAlchemy, Pydantic schemas, and dependency-injected sessions.
- SQLite default is `backend/testpilot.db`; PostgreSQL works via `DATABASE_URL`.
- Tables auto-create on startup for MVP, with SQLite missing-column upgrades.
- Every major operation writes `HistoryEvent`.
- Uploads stay under `backend/app/uploads/{product_id}/`.
- Generated scripts stay under `backend/app/generated_scripts/{product_id}/{test_case_id}/`.

## Frontend Standards

- Use React + Vite + TypeScript + Tailwind CSS.
- Keep a premium enterprise SaaS UI.
- Include product selector, loading states, visible success/error states, badges, tables, cards, code preview, and timeline patterns.
- Show OpenAI configuration errors clearly.

## Script Execution Safety

- Default `ENABLE_LOCAL_RUNNER=false`.
- Do not run OS-level SAP/browser/desktop scripts by default.
- Execution APIs create safe `READY_TO_RUN` records and commands.

## Quality Checks

- Run `python -m compileall backend\app`.
- Run `python -m pytest backend\tests`.
- Verify `/api/health`.
- Verify AI endpoints return the missing-key error when no key is set.
- Run `npm run build` when Node/npm are available.
