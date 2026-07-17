import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canSubmitLog, denyCrossCampus, isSuperAdmin, type SessionUser } from "@/lib/permissions";
import { z } from "zod";

const schema = z.object({
  subjectId: z.string().min(1),
  notes: z.string().min(1, "上课日志不能为空"),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canSubmitLog(sessionUser)) {
    return NextResponse.json({ error: "仅老师可提交上课日志" }, { status: 403 });
  }

  const { id } = await params;
  const lesson = await prisma.scheduledLesson.findUnique({
    where: { id },
    include: { log: true, student: { select: { campusId: true } } },
  });
  if (!lesson) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, lesson.student.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  // 下面 create 时 teacherId 记的是调用者，不是 lesson.teacherId ——
  // 不校验归属，老师就能把别人的课记成自己的工时，并顺带占掉那节课的日志位。
  if (!isSuperAdmin(sessionUser) && lesson.teacherId !== sessionUser.id) {
    return NextResponse.json({ error: "只能为自己的课程提交日志" }, { status: 403 });
  }

  if (lesson.log) return NextResponse.json({ error: "已提交日志" }, { status: 400 });

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const log = await prisma.lessonLog.create({
    data: {
      lessonId: id,
      teacherId: sessionUser.id,
      subjectId: parsed.data.subjectId,
      notes: parsed.data.notes,
    },
  });

  return NextResponse.json(log, { status: 201 });
}
