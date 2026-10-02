# TestPilot — Full Product & Technical Build Prompt

> Feed this entire document to an AI coding agent as the initial prompt. It describes a complete, working product to build in one continuous effort, including the technical decisions and pitfalls already discovered building it once. Follow it as an implementation brief, not a suggestion list — the architecture choices below are deliberate, not arbitrary.

## 1. Product Vision

Build **TestPilot**: a local-AI-powered QA automation platform that acts as a full QA co-pilot, not a no-code script generator. The goal: let one skilled QA engineer manage the quality of a product that would normally need a team of ten, with AI doing the repetitive analysis and generation work under human review.

TestPilot should be able to: read a Jira story, understand acceptance criteria and risk areas, write categorized manual test cases, identify which are worth automating, generate production-grade Playwright/Selenium scripts against a real object library, execute them, analyze failures with root-cause classification, draft a bug report with evidence, recommend a regression suite when something changes, and keep improving from an uploaded product knowledge base — all while running against a **local LLM by default**, not a cloud API, so product data never has to leave the machine.

Current scope: **web application testing only**. SAP GUI, desktop, and mobile are explicitly out of scope for v1 — design the Scanner/Object Library abstractions so they *could* extend there later, but do not build for it now.

Do not build a demo. Every generated artifact (test cases, scripts, reports, bug tickets) must be something a real QA engineer would actually use, not a toy example.

## 2. Tech Stack (non-negotiable)

- **Backend**: NestJS + TypeScript + Prisma ORM + **SQLite** for the working prototype (not Postgres — SQLite is genuinely sufficient at this scale and removes a whole service dependency; migrate to Postgres only if/when real multi-user concurrency demands it).
- **Frontend**: Next.js (App Router) + TypeScript + Tailwind CSS v4 + shadcn/ui (built on **Base UI**, not Radix — check current shadcn CLI defaults).
- **Automation**: Playwright first (TypeScript, Page Object Model). Selenium (Java) second. Both must be real, running compilers producing multi-file projects — not string templates that only look like code.
- **AI**: Provider-abstracted (`AiProvider` interface: `generateText`, `generateJson`, `generateEmbedding`, `streamText`, `healthCheck`), with three implementations: **Ollama** (default local), **llama.cpp** (alternate local), **OpenAI** (optional cloud fallback). Select via a single `AI_PROVIDER` env var through a Nest factory provider. Ollama and llama.cpp share a base class since both speak an OpenAI-compatible HTTP surface.
- **Local models**: `llama3.2:3b` for text/JSON generation, `nomic-embed-text` for embeddings. Do not default to a larger model (`llama3.1` 8B) unless the target machine is confirmed to have GPU acceleration — on CPU-only hardware a 3B model is already slow for some flows; an 8B model download alone can take hours on a throttled/corporate network (see §11).
- **Vector search**: no external vector DB needed at this scale — store embeddings as JSON arrays directly on the chunk row and rank by in-process cosine similarity. Only move to Qdrant/pgvector if a real deployment's knowledge base grows large enough to matter.
- **File storage**: local filesystem under `storage/` (scans, executions, knowledge documents), served as static assets outside the API prefix.

## 3. Architecture Overview

