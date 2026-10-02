-- CreateTable
CREATE TABLE "scan_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "triggeredById" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "pagesScanned" INTEGER NOT NULL DEFAULT 0,
    "objectsFound" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "scan_sessions_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "scan_pages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scanSessionId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "screenshotPath" TEXT,
    "htmlSnapshotPath" TEXT,
    "domHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "scan_pages_scanSessionId_fkey" FOREIGN KEY ("scanSessionId") REFERENCES "scan_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "scan_objects" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scanPageId" TEXT NOT NULL,
    "label" TEXT,
    "objectType" TEXT NOT NULL,
    "xpath" TEXT NOT NULL,
    "cssSelector" TEXT,
    "idAttr" TEXT,
    "nameAttr" TEXT,
    "placeholder" TEXT,
    "buttonText" TEXT,
    "ariaLabel" TEXT,
    "nearbyLabelText" TEXT,
    "recommendedLocator" TEXT NOT NULL,
    "recommendedLocatorType" TEXT NOT NULL,
    "backupLocators" JSONB,
    "confidenceScore" REAL NOT NULL,
    "lastScannedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastWorkingStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "promoted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "scan_objects_scanPageId_fkey" FOREIGN KEY ("scanPageId") REFERENCES "scan_pages" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "object_repository" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "moduleName" TEXT,
    "featureName" TEXT,
    "screenName" TEXT,
    "objectName" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'WEB',
    "objectType" TEXT NOT NULL,
    "technicalPath" TEXT NOT NULL,
    "locatorStrategy" TEXT NOT NULL,
    "backupLocators" JSONB,
    "supportedActions" JSONB,
    "scope" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "confidenceScore" REAL,
    "aliases" JSONB,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "screenshotPath" TEXT,
    "sourceScanObjectId" TEXT,
    "lastValidatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "object_repository_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "object_repository_sourceScanObjectId_fkey" FOREIGN KEY ("sourceScanObjectId") REFERENCES "scan_objects" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "scan_sessions_applicationId_idx" ON "scan_sessions"("applicationId");

-- CreateIndex
CREATE INDEX "scan_pages_scanSessionId_idx" ON "scan_pages"("scanSessionId");

-- CreateIndex
CREATE INDEX "scan_objects_scanPageId_idx" ON "scan_objects"("scanPageId");

-- CreateIndex
CREATE UNIQUE INDEX "object_repository_sourceScanObjectId_key" ON "object_repository"("sourceScanObjectId");

-- CreateIndex
CREATE INDEX "object_repository_applicationId_idx" ON "object_repository"("applicationId");
