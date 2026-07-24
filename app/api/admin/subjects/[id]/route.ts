import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageUsers, isSuperAdmin, type SessionUser } from "@/lib/permissions";
import type { Role } from "@/lib/enums";
import { z } from "zod";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuperAdmin(session.user as SessionUser)) return NextResponse.json({ error: "仅超管可删除科目" }, { status: 403 });
  const { id } = await params;
  const inUse = await prisma.coursePackage.count({ where: { subjectId: id } })
    + await prisma.lessonLog.count({ where: { subjectId: id } });
  if (inUse > 0) return NextResponse.json({ error: "该科目仍被课包或上课记录引用，不能删除" }, { status: 400 });
  await prisma.subject.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = session.user as { roles: Role[]; campusIds: string[]; id: string; name: string };
  if (!canManageUsers(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await req.json();
  const parsed = z.object({ name: z.string().min(1) }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const subject = await prisma.subject.update({ where: { id }, data: { name: parsed.data.name } });
  return NextResponse.json(subject);
}
