import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canSchedule, type SessionUser } from "@/lib/permissions";
import { lessonHours, roundHours } from "@/lib/hours";
import { validateTargets, assertInventory, assertNoConflict, normalizeLocation, ScheduleError } from "@/lib/scheduling";
import { torontoWallTimeToUtc } from "@/lib/datetime";
import { expandRecurrence, MAX_OCCURRENCES, type Frequency } from "@/lib/recurrence";
import { z } from "zod";

const schema = z.object({
  teacherId: z.string().min(1),
  studentId: z.string().min(1),
  packageId: z.string().min(1),
  // 线上课不选教室。
  classroomId: z.string().min(1).nullish(),
  deliveryMode: z.enum(["ONSITE", "ONLINE"]).default("ONSITE"),
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
  lessonType: z.enum(["ONE_ON_ONE", "GROUP"]).default("ONE_ON_ONE"),
  dryRun: z.boolean().optional(),
});

/**
 * 一对一重复排课（如固定每周二 16:00 的长期学生）。
 *
 * 与班课批量同样的做法：先预检（只算不建）供前端提示，确认后逐次独立
 * 创建，撞课或课时不足的跳过并说明原因。库存逐次累加，用完自动停下。
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canSchedule(sessionUser)) {
    return NextResponse.json({ error: "无权排课" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const d = parsed.data;

  // 地点在预检和逐条落库两处都要用，所以提到 try 外面。
  let loc: { deliveryMode: string; classroomId: string | null };
  try {
    loc = normalizeLocation(d.deliveryMode, d.classroomId);
    await validateTargets(sessionUser, {
      studentId: d.studentId, classroomId: loc.classroomId, teacherId: d.teacherId,
    });
  } catch (e) {
    if (e instanceof ScheduleError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const pkg = await prisma.coursePackage.findUnique({ where: { id: d.packageId } });
  if (!pkg || pkg.status !== "ACTIVE") {
    return NextResponse.json({ error: "课包未激活，无法排课" }, { status: 400 });
  }
  if (pkg.studentId !== d.studentId) {
    return NextResponse.json({ error: "课包不属于该学生" }, { status: 400 });
  }
  if (pkg.classType === "GROUP") {
    return NextResponse.json({ error: "班课课包请到班级里排课" }, { status: 400 });
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

  const created: { id: string; date: string }[] = [];
  const skipped: { date: string; reason: string }[] = [];
  let plannedHours = 0; // 预检时模拟前面几节已占掉的课时

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
        await assertInventory(prisma, {
          pkg: { id: pkg.id, remainingHours: roundHours(Number(pkg.remainingHours) - plannedHours) },
          durationHours,
        });
        await assertNoConflict(prisma, {
          startTime, endTime,
          teacherId: d.teacherId, classroomId: loc.classroomId, studentId: d.studentId,
          excludeLessonId: "__none__",
        });
        plannedHours = roundHours(plannedHours + durationHours);
        created.push({ id: "", date });
      } catch (e) {
        if (e instanceof ScheduleError) skipped.push({ date, reason: e.message });
        else throw e;
      }
      continue;
    }

    try {
      const row = await prisma.$transaction(async (tx) => {
        const fresh = await tx.coursePackage.findUniqueOrThrow({ where: { id: d.packageId } });
        await assertInventory(tx, { pkg: fresh, durationHours });

        const lesson = await tx.scheduledLesson.create({
          data: {
            teacherId: d.teacherId, studentId: d.studentId, packageId: d.packageId,
            classroomId: loc.classroomId, deliveryMode: loc.deliveryMode,
            startTime, endTime, lessonType: d.lessonType,
          },
        });

        await assertNoConflict(tx, {
          startTime, endTime,
          teacherId: d.teacherId, classroomId: loc.classroomId, studentId: d.studentId,
          excludeLessonId: lesson.id,
        });
        return lesson;
      });
      created.push({ id: row.id, date });
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
    dates: created.map((c) => c.date),
  }, { status: d.dryRun ? 200 : (created.length ? 201 : 400) });
}
