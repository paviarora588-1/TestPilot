-- CreateTable
CREATE TABLE "test_cases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "externalId" TEXT,
    "title" TEXT NOT NULL,
    "moduleName" TEXT,
    "featureName" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "preconditions" TEXT,
    "expectedResult" TEXT,
    "requiredTestData" JSONB,
    "readinessScore" REAL,
    "qualityScore" REAL,
    "riskScore" REAL,
    "duplicateGroup" TEXT,
    "automationStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "analysisResultJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "test_cases_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "test_steps" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "testCaseId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "instruction" TEXT NOT NULL,
    "expectedResult" TEXT,
    "requiredDataKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "test_steps_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "test_cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "test_data_sets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "environment" TEXT,
    "description" TEXT,
    "isReusable" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "test_data_sets_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "test_data_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "testDataSetId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "importedFrom" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "test_data_items_testDataSetId_fkey" FOREIGN KEY ("testDataSetId") REFERENCES "test_data_sets" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "data_bindings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "testStepId" TEXT,
    "testCaseId" TEXT,
    "testDataItemId" TEXT,
    "bindingExpression" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "data_bindings_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "data_bindings_testStepId_fkey" FOREIGN KEY ("testStepId") REFERENCES "test_steps" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "data_bindings_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "test_cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "data_bindings_testDataItemId_fkey" FOREIGN KEY ("testDataItemId") REFERENCES "test_data_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "test_cases_applicationId_idx" ON "test_cases"("applicationId");

-- CreateIndex
CREATE INDEX "test_steps_testCaseId_idx" ON "test_steps"("testCaseId");

-- CreateIndex
CREATE INDEX "test_data_sets_applicationId_idx" ON "test_data_sets"("applicationId");

-- CreateIndex
CREATE INDEX "test_data_items_testDataSetId_idx" ON "test_data_items"("testDataSetId");

-- CreateIndex
CREATE INDEX "data_bindings_applicationId_idx" ON "data_bindings"("applicationId");

-- CreateIndex
CREATE INDEX "data_bindings_testStepId_idx" ON "data_bindings"("testStepId");
