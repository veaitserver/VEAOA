import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageGroupClass, denyCrossCampus, type SessionUser } from "@/lib/permissions";
import { lessonHours } from "@/lib/hours";
import { ScheduleError } from "@/lib/scheduling";
import { activeMembers, assertAllMembersHaveHours, assertGroupNoConflict } from "@/lib/groupClass";
import { AttendanceStatus, GroupClassStatus, GroupSessionStatus } from "@/lib/enums";
import { z } from "zod";

const createSchema = z.object({
  startTime: z.string(),
  endTime: z.string(),
  teacherId: z.string().min(1).optional(),
  classroomId: z.string().min(1).optional(),
}).refine(
  (d) => {
    const s = new Date(d.startTime).getTime();
    const e = new Date(d.endTime).getTime();
    return Number.isFinite(s) && Number.isFinite(e) && e > s;
  },
  { message: "结束时间必须晚于开始时间", path: ["endTime"] },
);

/**
 * 给班级排一次课（教务/校长）。
 *
 * 排课即为当时在册的每个成员建一条考勤（默认到课），并在同一事务里做
 * 全员库存校验与四维冲突检查 —— 任何一人课时不足就整节课排不了。
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canManageGroupClass(sessionUser)) {
    return NextResponse.json({ error: "仅教务/校长可给班级排课" }, { status: 403 });
  }

  const { id } = await params;
  const cls = await prisma.groupClass.findUnique({ where: { id } });
  if (!cls) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, cls.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  if (cls.status === GroupClassStatus.FINISHED) {
    return NextResponse.json({ error: "已结班的班级不能排课" }, { status: 400 });
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const teacherId = parsed.data.teacherId ?? cls.teacherId;
  const classroomId = parsed.data.classroomId ?? cls.classroomId;
  if (!teacherId) return NextResponse.json({ error: "请指定老师（班级未设默认老师）" }, { status: 400 });
  if (!classroomId) return NextResponse.json({ error: "请指定教室（班级未设默认教室）" }, { status: 400 });

  const startTime = new Date(parsed.data.startTime);
  const endTime = new Date(parsed.data.endTime);
  const durationHours = lessonHours(startTime, endTime);

  // 老师/教室必须属于本校区，避免跨校区占用。
  const teacher = await prisma.user.findUnique({
    where: { id: teacherId },
    select: { isActive: true, roles: { select: { role: true } }, campuses: { select: { campusId: true } } },
  });
  if (!teacher || !teacher.isActive || !teacher.roles.some((r) => r.role === "TEACHER")
      || !teacher.campuses.some((c) => c.campusId === cls.campusId)) {
    return NextResponse.json({ error: "老师不是该校区的在职老师" }, { status: 400 });
  }
  const room = await prisma.classroom.findUnique({ where: { id: classroomId }, select: { campusId: true } });
  if (!room || room.campusId !== cls.campusId) {
    return NextResponse.json({ error: "教室不属于该校区" }, { status: 400 });
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const members = await activeMembers(tx, id);
      if (!members.length) throw new ScheduleError(400, "班级还没有成员，请先加入学生再排课");

      await assertAllMembersHaveHours(tx, members, durationHours);

      const row = await tx.groupSession.create({
        data: {
          classId: id, teacherId, classroomId, startTime, endTime,
          status: GroupSessionStatus.SCHEDULED,
          // 排课当时在册的人固定下来，之后插班的人不会被追溯到这节课。
          attendances: {
            create: members.map((m) => ({
              studentId: m.studentId,
              packageId: m.packageId,
              attendance: AttendanceStatus.PRESENT,
            })),
          },
        },
        include: {
          teacher: { select: { name: true } },
          classroom: { select: { name: true } },
          attendances: { include: { student: { select: { id: true, name: true } } } },
        },
      });

      await assertGroupNoConflict(tx, {
        startTime, endTime, teacherId, classroomId, members, excludeSessionId: row.id,
      });
      return row;
    });

    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    if (e instanceof ScheduleError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
