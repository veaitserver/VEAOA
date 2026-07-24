import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canApproveRefund, denyCrossCampus, type SessionUser } from "@/lib/permissions";

/** 退费第一步：校长审核 → 转待财务打款。此刻仍不动课时。 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canApproveRefund(sessionUser)) {
    return NextResponse.json({ error: "仅校长可审核退费" }, { status: 403 });
  }

  const { id } = await params;
  const refund = await prisma.refundRequest.findUnique({
    where: { id },
    include: { student: { select: { campusId: true } } },
  });
  if (!refund) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, refund.student.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  // 幂等门闩：并发/重复点击时只有一次能推进状态。
  const gate = await prisma.refundRequest.updateMany({
    where: { id, status: "PENDING_APPROVAL" },
    data: { status: "PENDING_FINANCE", approvedById: sessionUser.id, approvedAt: new Date() },
  });
  if (gate.count === 0) {
    return NextResponse.json({ error: "该申请不是待校长审核状态" }, { status: 400 });
  }

  return NextResponse.json(await prisma.refundRequest.findUnique({ where: { id } }));
}
