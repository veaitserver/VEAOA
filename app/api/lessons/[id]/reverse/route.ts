import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canReverseDeduction, denyCrossCampus, type SessionUser } from "@/lib/permissions";
import { roundHours } from "@/lib/hours";

class AlreadyReversed extends Error {}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canReverseDeduction(sessionUser)) {
    return NextResponse.json({ error: "仅财务/超管可撤销核销" }, { status: 403 });
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

  // 生效中的扣课记录 = reversedAt 为空的那条。撤销后又重新核销会有多条，只撤最新生效的。
  const active = lesson.log?.deductions.find((d) => !d.reversedAt);
  if (!active) return NextResponse.json({ error: "该课程未核销" }, { status: 400 });

  const hoursDeducted = roundHours(Number(active.hoursDeducted));
  const log = lesson.log!;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 双击撤销防护：updateMany + reversedAt:null 谓词，count === 0 说明另一并发请求
      // 已经撤销过，直接回滚，避免课时被重复加回。
      const reversed = await tx.courseDeduction.updateMany({
        where: { id: active.id, reversedAt: null },
        data: { reversedAt: new Date(), reversedById: sessionUser.id },
      });
      if (reversed.count === 0) throw new AlreadyReversed();

      await tx.coursePackage.update({
        where: { id: lesson.packageId },
        data: { remainingHours: { increment: hoursDeducted } },
      });

      await tx.lessonLog.update({
        where: { id: log.id },
        data: { confirmedById: null, confirmedAt: null },
      });

      return tx.courseDeduction.findUnique({ where: { id: active.id } });
    });

    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof AlreadyReversed) {
      return NextResponse.json({ error: "该核销已撤销" }, { status: 400 });
    }
    throw e;
  }
}
