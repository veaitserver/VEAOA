-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CoursePackage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "gradeId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "totalHours" REAL NOT NULL,
    "pricePerHour" REAL NOT NULL,
    "totalAmount" REAL NOT NULL,
    "remainingHours" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "createdById" TEXT NOT NULL,
    "confirmedById" TEXT,
    "confirmedAt" DATETIME,
    "financeConfirmedById" TEXT,
    "financeConfirmedAt" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CoursePackage_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CoursePackage_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CoursePackage_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CoursePackage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CoursePackage_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CoursePackage_financeConfirmedById_fkey" FOREIGN KEY ("financeConfirmedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CoursePackage" ("confirmedAt", "confirmedById", "createdAt", "createdById", "gradeId", "id", "notes", "pricePerHour", "remainingHours", "status", "studentId", "subjectId", "totalAmount", "totalHours") SELECT "confirmedAt", "confirmedById", "createdAt", "createdById", "gradeId", "id", "notes", "pricePerHour", "remainingHours", "status", "studentId", "subjectId", "totalAmount", "totalHours" FROM "CoursePackage";
DROP TABLE "CoursePackage";
ALTER TABLE "new_CoursePackage" RENAME TO "CoursePackage";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
