# TestPilot AI Interview Guide

This guide describes the checked implementation, including its limitations. Explain the active v2 system separately from the older application. Do not claim that every visible UI element is an independent autonomous agent or that current policy gates provide guarantees they do not enforce.

## 1. What is TestPilot?

TestPilot AI is a full-stack QA automation workspace. It connects product knowledge, an object repository, manual test cases, generated framework code, execution evidence and reporting. The current implementation is Next.js/React plus NestJS/Prisma/PostgreSQL.

## 2. What problem does it solve?

It addresses fragmented QA work: documentation, locators, test data, automation code and failure evidence often live in unrelated tools. Application-scoped records connect those steps so a tester can trace a flow from a manual case to generated code and execution results.

## 3. Why was it created?

Describe the engineering motivation supported by the design: make product understanding and reusable test assets part of automation, rather than asking an LLM to invent selectors from a test description. The repository does not establish the author's personal history or a measured business outcome; supply that from your own experience.

## 4. Complete technology stack

- Current UI: Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, Base UI, TanStack Query, Axios, React Flow and Motion. Some visual components also use React Three Fiber/Drei.
- Current API: NestJS 11, TypeScript, REST controllers, Socket.IO scanner gateway, class-validator DTOs and scheduled jobs.
- Persistence/auth: PostgreSQL, Prisma 7, PostgreSQL adapter, bcrypt passwords, JWT access tokens and persisted refresh-token hashes.
- AI: OpenAI SDK, existing Ollama/llama.cpp/Groq alternatives, and separate Codex CLI calls.
- Automation: Playwright TypeScript, Selenium Java/Maven, SAP GUI VBScript/PowerShell and hybrid driver segmentation.
- Verification: Jest/ts-jest backend tests, Vitest frontend tests and optional Playwright E2E journeys.
- Legacy: FastAPI, SQLAlchemy, Pydantic, Python, React/Vite, pytest and SQLite/PostgreSQL.

## 5. System architecture

The frontend calls the backend through its shared API layer. Nest modules separate application data, scanning, test cases, flow building, generation, execution, knowledge and reporting. Prisma persists structured records; local storage holds uploaded/generated files and evidence. Provider-based AI and Codex-based workflows are separate integrations. See `ARCHITECTURE.md` for the diagram.

## 6. Where AI is used

AI supports knowledge enrichment, manual-case analysis/generation, failure explanation, locator repair, script review and engineering-task interpretation. Availability is operation-specific; some existing workflows continue with AI enrichment/review marked unavailable. Deterministic compilers still generate much of the framework syntax.

## 7. Where LLMs are used

`AiProvider` implementations make model calls from backend services. The OpenAI example configuration selects the SDK-backed provider with configurable chat/embedding models. Other providers are already implemented. Codex CLI invokes its separately configured model for review, certain import/generation operations and source-repair tasks. Do not assert a specific Codex model: it is not fixed by repository configuration.

## 8. How agents work

AI Engineering orchestrates tasks: manager triage chooses scope, backend/frontend specialists work in isolated source copies, a reviewer supplies advice, and verification checks the result. Chat personas include manager, backend, frontend, database, reviewer and QA roles. They are workflow responsibilities and conversation identities, not independent deployed services. Clean non-schema changes can auto-apply; other cases await review.

Frontend isolated verification currently runs TypeScript but skips the frontend test phase despite a real main-project Vitest suite. Backend isolated verification runs Jest. This discrepancy is a useful improvement to discuss honestly.

## 9. Why the selected technologies were used

Frame these as engineering tradeoffs visible in the implementation, rather than undocumented author intent. TypeScript shares concepts across UI/API; Nest modules support dependency injection; Prisma offers typed data access; PostgreSQL accommodates relational data and larger parameterized operations than the previous SQLite setup. Next.js provides routing/build tooling. Playwright is suited to browser evidence, while Selenium and SAP scripting support other existing targets.

## 10. Alternatives

FastAPI is already demonstrated in the legacy implementation. Other choices could include a Vite SPA, a durable job queue with isolated workers, indexed vector retrieval, a hosted object store or provider-native structured outputs. These are alternatives, not components already deployed.

## 11. End-to-end request flow

A tester creates an application and supplies knowledge, then scans or records an authorized test app. Objects are stored and verified. Manual test cases are analyzed and mapped into a flow. The backend compiles the flow into framework files and initiates review. Execution, when explicitly selected, dispatches to a real runner and stores results/evidence. Reporting reads persisted results; failure analysis can propose object repairs.

## 12. Testing strategy

Backend Jest tests cover compilers, scanner safety, flow segmentation, execution/failure handling, recorder behavior, engineering logic and workspace path restrictions. Frontend Vitest currently covers a small set of shared utility/data helpers. Legacy pytest tests cover health, providers, agents and compiler behavior. Playwright E2E tests exercise real journeys but require isolated accounts/data and can call external services or execution workflows. Build/typecheck, lint and missing-key checks complement unit tests.

See `PUBLISH_VERIFICATION.md` for actual outcomes. Do not present unit-test stubs as production AI fallbacks or say a unit pass proves an external integration is working.

## 13. Challenges

Examples supported by code include SAPUI5 dynamic IDs/date pickers, tab/SPA navigation, sensitivity handling during recording, hybrid driver sequencing, process timeout/cancellation, orphaned jobs after restarts and preserving source boundaries in AI working copies. Explain these as engineering concerns addressed in code; only claim personal involvement you actually had.

