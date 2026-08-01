import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageGroupClass, denyCrossCampus, type SessionUser } from "@/lib/permissions";
import { ClassType, GroupClassStatus } from "@/lib/enums";
import { z } from "zod";

const addSchema = z.object({ packageId: z.string().min(1) });

/**
 * 加入班级成员（教务/校长）。
 *
 * 成员资格 = 一张「班课 + 已生效 + 有剩余课时 + 同科目 + 同校区」的课包。
 * 同科目是硬性业务规则：班级按科目开，混科目会导致课时算到别的科目头上。
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canManageGroupClass(sessionUser)) {
    return NextResponse.json({ error: "仅教务/校长可管理班级成员" }, { status: 403 });
  }

  const { id } = await params;
  const cls = await prisma.groupClass.findUnique({ where: { id } });
  if (!cls) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, cls.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  if (cls.status === GroupClassStatus.FINISHED) {
    return NextResponse.json({ error: "已结班的班级不能再加入成员" }, { status: 400 });
  }

  const body = await req.json();
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const pkg = await prisma.coursePackage.findUnique({
    where: { id: parsed.data.packageId },
    include: { student: { select: { id: true, name: true, campusId: true } }, subject: { select: { name: true } } },
  });
  if (!pkg) return NextResponse.json({ error: "课包不存在" }, { status: 404 });

  if (pkg.student.campusId !== cls.campusId) {
    return NextResponse.json({ error: "学生与班级不在同一校区" }, { status: 400 });
  }
  if (pkg.classType !== ClassType.GROUP) {
    return NextResponse.json({ error: "只有班课课包才能加入班级" }, { status: 400 });
  }
  if (pkg.status !== "ACTIVE") {
    return NextResponse.json({ error: "课包未生效，不能加入班级" }, { status: 400 });
  }
  if (Number(pkg.remainingHours) <= 0) {
    return NextResponse.json({ error: "该课包课时已耗尽，请先续费" }, { status: 400 });
  }
  if (pkg.subjectId !== cls.subjectId) {
    return NextResponse.json({ error: `课包科目（${pkg.subject.name}）与班级科目不一致` }, { status: 400 });
  }

  // 同一课包不能重复入班；已退班的可以重新加入（清掉 leftAt）。
  const existing = await prisma.groupClassMember.findUnique({
    where: { classId_packageId: { classId: id, packageId: pkg.id } },
  });
  if (existing && existing.leftAt === null) {
    return NextResponse.json({ error: "该课包已在本班级中" }, { status: 409 });
  }

  if (cls.capacity != null) {
    const active = await prisma.groupClassMember.count({ where: { classId: id, leftAt: null } });
    if (active >= cls.capacity) {
      return NextResponse.json({ error: `班级已满（上限 ${cls.capacity} 人）` }, { status: 400 });
    }
  }

  const member = existing
    ? await prisma.groupClassMember.update({
        where: { id: existing.id },
        data: { leftAt: null, joinedAt: new Date() },
        include: { student: { select: { id: true, name: true } } },
      })
    : await prisma.groupClassMember.create({
        data: { classId: id, studentId: pkg.student.id, packageId: pkg.id },
        include: { student: { select: { id: true, name: true } } },
      });

  return NextResponse.json(member, { status: 201 });
}
