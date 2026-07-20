import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canReverseDeduction, denyCrossCampus, type SessionUser } from "@/lib/permissions";

/**
 * 财务解锁一条已自动锁定的核销，之后即可撤销更正。仅财务/超管。
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canReverseDeduction(sessionUser)) {
    return NextResponse.json({ error: "仅财务/超管可解锁核销" }, { status: 403 });
  }

  const { id } = await params;
  const lesson = await prisma.scheduledLesson.findUnique({
    where: { id },
    include: {
      log: { include: { deductions: true } },
      student: { select: { campusId: true } },
    },
  });
  if (!lesson) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, lesson.student.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  const active = lesson.log?.deductions.find((d) => !d.reversedAt);
  if (!active) return NextResponse.json({ error: "该课程未核销" }, { status: 400 });

  const updated = await prisma.courseDeduction.update({
    where: { id: active.id },
    data: { financeUnlockedAt: new Date(), financeUnlockedById: sessionUser.id },
  });
  return NextResponse.json(updated);
}
