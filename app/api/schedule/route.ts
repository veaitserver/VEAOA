import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { campusScope, canSchedule, denyCrossCampus, type SessionUser } from "@/lib/permissions";
import { z } from "zod";

const createSchema = z.object({
  teacherId: z.string().min(1),
  studentId: z.string().min(1),
  packageId: z.string().min(1),
  classroomId: z.string().min(1),
  startTime: z.string(),
  endTime: z.string(),
  lessonType: z.enum(["ONE_ON_ONE", "GROUP"]).default("ONE_ON_ONE"),
});

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

  // Check package is ACTIVE
  const pkg = await prisma.coursePackage.findUnique({ where: { id: packageId } });
  if (!pkg || pkg.status !== "ACTIVE") {
    return NextResponse.json({ error: "课包未激活，无法排课" }, { status: 400 });
  }
  if (pkg.studentId !== studentId) {
    return NextResponse.json({ error: "课包不属于该学生" }, { status: 400 });
  }

  // Check available inventory
  const durationHours = (new Date(endTime).getTime() - new Date(startTime).getTime()) / 3600000;

  if (Number(pkg.remainingHours) < durationHours) {
    return NextResponse.json({ error: "课包剩余课时不足" }, { status: 400 });
  }

  // Conflict check: teacher
  const teacherConflict = await prisma.scheduledLesson.findFirst({
    where: {
      teacherId,
      startTime: { lt: new Date(endTime) },
      endTime: { gt: new Date(startTime) },
    },
  });
  if (teacherConflict) {
    return NextResponse.json({ error: "该时段老师已有课程，存在冲突" }, { status: 409 });
  }

  // Conflict check: classroom
  const classroomConflict = await prisma.scheduledLesson.findFirst({
    where: {
      classroomId,
      startTime: { lt: new Date(endTime) },
      endTime: { gt: new Date(startTime) },
    },
  });
  if (classroomConflict) {
    return NextResponse.json({ error: "该时段教室已被占用，存在冲突" }, { status: 409 });
  }

  const lesson = await prisma.scheduledLesson.create({
    data: {
      teacherId, studentId, packageId, classroomId,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      lessonType,
    },
    include: {
      teacher: { select: { name: true } },
      student: { select: { name: true } },
      classroom: true,
      package: { include: { subject: true } },
    },
  });

  return NextResponse.json(lesson, { status: 201 });
}
