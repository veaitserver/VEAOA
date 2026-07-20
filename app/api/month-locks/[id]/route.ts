import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageMonthLock, denyCrossCampus, type SessionUser } from "@/lib/permissions";

/** 解锁（撤销某校区某月的锁账）。财务/超管。 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sessionUser = session.user as SessionUser;
  if (!canManageMonthLock(sessionUser)) return NextResponse.json({ error: "无权管理月度锁账" }, { status: 403 });

  const { id } = await params;
  const lock = await prisma.monthLock.findUnique({ where: { id }, select: { campusId: true } });
  if (!lock) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const denied = denyCrossCampus(sessionUser, lock.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  await prisma.monthLock.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
