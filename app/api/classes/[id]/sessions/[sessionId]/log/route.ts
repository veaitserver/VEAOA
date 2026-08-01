import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canSubmitLog, denyCrossCampus, hasRole, type SessionUser } from "@/lib/permissions";
import { GroupSessionStatus, Role } from "@/lib/enums";
import { z } from "zod";

const schema = z.object({ notes: z.string().min(1).max(2000) });

/**
 * 老师提交班课反馈 —— 整班一条（业务规则），不逐人写。
 * 只有该课次的授课老师本人（或超管）能写，防止替别人的课写反馈。
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canSubmitLog(sessionUser)) {
    return NextResponse.json({ error: "仅老师可提交上课反馈" }, { status: 403 });
  }

  const { id, sessionId } = await params;
  const s = await prisma.groupSession.findUnique({
    where: { id: sessionId },
    include: { class: { select: { id: true, campusId: true } } },
  });
  if (!s || s.class.id !== id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, s.class.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  if (s.teacherId !== sessionUser.id && !hasRole(sessionUser, Role.SUPER_ADMIN)) {
    return NextResponse.json({ error: "只能为自己的课提交反馈" }, { status: 403 });
  }
  if (s.status === GroupSessionStatus.CONFIRMED) {
    return NextResponse.json({ error: "该课次已核销，不能再改反馈" }, { status: 400 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const updated = await prisma.groupSession.update({
    where: { id: sessionId },
    data: {
      notes: parsed.data.notes.trim(),
      loggedById: sessionUser.id,
      loggedAt: new Date(),
      status: GroupSessionStatus.LOGGED,
    },
  });

  return NextResponse.json(updated);
}
