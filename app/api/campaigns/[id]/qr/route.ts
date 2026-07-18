import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageCampaigns, denyCrossCampus, type SessionUser } from "@/lib/permissions";
import QRCode from "qrcode";

/** 返回 campaign 公开链接 /join/{token} 的二维码 PNG，供活动详情页打印海报用。 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sessionUser = session.user as SessionUser;
  if (!canManageCampaigns(sessionUser)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const campaign = await prisma.campaign.findUnique({ where: { id }, select: { token: true, campusId: true } });
  if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const denied = denyCrossCampus(sessionUser, campaign.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  const origin = process.env.NEXTAUTH_URL || new URL(req.url).origin;
  const url = `${origin}/join/${campaign.token}`;
  const png = await QRCode.toBuffer(url, { width: 320, margin: 1, errorCorrectionLevel: "M" });

  return new NextResponse(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
}
