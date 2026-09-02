import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  campusScope, canViewLessons, canViewPackageFinancials, ownScheduleScope, studentOwnerScope, type SessionUser,
} from "@/lib/permissions";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const phase = searchParams.get("phase"); // "scheduled" | "pending_log" | "pending_confirm" | "completed"
  const start = searchParams.get("start"); // ISO，按上课时间过滤（核销管理默认当月）
  const end = searchParams.get("end");

  const sessionUser = session.user as SessionUser;
  if (!canViewLessons(sessionUser)) {
    return NextResponse.json({ error: "无权查看核销记录" }, { status: 403 });
  }

  // 三层收敛，各管各的一维：
  //   校区 —— campusScope（超管不限）
  //   老师 —— 纯老师只看自己带的课
  //   归属 —— 学管只看自己负责的学生（销售已在上面被整体挡掉）
  const baseWhere: Record<string, unknown> = {};
  const scope = campusScope(sessionUser);
  const studentWhere: Record<string, unknown> = {};
  if (scope) studentWhere.campusId = scope;
  Object.assign(studentWhere, studentOwnerScope(sessionUser) ?? {});
  if (Object.keys(studentWhere).length) baseWhere.student = studentWhere;

  const own = ownScheduleScope(sessionUser);
  if (own) baseWhere.teacherId = own.teacherId;

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

  const page = Number(searchParams.get("page")) || 0;
  const include = {
    teacher: { select: { id: true, name: true } },
    student: { select: { id: true, name: true } },
    classroom: { select: { name: true } },
    package: { include: { subject: true } },
    log: {
      include: {
        subject: true,
        confirmer: { select: { name: true } },
        deductions: { include: { reverser: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      },
    },
  } satisfies Prisma.ScheduledLessonInclude;

  // 前端只关心「当前生效」的那条扣课记录：优先未撤销的，否则取最近一条。压平成单个 deduction。
  type LessonRow = Prisma.ScheduledLessonGetPayload<{ include: typeof include }>;
  const hidePackageMoney = !canViewPackageFinancials(sessionUser);
  const shape = (rows: LessonRow[]) =>
    rows.map((l) => {
      const packageData = hidePackageMoney
        ? (() => {
            const { pricePerHour: _price, totalAmount: _amount, topUpAmount: _topUp, ...safe } = l.package;
            return safe;
          })()
        : l.package;
      if (!l.log) return { ...l, package: packageData };
      const { deductions, ...log } = l.log;
      const current = deductions.find((d) => !d.reversedAt) ?? deductions[0] ?? null;
      return { ...l, package: packageData, log: { ...log, deduction: current } };
    });

  if (page >= 1) {
    const pageSize = 20;
    const [rows, total] = await prisma.$transaction([
      prisma.scheduledLesson.findMany({ where, include, orderBy: { startTime: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.scheduledLesson.count({ where }),
    ]);
    return NextResponse.json({ items: shape(rows), total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  }

  const lessons = await prisma.scheduledLesson.findMany({ where, include, orderBy: { startTime: "desc" }, take: 100 });
  return NextResponse.json(shape(lessons));
}
