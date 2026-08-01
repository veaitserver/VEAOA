import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageGroupClass, denyCrossCampus, type SessionUser } from "@/lib/permissions";

/**
 * 移出班级成员（退班）。
 *
 * 上过课的成员只标记 leftAt（保留历史，其考勤与扣课记录仍要能追溯）；
 * 从没上过课的直接删掉，避免班级里留一堆没意义的空记录。
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canManageGroupClass(sessionUser)) {
    return NextResponse.json({ error: "仅教务/校长可管理班级成员" }, { status: 403 });
  }

  const { id, memberId } = await params;
  const member = await prisma.groupClassMember.findUnique({
    where: { id: memberId },
    include: { class: { select: { id: true, campusId: true } } },
  });
  if (!member || member.class.id !== id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const denied = denyCrossCampus(sessionUser, member.class.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  if (member.leftAt) {
    return NextResponse.json({ error: "该成员已退班" }, { status: 400 });
  }

  const attended = await prisma.groupSessionAttendance.count({
    where: { studentId: member.studentId, session: { classId: id } },
  });

  if (attended > 0) {
    const updated = await prisma.groupClassMember.update({
      where: { id: memberId },
      data: { leftAt: new Date() },
    });
    return NextResponse.json({ ok: true, mode: "left", member: updated });
  }

  await prisma.groupClassMember.delete({ where: { id: memberId } });
  return NextResponse.json({ ok: true, mode: "removed" });
}
