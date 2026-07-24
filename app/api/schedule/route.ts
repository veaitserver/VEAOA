import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { campusScope, canSchedule, denyCrossCampus, type SessionUser } from "@/lib/permissions";
import { lessonHours, roundHours } from "@/lib/hours";
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
    },
    backgroundColor: l.log?.confirmedAt ? "#16a34a" : l.log ? "#d97706" : "#3b82f6",
    borderColor: "transparent",
  }));

  return NextResponse.json(events);
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

  // studentId / classroomId 都来自请求体。不校验校区就能占用别校区的教室和老师，
  // 既是越权也是拒绝服务。
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { campusId: true },
  });
  if (!student) return NextResponse.json({ error: "学生不存在" }, { status: 404 });
  const studentDenied = denyCrossCampus(sessionUser, student.campusId);
  if (studentDenied) return NextResponse.json({ error: studentDenied }, { status: 403 });

  const classroom = await prisma.classroom.findUnique({
    where: { id: classroomId },
    select: { campusId: true },
  });
  if (!classroom) return NextResponse.json({ error: "教室不存在" }, { status: 404 });
  const roomDenied = denyCrossCampus(sessionUser, classroom.campusId);
  if (roomDenied) return NextResponse.json({ error: roomDenied }, { status: 403 });
  if (classroom.campusId !== student.campusId) {
    return NextResponse.json({ error: "教室与学生不在同一校区" }, { status: 400 });
  }

  // 老师校验：teacherId 原先直接落库、冲突检查还是全局的，可跨校区占用别人的老师
  // （越权 + 拒绝服务）。必须是本校区在职老师。
  const teacher = await prisma.user.findUnique({
    where: { id: teacherId },
    select: { isActive: true, roles: { select: { role: true } }, campuses: { select: { campusId: true } } },
  });
  if (!teacher || !teacher.isActive || !teacher.roles.some((r) => r.role === "TEACHER")) {
    return NextResponse.json({ error: "老师不存在或非在职老师" }, { status: 400 });
  }
  if (!teacher.campuses.some((c) => c.campusId === student.campusId)) {
    return NextResponse.json({ error: "老师不属于该学生所在校区" }, { status: 400 });
  }

  // Check package is ACTIVE
  const pkg = await prisma.coursePackage.findUnique({ where: { id: packageId } });
  if (!pkg || pkg.status !== "ACTIVE") {
    return NextResponse.json({ error: "课包未激活，无法排课" }, { status: 400 });
  }
  if (pkg.studentId !== studentId) {
    return NextResponse.json({ error: "课包不属于该学生" }, { status: 400 });
  }

  const durationHours = lessonHours(new Date(startTime), new Date(endTime));
  const overlap = { startTime: { lt: new Date(endTime) }, endTime: { gt: new Date(startTime) } };

  // 库存校验 + 冲突检查 + 建课放进一个事务，并用「建后复核」堵并发：
  // SQLite 写串行化，第二个并发事务的建课会排在第一个提交之后，其建后复核即可
  // 看到对方那条记录 → 冲突回滚，避免超排 / 同一老师·教室·学生被双占。
  try {
    const lesson = await prisma.$transaction(async (tx) => {
      // 可用量 = 剩余课时 − 已排未核销的课时总和。
      const packageLessons = await tx.scheduledLesson.findMany({
        where: { packageId },
        include: { log: { include: { deductions: true } } },
      });
      const pendingHours = roundHours(
        packageLessons
          .filter((l) => !l.log || !l.log.deductions.some((d) => !d.reversedAt))
          .reduce((sum, l) => sum + lessonHours(l.startTime, l.endTime), 0),
      );
      const available = roundHours(Number(pkg.remainingHours) - pendingHours);
      if (durationHours > available) {
        throw new ScheduleError(400, `课包可用课时不足（剩余 ${roundHours(Number(pkg.remainingHours))}h，已排未核销 ${pendingHours}h，可用 ${available}h）`);
      }

      const created = await tx.scheduledLesson.create({
        data: { teacherId, studentId, packageId, classroomId, startTime: new Date(startTime), endTime: new Date(endTime), lessonType },
        include: {
          teacher: { select: { name: true } },
          student: { select: { name: true } },
          classroom: true,
          package: { include: { subject: true } },
        },
      });

      // 建后复核：老师 / 教室 / 学生任一维在同时段已有别的课 → 回滚。
      const clash = await tx.scheduledLesson.findFirst({
        where: { id: { not: created.id }, ...overlap, OR: [{ teacherId }, { classroomId }, { studentId }] },
      });
      if (clash) {
        const dim = clash.teacherId === teacherId ? "老师" : clash.classroomId === classroomId ? "教室" : "学生";
        throw new ScheduleError(409, `该时段${dim}已有课程，存在冲突`);
      }
      return created;
    });

    return NextResponse.json(lesson, { status: 201 });
  } catch (e) {
    if (e instanceof ScheduleError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

class ScheduleError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
