import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageUsers, isSuperAdmin, type SessionUser } from "@/lib/permissions";
import type { Role } from "@/lib/enums";
import { z } from "zod";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // 全局基础数据（跨校区）：仅超管可删，且不能删仍被引用的年级（否则外键报 500）。
  if (!isSuperAdmin(session.user as SessionUser)) return NextResponse.json({ error: "仅超管可删除年级" }, { status: 403 });

  const { id } = await params;
  const inUse = await prisma.student.count({ where: { gradeId: id } })
    + await prisma.coursePackage.count({ where: { gradeId: id } });
  if (inUse > 0) return NextResponse.json({ error: "该年级仍被学生或课包引用，不能删除" }, { status: 400 });

  await prisma.grade.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = session.user as { roles: Role[]; campusIds: string[]; id: string; name: string };
  if (!canManageUsers(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const schema = z.object({ name: z.string().min(1) });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const grade = await prisma.grade.update({ where: { id }, data: { name: parsed.data.name } });
  return NextResponse.json(grade);
}
