-- CreateTable
CREATE TABLE "GroupClass" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "campusId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "gradeId" TEXT,
    "teacherId" TEXT,
    "classroomId" TEXT,
    "capacity" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'RECRUITING',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GroupClass_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GroupClass_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GroupClass_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GroupClass_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GroupClass_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GroupClass_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GroupClassMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" DATETIME,
    CONSTRAINT "GroupClassMember_classId_fkey" FOREIGN KEY ("classId") REFERENCES "GroupClass" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GroupClassMember_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GroupClassMember_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "CoursePackage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GroupSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "startTime" DATETIME NOT NULL,
    "endTime" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "loggedById" TEXT,
    "loggedAt" DATETIME,
    "confirmedById" TEXT,
    "confirmedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GroupSession_classId_fkey" FOREIGN KEY ("classId") REFERENCES "GroupClass" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GroupSession_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GroupSession_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GroupSession_loggedById_fkey" FOREIGN KEY ("loggedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GroupSession_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GroupSessionAttendance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "attendance" TEXT NOT NULL DEFAULT 'PRESENT',
    "note" TEXT,
    CONSTRAINT "GroupSessionAttendance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GroupSession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GroupSessionAttendance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CourseDeduction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packageId" TEXT NOT NULL,
    "logId" TEXT,
    "groupSessionId" TEXT,
    "hoursDeducted" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" DATETIME,
    "reversedById" TEXT,
    "financeUnlockedAt" DATETIME,
    "financeUnlockedById" TEXT,
    CONSTRAINT "CourseDeduction_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "CoursePackage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CourseDeduction_logId_fkey" FOREIGN KEY ("logId") REFERENCES "LessonLog" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CourseDeduction_groupSessionId_fkey" FOREIGN KEY ("groupSessionId") REFERENCES "GroupSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CourseDeduction_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CourseDeduction_financeUnlockedById_fkey" FOREIGN KEY ("financeUnlockedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CourseDeduction" ("createdAt", "financeUnlockedAt", "financeUnlockedById", "hoursDeducted", "id", "logId", "packageId", "reversedAt", "reversedById") SELECT "createdAt", "financeUnlockedAt", "financeUnlockedById", "hoursDeducted", "id", "logId", "packageId", "reversedAt", "reversedById" FROM "CourseDeduction";
DROP TABLE "CourseDeduction";
ALTER TABLE "new_CourseDeduction" RENAME TO "CourseDeduction";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "GroupClass_campusId_status_idx" ON "GroupClass"("campusId", "status");

-- CreateIndex
CREATE INDEX "GroupClassMember_classId_idx" ON "GroupClassMember"("classId");

-- CreateIndex
CREATE INDEX "GroupClassMember_studentId_idx" ON "GroupClassMember"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupClassMember_classId_packageId_key" ON "GroupClassMember"("classId", "packageId");

-- CreateIndex
CREATE INDEX "GroupSession_classId_startTime_idx" ON "GroupSession"("classId", "startTime");

-- CreateIndex
CREATE INDEX "GroupSession_startTime_idx" ON "GroupSession"("startTime");

-- CreateIndex
CREATE INDEX "GroupSessionAttendance_sessionId_idx" ON "GroupSessionAttendance"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupSessionAttendance_sessionId_studentId_key" ON "GroupSessionAttendance"("sessionId", "studentId");

