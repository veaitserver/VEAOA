import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageGroupClass, denyCrossCampus, type SessionUser } from "@/lib/permissions";
import { lessonHours } from "@/lib/hours";
import { ScheduleError } from "@/lib/scheduling";
import { activeMembers, assertAllMembersHaveHours, assertGroupNoConflict } from "@/lib/groupClass";
import { GroupSessionStatus } from "@/lib/enums";
import { z } from "zod";

const updateSchema = z.object({
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

async function loadSession(classId: string, sessionId: string) {
  const s = await prisma.groupSession.findUnique({
    where: { id: sessionId },
    include: {
      class: { select: { id: true, campusId: true } },
      deductions: { where: { reversedAt: null }, select: { id: true } },
    },
  });
  return s && s.class.id === classId ? s : null;
}

/** 班课改期（已核销的不能改，需先撤销）。 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canManageGroupClass(sessionUser)) {
    return NextResponse.json({ error: "仅教务/校长可改期" }, { status: 403 });
  }

  const { id, sessionId } = await params;
  const s = await loadSession(id, sessionId);
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, s.class.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  if (s.deductions.length > 0) {
    return NextResponse.json({ error: "该课次已核销，请先撤销核销再改期" }, { status: 400 });
  }

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const teacherId = parsed.data.teacherId ?? s.teacherId;
  const classroomId = parsed.data.classroomId ?? s.classroomId;
  const startTime = new Date(parsed.data.startTime);
  const endTime = new Date(parsed.data.endTime);
  const durationHours = lessonHours(startTime, endTime);

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const members = await activeMembers(tx, id);
      // 库存排除本节课自身，否则「原地微调时间」会把自己的时长重复计入。
      await assertAllMembersHaveHours(tx, members, durationHours, sessionId);

      const row = await tx.groupSession.update({
        where: { id: sessionId },
        data: { startTime, endTime, teacherId, classroomId },
        include: {
          teacher: { select: { name: true } },
          classroom: { select: { name: true } },
        },
      });

      await assertGroupNoConflict(tx, {
        startTime, endTime, teacherId, classroomId, members, excludeSessionId: sessionId,
      });
      return row;
    });

    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof ScheduleError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

/** 删除课次（已核销的不能删）。连同考勤一并清除。 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canManageGroupClass(sessionUser)) {
    return NextResponse.json({ error: "仅教务/校长可删除课次" }, { status: 403 });
  }

  const { id, sessionId } = await params;
  const s = await loadSession(id, sessionId);
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, s.class.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  if (s.deductions.length > 0) {
    return NextResponse.json({ error: "已核销的课次不能删除，请先撤销核销" }, { status: 400 });
  }
  if (s.status === GroupSessionStatus.CONFIRMED) {
    return NextResponse.json({ error: "已核销的课次不能删除" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.groupSessionAttendance.deleteMany({ where: { sessionId } });
    await tx.groupSession.delete({ where: { id: sessionId } });
  });

  return NextResponse.json({ ok: true });
}
