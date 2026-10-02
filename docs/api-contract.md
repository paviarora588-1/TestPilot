> Legacy application documentation. For the current v2 application, see README.md and docs/ARCHITECTURE.md.

# API Contract

All API routes are under `/api`. The MVP stores data through SQLAlchemy and auto-creates tables on startup.

## Health

- `GET /api/health`

## Products

- `GET /api/products`
- `POST /api/products`
- `GET /api/products/{id}`
- `PUT /api/products/{id}`
- `DELETE /api/products/{id}`

## Modules and Features

- `GET /api/products/{product_id}/modules`
- `POST /api/products/{product_id}/modules`
- `GET /api/modules/{module_id}/features`
- `POST /api/modules/{module_id}/features`

## Knowledge

- `GET /api/products/{product_id}/knowledge-sources`
- `POST /api/products/{product_id}/knowledge-sources`
- `POST /api/products/{product_id}/knowledge-sources/upload`
- `POST /api/knowledge/{source_id}/process`
- `GET /api/products/{product_id}/knowledge-summary`
- `GET /api/products/{product_id}/knowledge-chunks`

## Product Library

- `GET /api/products/{product_id}/objects`
- `POST /api/products/{product_id}/objects`
- `GET /api/objects/{object_id}`
- `PUT /api/objects/{object_id}`
- `DELETE /api/objects/{object_id}`
- `POST /api/objects/{object_id}/verify`

## Test Cases

- `GET /api/products/{product_id}/test-cases`
- `POST /api/products/{product_id}/test-cases`
- `POST /api/products/{product_id}/test-cases/import`
- `GET /api/test-cases/{id}`
- `PUT /api/test-cases/{id}`
- `DELETE /api/test-cases/{id}`

## AI Analysis and Mapping

- `POST /api/test-cases/{id}/analyze`
- `POST /api/test-cases/{id}/map-steps`
- `GET /api/test-cases/{id}/mappings`
- `POST /api/mappings/{id}/approve`
- `POST /api/mappings/{id}/reject`
- `POST /api/mappings/{id}/regenerate`

These routes call OpenAI through TestPilot Agent. If `OPENAI_API_KEY` is missing, they return a clear configuration error.

## Quality

- `GET /api/products/{product_id}/quality/test-cases`
- `GET /api/test-cases/{id}/quality`

## Script Generation

- `POST /api/test-cases/{id}/generate-script`
- `GET /api/scripts/{id}`
- `GET /api/test-cases/{id}/scripts`
- `GET /api/scripts/{id}/download`
- `POST /api/scripts/{id}/review`

Script generation enforces the golden rule and writes files to `backend/app/generated_scripts/`.
It calls OpenAI for code generation and AI review. If readiness is missing, it returns `blocked=true`, `reasons`, and `next_actions`.

## Execution

- `POST /api/scripts/{id}/execute`
- `GET /api/executions/{id}`
- `GET /api/products/{product_id}/executions`

Execution is safe by default. With `ENABLE_LOCAL_RUNNER=false`, the API creates a `READY_TO_RUN` record and command.

## Auto Heal

- `POST /api/executions/{id}/analyze-failure`
- `POST /api/products/{product_id}/auto-heal/suggest`
- `GET /api/products/{product_id}/auto-heal`
- `POST /api/auto-heal/{id}/approve`
- `POST /api/auto-heal/{id}/reject`

Approving an auto-heal suggestion updates the object repository technical path and writes history.

## Integrations

- `GET /api/integrations`
- `POST /api/integrations/zephyr/config`
- `POST /api/integrations/zephyr/import`
- `POST /api/integrations/zephyr/export-results`
- `POST /api/integrations/jira/create-defect`

## Reports and History

- `GET /api/products/{product_id}/coverage/gaps`
- `GET /api/products/{product_id}/regression/impact`
- `GET /api/products/{product_id}/approvals`
- `GET /api/products/{product_id}/reports/summary`
- `GET /api/products/{product_id}/reports/coverage`
- `GET /api/reports/global-summary`
- `GET /api/products/{product_id}/history`
- `POST /api/history`

## Settings

- `GET /api/settings`
- `PUT /api/settings`
