-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ScheduledLesson" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teacherId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "startTime" DATETIME NOT NULL,
    "endTime" DATETIME NOT NULL,
    "lessonType" TEXT NOT NULL DEFAULT 'ONE_ON_ONE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attendance" TEXT,
    "attendanceNote" TEXT,
    "attendanceById" TEXT,
    "attendanceAt" DATETIME,
    CONSTRAINT "ScheduledLesson_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ScheduledLesson_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ScheduledLesson_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "CoursePackage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ScheduledLesson_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ScheduledLesson_attendanceById_fkey" FOREIGN KEY ("attendanceById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ScheduledLesson" ("classroomId", "createdAt", "endTime", "id", "lessonType", "packageId", "startTime", "studentId", "teacherId") SELECT "classroomId", "createdAt", "endTime", "id", "lessonType", "packageId", "startTime", "studentId", "teacherId" FROM "ScheduledLesson";
DROP TABLE "ScheduledLesson";
ALTER TABLE "new_ScheduledLesson" RENAME TO "ScheduledLesson";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

