import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { campusScope, canCreatePackage, canCreateNewSignPackage, canCreateRenewalPackage, canAccessPackages, canViewPackageFinancials, packageOwnerScope, denyCrossCampus, denyNotOwner, type SessionUser } from "@/lib/permissions";
import { z } from "zod";

const createSchema = z.object({
  studentId: z.string().min(1),
  gradeId: z.string().min(1),
  subjectId: z.string().min(1),
  totalHours: z.number().positive(),
  pricePerHour: z.number().positive(),
  totalAmount: z.number().positive(),
  notes: z.string().optional(),
});

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const studentId = searchParams.get("studentId");
  const page = Number(searchParams.get("page")) || 0;

  const sessionUser = session.user as SessionUser;
  // 角色门禁：老师/HR 无权读课包（此前只校验登录，老师拿到 packageId 即可读全量财务）。
  if (!canAccessPackages(sessionUser)) {
    return NextResponse.json({ error: "无权查看课包" }, { status: 403 });
  }

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (studentId) where.studentId = studentId;
  const scope = campusScope(sessionUser);
  const owner = packageOwnerScope(sessionUser); // 销售→自己名下 / 学管→自己负责 / 管理层·教务→全校区
  const studentWhere: Record<string, unknown> = {};
  if (scope) studentWhere.campusId = scope;
  if (owner) Object.assign(studentWhere, owner);
  if (Object.keys(studentWhere).length) where.student = studentWhere;

  const include = {
    student: { select: { id: true, name: true, campusId: true } },
    grade: true,
    subject: true,
    creator: { select: { name: true } },
    confirmer: { select: { name: true } },
    deductions: { where: { reversedAt: null }, select: { hoursDeducted: true } },
  } as const;

  // 教务能看到课包用于排课，但看不到金额（单价/总额）。
  const stripMoney = !canViewPackageFinancials(sessionUser);
  type Pkg = Awaited<ReturnType<typeof prisma.coursePackage.findMany>>[number] & { pricePerHour?: number; totalAmount?: number };
  const shape = (rows: Pkg[]) =>
    stripMoney
      ? rows.map(({ pricePerHour: _p, totalAmount: _t, ...rest }) => rest)
      : rows;

  if (page >= 1) {
    const pageSize = 20;
    const [items, total] = await prisma.$transaction([
      prisma.coursePackage.findMany({ where, include, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.coursePackage.count({ where }),
    ]);
    return NextResponse.json({ items: shape(items as Pkg[]), total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  }

  const packages = await prisma.coursePackage.findMany({ where, include, orderBy: { createdAt: "desc" } });
  return NextResponse.json(shape(packages as Pkg[]));
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canCreatePackage(sessionUser)) {
    return NextResponse.json({ error: "无权创建课包" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const { studentId, gradeId, subjectId, totalHours, pricePerHour, totalAmount, notes } = parsed.data;

  // 总价 === 总课时 × 单价，折扣打在单价上。
  if (Math.abs(totalAmount - totalHours * pricePerHour) > 0.01) {
    return NextResponse.json({ error: "总价必须等于总课时 × 单价（折扣请调单价）" }, { status: 400 });
  }

  // studentId 直接来自请求体：不校验就能给别校区的学生开单，
  // 且 createdById 记的是自己 —— 销售报表会把提成算到攻击者头上。
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { campusId: true, salesId: true, studentManagerId: true },
  });
  if (!student) return NextResponse.json({ error: "学生不存在" }, { status: 404 });
  const denied = denyCrossCampus(sessionUser, student.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  // 签约类型：学生「曾有生效(ACTIVE)课包」→ 续费，否则 → 新签。
  // 用 ACTIVE 而非课包总数：同一次成交多科目会先建多张待审批课包，它们都应算新签，
  // 销售可一次性建齐；等第一张生效后，学生才进入「续费由学管负责」阶段，销售不再能建。
  const activeCount = await prisma.coursePackage.count({ where: { studentId, status: "ACTIVE" } });
  const isRenewal = activeCount > 0;
  if (isRenewal) {
    if (!canCreateRenewalPackage(sessionUser, student.studentManagerId)) {
      return NextResponse.json({ error: "该学生已签约，续费课包由其学管或校长创建，销售不能再添加" }, { status: 403 });
    }
  } else {
    if (!canCreateNewSignPackage(sessionUser)) {
      return NextResponse.json({ error: "新签课包由销售或校长创建" }, { status: 403 });
    }
    // 新签的销售必须是该学生的归属销售（管理层不受此限）。
    const notOwner = denyNotOwner(sessionUser, student.salesId);
    if (notOwner) return NextResponse.json({ error: notOwner }, { status: 403 });
  }

  const pkg = await prisma.coursePackage.create({
    data: {
      studentId,
      gradeId,
      subjectId,
      totalHours,
      pricePerHour,
      totalAmount,
      remainingHours: totalHours,
      notes,
      createdById: sessionUser.id,
      status: "PENDING_APPROVAL",
      signingType: isRenewal ? "RENEWAL" : "NEW_SIGN",
    },
    include: {
      student: { select: { name: true } },
      grade: true,
      subject: true,
      creator: { select: { name: true } },
    },
  });

  return NextResponse.json(pkg, { status: 201 });
}
