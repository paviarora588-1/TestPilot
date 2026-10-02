-- CreateTable
CREATE TABLE "bug_reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "executionId" TEXT,
    "title" TEXT NOT NULL,
    "stepsToReproduce" JSONB NOT NULL,
    "actualResult" TEXT NOT NULL,
    "expectedResult" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "environment" TEXT,
    "evidencePaths" JSONB,
    "logsSnapshot" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "externalIssueKey" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "bug_reports_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "bug_reports_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "execution_runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "bug_reports_applicationId_idx" ON "bug_reports"("applicationId");

-- CreateIndex
CREATE INDEX "bug_reports_executionId_idx" ON "bug_reports"("executionId");
