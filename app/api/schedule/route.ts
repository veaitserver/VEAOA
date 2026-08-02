import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { campusScope, canSchedule, type SessionUser } from "@/lib/permissions";
import { lessonHours } from "@/lib/hours";
import { validateTargets, assertInventory, assertNoConflict, ScheduleError } from "@/lib/scheduling";
import { z } from "zod";

const createSchema = z.object({
  teacherId: z.string().min(1),
  studentId: z.string().min(1),
  packageId: z.string().min(1),
  classroomId: z.string().min(1),
  startTime: z.string(),
  endTime: z.string(),
  lessonType: z.enum(["ONE_ON_ONE", "GROUP"]).default("ONE_ON_ONE"),
}).refine(
  (d) => {
    const s = new Date(d.startTime).getTime();
    const e = new Date(d.endTime).getTime();
    // 必须是合法时间且结束晚于开始：否则负/零时长课会绕过库存校验，
    // 核销时 decrement 负数反而给课包「加课时」。
    return Number.isFinite(s) && Number.isFinite(e) && e > s;
  },
  { message: "结束时间必须晚于开始时间", path: ["endTime"] },
);

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  const teacherId = searchParams.get("teacherId");
  const classroomId = searchParams.get("classroomId");

  const sessionUser = session.user as SessionUser;

  const where: Record<string, unknown> = {};
  if (start) where.startTime = { gte: new Date(start) };
  if (end) where.endTime = { lte: new Date(end) };
  if (teacherId) where.teacherId = teacherId;
  if (classroomId) where.classroomId = classroomId;
  const scope = campusScope(sessionUser);
  if (scope) where.student = { campusId: scope };

  const lessons = await prisma.scheduledLesson.findMany({
    where,
    include: {
      teacher: { select: { id: true, name: true } },
      student: { select: { id: true, name: true } },
      classroom: { select: { id: true, name: true } },
      package: { include: { subject: true } },
      log: { select: { id: true, confirmedAt: true } },
    },
    orderBy: { startTime: "asc" },
  });

  // Format for FullCalendar
  const events = lessons.map(l => ({
    id: l.id,
    title: `${l.student.name} - ${l.package.subject.name} (${l.teacher.name})`,
    start: l.startTime,
    end: l.endTime,
    extendedProps: {
      teacherId: l.teacherId,
      teacherName: l.teacher.name,
      studentId: l.studentId,
      studentName: l.student.name,
      classroomId: l.classroomId,
      classroomName: l.classroom.name,
      packageId: l.packageId,
      subjectName: l.package.subject.name,
      lessonType: l.lessonType,
      hasLog: !!l.log,
      isConfirmed: !!l.log?.confirmedAt,
      attendance: l.attendance,
      attendanceNote: l.attendanceNote,
    },
    backgroundColor: l.log?.confirmedAt ? "#16a34a" : l.log ? "#d97706" : "#3b82f6",
    borderColor: "transparent",
  }));

  // 班课课次也要出现在同一张课表上 —— 老师的时间是被两类课共同占用的，
  // 只显示一对一会让课表看起来有空档，实际排不进去。
  const sessionWhere: Record<string, unknown> = {};
  if (start) sessionWhere.startTime = { gte: new Date(start) };
  if (end) sessionWhere.endTime = { lte: new Date(end) };
  if (teacherId) sessionWhere.teacherId = teacherId;
  if (classroomId) sessionWhere.classroomId = classroomId;
  if (scope) sessionWhere.class = { campusId: scope };

  const sessions = await prisma.groupSession.findMany({
    where: sessionWhere,
    include: {
      teacher: { select: { id: true, name: true } },
      classroom: { select: { id: true, name: true } },
      class: { include: { subject: { select: { name: true } } } },
      attendances: { select: { id: true } },
    },
    orderBy: { startTime: "asc" },
  });

  const sessionEvents = sessions.map((s) => ({
    id: s.id,
    title: `${s.class.name} - ${s.class.subject.name} (${s.teacher.name})`,
    start: s.startTime,
    end: s.endTime,
    extendedProps: {
      teacherId: s.teacherId,
      teacherName: s.teacher.name,
      // 班课没有单一学生，用班级名占位，前端据 isGroup 区分展示。
      studentId: "",
      studentName: s.class.name,
      classroomId: s.classroomId,
      classroomName: s.classroom.name,
      packageId: "",
      subjectName: s.class.subject.name,
      lessonType: "GROUP",
      isGroup: true,
      classId: s.classId,
      className: s.class.name,
      memberCount: s.attendances.length,
      hasLog: s.status !== "SCHEDULED",
      isConfirmed: s.status === "CONFIRMED",
      attendance: null,
      attendanceNote: null,
    },
    backgroundColor: s.status === "CONFIRMED" ? "#16a34a" : s.status === "LOGGED" ? "#d97706" : "#7c3aed",
    borderColor: "transparent",
  }));

  return NextResponse.json([...events, ...sessionEvents]);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canSchedule(sessionUser)) {
    return NextResponse.json({ error: "无权排课" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const { teacherId, studentId, packageId, classroomId, startTime, endTime, lessonType } = parsed.data;

  try {
    // 校区/老师资格校验（与改期共用，见 lib/scheduling）。
    await validateTargets(sessionUser, { studentId, classroomId, teacherId });

    const pkg = await prisma.coursePackage.findUnique({ where: { id: packageId } });
    if (!pkg || pkg.status !== "ACTIVE") {
      return NextResponse.json({ error: "课包未激活，无法排课" }, { status: 400 });
    }
    if (pkg.studentId !== studentId) {
      return NextResponse.json({ error: "课包不属于该学生" }, { status: 400 });
    }
    // 班课课包只能通过班级排课，不能走单人排课，否则课时会绕开班级消耗。
    if (pkg.classType === "GROUP") {
      return NextResponse.json({ error: "班课课包请通过班级排课，不能单独排课" }, { status: 400 });
    }

    const durationHours = lessonHours(new Date(startTime), new Date(endTime));

    // 库存校验 + 冲突检查 + 建课放进一个事务，并用「建后复核」堵并发：
    // SQLite 写串行化，第二个并发事务的建课会排在第一个提交之后，其建后复核即可
    // 看到对方那条记录 → 冲突回滚，避免超排 / 同一老师·教室·学生被双占。
    const lesson = await prisma.$transaction(async (tx) => {
      await assertInventory(tx, { pkg, durationHours });

      const created = await tx.scheduledLesson.create({
        data: { teacherId, studentId, packageId, classroomId, startTime: new Date(startTime), endTime: new Date(endTime), lessonType },
        include: {
          teacher: { select: { name: true } },
          student: { select: { name: true } },
          classroom: true,
          package: { include: { subject: true } },
        },
      });

      await assertNoConflict(tx, {
        startTime: new Date(startTime), endTime: new Date(endTime),
        teacherId, classroomId, studentId, excludeLessonId: created.id,
      });
      return created;
    });

    return NextResponse.json(lesson, { status: 201 });
  } catch (e) {
    if (e instanceof ScheduleError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
