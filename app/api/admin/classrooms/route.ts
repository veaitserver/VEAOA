import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isSuperAdmin, type SessionUser } from "@/lib/permissions";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1),
  campusId: z.string().min(1),
  capacity: z.number().int().positive().optional().nullable(),
});

// 教室管理仅限超级管理员。
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuperAdmin(session.user as SessionUser)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const classrooms = await prisma.classroom.findMany({
    include: { campus: { select: { name: true } }, _count: { select: { lessons: true } } },
    orderBy: [{ campusId: "asc" }, { name: "asc" }],
  });
  return NextResponse.json(classrooms);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuperAdmin(session.user as SessionUser)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const campus = await prisma.campus.findUnique({ where: { id: parsed.data.campusId }, select: { id: true } });
  if (!campus) return NextResponse.json({ error: "校区不存在" }, { status: 400 });

  const classroom = await prisma.classroom.create({
    data: { name: parsed.data.name, campusId: parsed.data.campusId, capacity: parsed.data.capacity ?? null },
    include: { campus: { select: { name: true } }, _count: { select: { lessons: true } } },
  });
  return NextResponse.json(classroom, { status: 201 });
}
