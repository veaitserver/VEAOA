import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isSuperAdmin, type SessionUser } from "@/lib/permissions";
import { z } from "zod";

const schema = z.object({ name: z.string().min(1) });

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuperAdmin(session.user as SessionUser)) return NextResponse.json({ error: "仅超级管理员可管理校区" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const campus = await prisma.campus.update({ where: { id }, data: { name: parsed.data.name } });
  return NextResponse.json(campus);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuperAdmin(session.user as SessionUser)) return NextResponse.json({ error: "仅超级管理员可管理校区" }, { status: 403 });

  const { id } = await params;
  // 有学生/教室/员工归属的校区不能删，避免破坏关联数据。
  const [students, classrooms, users] = await Promise.all([
    prisma.student.count({ where: { campusId: id } }),
    prisma.classroom.count({ where: { campusId: id } }),
    prisma.userCampus.count({ where: { campusId: id } }),
  ]);
  if (students > 0 || classrooms > 0 || users > 0) {
    return NextResponse.json(
      { error: `该校区仍有 ${students} 名学生 / ${classrooms} 间教室 / ${users} 名员工，无法删除` },
      { status: 400 },
    );
  }
  await prisma.campus.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
