import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { campusScope, canViewTeacherReport, ownScheduleScope, type SessionUser } from "@/lib/permissions";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewTeacherReport(session.user as SessionUser)) {
    return NextResponse.json({ error: "无权查看工时报表" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const teacherId = searchParams.get("teacherId");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  const sessionUser = session.user as SessionUser;

  const where: Record<string, unknown> = {
    log: { confirmedAt: { not: null } },
  };

  const scope = campusScope(sessionUser);
  if (scope) where.student = { campusId: scope };
  if (teacherId) where.teacherId = teacherId;
  // 老师只看自己的工时。工时直接连着课酬，让老师互相看得到同事的工作量
  // 既没有业务理由，也是薪酬信息的旁路。压在 teacherId 参数之后。
  const own = ownScheduleScope(sessionUser);
  if (own) where.teacherId = own.teacherId;
  if (startDate || endDate) {
    const dateFilter: Record<string, Date> = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) dateFilter.lte = new Date(endDate);
    where.startTime = dateFilter;
  }

  const lessons = await prisma.scheduledLesson.findMany({
    where,
    include: {
      teacher: { select: { id: true, name: true } },
      package: { include: { subject: true } },
      log: { include: { subject: true } },
    },
  });

  // Aggregate by teacher
  const byTeacher: Record<string, {
    name: string;
    totalHours: number;
    oneOnOneHours: number;
    groupHours: number;
    bySubject: Record<string, number>;
  }> = {};

  for (const l of lessons) {
    const tid = l.teacherId;
    const durationH = (l.endTime.getTime() - l.startTime.getTime()) / 3600000;
    const subjectName = l.log?.subject.name ?? l.package.subject.name;

    if (!byTeacher[tid]) byTeacher[tid] = {
      name: l.teacher.name, totalHours: 0, oneOnOneHours: 0, groupHours: 0, bySubject: {},
    };

    byTeacher[tid].totalHours += durationH;
    if (l.lessonType === "ONE_ON_ONE") byTeacher[tid].oneOnOneHours += durationH;
    else byTeacher[tid].groupHours += durationH;
    byTeacher[tid].bySubject[subjectName] = (byTeacher[tid].bySubject[subjectName] ?? 0) + durationH;
  }

  return NextResponse.json({
    teachers: Object.entries(byTeacher).map(([id, v]) => ({ id, ...v })),
    totalHours: lessons.reduce((s, l) => s + (l.endTime.getTime() - l.startTime.getTime()) / 3600000, 0),
    count: lessons.length,
  });
}
