import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { campusScope, canManageStudents, denyCrossCampus, type SessionUser } from "@/lib/permissions";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(8),
  gradeId: z.string().min(1),
  publicSchool: z.string().optional(),
  salesId: z.string().optional(),
  campusId: z.string().min(1),
  leadSource: z.enum(["OUTREACH", "REFERRAL", "AD", "OTHER"]).optional(),
});

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const campusId = searchParams.get("campusId");
  const search = searchParams.get("search") ?? "";
  const status = searchParams.get("status"); // "lead" | "enrolled" | null

  const sessionUser = session.user as SessionUser;

  const where: Record<string, unknown> = {};
  const scope = campusScope(sessionUser, campusId);
  if (scope) where.campusId = scope;
  if (search) where.OR = [
    { name: { contains: search } },
    { phone: { contains: search } },
  ];

  const students = await prisma.student.findMany({
    where,
    include: {
      grade: true,
      campus: true,
      sales: { select: { id: true, name: true } },
      leadInfo: true,
      packages: {
        where: { status: "ACTIVE" },
        select: { id: true, remainingHours: true, status: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const enriched = students.map(s => ({
    ...s,
    isEnrolled: s.packages.length > 0,
  })).filter(s => {
    if (status === "lead") return !s.isEnrolled;
    if (status === "enrolled") return s.isEnrolled;
    return true;
  });

  return NextResponse.json(enriched);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canManageStudents(sessionUser)) {
    return NextResponse.json({ error: "无权建立学生档案" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const { name, phone, gradeId, publicSchool, salesId, campusId, leadSource } = parsed.data;

  // campusId 来自请求体，不校验就能往任何校区塞学生。
  const denied = denyCrossCampus(sessionUser, campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  const existing = await prisma.student.findUnique({ where: { phone } });
  if (existing) return NextResponse.json({ error: "该手机号已存在" }, { status: 409 });

  const student = await prisma.student.create({
    data: {
      name, phone, gradeId, publicSchool, campusId,
      salesId: salesId || null,
      leadInfo: leadSource ? { create: { source: leadSource } } : undefined,
    },
    include: { grade: true, campus: true },
  });

  return NextResponse.json(student, { status: 201 });
}
