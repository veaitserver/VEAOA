import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canApproveRefund, canPayRefund, denyCrossCampus, type SessionUser } from "@/lib/permissions";
import { z } from "zod";

const schema = z.object({ reason: z.string().max(500).optional().nullable() });

/** 驳回退费申请：校长可驳回待审核的，财务可驳回待打款的。已打款不能驳回。 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  const { id } = await params;

  const refund = await prisma.refundRequest.findUnique({
    where: { id },
    include: { student: { select: { campusId: true } } },
  });
  if (!refund) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, refund.student.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  // 谁能驳回取决于当前卡在哪一步：待校长审核归校长，待财务打款归财务。
  const allowed = refund.status === "PENDING_APPROVAL"
    ? canApproveRefund(sessionUser)
    : refund.status === "PENDING_FINANCE"
      ? canPayRefund(sessionUser) || canApproveRefund(sessionUser)
      : false;
  if (!allowed) {
    return NextResponse.json({ error: "无权驳回该申请，或申请已结束" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const gate = await prisma.refundRequest.updateMany({
    where: { id, status: { in: ["PENDING_APPROVAL", "PENDING_FINANCE"] } },
    data: {
      status: "REJECTED",
      rejectedById: sessionUser.id,
      rejectedAt: new Date(),
      rejectReason: parsed.data.reason?.trim() || null,
    },
  });
  if (gate.count === 0) return NextResponse.json({ error: "该申请已结束，无法驳回" }, { status: 400 });

  return NextResponse.json(await prisma.refundRequest.findUnique({ where: { id } }));
}