```
backend/                     # NestJS + Prisma
├── prisma/schema.prisma
└── src/
    ├── modules/
    │   ├── auth/                  JWT + refresh, bcrypt, RolesGuard, seeded Admin
    │   ├── applications/          top-level "product under test" entity
    │   ├── scanner/                real Playwright headless scan of a live URL
    │   ├── object-library/        curated, promoted objects (locators, confidence, backups)
    │   ├── test-cases/            manual CRUD, CSV/Excel import, AI generation, regression rec.
    │   ├── test-data/             data sets/items, placeholder tokens
    │   ├── automation-builder/    flow graph (nodes/edges), AI-drafts from a test case
    │   ├── script-generator/      deterministic Playwright/Selenium compilers + AI review pass
    │   ├── execution/             runs compiled scripts, captures evidence, failure analysis, auto-heal
    │   ├── bug-reports/           AI drafts a bug report from a failed run, human submits to Jira
    │   ├── reporting/             coverage/trends/exports
    │   ├── knowledge-base/        upload → parse → chunk → embed → AI summary
    │   ├── rag/                   in-process embedding retrieval, used by every AI-generation call
    │   ├── integrations/          real Zephyr/Jira REST clients (read AND write), single-story analysis
    │   └── ai-provider/           the provider abstraction described above
    └── common/
        ├── golden-rule-policy.service.ts   central "can this be generated/executed yet" gate
        └── role-groups.ts                  OPERATIONAL_ROLES / APPROVAL_ROLES / ADMIN_ONLY

frontend/                    # Next.js App Router
└── src/
    ├── app/
    │   ├── (auth)/login
    │   └── (dashboard)/            one route per module, shared AppShell layout
    ├── components/
    │   ├── ui/                     shadcn primitives
    │   ├── layout/                 AppShell, sidebar nav, app background glow
    │   └── <feature>/              feature-specific components
    └── lib/
        ├── api.ts                  one typed function per backend endpoint
        ├── types.ts                mirrors backend DTOs/entities
        └── application-context.tsx currently-selected Application, used everywhere
```

Every module follows the same shape: `*.controller.ts` (routes + `@Roles()` guards), `*.service.ts` (business logic), `*.module.ts` (DI wiring), `dto/*.dto.ts` (class-validator input shapes).

## 4. Database Schema (Prisma) — core models

Build these as real Prisma models (SQLite datasource). Field lists are the minimum needed for the features below to work — add fields as features require them, don't pre-add speculative ones.

