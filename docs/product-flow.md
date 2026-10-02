> Legacy application documentation. For the current v2 application, see README.md and docs/ARCHITECTURE.md.

# Product Flow

Product Setup -> Knowledge Base -> Product Library -> Test Case Import -> AI Mapping -> Script Generation -> Execution -> Auto Heal if Failed -> Reports -> Zephyr/Jira Update.

Golden rule:

No automation without knowledge, library, mapping confidence, and approvals.

TestPilot Agent must always use product knowledge, product library, and test case context before generating scripts.

The MVP enforces this in `POST /api/test-cases/{id}/generate-script`. If knowledge has not been processed, objects do not exist, mappings are missing, or low-confidence mappings are not approved, the API returns a blocking error instead of producing a script.

AI steps require a valid `OPENAI_API_KEY`. Missing-key responses are explicit; the system does not fabricate AI output.
