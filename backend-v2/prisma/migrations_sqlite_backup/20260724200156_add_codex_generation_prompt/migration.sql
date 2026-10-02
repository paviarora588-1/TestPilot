-- CreateTable
CREATE TABLE "codex_generation_prompts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "testCaseGenerationJobId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "label" TEXT,
    "systemPrompt" TEXT NOT NULL,
    "userPrompt" TEXT NOT NULL,
    "rawResponse" TEXT,
    "succeeded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "codex_generation_prompts_testCaseGenerationJobId_fkey" FOREIGN KEY ("testCaseGenerationJobId") REFERENCES "test_case_generation_jobs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "codex_generation_prompts_testCaseGenerationJobId_idx" ON "codex_generation_prompts"("testCaseGenerationJobId");
