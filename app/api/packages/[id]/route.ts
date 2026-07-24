import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  canEditActivePackage,
  canEditPendingPackage,
  canAccessPackages,
  canViewPackageFinancials,
  canSeePackageOfStudent,
  denyCrossCampus,
  hasRole,
  type SessionUser,
} from "@/lib/permissions";
import { Role } from "@/lib/enums";
import { roundHours } from "@/lib/hours";
import { settlableHours } from "@/lib/settlement";
import { z } from "zod";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canAccessPackages(sessionUser)) {
    return NextResponse.json({ error: "无权查看课包" }, { status: 403 });
  }

  const { id } = await params;
  const pkg = await prisma.coursePackage.findUnique({
    where: { id },
    include: {
      student: { select: { id: true, name: true, campusId: true, salesId: true, studentManagerId: true } },
      grade: true, subject: true,
      creator: { select: { name: true } },
      confirmer: { select: { name: true } },
      financeConfirmer: { select: { name: true } },
      deductions: {
        include: { reverser: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      },
      lessons: {
        include: { teacher: { select: { name: true } }, classroom: true },
        orderBy: { startTime: "desc" },
      },
    },
  });

  if (!pkg) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, pkg.student.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  // 归属：销售/学管只能看自己名下·负责的学生课包（管理层/教务全校区）。
  if (!canSeePackageOfStudent(sessionUser, pkg.student)) {
    return NextResponse.json({ error: "只能查看自己名下学生的课包" }, { status: 403 });
  }

  // 可退课时上限（剩余 − 已排未核销），供退费表单校验与提示。
  const settlable = await settlableHours(prisma, pkg);
  const withSettlable = { ...pkg, refundable: settlable };

  // 教务看不到金额。
  if (!canViewPackageFinancials(sessionUser)) {
    const { pricePerHour: _p, totalAmount: _t, ...rest } = withSettlable;
    return NextResponse.json(rest);
  }
  return NextResponse.json(withSettlable);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  const { id } = await params;

  const pkg = await prisma.coursePackage.findUnique({
    where: { id },
    include: { student: { select: { campusId: true, salesId: true } } },
  });
  if (!pkg) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, pkg.student.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  // 待审批课包原先直接短路掉整个角色检查，任何登录用户都能改价删单。
  if (!canEditPendingPackage(sessionUser)) {
    return NextResponse.json({ error: "无权修改课包" }, { status: 403 });
  }
  // 归属：销售只能改自己名下学生的课包，不能改同校区同事的单（管理层/财务不受限）。
  if (!hasRole(sessionUser, Role.PRINCIPAL, Role.FINANCE, Role.SUPER_ADMIN) && pkg.student.salesId !== sessionUser.id) {
    return NextResponse.json({ error: "只能修改自己名下学生的课包" }, { status: 403 });
  }
  // 已激活的课包只有财务能动。
  if (pkg.status !== "PENDING_APPROVAL" && !canEditActivePackage(sessionUser)) {
    return NextResponse.json({ error: "已激活课包仅限财务修改" }, { status: 403 });
  }

  const schema = z.object({
    totalHours: z.number().positive().optional(),
    pricePerHour: z.number().positive().optional(),
    totalAmount: z.number().positive().optional(),
    notes: z.string().optional(),
  });

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  // 三个金额字段任改其一都要重新校验一致性：总价 === 总课时 × 单价。
  const totalHours = parsed.data.totalHours ?? pkg.totalHours;
  const pricePerHour = parsed.data.pricePerHour ?? pkg.pricePerHour;
  const totalAmount = parsed.data.totalAmount ?? pkg.totalAmount;
  if (Math.abs(totalAmount - totalHours * pricePerHour) > 0.01) {
    return NextResponse.json({ error: "总价必须等于总课时 × 单价（折扣请调单价）" }, { status: 400 });
  }

  // 聚合已消耗 + 更新放进一个事务，避免与并发的核销/撤销交错造成 remainingHours 丢更新；
  // 且只有真正改了 totalHours 才重算余额（改备注/单价不该覆写余额）。
  const changesTotalHours = parsed.data.totalHours !== undefined;
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const agg = await tx.courseDeduction.aggregate({
        where: { packageId: id, reversedAt: null },
        _sum: { hoursDeducted: true },
      });
      const consumed = roundHours(Number(agg._sum.hoursDeducted ?? 0));
      if (changesTotalHours && totalHours < consumed) {
        throw new PkgUpdateError(`总课时不能低于已消耗课时（已消耗 ${consumed}h）`);
      }
      return tx.coursePackage.update({
        where: { id },
        data: {
          ...parsed.data,
          ...(changesTotalHours ? { remainingHours: roundHours(totalHours - consumed) } : {}),
        },
        include: { grade: true, subject: true },
      });
    });
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof PkgUpdateError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

class PkgUpdateError extends Error {}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  const { id } = await params;

  const pkg = await prisma.coursePackage.findUnique({
    where: { id },
    include: {
      student: { select: { campusId: true, salesId: true } },
      _count: { select: { lessons: true, deductions: true } },
    },
  });
  if (!pkg) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, pkg.student.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  if (!canEditPendingPackage(sessionUser)) {
    return NextResponse.json({ error: "无权删除课包" }, { status: 403 });
  }
  if (!hasRole(sessionUser, Role.PRINCIPAL, Role.FINANCE, Role.SUPER_ADMIN) && pkg.student.salesId !== sessionUser.id) {
    return NextResponse.json({ error: "只能删除自己名下学生的课包" }, { status: 403 });
  }
  if (pkg.status !== "PENDING_APPROVAL" && !canEditActivePackage(sessionUser)) {
    return NextResponse.json({ error: "已激活课包仅限财务删除" }, { status: 403 });
  }
  // 已排课或已有扣课记录的课包不能物理删除，否则外键报 500、学生阶段错误回退。
  if (pkg._count.lessons > 0 || pkg._count.deductions > 0) {
    return NextResponse.json({ error: "该课包已有排课或核销记录，不能删除" }, { status: 400 });
  }

  await prisma.coursePackage.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