```prisma
model User { id, email, passwordHash, name, role: ADMIN|QA_LEAD|QA_ENGINEER|VIEWER, timestamps }
model RefreshToken { id, userId → User, tokenHash, expiresAt }

model Application { id, name, appType, entryUrl, defaultFramework, owner, description, timestamps
  // has-many: everything below is scoped to one Application
}

// Scanner: raw → curated, two layers deliberately (a scan run is noisy/unreviewed)
model ScanSession { id, applicationId, targetUrl, status, startedAt, completedAt }
model ScanPage { id, scanSessionId, url, title, screenshotPath, htmlSnapshotPath }
model ScanObject { id, scanPageId, label, objectType, xpath, cssSelector, recommendedLocator,
  recommendedLocatorType, backupLocators (json), confidenceScore, promoted }
model ObjectRepository { id, applicationId, moduleName, featureName, screenName, objectName,
  objectType, technicalPath, locatorStrategy, backupLocators (json), verificationStatus,
  confidenceScore, usageCount, screenshotPath, sourceScanObjectId }

// Test Cases
model TestCase { id, applicationId, externalId, title, moduleName, featureName,
  source: MANUAL|CSV|EXCEL|ZEPHYR_API|JIRA_AI_GENERATED|AI_GENERATED,
  priority: LOW|MEDIUM|HIGH|CRITICAL,
  testType: POSITIVE|NEGATIVE|BOUNDARY|UI|INTEGRATION|REGRESSION|SMOKE (nullable),
  preconditions, expectedResult, readinessScore, automationStatus: NOT_STARTED|MAPPED|SCRIPT_GENERATED|AUTOMATED,
  automationRecommended (bool, nullable), automationRecommendedReason, analysisResultJson (json) }
model TestStep { id, testCaseId, stepOrder, instruction, expectedResult }

// Test Data
model TestDataSet { id, applicationId, name, environment, description }
model TestDataItem { id, testDataSetId, key, value, isSensitive }
model DataBinding { id, applicationId, testStepId, testCaseId, testDataItemId }

// Automation Builder — hybrid storage: graphJson is canonical, steps are a
// materialized/queryable view rebuilt from it on every save
model AutomationFlow { id, applicationId, testCaseId (nullable), name, description,
  framework: PLAYWRIGHT|SELENIUM, graphJson (json), status: DRAFT|VALID|GENERATED }
model AutomationFlowStep { id, automationFlowId, nodeId, stepOrder, stepType, objectId,
  testDataItemId, inlineValue, config (json) }

// Script Generation & Execution
model GeneratedScript { id, applicationId, automationFlowId, testCaseId, framework, command,
  reviewJson (json), riskScore, status: GENERATED|REVIEWED }
model GeneratedScriptFile { id, generatedScriptId, fileName, role: SPEC|PAGE_OBJECT|CONFIG|FIXTURE, code }
model ExecutionSuiteRun { id, applicationId, scope, status, totalCount, passCount, failCount }
model ExecutionRun { id, applicationId, scriptId, suiteRunId, status: READY_TO_RUN|RUNNING|COMPLETED|FAILED|BLOCKED,
  durationSeconds, logs (json), evidencePath, command, browser, environment, executedById,
  failureAnalysisJson (json) }
model ExecutionStepResult { id, executionId, stepOrder, action, instruction, status, durationSeconds,
  message, screenshotPath }
model AutoHealSuggestion { id, applicationId, executionId, objectId, oldPath, suggestedPath, reason,
  confidence, status: PENDING|APPROVED|REJECTED }

// Bug Reports
model BugReport { id, applicationId, executionId (nullable), title, stepsToReproduce (json),
  actualResult, expectedResult, severity: LOW|MEDIUM|HIGH|CRITICAL, priority, environment,
  evidencePaths (json), logsSnapshot, status: DRAFT|SUBMITTED|FAILED, externalIssueKey, errorMessage }

// Knowledge Base / RAG
model KnowledgeSource { id, applicationId, fileName, fileType, filePath,
  status: PENDING|PROCESSING|PROCESSED|FAILED, errorMessage, chunkCount }
model KnowledgeChunk { id, knowledgeSourceId, applicationId, chunkIndex, content,
  embedding (json, float array), embeddingAvailable (bool) }
model KnowledgeSummary { id, knowledgeSourceId (unique), modules (json), validations (json),
  gaps (json), aiEnrichmentAvailable }

// Integrations
model IntegrationConfig { id, applicationId, type: ZEPHYR|JIRA, baseUrl, projectKey,
  credentialsEncrypted, keyVersion }
model IntegrationSyncLog { id, integrationConfigId, direction, status, itemsProcessed,
  errorMessage, startedAt, finishedAt }
```

Add explicit inverse relation arrays on `Application` for every child model (Prisma requires both sides declared) and appropriate `@@index`/`onDelete: Cascade` on every foreign key.

## 5. AI Provider Architecture & Prompting Patterns — read this before writing any AI-calling code

These are hard lessons from building this once already. Skipping them will reproduce real bugs.

1. **Load `.env` explicitly.** A NestJS app does not auto-load `.env` files. Add `import 'dotenv/config';` as the literal first line of `main.ts`, before any other import. Without this, every `process.env.X` read silently falls back to its hardcoded default — this exact bug caused hours of "why doesn't changing the config do anything" confusion.

2. **Small local models (3B-class) reliably complete ONE bounded JSON object per call, but frequently truncate mid-array when asked for several nested objects in a single completion.** Never ask `generateJson` for an array of N rich objects (e.g. "generate 5 test cases as a JSON array"). Instead, loop N times, asking for **one object per call**, accumulating results. This is the single most important reliability pattern in this codebase — apply it to test case generation, Jira story test-case drafting, and anywhere else a "generate several structured things" feature is built.

3. **Small models weight "don't repeat yourself" instructions weakly.** If you loop N calls with only a growing "don't duplicate these titles" list, you will still get near-duplicate outputs. Fix by assigning each iteration a distinct explicit angle/constraint (e.g. rotate through "happy path", "invalid input", "boundary case", "security/validation case", "alternate rule") — forcing structural variety works far better than asking politely for variety. Add a hard case-insensitive exact-title dedupe filter as a backstop regardless.

