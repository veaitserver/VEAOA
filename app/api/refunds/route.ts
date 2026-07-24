import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  campusScope, canCreateRefund, canViewLedger, denyCrossCampus,
  hasRole, type SessionUser,
} from "@/lib/permissions";
import { settlableHours, settlementAmount } from "@/lib/settlement";
import { roundHours } from "@/lib/hours";
import { Role } from "@/lib/enums";
import { z } from "zod";

const createSchema = z.object({
  packageId: z.string().min(1),
  hours: z.number().positive().max(10000).finite(),
  reason: z.string().max(500).optional().nullable(),
});

/** 退费申请列表（校区隔离；可按状态筛选、分页）。 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canViewLedger(sessionUser)) {
    return NextResponse.json({ error: "无权查看退费申请" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const page = Number(searchParams.get("page")) || 0;

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  const scope = campusScope(sessionUser);
  const studentWhere: Record<string, unknown> = {};
  if (scope) studentWhere.campusId = scope;
  // 学管只看自己负责的学生；销售只看自己名下的。管理层看全校区。
  if (!hasRole(sessionUser, Role.PRINCIPAL, Role.FINANCE, Role.SUPER_ADMIN)) {
    if (hasRole(sessionUser, Role.STUDENT_MANAGER)) studentWhere.studentManagerId = sessionUser.id;
    else studentWhere.salesId = sessionUser.id;
  }
  if (Object.keys(studentWhere).length) where.student = studentWhere;

  const include = {
    student: { select: { id: true, name: true, campusId: true } },
    package: { select: { id: true, grade: { select: { name: true } }, subject: { select: { name: true } } } },
    creator: { select: { name: true } },
    approver: { select: { name: true } },
    payer: { select: { name: true } },
  } as const;

  if (page >= 1) {
    const pageSize = 20;
    const [items, total] = await prisma.$transaction([
      prisma.refundRequest.findMany({ where, include, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.refundRequest.count({ where }),
    ]);
    return NextResponse.json({ items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  }

  const items = await prisma.refundRequest.findMany({ where, include, orderBy: { createdAt: "desc" }, take: 200 });
  return NextResponse.json(items);
}

/** 发起退费申请（学管/校长）。此刻不动课时，财务打款时才结算。 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canCreateRefund(sessionUser)) {
    return NextResponse.json({ error: "仅学管或校长可发起退费" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const { packageId, hours, reason } = parsed.data;

  const pkg = await prisma.coursePackage.findUnique({
    where: { id: packageId },
    include: { student: { select: { id: true, campusId: true, studentManagerId: true } } },
  });
  if (!pkg) return NextResponse.json({ error: "课包不存在" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, pkg.student.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  // 学管只能给自己负责的学生发起（校长/超管不受限）。
  if (!hasRole(sessionUser, Role.PRINCIPAL, Role.SUPER_ADMIN)
      && pkg.student.studentManagerId !== sessionUser.id) {
    return NextResponse.json({ error: "只能为自己负责的学生发起退费" }, { status: 403 });
  }

  if (pkg.status !== "ACTIVE") {
    return NextResponse.json({ error: "只有已生效的课包才能退费" }, { status: 400 });
  }

  // 同一课包不允许有两笔在途申请，否则两笔都通过会重复退。
  const inFlight = await prisma.refundRequest.findFirst({
    where: { packageId, status: { in: ["PENDING_APPROVAL", "PENDING_FINANCE"] } },
  });
  if (inFlight) {
    return NextResponse.json({ error: "该课包已有在途的退费申请" }, { status: 409 });
  }

  // 可退上限 = 剩余 − 已排未核销；已排的课要先取消或上掉才能退。
  const settlable = await settlableHours(prisma, pkg);
  const wanted = roundHours(hours);
  if (wanted > settlable.hours) {
    return NextResponse.json(
      { error: `可退课时不足（剩余 ${settlable.remainingHours}h，已排未核销 ${settlable.pendingHours}h，最多可退 ${settlable.hours}h）` },
      { status: 400 },
    );
  }

  const pricePerHour = Number(pkg.pricePerHour);
  const refund = await prisma.refundRequest.create({
    data: {
      studentId: pkg.student.id,
      packageId,
      hours: wanted,
      pricePerHour,
      amount: settlementAmount(wanted, pricePerHour),
      status: "PENDING_APPROVAL",
      reason: reason?.trim() || null,
      createdById: sessionUser.id,
    },
    include: {
      student: { select: { id: true, name: true } },
      package: { select: { grade: { select: { name: true } }, subject: { select: { name: true } } } },
    },
  });

  return NextResponse.json(refund, { status: 201 });
}
