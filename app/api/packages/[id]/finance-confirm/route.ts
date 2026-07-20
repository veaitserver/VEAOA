import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canFinanceConfirmPackage, denyCrossCampus, type SessionUser } from "@/lib/permissions";

/**
 * 财务二次确认课包：校长确认(PENDING_FINANCE) → 财务确认 → 正式生效(ACTIVE)。
 * 生效后才能排课。
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canFinanceConfirmPackage(sessionUser)) {
    return NextResponse.json({ error: "仅财务或超管可确认生效" }, { status: 403 });
  }

  const { id } = await params;
  const pkg = await prisma.coursePackage.findUnique({
    where: { id },
    include: { student: { select: { campusId: true } } },
  });
  if (!pkg) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, pkg.student.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  if (pkg.status !== "PENDING_FINANCE") {
    return NextResponse.json({ error: "课包不是待财务确认状态" }, { status: 400 });
  }

  const updated = await prisma.coursePackage.update({
    where: { id },
    data: {
      status: "ACTIVE",
      financeConfirmedById: sessionUser.id,
      financeConfirmedAt: new Date(),
    },
  });

  return NextResponse.json(updated);
}
