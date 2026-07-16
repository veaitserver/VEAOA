import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageUsers } from "@/lib/permissions";
import type { Role } from "@/lib/enums";
import { z } from "zod";

const schema = z.object({ name: z.string().min(1, "科目名称不能为空") });

export async function GET() {
  // 科目是全局基础数据，任何登录用户（开课包、写日志）都要读，故只校验登录。
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const subjects = await prisma.subject.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json(subjects);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = session.user as { roles: Role[]; campusIds: string[]; id: string; name: string };
  if (!canManageUsers(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const subject = await prisma.subject.create({ data: { name: parsed.data.name } });
  return NextResponse.json(subject, { status: 201 });
}
