import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageGroupClass, denyCrossCampus, type SessionUser } from "@/lib/permissions";
import { lessonHours } from "@/lib/hours";
import { ScheduleError } from "@/lib/scheduling";
import { activeMembers, assertAllMembersHaveHours, assertGroupNoConflict } from "@/lib/groupClass";
import { torontoWallTimeToUtc } from "@/lib/datetime";
import { expandRecurrence, MAX_OCCURRENCES, type Frequency } from "@/lib/recurrence";
import { AttendanceStatus, GroupClassStatus, GroupSessionStatus } from "@/lib/enums";
import { z } from "zod";

const schema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  frequency: z.enum(["DAILY", "WEEKDAYS", "WEEKLY"]),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  until: z.discriminatedUnion("type", [
    z.object({ type: z.literal("weeks"), value: z.number().int().positive().max(52) }),
    z.object({ type: z.literal("date"), value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    z.object({ type: z.literal("count"), value: z.number().int().positive().max(MAX_OCCURRENCES) }),
  ]),
  teacherId: z.string().min(1).optional(),
  classroomId: z.string().min(1).optional(),
  // 预检：只算不建，让教务先看清哪几次排不了、改完再提交。
  dryRun: z.boolean().optional(),
});

/**
 * 批量排课（每周固定这类）。
 *
 * 逐次独立校验并创建：能排的先排，排不了的收集原因返回，不因为其中一次
 * 冲突就整批作废 —— 一学期的课通常只有个别几次撞节假日或撞课。
 * 库存也是逐次累加的：前面的课占掉课时后，后面的自然会因不足而停下。
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
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const d = parsed.data;

  const teacherId = d.teacherId ?? cls.teacherId;
  const classroomId = d.classroomId ?? cls.classroomId;
  if (!teacherId) return NextResponse.json({ error: "请指定老师（班级未设默认老师）" }, { status: 400 });
  if (!classroomId) return NextResponse.json({ error: "请指定教室（班级未设默认教室）" }, { status: 400 });

  // 老师/教室校区校验一次即可，整批共用。
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

  const dates = expandRecurrence({
    startDate: d.startDate,
    frequency: d.frequency as Frequency,
    weekdays: d.weekdays,
    until: d.until,
  });
  if (!dates.length) {
    return NextResponse.json({ error: "按该规则没有算出任何上课日期" }, { status: 400 });
  }

  const members = await activeMembers(prisma, id);
  if (!members.length) {
    return NextResponse.json({ error: "班级还没有成员，请先加入学生再排课" }, { status: 400 });
  }

  const created: { id: string; date: string; startTime: Date }[] = [];
  const skipped: { date: string; reason: string }[] = [];
  // 预检时不落库，用它模拟「前面几节已占掉的课时」，才能算准后面还够不够。
  const plannedHours = new Map<string, number>();

  for (const date of dates) {
    const startTime = torontoWallTimeToUtc(date, d.start);
    const endTime = torontoWallTimeToUtc(date, d.end);
    if (endTime <= startTime) {
      skipped.push({ date, reason: "结束时间不晚于开始时间" });
      continue;
    }
    const durationHours = lessonHours(startTime, endTime);

    if (d.dryRun) {
      try {
        await assertAllMembersHaveHours(prisma, members, durationHours, undefined, plannedHours);
        await assertGroupNoConflict(prisma, {
          startTime, endTime, teacherId, classroomId, members, excludeSessionId: "__none__",
        });
        for (const m of members) {
          plannedHours.set(m.packageId, (plannedHours.get(m.packageId) ?? 0) + durationHours);
        }
        created.push({ id: "", date, startTime });
      } catch (e) {
        if (e instanceof ScheduleError) skipped.push({ date, reason: e.message });
        else throw e;
      }
      continue;
    }

    try {
      const row = await prisma.$transaction(async (tx) => {
        // 每次都重新读成员余额：前面已建的课会计入「已排未核销」，课时用完就会在这里停下。
        const fresh = await activeMembers(tx, id);
        await assertAllMembersHaveHours(tx, fresh, durationHours);

        const s = await tx.groupSession.create({
          data: {
            classId: id, teacherId, classroomId, startTime, endTime,
            status: GroupSessionStatus.SCHEDULED,
            attendances: {
              create: fresh.map((m) => ({
                studentId: m.studentId,
                packageId: m.packageId,
                attendance: AttendanceStatus.PRESENT,
              })),
            },
          },
        });

        await assertGroupNoConflict(tx, {
          startTime, endTime, teacherId, classroomId, members: fresh, excludeSessionId: s.id,
        });
        return s;
      });
      created.push({ id: row.id, date, startTime: row.startTime });
    } catch (e) {
      if (e instanceof ScheduleError) skipped.push({ date, reason: e.message });
      else throw e;
    }
  }

  return NextResponse.json({
    dryRun: !!d.dryRun,
    requested: dates.length,
    created: created.length,
    skipped,
    sessions: created,
    // 预检把日期回给前端展示，方便确认排在哪几天。
    dates: created.map((c) => c.date),
  }, { status: d.dryRun ? 200 : (created.length ? 201 : 400) });
}
