import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageCampaigns, denyCrossCampus, type SessionUser } from "@/lib/permissions";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  sourceDetail: z.string().min(1).optional(),
  active: z.boolean().optional(),
  defaultOwnerId: z.string().nullable().optional(),
});

async function loadOwned(sessionUser: SessionUser, id: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) return { error: "Not found", status: 404 as const };
  const denied = denyCrossCampus(sessionUser, campaign.campusId);
  if (denied) return { error: denied, status: 403 as const };
  return { campaign };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sessionUser = session.user as SessionUser;
  if (!canManageCampaigns(sessionUser)) return NextResponse.json({ error: "无权管理营销活动" }, { status: 403 });

  const { id } = await params;
  const owned = await loadOwned(sessionUser, id);
  if (owned.error) return NextResponse.json({ error: owned.error }, { status: owned.status });

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  if (parsed.data.defaultOwnerId) {
    const owner = await prisma.user.findFirst({
      where: { id: parsed.data.defaultOwnerId, isActive: true, roles: { some: { role: "SALES" } }, campuses: { some: { campusId: owned.campaign!.campusId } } },
      select: { id: true },
    });
    if (!owner) return NextResponse.json({ error: "默认负责人不属于该校区或已停用" }, { status: 400 });
  }

  const updated = await prisma.campaign.update({
    where: { id },
    data: parsed.data,
    include: { campus: { select: { name: true } }, defaultOwner: { select: { name: true } }, _count: { select: { leads: true } } },
  });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sessionUser = session.user as SessionUser;
  if (!canManageCampaigns(sessionUser)) return NextResponse.json({ error: "无权管理营销活动" }, { status: 403 });

  const { id } = await params;
  const owned = await loadOwned(sessionUser, id);
  if (owned.error) return NextResponse.json({ error: owned.error }, { status: owned.status });

  // 已有线索的活动不物理删除，仅停用，避免破坏线索来源溯源。
  const leadCount = await prisma.lead.count({ where: { campaignId: id } });
  if (leadCount > 0) {
    await prisma.campaign.update({ where: { id }, data: { active: false } });
    return NextResponse.json({ ok: true, softDeleted: true });
  }
  await prisma.campaign.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
