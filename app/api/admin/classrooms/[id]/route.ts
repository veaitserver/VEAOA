import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isSuperAdmin, type SessionUser } from "@/lib/permissions";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  capacity: z.number().int().positive().nullable().optional(),
});

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuperAdmin(session.user as SessionUser)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const classroom = await prisma.classroom.update({
    where: { id },
    data: parsed.data,
    include: { campus: { select: { name: true } }, _count: { select: { lessons: true } } },
  });
  return NextResponse.json(classroom);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuperAdmin(session.user as SessionUser)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  // 已有排课记录的教室不能删，否则会破坏历史课程/核销数据。
  const lessons = await prisma.scheduledLesson.count({ where: { classroomId: id } });
  if (lessons > 0) {
    return NextResponse.json({ error: `该教室已有 ${lessons} 条排课记录，无法删除` }, { status: 400 });
  }

  await prisma.classroom.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
