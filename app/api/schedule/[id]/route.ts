import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canSchedule, denyCrossCampus, type SessionUser } from "@/lib/permissions";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canSchedule(sessionUser)) {
    return NextResponse.json({ error: "无权删除课程" }, { status: 403 });
  }

  const { id } = await params;
  const lesson = await prisma.scheduledLesson.findUnique({
    where: { id },
    include: { log: true, student: { select: { campusId: true } } },
  });
  if (!lesson) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, lesson.student.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  if (lesson.log) return NextResponse.json({ error: "已提交日志的课程不能删除" }, { status: 400 });

  await prisma.scheduledLesson.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
