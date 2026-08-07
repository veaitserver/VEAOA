import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { campusScope, canViewSchedule, ownScheduleScope, type SessionUser } from "@/lib/permissions";

/**
 * 课表页的老师列表（按校区收敛）。
 *
 * 排课日历原先用 /api/admin/users 拉老师，而那个接口只对 HR/超管开放，
 * 于是真正排课的教务/校长打开日历是空的。这里给课表页一个专用只读接口，
 * 只返回本校区在职老师的姓名与校区，不含账号等敏感信息。
 *
 * 纯老师只能拿到自己这一条 —— 他看的是自己的课表，不该看到同事的排班。
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canViewSchedule(sessionUser)) {
    return NextResponse.json({ error: "无权查看课表" }, { status: 403 });
  }

  const scope = campusScope(sessionUser);
  const own = ownScheduleScope(sessionUser);
  const teachers = await prisma.user.findMany({
    where: {
      isActive: true,
      roles: { some: { role: "TEACHER" } },
      ...(scope ? { campuses: { some: { campusId: scope } } } : {}),
      ...(own ? { id: own.teacherId } : {}),
    },
    select: {
      id: true,
      name: true,
      roles: { select: { role: true } },
      campuses: { select: { campus: { select: { id: true, name: true } } } },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(teachers);
}
