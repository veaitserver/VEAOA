import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageCampaigns, denyCrossCampus, type SessionUser } from "@/lib/permissions";
import { fsa } from "@/lib/leadImport";
import { deriveStage } from "@/lib/leadLabels";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sessionUser = session.user as SessionUser;
  if (!canManageCampaigns(sessionUser)) return NextResponse.json({ error: "无权查看活动报表" }, { status: 403 });

  const { id } = await params;
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: { campus: { select: { name: true } }, defaultOwner: { select: { name: true } } },
  });
  if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const denied = denyCrossCampus(sessionUser, campaign.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  const leads = await prisma.lead.findMany({
    where: { campaignId: id },
    include: {
      student: {
        select: {
          postalCode: true,
          // 取全部课包以派生阶段（在读/已结课都算已转化）。业务流不变。
          packages: { select: { status: true, remainingHours: true } },
        },
      },
    },
  });

  const captured = leads.length;
  const stageOf = (l: (typeof leads)[number]) => deriveStage(l.student.packages, { source: "", status: l.status });
  // 转化 = 已成为学生（在读或已结课）
  const enrolled = leads.filter((l) => ["ENROLLED", "COMPLETED"].includes(stageOf(l))).length;

  const byStatus: Record<string, number> = { NEW: 0, CONTACTED: 0, LOST: 0, ENROLLED: 0, COMPLETED: 0 };
  const byFsa: Record<string, number> = {};
  for (const l of leads) {
    const st = stageOf(l);
    byStatus[st] = (byStatus[st] ?? 0) + 1;
    const region = fsa(l.student.postalCode) ?? "未知";
    byFsa[region] = (byFsa[region] ?? 0) + 1;
  }

  return NextResponse.json({
    campaign: {
      id: campaign.id, name: campaign.name, sourceCategory: campaign.sourceCategory,
      sourceDetail: campaign.sourceDetail, campus: campaign.campus.name,
      defaultOwner: campaign.defaultOwner?.name ?? null, active: campaign.active, token: campaign.token,
    },
    captured,
    enrolled,
    conversionRate: captured > 0 ? enrolled / captured : 0,
    byStatus,
    byFsa: Object.entries(byFsa)
      .map(([region, count]) => ({ region, count }))
      .sort((a, b) => b.count - a.count),
  });
}
