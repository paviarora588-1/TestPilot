-- CreateTable
CREATE TABLE "jira_story_imports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "integrationConfigId" TEXT NOT NULL,
    "issueKey" TEXT NOT NULL,
    "storyUrl" TEXT NOT NULL,
    "rawContent" TEXT NOT NULL,
    "storyAnalysisJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'FETCHED',
    "errorMessage" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "jira_story_imports_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "jira_story_imports_integrationConfigId_fkey" FOREIGN KEY ("integrationConfigId") REFERENCES "integration_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "jira_story_prompts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jiraStoryImportId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "label" TEXT,
    "systemPrompt" TEXT NOT NULL,
    "userPrompt" TEXT NOT NULL,
    "rawResponse" TEXT,
    "succeeded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "jira_story_prompts_jiraStoryImportId_fkey" FOREIGN KEY ("jiraStoryImportId") REFERENCES "jira_story_imports" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "jira_story_imports_applicationId_idx" ON "jira_story_imports"("applicationId");

-- CreateIndex
CREATE INDEX "jira_story_prompts_jiraStoryImportId_idx" ON "jira_story_prompts"("jiraStoryImportId");
