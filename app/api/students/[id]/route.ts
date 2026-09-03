import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageLeads, canManageStudents, canViewPackageFinancials, denyCrossCampus, denyNotMyStudent, canAssignLeadOwner, canAssignStudentManager, type SessionUser } from "@/lib/permissions";
import { isAssignableUser } from "@/lib/assign";
import { normalizeAppId } from "@/lib/leadImport";
import { SourceCategory, LeadStatus } from "@/lib/enums";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  gradeId: z.string().nullable().optional(),
  publicSchool: z.string().nullable().optional(),
  salesId: z.string().nullable().optional(),
  campusId: z.string().optional(),
  studentManagerId: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  preferredContactApp: z.string().nullable().optional(),
  contactAppId: z.string().nullable().optional(),
  // 线索来源与状态（销售可从线索里补销售信息、推进漏斗状态）
  sourceCategory: z.nativeEnum(SourceCategory).nullable().optional(),
  sourceDetail: z.string().nullable().optional(),
  subjectsOfInterest: z.string().nullable().optional(),
  status: z.nativeEnum(LeadStatus).optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const student = await prisma.student.findUnique({
    where: { id },
    include: {
      grade: true,
      campus: true,
      sales: { select: { id: true, name: true } },
      studentManager: { select: { id: true, name: true } },
      leadInfo: { include: { campaign: { select: { name: true } } } },
      followUps: {
        include: { sales: { select: { name: true } } },
        orderBy: { followedAt: "desc" },
      },
      packages: {
        include: { grade: true, subject: true, creator: { select: { name: true } }, confirmer: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      },
      lessons: {
        include: {
          teacher: { select: { name: true } },
          classroom: true,
          package: { include: { subject: true } },
          log: { include: { deductions: true } },
        },
        orderBy: { startTime: "desc" },
        take: 20,
      },
    },
  });

  if (!student) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(session.user as SessionUser, student.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  // 归属隔离：销售只能看自己名下的，学管只能看自己负责的。
  const notOwner = denyNotMyStudent(session.user as SessionUser, student);
  if (notOwner) return NextResponse.json({ error: notOwner }, { status: 403 });

  // 压平成单个 deduction：只认「生效中」的那条。已撤销的课时已还回，
  // 该课应重新计入「已排未消耗」，故撤销后 deduction 视为空。
  const hidePackageMoney = !canViewPackageFinancials(session.user as SessionUser);
  const withoutMoney = <T extends { pricePerHour: unknown; totalAmount: unknown; topUpAmount?: unknown }>(pkg: T) => {
    if (!hidePackageMoney) return pkg;
    const { pricePerHour: _price, totalAmount: _amount, topUpAmount: _topUp, ...safe } = pkg;
    return safe;
  };
  const shaped = {
    ...student,
    packages: student.packages.map(withoutMoney),
    lessons: student.lessons.map((l) => {
      const packageData = withoutMoney(l.package);
      if (!l.log) return { ...l, package: packageData };
      const { deductions, ...log } = l.log;
      return { ...l, package: packageData, log: { ...log, deduction: deductions.find((d) => !d.reversedAt) ?? null } };
    }),
  };

  return NextResponse.json(shaped);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canManageStudents(sessionUser)) {
    return NextResponse.json({ error: "无权修改学生档案" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const {
    salesId, studentManagerId, contactAppId, postalCode, preferredContactApp,
    sourceCategory, sourceDetail, subjectsOfInterest, status,
    ...rest
  } = parsed.data;

  // 线索来源、兴趣科目和漏斗状态只应由销售/校长处理；教务可维护
  // 学籍资料，但不能绕过“校长分配 — 销售跟进”的业务链。
  if ((sourceCategory !== undefined || sourceDetail !== undefined || subjectsOfInterest !== undefined || status !== undefined)
      && !canManageLeads(sessionUser)) {
    return NextResponse.json({ error: "无权修改线索信息或状态" }, { status: 403 });
  }

  const existing = await prisma.student.findUnique({ where: { id }, select: { campusId: true, salesId: true, studentManagerId: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, existing.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  const notOwner = denyNotMyStudent(sessionUser, existing);
  if (notOwner) return NextResponse.json({ error: notOwner }, { status: 403 });

  // 改归属销售只限校长/超管；销售不能把线索转给别人或抢过来。
  if (salesId !== undefined && salesId !== existing.salesId) {
    if (!canAssignLeadOwner(sessionUser)) {
      return NextResponse.json({ error: "仅校长可分配/变更线索归属" }, { status: 403 });
    }
    // 目标须是本校区在职销售，否则学生会被指给别校区/非销售用户而从各视图“消失”。
    if (salesId !== null && !(await isAssignableUser(salesId, "SALES", existing.campusId))) {
      return NextResponse.json({ error: "目标不是该校区的有效销售" }, { status: 400 });
    }
  }
  // 分配/变更学管只限校长/超管。
  if (studentManagerId !== undefined && studentManagerId !== existing.studentManagerId) {
    if (!canAssignStudentManager(sessionUser)) {
      return NextResponse.json({ error: "仅校长可分配/变更学管" }, { status: 403 });
    }
    if (studentManagerId !== null && !(await isAssignableUser(studentManagerId, "STUDENT_MANAGER", existing.campusId))) {
      return NextResponse.json({ error: "目标不是该校区的有效学管" }, { status: 400 });
    }
  }

  // 迁校区要求对「迁出」和「迁入」两边都有权限，否则可以把学生推去自己看不到的校区。
  if (rest.campusId && rest.campusId !== existing.campusId) {
    const targetDenied = denyCrossCampus(sessionUser, rest.campusId);
    if (targetDenied) return NextResponse.json({ error: targetDenied }, { status: 403 });
  }

  await prisma.student.update({
    where: { id },
    data: {
      ...rest,
      ...(salesId !== undefined ? { salesId } : {}),
      ...(studentManagerId !== undefined ? { studentManagerId: studentManagerId || null } : {}),
      ...(postalCode !== undefined ? { postalCode: postalCode?.trim() || null } : {}),
      ...(preferredContactApp !== undefined ? { preferredContactApp: preferredContactApp || null } : {}),
      ...(contactAppId !== undefined ? { contactAppId: normalizeAppId(contactAppId) } : {}),
    },
  });

  // 线索来源/状态更新（该学生已有 Lead 记录才更新）
  if (sourceCategory !== undefined || sourceDetail !== undefined || subjectsOfInterest !== undefined || status !== undefined) {
    await prisma.lead.updateMany({
      where: { studentId: id },
      data: {
        ...(sourceCategory !== undefined ? { source: sourceCategory ?? "OTHER", sourceCategory: sourceCategory ?? null } : {}),
        ...(sourceDetail !== undefined ? { sourceDetail: sourceDetail?.trim() || null } : {}),
        ...(subjectsOfInterest !== undefined ? { subjectsOfInterest: subjectsOfInterest?.trim() || null } : {}),
        ...(status !== undefined ? { status } : {}),
      },
    });
  }

  const updated = await prisma.student.findUnique({
    where: { id },
    include: { grade: true, campus: true, leadInfo: true },
  });
  return NextResponse.json(updated);
}
