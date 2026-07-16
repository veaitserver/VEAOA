import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canConfirmPackage, denyCrossCampus, type SessionUser } from "@/lib/permissions";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canConfirmPackage(sessionUser)) {
    return NextResponse.json({ error: "仅校长或超管可确认课包" }, { status: 403 });
  }

  const { id } = await params;
  const pkg = await prisma.coursePackage.findUnique({
    where: { id },
    include: { student: { select: { campusId: true } } },
  });
  if (!pkg) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // 角色对了不代表校区对了：Markham 校长不该批 Richmond Hill 的单。
  const denied = denyCrossCampus(sessionUser, pkg.student.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  if (pkg.status !== "PENDING_APPROVAL") {
    return NextResponse.json({ error: "课包已不是待确认状态" }, { status: 400 });
  }

  const updated = await prisma.coursePackage.update({
    where: { id },
    data: {
      status: "ACTIVE",
      confirmedById: sessionUser.id,
      confirmedAt: new Date(),
    },
  });

  return NextResponse.json(updated);
}
