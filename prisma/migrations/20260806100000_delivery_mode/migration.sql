-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GroupClass" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "campusId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "gradeId" TEXT,
    "teacherId" TEXT,
    "classroomId" TEXT,
    "deliveryMode" TEXT NOT NULL DEFAULT 'ONSITE',
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
INSERT INTO "new_GroupClass" ("campusId", "capacity", "classroomId", "createdAt", "createdById", "gradeId", "id", "name", "notes", "status", "subjectId", "teacherId") SELECT "campusId", "capacity", "classroomId", "createdAt", "createdById", "gradeId", "id", "name", "notes", "status", "subjectId", "teacherId" FROM "GroupClass";
DROP TABLE "GroupClass";
ALTER TABLE "new_GroupClass" RENAME TO "GroupClass";
CREATE INDEX "GroupClass_campusId_status_idx" ON "GroupClass"("campusId", "status");
CREATE TABLE "new_GroupSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "classroomId" TEXT,
    "startTime" DATETIME NOT NULL,
    "endTime" DATETIME NOT NULL,
    "deliveryMode" TEXT NOT NULL DEFAULT 'ONSITE',
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "loggedById" TEXT,
    "loggedAt" DATETIME,
    "confirmedById" TEXT,
    "confirmedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GroupSession_classId_fkey" FOREIGN KEY ("classId") REFERENCES "GroupClass" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GroupSession_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GroupSession_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GroupSession_loggedById_fkey" FOREIGN KEY ("loggedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GroupSession_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_GroupSession" ("classId", "classroomId", "confirmedAt", "confirmedById", "createdAt", "endTime", "id", "loggedAt", "loggedById", "notes", "startTime", "status", "teacherId") SELECT "classId", "classroomId", "confirmedAt", "confirmedById", "createdAt", "endTime", "id", "loggedAt", "loggedById", "notes", "startTime", "status", "teacherId" FROM "GroupSession";
DROP TABLE "GroupSession";
ALTER TABLE "new_GroupSession" RENAME TO "GroupSession";
CREATE INDEX "GroupSession_classId_startTime_idx" ON "GroupSession"("classId", "startTime");
CREATE INDEX "GroupSession_startTime_idx" ON "GroupSession"("startTime");
CREATE TABLE "new_ScheduledLesson" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teacherId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "classroomId" TEXT,
    "startTime" DATETIME NOT NULL,
    "endTime" DATETIME NOT NULL,
    "lessonType" TEXT NOT NULL DEFAULT 'ONE_ON_ONE',
    "deliveryMode" TEXT NOT NULL DEFAULT 'ONSITE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attendance" TEXT,
    "attendanceNote" TEXT,
    "attendanceById" TEXT,
    "attendanceAt" DATETIME,
    CONSTRAINT "ScheduledLesson_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ScheduledLesson_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ScheduledLesson_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "CoursePackage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ScheduledLesson_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ScheduledLesson_attendanceById_fkey" FOREIGN KEY ("attendanceById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ScheduledLesson" ("attendance", "attendanceAt", "attendanceById", "attendanceNote", "classroomId", "createdAt", "endTime", "id", "lessonType", "packageId", "startTime", "studentId", "teacherId") SELECT "attendance", "attendanceAt", "attendanceById", "attendanceNote", "classroomId", "createdAt", "endTime", "id", "lessonType", "packageId", "startTime", "studentId", "teacherId" FROM "ScheduledLesson";
DROP TABLE "ScheduledLesson";
ALTER TABLE "new_ScheduledLesson" RENAME TO "ScheduledLesson";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

