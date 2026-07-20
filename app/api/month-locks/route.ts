import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { campusScope, canManageMonthLock, denyCrossCampus, type SessionUser } from "@/lib/permissions";
import { z } from "zod";

const createSchema = z.object({
  campusId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/, "月份格式应为 YYYY-MM"),
});

/** 列出本人可见校区的锁账记录（财务/超管）。 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sessionUser = session.user as SessionUser;
  if (!canManageMonthLock(sessionUser)) return NextResponse.json({ error: "无权管理月度锁账" }, { status: 403 });

  const scope = campusScope(sessionUser);
  const locks = await prisma.monthLock.findMany({
    where: scope ? { campusId: scope } : {},
    include: { campus: { select: { name: true } }, lockedBy: { select: { name: true } } },
    orderBy: [{ campusId: "asc" }, { month: "desc" }],
  });
  return NextResponse.json(locks);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sessionUser = session.user as SessionUser;
  if (!canManageMonthLock(sessionUser)) return NextResponse.json({ error: "无权管理月度锁账" }, { status: 403 });

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const { campusId, month } = parsed.data;

  const denied = denyCrossCampus(sessionUser, campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  try {
    const lock = await prisma.monthLock.create({
      data: { campusId, month, lockedById: sessionUser.id },
      include: { campus: { select: { name: true } }, lockedBy: { select: { name: true } } },
    });
    return NextResponse.json(lock, { status: 201 });
  } catch (e: unknown) {
    if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "该校区该月已锁账" }, { status: 409 });
    }
    throw e;
  }
}
