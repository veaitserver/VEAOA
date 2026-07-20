import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  canEditActivePackage,
  canEditPendingPackage,
  denyCrossCampus,
  type SessionUser,
} from "@/lib/permissions";
import { roundHours } from "@/lib/hours";
import { z } from "zod";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const pkg = await prisma.coursePackage.findUnique({
    where: { id },
    include: {
      student: { select: { id: true, name: true, campusId: true } },
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

  const denied = denyCrossCampus(session.user as SessionUser, pkg.student.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  return NextResponse.json(pkg);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  const { id } = await params;

  const pkg = await prisma.coursePackage.findUnique({
    where: { id },
    include: { student: { select: { campusId: true } } },
  });
  if (!pkg) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, pkg.student.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  // 待审批课包原先直接短路掉整个角色检查，任何登录用户都能改价删单。
  if (!canEditPendingPackage(sessionUser)) {
    return NextResponse.json({ error: "无权修改课包" }, { status: 403 });
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

  // 已消耗课时以扣课台账为准（remainingHours 可能被历史 bug 写坏）。
  // 改总课时后余额 = 新总课时 − 已消耗；不允许改到低于已消耗。
  const agg = await prisma.courseDeduction.aggregate({
    where: { packageId: id, reversedAt: null },
    _sum: { hoursDeducted: true },
  });
  const consumed = roundHours(Number(agg._sum.hoursDeducted ?? 0));
  if (totalHours < consumed) {
    return NextResponse.json(
      { error: `总课时不能低于已消耗课时（已消耗 ${consumed}h）` },
      { status: 400 },
    );
  }

  const updated = await prisma.coursePackage.update({
    where: { id },
    data: {
      ...parsed.data,
      remainingHours: roundHours(totalHours - consumed),
    },
    include: { grade: true, subject: true },
  });

  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  const { id } = await params;

  const pkg = await prisma.coursePackage.findUnique({
    where: { id },
    include: { student: { select: { campusId: true } } },
  });
  if (!pkg) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, pkg.student.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  if (!canEditPendingPackage(sessionUser)) {
    return NextResponse.json({ error: "无权删除课包" }, { status: 403 });
  }
  if (pkg.status !== "PENDING_APPROVAL" && !canEditActivePackage(sessionUser)) {
    return NextResponse.json({ error: "已激活课包仅限财务删除" }, { status: 403 });
  }

  await prisma.coursePackage.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
