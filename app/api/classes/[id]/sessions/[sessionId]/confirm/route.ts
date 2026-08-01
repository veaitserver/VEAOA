import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canConfirmLog, denyCrossCampus, type SessionUser } from "@/lib/permissions";
import { lessonHours, roundHours } from "@/lib/hours";
import { GroupSessionStatus } from "@/lib/enums";

class ConfirmError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/**
 * 核销一次班课 —— 全班每个在册成员各扣一次课时。
 *
 * 一次操作产生多条扣课记录，必须同一事务：不能出现「有人扣了有人没扣」。
 * 请假的成员仍然扣（座位已占，业务规则），需要免扣时用
 * 「撤销该成员扣课」单独退回那一笔。
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canConfirmLog(sessionUser)) {
    return NextResponse.json({ error: "仅教务/校长可确认核销" }, { status: 403 });
  }

  const { id, sessionId } = await params;
  const s = await prisma.groupSession.findUnique({
    where: { id: sessionId },
    include: {
      class: { select: { id: true, campusId: true } },
      attendances: { include: { student: { select: { name: true } } } },
      deductions: { where: { reversedAt: null }, select: { id: true } },
    },
  });
  if (!s || s.class.id !== id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, s.class.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  if (!s.notes) {
    return NextResponse.json({ error: "老师尚未提交上课反馈" }, { status: 400 });
  }
  if (s.deductions.length > 0) {
    return NextResponse.json({ error: "该课次已核销" }, { status: 400 });
  }
  if (!s.attendances.length) {
    return NextResponse.json({ error: "该课次没有成员名单" }, { status: 400 });
  }

  const durationHours = lessonHours(s.startTime, s.endTime);
  if (!(durationHours > 0)) {
    return NextResponse.json({ error: "课程时长非法，无法核销" }, { status: 400 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      // 幂等门闩：并发确认只有一次能推进状态。
      const gate = await tx.groupSession.updateMany({
        where: { id: sessionId, status: { not: GroupSessionStatus.CONFIRMED } },
        data: {
          status: GroupSessionStatus.CONFIRMED,
          confirmedById: sessionUser.id,
          confirmedAt: new Date(),
        },
      });
      if (gate.count === 0) throw new ConfirmError(400, "该课次已核销");

      // 逐个成员扣课；任何一人余额不足则整体回滚，避免半扣状态。
      for (const att of s.attendances) {
        const decremented = await tx.coursePackage.updateMany({
          where: { id: att.packageId, remainingHours: { gte: durationHours } },
          data: { remainingHours: { decrement: durationHours } },
        });
        if (decremented.count === 0) {
          throw new ConfirmError(400, `${att.student.name} 的课包余额不足 ${durationHours}h，无法核销`);
        }
        await tx.courseDeduction.create({
          data: {
            packageId: att.packageId,
            groupSessionId: sessionId,
            hoursDeducted: durationHours,
          },
        });
      }
    });
  } catch (e) {
    if (e instanceof ConfirmError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const result = await prisma.groupSession.findUnique({
    where: { id: sessionId },
    include: {
      attendances: { include: { student: { select: { id: true, name: true } } } },
      deductions: { select: { id: true, packageId: true, hoursDeducted: true, reversedAt: true } },
    },
  });
  return NextResponse.json({
    ...result,
    deductedCount: result?.deductions.filter((d) => !d.reversedAt).length ?? 0,
    hoursEach: roundHours(durationHours),
  });
}
