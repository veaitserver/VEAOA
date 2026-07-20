import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canConfirmPackage, denyCrossCampus, type SessionUser } from "@/lib/permissions";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canConfirmPackage(sessionUser)) {
    return NextResponse.json({ error: "仅校长或超管可确认课包" }, { status: 403 });
  }

  // 校长确认时可一并分配学管（可选）。
  let studentManagerId: string | null = null;
  try {
    const body = await req.json();
    if (body && typeof body.studentManagerId === "string") studentManagerId = body.studentManagerId || null;
  } catch { /* 无 body 也可 */ }

  const { id } = await params;
  const pkg = await prisma.coursePackage.findUnique({
    where: { id },
    include: { student: { select: { id: true, campusId: true } } },
  });
  if (!pkg) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // 角色对了不代表校区对了：Markham 校长不该批 Richmond Hill 的单。
  const denied = denyCrossCampus(sessionUser, pkg.student.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  if (pkg.status !== "PENDING_APPROVAL") {
    return NextResponse.json({ error: "课包已不是待校长确认状态" }, { status: 400 });
  }

  // 校验学管属于本校区且是活跃学管。
  if (studentManagerId) {
    const mgr = await prisma.user.findFirst({
      where: { id: studentManagerId, isActive: true, roles: { some: { role: "STUDENT_MANAGER" } }, campuses: { some: { campusId: pkg.student.campusId } } },
      select: { id: true },
    });
    if (!mgr) return NextResponse.json({ error: "学管不属于该校区或无效" }, { status: 400 });
  }

  // 校长确认 → 进入待财务确认（还未正式生效，不能排课）；并分配学管到学生。
  const [updated] = await prisma.$transaction([
    prisma.coursePackage.update({
      where: { id },
      data: { status: "PENDING_FINANCE", confirmedById: sessionUser.id, confirmedAt: new Date() },
    }),
    ...(studentManagerId
      ? [prisma.student.update({ where: { id: pkg.student.id }, data: { studentManagerId } })]
      : []),
  ]);

  return NextResponse.json(updated);
}
