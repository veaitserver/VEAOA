import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { campusScope, canCreatePackage, denyCrossCampus, denyNotOwner, ownerFilter, type SessionUser } from "@/lib/permissions";
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

  const sessionUser = session.user as SessionUser;

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (studentId) where.studentId = studentId;
  const scope = campusScope(sessionUser);
  const owner = ownerFilter(sessionUser);
  const studentWhere: Record<string, unknown> = {};
  if (scope) studentWhere.campusId = scope;
  if (owner) studentWhere.salesId = owner.salesId; // 销售只看自己名下学生的课包
  if (Object.keys(studentWhere).length) where.student = studentWhere;

  const packages = await prisma.coursePackage.findMany({
    where,
    include: {
      student: { select: { id: true, name: true, campusId: true } },
      grade: true,
      subject: true,
      creator: { select: { name: true } },
      confirmer: { select: { name: true } },
      deductions: { where: { reversedAt: null }, select: { hoursDeducted: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(packages);
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
    select: { campusId: true, salesId: true },
  });
  if (!student) return NextResponse.json({ error: "学生不存在" }, { status: 404 });
  const denied = denyCrossCampus(sessionUser, student.campusId) ?? denyNotOwner(sessionUser, student.salesId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

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
