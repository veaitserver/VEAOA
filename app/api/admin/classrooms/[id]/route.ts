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
  // 已被引用的教室不能删，否则会破坏历史课程/核销数据。
  //
  // 三张表都要数：classroomId 现在是可空外键（线上课不占教室），外键动作因此
  // 是 SET NULL 而非 RESTRICT —— 数据库不再兜底，漏数哪一张，删除就会把那批
  // 记录的上课地点静默清空。班课课次曾经就是这么被漏掉的。
  const [lessons, sessions, classes] = await Promise.all([
    prisma.scheduledLesson.count({ where: { classroomId: id } }),
    prisma.groupSession.count({ where: { classroomId: id } }),
    prisma.groupClass.count({ where: { classroomId: id } }),
  ]);
  const refs = [
    lessons && `${lessons} 条一对一排课`,
    sessions && `${sessions} 次班课`,
    classes && `${classes} 个班级把它设为默认教室`,
  ].filter(Boolean);
  if (refs.length) {
    return NextResponse.json({ error: `该教室已被引用（${refs.join("、")}），无法删除` }, { status: 400 });
  }

  await prisma.classroom.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
