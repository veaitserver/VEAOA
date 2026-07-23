import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageUsers, checkUserGrant, isSuperAdmin, sharesCampusWith, type SessionUser } from "@/lib/permissions";
import { userSelect } from "@/lib/selects";
import { Role } from "@/lib/enums";
import bcrypt from "bcryptjs";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  password: z.string().min(6).optional(),
  roles: z.array(z.nativeEnum(Role)).optional(),
  campusIds: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

/**
 * 超管账号只能由超管这一层动：改密码、改角色、停用都算。
 * 返回 null 表示放行，否则返回要回给客户端的拒绝响应。
 */
async function guardTarget(
  sessionUser: SessionUser,
  id: string,
): Promise<{ error: string; status: 403 | 404 } | null> {
  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, roles: true, campuses: { select: { campusId: true } } },
  });
  if (!target) return { error: "Not found", status: 404 };
  if (!isSuperAdmin(sessionUser)) {
    if (target.roles.some((r) => r.role === Role.SUPER_ADMIN)) {
      return { error: "不能修改超级管理员账号", status: 403 };
    }
    // 校区交集校验：否则 Markham 的 HR 能改 Richmond Hill 校长的密码，跨校区接管账号。
    if (!sharesCampusWith(sessionUser, target.campuses.map((c) => c.campusId))) {
      return { error: "只能管理与自己有共同校区的用户", status: 403 };
    }
  }
  return null;
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sessionUser = session.user as { roles: Role[]; campusIds: string[]; id: string; name: string };
  if (!canManageUsers(sessionUser)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const targetDenied = await guardTarget(sessionUser, id);
  if (targetDenied) return NextResponse.json({ error: targetDenied.error }, { status: targetDenied.status });

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const { name, password, roles, campusIds, isActive } = parsed.data;

  // 非超管不得修改自己的角色/校区（否则 HR 给自己加校长+财务自我提权）。
  if (!isSuperAdmin(sessionUser) && id === sessionUser.id && (roles !== undefined || campusIds !== undefined)) {
    return NextResponse.json({ error: "不能修改自己的角色或校区" }, { status: 403 });
  }

  const grantDenied = checkUserGrant(sessionUser, { roles, campusIds });
  if (grantDenied) return NextResponse.json({ error: grantDenied }, { status: 403 });

  const updates: { name?: string; passwordHash?: string; isActive?: boolean } = {};
  if (name) updates.name = name;
  if (password) updates.passwordHash = await bcrypt.hash(password, 12);
  if (isActive !== undefined) updates.isActive = isActive;

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: updates });
    if (roles) {
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.createMany({ data: roles.map((r) => ({ userId: id, role: r })) });
    }
    if (campusIds) {
      await tx.userCampus.deleteMany({ where: { userId: id } });
      await tx.userCampus.createMany({ data: campusIds.map((campusId) => ({ userId: id, campusId })) });
    }
  });

  const updated = await prisma.user.findUnique({ where: { id }, select: userSelect });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sessionUser = session.user as { roles: Role[]; campusIds: string[]; id: string; name: string };
  if (!canManageUsers(sessionUser)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  if (id === sessionUser.id) {
    return NextResponse.json({ error: "不能停用自己的账号" }, { status: 400 });
  }
  const targetDenied = await guardTarget(sessionUser, id);
  if (targetDenied) return NextResponse.json({ error: targetDenied.error }, { status: targetDenied.status });

  await prisma.user.update({ where: { id }, data: { isActive: false } });
  return NextResponse.json({ ok: true });
}
