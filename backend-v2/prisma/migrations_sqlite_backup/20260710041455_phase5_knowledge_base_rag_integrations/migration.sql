-- CreateTable
CREATE TABLE "knowledge_sources" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "knowledge_sources_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "knowledgeSourceId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" JSONB,
    "embeddingAvailable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_chunks_knowledgeSourceId_fkey" FOREIGN KEY ("knowledgeSourceId") REFERENCES "knowledge_sources" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "knowledge_summaries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "knowledgeSourceId" TEXT NOT NULL,
    "modules" JSONB,
    "validations" JSONB,
    "gaps" JSONB,
    "aiEnrichmentAvailable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "knowledge_summaries_knowledgeSourceId_fkey" FOREIGN KEY ("knowledgeSourceId") REFERENCES "knowledge_sources" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "integration_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "projectKey" TEXT,
    "credentialsEncrypted" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "integration_configs_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "integration_sync_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "integrationConfigId" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'IMPORT',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "itemsProcessed" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "integration_sync_logs_integrationConfigId_fkey" FOREIGN KEY ("integrationConfigId") REFERENCES "integration_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "knowledge_sources_applicationId_idx" ON "knowledge_sources"("applicationId");

-- CreateIndex
CREATE INDEX "knowledge_chunks_applicationId_idx" ON "knowledge_chunks"("applicationId");

-- CreateIndex
CREATE INDEX "knowledge_chunks_knowledgeSourceId_idx" ON "knowledge_chunks"("knowledgeSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_summaries_knowledgeSourceId_key" ON "knowledge_summaries"("knowledgeSourceId");

-- CreateIndex
CREATE INDEX "integration_configs_applicationId_idx" ON "integration_configs"("applicationId");

-- CreateIndex
CREATE INDEX "integration_sync_logs_integrationConfigId_idx" ON "integration_sync_logs"("integrationConfigId");
