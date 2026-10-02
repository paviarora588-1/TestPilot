-- CreateTable
CREATE TABLE "automation_flows" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "testCaseId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "framework" TEXT NOT NULL DEFAULT 'PLAYWRIGHT',
    "graphJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "automation_flows_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "automation_flow_steps" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "automationFlowId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "stepType" TEXT NOT NULL,
    "objectId" TEXT,
    "testDataItemId" TEXT,
    "inlineValue" TEXT,
    "config" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "automation_flow_steps_automationFlowId_fkey" FOREIGN KEY ("automationFlowId") REFERENCES "automation_flows" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "automation_flow_steps_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "object_repository" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "automation_flow_steps_testDataItemId_fkey" FOREIGN KEY ("testDataItemId") REFERENCES "test_data_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "generated_scripts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "automationFlowId" TEXT,
    "testCaseId" TEXT,
    "framework" TEXT NOT NULL DEFAULT 'PLAYWRIGHT',
    "command" TEXT,
    "reviewJson" JSONB,
    "riskScore" REAL,
    "status" TEXT NOT NULL DEFAULT 'GENERATED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "generated_scripts_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "generated_scripts_automationFlowId_fkey" FOREIGN KEY ("automationFlowId") REFERENCES "automation_flows" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "generated_script_files" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "generatedScriptId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "generated_script_files_generatedScriptId_fkey" FOREIGN KEY ("generatedScriptId") REFERENCES "generated_scripts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "automation_flows_applicationId_idx" ON "automation_flows"("applicationId");

-- CreateIndex
CREATE INDEX "automation_flow_steps_automationFlowId_idx" ON "automation_flow_steps"("automationFlowId");

-- CreateIndex
CREATE INDEX "generated_scripts_applicationId_idx" ON "generated_scripts"("applicationId");

-- CreateIndex
CREATE INDEX "generated_scripts_automationFlowId_idx" ON "generated_scripts"("automationFlowId");

-- CreateIndex
CREATE INDEX "generated_script_files_generatedScriptId_idx" ON "generated_script_files"("generatedScriptId");
