/*
  Warnings:

  - You are about to drop the column `candidateObjectId` on the `auto_heal_suggestions` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_auto_heal_suggestions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "executionId" TEXT,
    "objectId" TEXT,
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
INSERT INTO "new_auto_heal_suggestions" ("aiRawResponse", "applicationId", "confidence", "createdAt", "decidedAt", "decidedById", "executionId", "id", "objectId", "oldPath", "reason", "riskScore", "status", "suggestedPath", "updatedAt") SELECT "aiRawResponse", "applicationId", "confidence", "createdAt", "decidedAt", "decidedById", "executionId", "id", "objectId", "oldPath", "reason", "riskScore", "status", "suggestedPath", "updatedAt" FROM "auto_heal_suggestions";
DROP TABLE "auto_heal_suggestions";
ALTER TABLE "new_auto_heal_suggestions" RENAME TO "auto_heal_suggestions";
CREATE INDEX "auto_heal_suggestions_applicationId_idx" ON "auto_heal_suggestions"("applicationId");
CREATE INDEX "auto_heal_suggestions_executionId_idx" ON "auto_heal_suggestions"("executionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
