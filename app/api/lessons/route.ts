import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/lib/enums";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const phase = searchParams.get("phase"); // "scheduled" | "pending_log" | "pending_confirm" | "completed"
  const start = searchParams.get("start"); // ISO，按上课时间过滤（核销管理默认当月）
  const end = searchParams.get("end");

  const sessionUser = session.user as { id: string; roles: Role[]; campusIds: string[] };
  const isSuperAdmin = sessionUser.roles.includes("SUPER_ADMIN" as Role);
  const isTeacher = sessionUser.roles.includes("TEACHER" as Role);

  const baseWhere: Record<string, unknown> = {};
  if (!isSuperAdmin) {
    if (isTeacher && !sessionUser.roles.some(r => ["ACADEMIC_ADMIN", "PRINCIPAL", "FINANCE"].includes(r as string))) {
      baseWhere.teacherId = sessionUser.id;
    } else {
      baseWhere.student = { campusId: { in: sessionUser.campusIds } };
    }
  }

  const where: Record<string, unknown> = { ...baseWhere };

  // 按上课时间过滤（核销管理的时间范围，默认当月）。
  const timeRange: Record<string, Date> = {};
  if (start) timeRange.gte = new Date(start);
  if (end) timeRange.lte = new Date(end);

  if (phase === "pending_log") {
    where.log = null;
    where.startTime = { ...timeRange, lt: new Date() }; // Past lessons without log
  } else if (phase === "pending_confirm") {
    where.log = { isNot: null, confirmedAt: null };
    if (start || end) where.startTime = timeRange;
  } else if (phase === "completed") {
    where.log = { confirmedAt: { not: null } };
    if (start || end) where.startTime = timeRange;
  } else if (start || end) {
    where.startTime = timeRange;
  }

  const lessons = await prisma.scheduledLesson.findMany({
    where,
    include: {
      teacher: { select: { id: true, name: true } },
      student: { select: { id: true, name: true } },
      classroom: { select: { name: true } },
      package: { include: { subject: true } },
      log: {
        include: {
          subject: true,
          confirmer: { select: { name: true } },
          deductions: {
            include: { reverser: { select: { name: true } } },
            orderBy: { createdAt: "desc" },
          },
        },
      },
    },
    orderBy: { startTime: "desc" },
    take: 100,
  });

  // 前端只关心「当前生效」的那条扣课记录：优先未撤销的，否则取最近一条。
  // 把一对多压平成单个 deduction，保持客户端契约不变。
  const shaped = lessons.map((l) => {
    if (!l.log) return l;
    const { deductions, ...log } = l.log;
    const current = deductions.find((d) => !d.reversedAt) ?? deductions[0] ?? null;
    return { ...l, log: { ...log, deduction: current } };
  });

  return NextResponse.json(shaped);
}
