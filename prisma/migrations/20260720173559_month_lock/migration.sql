-- CreateTable
CREATE TABLE "MonthLock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campusId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "lockedById" TEXT NOT NULL,
    "lockedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MonthLock_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MonthLock_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "MonthLock_campusId_month_key" ON "MonthLock"("campusId", "month");
