import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { campusScope, canManageUsers, type SessionUser } from "@/lib/permissions";
import { z } from "zod";

const schema = z.object({ name: z.string().min(1, "校区名称不能为空") });

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 这份列表同时是建档/建账号表单的下拉数据源，销售也要读，不能按角色一刀切；
  // 但要收敛到本人有权的校区，超管才看得到全部。
  const scope = campusScope(session.user as SessionUser);
  const campuses = await prisma.campus.findMany({
    where: scope ? { id: scope } : {},
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(campuses);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageUsers(session.user as SessionUser)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const campus = await prisma.campus.create({ data: { name: parsed.data.name } });
  return NextResponse.json(campus, { status: 201 });
}
