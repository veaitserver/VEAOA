-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sourceCategory" TEXT NOT NULL,
    "sourceDetail" TEXT NOT NULL,
    "campusId" TEXT NOT NULL,
    "defaultOwnerId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "token" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Campaign_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Campaign_defaultOwnerId_fkey" FOREIGN KEY ("defaultOwnerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LeadImportLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "studentId" TEXT,
    "message" TEXT,
    "payload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Lead" (
    "studentId" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "sourceCategory" TEXT,
    "sourceDetail" TEXT,
    "subjectsOfInterest" TEXT,
    "campaignId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Lead_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Lead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Lead" ("source", "studentId") SELECT "source", "studentId" FROM "Lead";
DROP TABLE "Lead";
ALTER TABLE "new_Lead" RENAME TO "Lead";
CREATE INDEX "Lead_status_idx" ON "Lead"("status");
CREATE INDEX "Lead_campaignId_idx" ON "Lead"("campaignId");
CREATE TABLE "new_Student" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "gradeId" TEXT,
    "publicSchool" TEXT,
    "salesId" TEXT,
    "campusId" TEXT NOT NULL,
    "postalCode" TEXT,
    "preferredContactApp" TEXT,
    "contactAppId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Student_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Student_salesId_fkey" FOREIGN KEY ("salesId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Student_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Student" ("campusId", "createdAt", "gradeId", "id", "name", "phone", "publicSchool", "salesId") SELECT "campusId", "createdAt", "gradeId", "id", "name", "phone", "publicSchool", "salesId" FROM "Student";
DROP TABLE "Student";
ALTER TABLE "new_Student" RENAME TO "Student";
CREATE UNIQUE INDEX "Student_phone_key" ON "Student"("phone");
CREATE INDEX "Student_contactAppId_idx" ON "Student"("contactAppId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_token_key" ON "Campaign"("token");

-- CreateIndex
CREATE INDEX "LeadImportLog_createdAt_idx" ON "LeadImportLog"("createdAt");
