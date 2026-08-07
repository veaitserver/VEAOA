import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { campusScope, canViewLiabilityReport, type SessionUser } from "@/lib/permissions";
import { buildLiabilityReport } from "@/lib/liability";

/**
 * 剩余课时负债报表（预收未消耗）。口径见 lib/liability。
 * 校长只看本校区，财务/超管看全部。
 */
export async function GET(_req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canViewLiabilityReport(sessionUser)) {
    return NextResponse.json({ error: "无权查看负债报表" }, { status: 403 });
  }

  const report = await buildLiabilityReport(prisma, { campusScope: campusScope(sessionUser) });
  return NextResponse.json(report);
}