4. **Increase context/output limits explicitly for local providers.** Ollama's OpenAI-compatible chat endpoint defaults to a small context window that truncates longer structured responses. Pass `max_tokens: 4096` and the Ollama-specific extension `options: { num_ctx: 8192 }` in every `generateText` call in the Ollama/llama.cpp provider — harmless no-ops on strict OpenAI-compatible servers, necessary on Ollama.

5. **Defensive JSON parsing is not optional.** Local models wrap JSON in markdown fences, add prose before/after, or occasionally emit an object when an array was requested. Implement a `parseJsonLoose` that strips code fences, tries direct `JSON.parse`, and falls back to a brace/bracket-balanced extractor (walk the string tracking string-escape state and nesting depth, extract the first balanced `{...}` or `[...]`). Every `generateJson` call goes through this.

6. **Every AI enrichment step must degrade gracefully, never block the deterministic baseline.** Pattern used throughout: compute a deterministic result first (rule-based classification, object matching, etc.), then wrap the AI call in try/catch — on success, merge AI fields in and set `aiEnrichmentAvailable: true`; on failure, log a warning and return the deterministic result alone with `aiEnrichmentAvailable: false`. The UI must show *why* AI enrichment is unavailable (health-check it, don't just silently omit fields).

7. **RAG retrieval must also degrade gracefully.** `retrieveContext(applicationId, query)` returns `{ chunks: [], used: false }` if the embedding model is unreachable or no chunks exist — every caller checks `.used` and only appends context to the prompt when true. Never let a knowledge-base outage break test-case generation; it should just generate without that context.

8. **Ground every AI generation in real data, never let it invent domain objects.** When generating an automation flow or grounding test steps in UI elements, only ever reference `ObjectRepository` ids that actually exist — validate/filter AI output against the real id set before persisting, silently dropping hallucinated references rather than trusting them. When no matching object exists (e.g. a Knowledge-Base-only test case with no Scanner data yet), instruct the model explicitly to phrase that step as a business-level action instead of inventing a UI element.

9. **Model size/speed tradeoff is real and user-facing.** An 8B model produces better output but can take multiple minutes per structured-generation call on CPU; a 3B model is ~5-10x faster with somewhat rougher output. Default to the 3B class for responsiveness; document this tradeoff to the user rather than silently picking one.

## 6. Golden Rule Policy (execution/generation gating)

Implement a shared `GoldenRulePolicyService` that every generation/execution path consults before acting — it's the thing stopping the AI from generating garbage scripts or running against an incomplete flow. Returns `{ blocked: boolean, reasons: string[], nextActions: string[] }`. Blockers include (non-exhaustive): a flow step has no object assigned, no scanned objects AND no processed Knowledge Base content exist for the application, a script framework isn't supported by the execution engine yet, required test data is missing. Every blocked response follows this exact `{blocked, reasons, nextActions}` shape across the whole codebase — controllers throw a `ConflictException` (409) with this body; the frontend has one shared `blockerMessage(err, fallback)` helper that extracts `reasons` from an Axios error and falls back to a generic message.

## 7. Feature Modules — what each must actually do

**Scanner** — real Playwright headless scan of a given URL (`page.evaluate()` DOM walk), heuristic label priority: `aria-label` → `label[for]` → `placeholder` → nearby heading → `data-testid` → CSS nth-of-type fallback path. Screenshot + HTML snapshot per page, confidence-scored candidate objects. A promote step moves reviewed candidates from `ScanObject` into the curated `ObjectRepository`.

**Object Library** — browse/edit/promote-from-scan/rescan/delete-with-usage-warning. Store multiple locator strategies + backup locators per object (used later for self-healing).

**Test Cases** — manual CRUD; CSV/Excel import; **AI generation** grounded in either scanned objects, processed Knowledge Base summaries, or both (neither being required exclusively — Knowledge-Base-only generation must work with zero scanned objects, since a QA lead may start from a spec doc before the Scanner ever runs); one-object-per-call generation loop per §5.2-5.3; each generated test case can optionally auto-chain into automation flow generation in the same request (`autoGenerateFlows` flag).

**Jira Story → QA Flow** — given a real Jira issue key, fetch the single issue (not a bulk project search), extract acceptance criteria (from a conventional description heading, since Jira has no universal ACF field), analyze impacted modules and risk areas, then generate several categorized test cases (`testType` enum) each with an automation-candidate recommendation + reason. Separate this from a bulk "sync all project issues" import path, which can stay shallow.

**Automation Builder** — flow stored as a graph (nodes/edges/viewport from a canvas library like React Flow), `AutomationFlowStep` rows rebuilt (delete+recreate) from the graph on every save as a materialized queryable view. AI drafts a flow from a test case's steps, matched against the real Object Library and Test Data, silently dropping any hallucinated ids.

**Script Generator** — deterministic template compilers (not free-form AI-authored code — generation from a fixed compiler is the security boundary that makes running the output safe), one for Playwright (TS, Page Object Model, per-step screenshot-on-every-step not just on failure, waits, assertions, structured step-result logging) and one for Selenium (Java, JUnit 5, same POM pattern, explicit `implicitlyWait` since Selenium has no Playwright-style auto-wait). AI does a review pass afterward (risk score + comments), never authors the executable code itself.

**Execution Engine** — runs the compiled project via subprocess (`spawn`, never `eval`), single global lock (the scratch project directory isn't per-run isolated), captures a screenshot after every step (not just failures) so a headless run is still visible step-by-step in the UI, parses pass/fail per step, computes failure analysis on any failure.

**Failure Analysis** — deterministic string-matching on the raw error message first (framework-specific vocabulary: Playwright says "waiting for locator", Selenium says "no such element" — these need separate matchers, don't reuse one for both). Categories: `locator_not_found`, `timeout`, `assertion_failed`, `navigation_failed`, `unknown`, plus — for the two genuinely ambiguous categories (`assertion_failed`, `unknown`) — an AI second pass that can reclassify into `application_bug`, `test_data_issue`, `environment_issue`, `requirement_mismatch`, or `automation_script_issue`, grounded in the test case's expected result and Knowledge Base context. When the AI concludes it's a script issue, additionally ask for a corrected code snippet (shown read-only in the UI — never auto-applied).

**Self-Healing** — when a failure is a locator issue, propose a fix using the *same object's own backup locators* (captured at scan time), never swap to a different object. Store as an `AutoHealSuggestion` requiring explicit human approval before it writes back to `ObjectRepository` — never auto-apply on failure.

**Bug Reports** — AI drafts title/repro-steps/actual-result/severity from a failed `ExecutionRun`'s step results + failure analysis + the test case's expected result, evidence = the run's per-step screenshot paths. Always starts `DRAFT`; a human reviews/edits in the UI; only an explicit "Submit" action calls a real Jira issue-creation client and stores the returned issue key. Jira's `description` field requires Atlassian Document Format on create, not plain text — implement a minimal plain-text→ADF converter (one paragraph node per line).

**Regression Intelligence** — rule-based first: rank other test cases in the same application by (a) shared `moduleName`/`featureName` and (b) shared `ObjectRepository` usage between automation flows (compare the target flow's step objectIds against every candidate's flow's step objectIds). This needs zero AI calls and is the primary, always-available signal. Layer one bounded AI call on top (capped to ~8 top candidates, single JSON array — small enough to avoid the truncation problem in §5.2) to assign a HIGH/MEDIUM/LOW risk label with a one-sentence reason, falling back to a deterministic priority-based risk label if the AI call fails.

**Knowledge Base** — upload (PDF/Word/Excel/CSV/text/markdown) → parse to plain text → chunk → embed each chunk (gracefully mark `embeddingAvailable: false` per-chunk on embedding failure, don't fail the whole upload) → AI extraction of `{modules, validations, gaps}` stored as a `KnowledgeSummary`, always available even if embeddings aren't (it needs `generateJson`, not `generateEmbedding`). This structured summary is a **separate, always-on layer** from semantic chunk retrieval — use it as a same-cost fallback context source whenever RAG retrieval itself is unavailable.

**Reporting** — coverage (per-module automated vs. not), pass/fail trend over time, PDF/Excel/CSV export.

**Integrations (Zephyr/Jira)** — real REST clients (Jira Cloud REST v3, Basic auth via email+API token; Zephyr Scale REST v2), not stubs. Credentials AES-256-GCM encrypted at rest, masked in every API response. Separate config per tool — **do not build one generic "connect integration" form with a type dropdown**; Zephyr and Jira have different required fields (Jira needs an account email, Zephyr doesn't) and should read as two independent, clearly labeled configuration sections in the UI, not one form that conditionally shows/hides fields.

## 8. RBAC

Four fixed roles, no custom permission tables: `ADMIN`, `QA_LEAD`, `QA_ENGINEER`, `VIEWER`. Central `role-groups.ts`:
- `OPERATIONAL_ROLES = [QA_ENGINEER, QA_LEAD, ADMIN]` — day-to-day create/generate/execute actions.
- `APPROVAL_ROLES = [QA_LEAD, ADMIN]` — approving auto-heal, deletions, syncing integrations, submitting bug reports to Jira (external, higher-risk actions).
- `ADMIN_ONLY = [ADMIN]` — credential/integration management, user administration.
- No `@Roles()` decorator on a route = any authenticated user, including Viewer, can call it (reads are open by default).

## 9. UI/UX Design System

Premium, enterprise-grade, dark-mode-first — never look like a default component-library template. Concretely:

- **Base**: Tailwind v4 + shadcn/ui (Base UI primitives). Extend the base `Card` component with dark-mode-only glass styling (`dark:bg-white/[0.03] dark:backdrop-blur-xl dark:ring-white/10 dark:hover:ring-primary/25`) — this one change cascades premium styling across every page automatically, since every module's UI is built from the same `Card` primitive. Light mode stays untouched (plain `bg-card`).
- **Ambient depth**: a fixed, low-opacity, slow-animating background layer (a few blurred colored orbs — blue/violet/cyan, `blur-[90px]`, `opacity` oscillating ~0.12-0.22) mounted once at the authenticated-app-shell root, dark-mode only (`hidden dark:block`). Cheap, high-leverage, must never compete with real content for attention.
- **Sidebar/topbar**: glass treatment consistent with cards (`dark:bg-white/[0.02] dark:backdrop-blur-xl`), branded gradient-icon badge (primary-to-primary/60 gradient square with a glow shadow) reused identically on the login page and the sidebar header for brand consistency.
- **Navigation**: persistent left sidebar, one item per module (Dashboard, Applications, Scanner, Object Library, Test Cases, Test Data, Automation Builder, Script Generator, Executions, Reports, Knowledge Base, Integrations, Settings), active-item pill with a subtle glow ring, animated layout transition between items (e.g. Framer Motion `layoutId` shared-element pill).
- **Landing/marketing page** (pre-login, public): a distinct, more expressive 3D/animated hero (e.g. react-three-fiber orb + orbiting nodes) is acceptable here even though the authenticated app stays flatter/glass — but do not build fake product screenshots into the marketing page (no invented demo-app branding); keep any illustrative content generic/abstract.
- **Every blocked/error state renders the same way**: a toast (Sonner) showing the joined `reasons[]` from a Golden-Rule-Policy 409, never a raw stack trace or generic "Something went wrong."
- **Empty states** get one line of specific guidance ("No scanned objects yet. Run the Scanner against a live page first."), never a bare "No data."

## 10. Build Order

Build in this order — each stage should be a working, demoable increment before starting the next:

1. **Foundation**: Auth (JWT+refresh, seeded Admin), Applications CRUD, AI Provider module (all 3 providers + health check), empty AppShell with full nav.
2. **Scanner + Object Library**: real Playwright scan against a live test app, promote-to-library flow.
3. **Test Cases + Test Data**: manual CRUD, CSV/Excel import, AI generation (grounded in objects and/or Knowledge Base — build Knowledge Base's upload+chunk+embed pipeline alongside this since generation needs it).
4. **Automation Builder + Script Generator**: AI-drafted flows from test cases, deterministic Playwright compiler first, Selenium compiler second.
5. **Execution Engine + Reporting**: real subprocess execution, per-step evidence, deterministic failure analysis, coverage/trend reporting.
6. **AI failure re-classification + self-healing + Regression Intelligence**: layer the AI second-pass onto failure analysis, wire auto-heal approval, add the regression-recommendation endpoint.
7. **Bug Reports + real Integrations (Zephyr/Jira read+write)**: single-story Jira analysis, bug-report drafting, Jira issue creation.
8. **UI/UX pass**: apply the Card/AppShell glass treatment globally, verify every page in dark mode with a real browser check (screenshot + zero console errors), not just a type-check.

## 11. Known Pitfalls (avoid repeating these)

- **Corporate/restrictive networks can make `ollama pull` fail silently** (digest mismatch against an empty-file hash) due to TLS interception or aggressive bandwidth throttling on large binary downloads. If this happens: verify with `curl -I <blob-url>` whether the connection even completes: if you see a Windows Schannel `CRYPT_E_NO_REVOCATION_CHECK` error, that's a corporate TLS-inspecting proxy re-signing traffic with its own CA that your HTTP client doesn't trust the same way Windows does — do **not** disable certificate/revocation checking as a workaround (a genuine security-relevant decision, not something to route around unilaterally); a client that validates the full chain via the OS trust store without also demanding a live revocation check (many non-browser HTTP clients behave this way by default) can still succeed. If downloads are simply extremely slow (a few hundred KB/s) rather than failing outright, that's likely aggressive DPI content-scanning bandwidth-shaping — prefer a smaller model or a different network over fighting it.
- **Don't run two instances of the dev server on the same port.** A watch-mode process (`nest start --watch`) and a directly-invoked compiled instance (`node dist/main`) can both end up running simultaneously pointed at the same port, with only one actually winning the bind — the "losing" one silently burns CPU/RAM doing nothing. Always verify single-process port ownership after a restart.
- **Windows + `child_process.spawn` + `.cmd` binaries** (like `npx.cmd`): either use `shell: true`, or better, resolve and invoke the underlying JS entry file directly via `process.execPath` — avoids both the shell dependency and Node's `DEP0190` unsafe-argument-concatenation warning. If you do use `shell: true`, pass one pre-built command **string**, never a separate `args` array (that combination is what triggers the warning).
- **A Java Page-Object field initializer that constructs before the WebDriver exists is a real bug, not a style nit**: declare Page Object fields without initializers and construct them inside `@BeforeEach`, after the driver itself is created.
- **Selenium has no auto-wait** (unlike Playwright) — always set `driver.manage().timeouts().implicitlyWait(...)` or every test against a normal SPA will flake on the first slow render.

## 12. Definition of Done

A fresh user can, unassisted: create an Application → scan a real login page → see confidence-scored objects in the Object Library → generate test cases with AI from either the scanned objects or an uploaded requirements doc → auto-generate an automation flow and a Playwright script from a test case → execute it and see live per-step screenshots → (on a forced failure) see a classified root cause and file a reviewed bug report to a connected Jira project → ask for a regression recommendation on a related test case and get a ranked, risk-labeled list — entirely through the UI, with the local LLM doing the analysis/generation work throughout.
