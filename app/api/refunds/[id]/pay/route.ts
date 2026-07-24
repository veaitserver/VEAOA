import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canPayRefund, denyCrossCampus, type SessionUser } from "@/lib/permissions";
import { settlableHours } from "@/lib/settlement";
import { recordEntries, refundDrafts } from "@/lib/ledger";
import { roundHours } from "@/lib/hours";
import { roundMoney } from "@/lib/money";

class RefundError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/**
 * 退费第二步：财务复核并实际打款 —— 这一刻才结算。
 *
 * 同一事务内：推进状态 → 扣减课包 → 写账本两条流水（退课入账 + 退款打出）。
 * 课包同时减 totalHours / totalAmount / remainingHours，保持
 * 「总价 = 总课时 × 单价」与「剩余 = 总课时 − 已消耗」两条不变量，
 * 否则财务后续编辑课包时会把已退的课时又算回来。
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canPayRefund(sessionUser)) {
    return NextResponse.json({ error: "仅财务可复核打款" }, { status: 403 });
  }

  const { id } = await params;
  const refund = await prisma.refundRequest.findUnique({
    where: { id },
    include: {
      student: { select: { id: true, campusId: true } },
      package: true,
    },
  });
  if (!refund) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, refund.student.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  const hours = roundHours(Number(refund.hours));
  const amount = roundMoney(Number(refund.amount));

  try {
    await prisma.$transaction(async (tx) => {
      // 幂等门闩：并发/重复点击只有一次能打款。
      const gate = await tx.refundRequest.updateMany({
        where: { id, status: "PENDING_FINANCE" },
        data: { status: "PAID", paidById: sessionUser.id, paidAt: new Date() },
      });
      if (gate.count === 0) throw new RefundError(400, "该申请不是待财务打款状态");

      // 审批期间学生可能又排了课，打款前按当下重新核一遍可退上限。
      const settlable = await settlableHours(tx, refund.package);
      if (hours > settlable.hours) {
        throw new RefundError(400, `可退课时不足（剩余 ${settlable.remainingHours}h，已排未核销 ${settlable.pendingHours}h，最多可退 ${settlable.hours}h），请驳回后重新申请`);
      }

      const updated = await tx.coursePackage.updateMany({
        where: { id: refund.packageId, remainingHours: { gte: hours } },
        data: {
          remainingHours: { decrement: hours },
          totalHours: { decrement: hours },
          totalAmount: { decrement: amount },
        },
      });
      if (updated.count === 0) throw new RefundError(400, "课包剩余课时不足，无法退费");

      await recordEntries(tx, sessionUser.id, refundDrafts({
        studentId: refund.student.id,
        packageId: refund.packageId,
        refundId: refund.id,
        amount,
        hours,
      }));
    });
  } catch (e) {
    if (e instanceof RefundError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  return NextResponse.json(await prisma.refundRequest.findUnique({ where: { id } }));
}
