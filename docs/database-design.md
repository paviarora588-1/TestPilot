> Legacy application documentation. For the current v2 application, see README.md and docs/ARCHITECTURE.md.

# Database Design

SQLAlchemy models live in `backend/app/models/models.py`.

Core entities:

1. Product
2. Module
3. Feature
4. Screen
5. ObjectRepository
6. KnowledgeSource
7. KnowledgeChunk
8. KnowledgeSummary
9. TestCase
10. TestStep
11. StepMapping
12. GeneratedScript
13. ExecutionRun
14. ExecutionStepResult
15. AutoHealSuggestion
16. IntegrationConfig
17. HistoryEvent
18. UserSetting

## Persistence Notes

- Local default database: `backend/testpilot.db`.
- Uploaded files are referenced by `KnowledgeSource.file_path`.
- Extracted chunks are stored in `KnowledgeChunk`.
- OpenAI extraction results are stored in `KnowledgeSummary`, including `ai_raw_response`.
- Generated OpenAI code is stored in `GeneratedScript.code` and also written to `GeneratedScript.file_path`.
- Script review output is stored in `GeneratedScript.review_json`.
- Failure analysis output is stored in `ExecutionRun.failure_analysis_json`.
- Auto-heal AI reasoning is stored in `AutoHealSuggestion.ai_raw_response`.
- Auto-heal approval updates `ObjectRepository.technical_path` and appends to `path_history`.
- `HistoryEvent` records actor, action, entity, status, details, before, after, and timestamp.

## Future Migration Work

The MVP uses `Base.metadata.create_all()` for fast local iteration. Production should add Alembic migrations, stricter indexes, user/tenant ownership, and evidence storage tables.
