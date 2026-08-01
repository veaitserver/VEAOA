import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canReverseDeduction, denyCrossCampus, type SessionUser } from "@/lib/permissions";
import { roundHours } from "@/lib/hours";
import { isDeductionLocked } from "@/lib/lock";
import { GroupSessionStatus } from "@/lib/enums";
import { z } from "zod";

// 不传 packageId = 撤销整节课的全部扣课；传了 = 只退某个成员那一笔
// （请假成员默认照扣，需要免扣时用它单独退回）。
const schema = z.object({ packageId: z.string().min(1).optional() });

class ReverseError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canReverseDeduction(sessionUser)) {
    return NextResponse.json({ error: "仅财务/超管可撤销核销" }, { status: 403 });
  }

  const { id, sessionId } = await params;
  const s = await prisma.groupSession.findUnique({
    where: { id: sessionId },
    include: {
      class: { select: { id: true, campusId: true } },
      deductions: { where: { reversedAt: null } },
    },
  });
  if (!s || s.class.id !== id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, s.class.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const targets = parsed.data.packageId
    ? s.deductions.filter((d) => d.packageId === parsed.data.packageId)
    : s.deductions;
  if (!targets.length) {
    return NextResponse.json({ error: "没有可撤销的扣课记录" }, { status: 400 });
  }

  // 财务锁与一对一同一套：确认满一周自动锁定，需先解锁。
  const locked = targets.find((d) => isDeductionLocked(d));
  if (locked) {
    return NextResponse.json({ error: "该扣课已锁定（确认满一周），请财务先解锁再撤销" }, { status: 403 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      for (const d of targets) {
        const reversed = await tx.courseDeduction.updateMany({
          where: { id: d.id, reversedAt: null },
          data: { reversedAt: new Date(), reversedById: sessionUser.id },
        });
        if (reversed.count === 0) throw new ReverseError(400, "该扣课已撤销");
        await tx.coursePackage.update({
          where: { id: d.packageId },
          data: { remainingHours: { increment: roundHours(Number(d.hoursDeducted)) } },
        });
      }

      // 整节课都撤销后退回「待确认」，可重新核销；只撤个别成员则保持已核销。
      const stillActive = await tx.courseDeduction.count({
        where: { groupSessionId: sessionId, reversedAt: null },
      });
      if (stillActive === 0) {
        await tx.groupSession.update({
          where: { id: sessionId },
          data: { status: GroupSessionStatus.LOGGED, confirmedById: null, confirmedAt: null },
        });
      }
    });
  } catch (e) {
    if (e instanceof ReverseError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  return NextResponse.json({ ok: true, reversed: targets.length });
}
