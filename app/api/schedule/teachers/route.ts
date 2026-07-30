import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { campusScope, canSchedule, type SessionUser } from "@/lib/permissions";

/**
 * 排课用的老师列表（按校区收敛）。
 *
 * 排课日历原先用 /api/admin/users 拉老师，而那个接口只对 HR/超管开放，
 * 于是真正排课的教务/校长打开日历是空的。这里给排课方一个专用只读接口，
 * 只返回本校区在职老师的姓名与校区，不含账号等敏感信息。
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canSchedule(sessionUser)) {
    return NextResponse.json({ error: "无权查看排课老师列表" }, { status: 403 });
  }

  const scope = campusScope(sessionUser);
  const teachers = await prisma.user.findMany({
    where: {
      isActive: true,
      roles: { some: { role: "TEACHER" } },
      ...(scope ? { campuses: { some: { campusId: scope } } } : {}),
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
