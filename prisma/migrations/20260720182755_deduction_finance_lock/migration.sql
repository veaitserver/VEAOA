/*
  Warnings:

  - You are about to drop the `MonthLock` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropIndex
DROP INDEX "MonthLock_campusId_month_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "MonthLock";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CourseDeduction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packageId" TEXT NOT NULL,
    "logId" TEXT NOT NULL,
    "hoursDeducted" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" DATETIME,
    "reversedById" TEXT,
    "financeUnlockedAt" DATETIME,
    "financeUnlockedById" TEXT,
    CONSTRAINT "CourseDeduction_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "CoursePackage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CourseDeduction_logId_fkey" FOREIGN KEY ("logId") REFERENCES "LessonLog" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CourseDeduction_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CourseDeduction_financeUnlockedById_fkey" FOREIGN KEY ("financeUnlockedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CourseDeduction" ("createdAt", "hoursDeducted", "id", "logId", "packageId", "reversedAt", "reversedById") SELECT "createdAt", "hoursDeducted", "id", "logId", "packageId", "reversedAt", "reversedById" FROM "CourseDeduction";
DROP TABLE "CourseDeduction";
ALTER TABLE "new_CourseDeduction" RENAME TO "CourseDeduction";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