## 14. Limitations

- V2 does not fully enforce every knowledge-first Golden Rule prerequisite.
- Missing AI review does not always block execution.
- The default factory selects Ollama, although the publication template selects OpenAI.
- V2 does not enforce the legacy safe-runner flag and can invoke real subprocesses.
- Evidence routes need authenticated access controls before exposure.
- In-process jobs/shared runner directories limit multi-instance deployment.
- JSON parsing is not complete runtime schema validation.
- Current frontend verification/test coverage and lint hygiene need improvement.
- Current PostgreSQL deployment migrations are incomplete; historical SQLite migrations are not a replacement.
- Existing Prisma Dev startup reconciliation can emit a bind-parameter warning.

## 15. Future improvements

Prioritize strict AI/policy gates, authenticated evidence storage, sandboxed per-run workers, durable queueing, upload/path checks, consistent frontend verification, schema migrations, embedding versioning/indexed retrieval, structured output validation, CI and sanitized demo fixtures.

## 16. Two-minute project explanation

“TestPilot AI is a QA automation workspace that connects product knowledge and reusable test assets to generated automation and execution evidence. The active version uses Next.js and React for the UI, NestJS for the API and Prisma with PostgreSQL for persistence.

“A tester can configure an application, ingest documentation, scan or record its UI, verify reusable objects and map manual test steps into an automation flow. Deterministic compilers produce Playwright, Selenium or SAP GUI code. AI adds analysis, knowledge enrichment, review and failure explanation, while execution writes results and evidence back into the system.

“There is also a separate Codex-driven engineering workflow for TestPilot's own bugs. It triages work, creates isolated source copies, obtains specialist changes and records review and verification before applying eligible patches.

“The important tradeoff is that this is a working local application rather than a fully hardened deployment. Current gaps include runner isolation, strict prerequisite enforcement, authenticated evidence serving and broader frontend verification. I distinguish implemented behavior from those planned improvements.”

## 17. Five-minute project explanation

Start with the fragmented QA workflow problem and the application-scoped data model. Explain that requirements, locators and test data must be grounded in real product assets before generated code is trustworthy.

Walk through the UI/API/persistence boundary. Point to the shared Axios API layer, Nest modules, Prisma schema and local evidence storage. Explain authentication and the separation between relational metadata and files.

Describe one recorded login/search flow using a synthetic app. Explain object verification, mapping, deterministic compilation and framework selection. Show how hybrid flows split by driver and why external execution needs separate prerequisites. Explain the stored result/evidence lifecycle.

Discuss the two AI paths. Provider injection covers knowledge/text/embedding operations; RAG ranks stored application chunks. Codex separately supports review/import and engineering tasks. Explain response parsing and the difference between an unavailable enrichment result and a successful AI result.

Explain AI Engineering without overselling autonomy. Manager triage selects scope; specialists edit isolated copies; review and verification produce evidence. Some verified non-schema work can auto-apply. Database changes and broader approvals need care. Acknowledge the frontend verification mismatch.

Finish with actual validation outcomes and deployment tradeoffs. Discuss existing lint debt, incomplete policy enforcement, unauthenticated evidence paths and shared runners. Explain how you would prioritize hardening, durable jobs, migration management and broader tests. Do not claim cost savings, production adoption or measured accuracy unless you have independent evidence.

## 18. Likely interviewer questions

| Question | Concise answer |
| --- | --- |
| Is the frontend connected to a real API? | Yes. V2 uses a shared Axios API client and persisted backend resources; root HTML assets are historical design material. |
| Does AI generate all automation code? | No. Deterministic framework compilers emit much of the code; AI assists interpretation, review and selected generation workflows. |
| How are selectors grounded? | Scanning/recording populates the Object Library, and flows reference stored objects. Verification/confidence helps review locator quality. |
| Is there a vector database? | No separate vector service. Embeddings are stored in PostgreSQL and ranked in memory. |
| Are there six autonomous agents? | There are six engineering roles/personas; service orchestration invokes specialist/review CLI calls, rather than six permanent agent servers. |
| Does every fix require a human? | No. Eligible clean, verified, non-schema fixes can auto-apply; other work waits for review. |
| What happens when AI is unavailable? | The OpenAI provider rejects a missing key; other operation paths may record unavailable enrichment/review. Full policy consistency is unfinished. |
| How are secrets handled? | Local environment files are ignored; JWT/encryption secrets are required; integration credentials are encrypted and seed passwords are no longer logged. |
| Can it safely run arbitrary uploaded code? | It does not provide a hardened sandbox. Execution should remain limited to trusted local users and authorized targets. |
| Is `ENABLE_LOCAL_RUNNER=false` enforced? | In legacy, yes; v2 currently does not enforce that flag. |
| Is it deployment-ready? | It needs evidence access controls, runner isolation, durable jobs, strict policy gates and PostgreSQL migration management before broader deployment. |
| How would you scale it? | Separate API and workers, isolate each run, use durable queueing/shared evidence storage and indexed retrieval; these are proposed improvements. |
| What was validated for publication? | Builds, unit tests, lint checks, dependency inventory/audit and missing-key/health behavior; live enterprise execution was deliberately excluded. |
| What would you demonstrate? | A synthetic authorized test app, verified objects, a generated flow and sanitized evidence; never company captures or credentials. |
