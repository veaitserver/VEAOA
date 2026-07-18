import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { campusScope, canManageCampaigns, denyCrossCampus, type SessionUser } from "@/lib/permissions";
import { generateToken } from "@/lib/token";
import { SourceCategory } from "@/lib/enums";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1),
  sourceCategory: z.nativeEnum(SourceCategory),
  sourceDetail: z.string().min(1),
  campusId: z.string().min(1),
  defaultOwnerId: z.string().optional().nullable(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sessionUser = session.user as SessionUser;
  if (!canManageCampaigns(sessionUser)) return NextResponse.json({ error: "无权管理营销活动" }, { status: 403 });

  const scope = campusScope(sessionUser);
  const campaigns = await prisma.campaign.findMany({
    where: scope ? { campusId: scope } : {},
    include: {
      campus: { select: { name: true } },
      defaultOwner: { select: { name: true } },
      _count: { select: { leads: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(campaigns);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sessionUser = session.user as SessionUser;
  if (!canManageCampaigns(sessionUser)) return NextResponse.json({ error: "无权管理营销活动" }, { status: 403 });

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const { name, sourceCategory, sourceDetail, campusId, defaultOwnerId } = parsed.data;

  // 校区必须是本人有权的（多校区校长在前端弹选，这里兜底校验）。
  const denied = denyCrossCampus(sessionUser, campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  // 默认负责人（若指定）须为该校区的活跃用户。
  if (defaultOwnerId) {
    const owner = await prisma.user.findFirst({
      where: { id: defaultOwnerId, isActive: true, campuses: { some: { campusId } } },
      select: { id: true },
    });
    if (!owner) return NextResponse.json({ error: "默认负责人不属于该校区或已停用" }, { status: 400 });
  }

  const campaign = await prisma.campaign.create({
    data: {
      name, sourceCategory, sourceDetail, campusId,
      defaultOwnerId: defaultOwnerId || null,
      token: generateToken(),
    },
    include: { campus: { select: { name: true } }, defaultOwner: { select: { name: true } }, _count: { select: { leads: true } } },
  });
  return NextResponse.json(campaign, { status: 201 });
}
