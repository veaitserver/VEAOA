import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageCampaigns, denyCrossCampus, type SessionUser } from "@/lib/permissions";

/**
 * 活动默认负责人下拉的数据源：某校区的活跃销售。
 * 校长无权调用 /api/admin/users，故单开这个受限端点。
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sessionUser = session.user as SessionUser;
  if (!canManageCampaigns(sessionUser)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const campusId = new URL(req.url).searchParams.get("campusId");
  if (!campusId) return NextResponse.json({ error: "缺少 campusId" }, { status: 400 });
  const denied = denyCrossCampus(sessionUser, campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  const sales = await prisma.user.findMany({
    where: { isActive: true, roles: { some: { role: "SALES" } }, campuses: { some: { campusId } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(sales);
}
