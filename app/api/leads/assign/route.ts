import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAssignLeadOwner, denyCrossCampus, type SessionUser } from "@/lib/permissions";
import { z } from "zod";

/**
 * 批量把选中的线索归属到指定销售（校长/超管操作）。
 * 约束：目标线索都须在操作者可见校区；目标销售须在职、是 SALES、且覆盖这些线索所属校区。
 */
const schema = z.object({
  studentIds: z.array(z.string().min(1)).min(1).max(500),
  salesId: z.string().min(1),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canAssignLeadOwner(sessionUser)) {
    return NextResponse.json({ error: "仅校长可分配/变更线索归属" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const { studentIds, salesId } = parsed.data;

  const students = await prisma.student.findMany({
    where: { id: { in: studentIds } },
    select: { id: true, campusId: true },
  });
  if (!students.length) return NextResponse.json({ error: "未找到线索" }, { status: 404 });

  // 每条线索都必须在操作者可见校区，否则越权。
  for (const s of students) {
    const denied = denyCrossCampus(sessionUser, s.campusId);
    if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  }

  // 目标销售：在职 + 具备 SALES 角色 + 覆盖所有目标线索所属校区。
  const sales = await prisma.user.findUnique({
    where: { id: salesId },
    include: { roles: true, campuses: true },
  });
  if (!sales || !sales.isActive || !sales.roles.some((r) => r.role === "SALES")) {
    return NextResponse.json({ error: "目标不是有效的销售账号" }, { status: 400 });
  }
  const salesCampuses = new Set(sales.campuses.map((c) => c.campusId));
  const targetCampuses = new Set(students.map((s) => s.campusId));
  for (const c of targetCampuses) {
    if (!salesCampuses.has(c)) {
      return NextResponse.json({ error: "该销售不在所选线索的校区，无法分配" }, { status: 400 });
    }
  }

  await prisma.student.updateMany({
    where: { id: { in: students.map((s) => s.id) } },
    data: { salesId },
  });

  return NextResponse.json({ assigned: students.length });
}
