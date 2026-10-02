-- CreateTable
CREATE TABLE "execution_suite_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'SINGLE',
    "status" TEXT NOT NULL DEFAULT 'READY_TO_RUN',
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "passCount" INTEGER NOT NULL DEFAULT 0,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "skipCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "triggeredById" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "execution_suite_runs_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "execution_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "scriptId" TEXT NOT NULL,
    "suiteRunId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'READY_TO_RUN',
    "durationSeconds" REAL NOT NULL DEFAULT 0,
    "logs" JSONB,
    "evidencePath" TEXT,
    "command" TEXT,
    "browser" TEXT,
    "environment" TEXT,
    "executedById" TEXT,
    "failureAnalysisJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "execution_runs_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "execution_runs_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "generated_scripts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "execution_runs_suiteRunId_fkey" FOREIGN KEY ("suiteRunId") REFERENCES "execution_suite_runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "execution_step_results" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "instruction" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "durationSeconds" REAL NOT NULL DEFAULT 0,
    "message" TEXT,
    "screenshotPath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "execution_step_results_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "execution_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "auto_heal_suggestions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "executionId" TEXT,
    "objectId" TEXT,
    "candidateObjectId" TEXT,
    "oldPath" TEXT,
    "suggestedPath" TEXT,
    "reason" TEXT,
    "confidence" REAL,
    "riskScore" REAL,
    "aiRawResponse" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedAt" DATETIME,
    "decidedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "auto_heal_suggestions_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "auto_heal_suggestions_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "execution_runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "auto_heal_suggestions_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "object_repository" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "execution_suite_runs_applicationId_idx" ON "execution_suite_runs"("applicationId");

-- CreateIndex
CREATE INDEX "execution_runs_applicationId_idx" ON "execution_runs"("applicationId");

-- CreateIndex
CREATE INDEX "execution_runs_scriptId_idx" ON "execution_runs"("scriptId");

-- CreateIndex
CREATE INDEX "execution_runs_suiteRunId_idx" ON "execution_runs"("suiteRunId");

-- CreateIndex
CREATE INDEX "execution_step_results_executionId_idx" ON "execution_step_results"("executionId");

-- CreateIndex
CREATE INDEX "auto_heal_suggestions_applicationId_idx" ON "auto_heal_suggestions"("applicationId");

-- CreateIndex
CREATE INDEX "auto_heal_suggestions_executionId_idx" ON "auto_heal_suggestions"("executionId");
