-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Student" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "gradeId" TEXT,
    "publicSchool" TEXT,
    "salesId" TEXT,
    "studentManagerId" TEXT,
    "campusId" TEXT NOT NULL,
    "postalCode" TEXT,
    "preferredContactApp" TEXT,
    "contactAppId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Student_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Student_salesId_fkey" FOREIGN KEY ("salesId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Student_studentManagerId_fkey" FOREIGN KEY ("studentManagerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Student_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Student" ("campusId", "contactAppId", "createdAt", "gradeId", "id", "name", "phone", "postalCode", "preferredContactApp", "publicSchool", "salesId") SELECT "campusId", "contactAppId", "createdAt", "gradeId", "id", "name", "phone", "postalCode", "preferredContactApp", "publicSchool", "salesId" FROM "Student";
DROP TABLE "Student";
ALTER TABLE "new_Student" RENAME TO "Student";
CREATE UNIQUE INDEX "Student_phone_key" ON "Student"("phone");
CREATE INDEX "Student_contactAppId_idx" ON "Student"("contactAppId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
