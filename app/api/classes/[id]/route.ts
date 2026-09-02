import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  canManageGroupClass, canViewGroupClass, denyCrossCampus, hasRole, ownClassScope, type SessionUser,
} from "@/lib/permissions";
import { GroupClassStatus, Role } from "@/lib/enums";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  gradeId: z.string().min(1).nullable().optional(),
  teacherId: z.string().min(1).nullable().optional(),
  classroomId: z.string().min(1).nullable().optional(),
  deliveryMode: z.enum(["ONSITE", "ONLINE"]).optional(),
  capacity: z.number().int().positive().max(200).nullable().optional(),
  status: z.nativeEnum(GroupClassStatus).optional(),
  notes: z.string().max(1000).nullable().optional(),
});

/** 班级详情：含成员（在册与已退班）与课次。 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canViewGroupClass(sessionUser)) {
    return NextResponse.json({ error: "无权查看班级" }, { status: 403 });
  }

  const { id } = await params;
  const cls = await prisma.groupClass.findUnique({
    where: { id },
    include: {
      campus: { select: { id: true, name: true } },
      subject: { select: { id: true, name: true } },
      grade: { select: { id: true, name: true } },
      teacher: { select: { id: true, name: true } },
      classroom: { select: { id: true, name: true } },
      creator: { select: { name: true } },
      members: {
        include: {
          student: { select: { id: true, name: true, salesId: true, studentManagerId: true } },
          package: {
            select: {
              id: true, remainingHours: true, totalHours: true, status: true,
              subject: { select: { name: true } }, grade: { select: { name: true } },
            },
          },
        },
        orderBy: { joinedAt: "asc" },
      },
      sessions: {
        include: {
          teacher: { select: { name: true } },
          classroom: { select: { name: true } },
          attendances: { include: { student: { select: { id: true, name: true } } } },
        },
        orderBy: { startTime: "desc" },
      },
    },
  });
  if (!cls) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, cls.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  // 老师只看自己带的班。列表已按 teacherId 收敛，这里是按 id 直取的那条路，
  // 不挡住就等于列表白收敛了 —— 班级详情带着完整花名册。
  const ownClass = ownClassScope(sessionUser);
  if (ownClass && cls.teacherId !== ownClass.teacherId) {
    return NextResponse.json({ error: "只能查看自己带的班级" }, { status: 403 });
  }

  // 教师只需从课表进入班课写整班反馈，不应看到学生名单、考勤或课时。
  if (ownClass) {
    return NextResponse.json({
      ...cls,
      members: [],
      sessions: cls.sessions.map(({ attendances: _attendances, ...row }) => ({ ...row, attendances: [] })),
    });
  }

  // 学管/销售只可查看自己名下学生在班中的资料；不能借共同班级读取其他学生。
  const canSeeAllClassData = hasRole(sessionUser, Role.ACADEMIC_ADMIN, Role.PRINCIPAL, Role.FINANCE, Role.SUPER_ADMIN);
  const scopedToStudents = !canSeeAllClassData
    && (hasRole(sessionUser, Role.STUDENT_MANAGER) || hasRole(sessionUser, Role.SALES));
  if (scopedToStudents) {
    const owns = (m: (typeof cls.members)[number]) =>
      (hasRole(sessionUser, Role.STUDENT_MANAGER) && m.student.studentManagerId === sessionUser.id)
      || (hasRole(sessionUser, Role.SALES) && m.student.salesId === sessionUser.id);
    const ownMembers = cls.members.filter(owns);
    if (!ownMembers.length) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const ownStudentIds = new Set(ownMembers.map((m) => m.studentId));
    return NextResponse.json({
      ...cls,
      members: ownMembers.map(({ student, ...member }) => ({
        ...member, student: { id: student.id, name: student.name },
      })),
      sessions: cls.sessions.map(({ attendances, ...row }) => ({
        ...row,
        attendances: attendances.filter((a) => ownStudentIds.has(a.studentId)),
      })),
    });
  }

  return NextResponse.json(cls);
}

/** 修改班级（改名、换默认老师/教室、改容量、结班）。 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canManageGroupClass(sessionUser)) {
    return NextResponse.json({ error: "仅教务/校长可修改班级" }, { status: 403 });
  }

  const { id } = await params;
  const cls = await prisma.groupClass.findUnique({ where: { id } });
  if (!cls) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, cls.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const d = parsed.data;

  if (d.teacherId) {
    const t = await prisma.user.findUnique({
      where: { id: d.teacherId },
      select: { isActive: true, roles: { select: { role: true } }, campuses: { select: { campusId: true } } },
    });
    if (!t || !t.isActive || !t.roles.some((r) => r.role === "TEACHER") || !t.campuses.some((c) => c.campusId === cls.campusId)) {
      return NextResponse.json({ error: "默认老师不是该校区的在职老师" }, { status: 400 });
    }
  }
  if (d.classroomId) {
    const room = await prisma.classroom.findUnique({ where: { id: d.classroomId }, select: { campusId: true } });
    if (!room || room.campusId !== cls.campusId) {
      return NextResponse.json({ error: "默认教室不属于该校区" }, { status: 400 });
    }
  }

  // 缩容不能小于当前在册人数，否则班级立刻处于超员的非法状态。
  if (d.capacity != null) {
    const active = await prisma.groupClassMember.count({ where: { classId: id, leftAt: null } });
    if (d.capacity < active) {
      return NextResponse.json({ error: `容量不能小于当前在册人数（${active} 人）` }, { status: 400 });
    }
  }

  const updated = await prisma.groupClass.update({
    where: { id },
    data: {
      ...(d.name !== undefined ? { name: d.name.trim() } : {}),
      ...(d.gradeId !== undefined ? { gradeId: d.gradeId } : {}),
      ...(d.teacherId !== undefined ? { teacherId: d.teacherId } : {}),
      ...(d.classroomId !== undefined ? { classroomId: d.classroomId } : {}),
      ...(d.deliveryMode !== undefined ? { deliveryMode: d.deliveryMode } : {}),
      ...(d.capacity !== undefined ? { capacity: d.capacity } : {}),
      ...(d.status !== undefined ? { status: d.status } : {}),
      ...(d.notes !== undefined ? { notes: d.notes?.trim() || null } : {}),
    },
  });

  return NextResponse.json(updated);
}

/** 删除班级：已排过课的不能删（应改为结班），保住历史。 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canManageGroupClass(sessionUser)) {
    return NextResponse.json({ error: "仅教务/校长可删除班级" }, { status: 403 });
  }

  const { id } = await params;
  const cls = await prisma.groupClass.findUnique({
    where: { id },
    include: { _count: { select: { sessions: true, members: true } } },
  });
  if (!cls) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, cls.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  if (cls._count.sessions > 0) {
    return NextResponse.json({ error: "该班级已有课次，不能删除，请改为结班" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.groupClassMember.deleteMany({ where: { classId: id } });
    await tx.groupClass.delete({ where: { id } });
  });

  return NextResponse.json({ ok: true });
}
