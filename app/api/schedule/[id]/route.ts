import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canSchedule, denyCrossCampus, type SessionUser } from "@/lib/permissions";
import { lessonHours } from "@/lib/hours";
import { validateTargets, assertInventory, assertNoConflict, normalizeLocation, ScheduleError } from "@/lib/scheduling";
import { AttendanceStatus } from "@/lib/enums";
import { z } from "zod";

const updateSchema = z.object({
  startTime: z.string(),
  endTime: z.string(),
  teacherId: z.string().min(1).optional(),
  // 线上课没有教室；不传则沿用原值。
  classroomId: z.string().min(1).nullish(),
  deliveryMode: z.enum(["ONSITE", "ONLINE"]).optional(),
}).refine(
  (d) => {
    const s = new Date(d.startTime).getTime();
    const e = new Date(d.endTime).getTime();
    return Number.isFinite(s) && Number.isFinite(e) && e > s;
  },
  { message: "结束时间必须晚于开始时间", path: ["endTime"] },
);

/**
 * 改期（学生请假后把课挪到别的时间，也可顺带换老师/教室）。
 *
 * 已核销的课不能改期 —— 课时已经扣掉，挪时间会让台账和课表对不上，
 * 要改先撤销核销。改期成功后考勤重置为未标记：这是一节全新的课。
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canSchedule(sessionUser)) {
    return NextResponse.json({ error: "无权改期" }, { status: 403 });
  }

  const { id } = await params;
  const lesson = await prisma.scheduledLesson.findUnique({
    where: { id },
    include: {
      student: { select: { campusId: true } },
      package: true,
      log: { include: { deductions: true } },
    },
  });
  if (!lesson) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, lesson.student.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  if (lesson.log?.deductions.some((d) => !d.reversedAt)) {
    return NextResponse.json({ error: "该课程已核销，请先撤销核销再改期" }, { status: 400 });
  }

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const teacherId = parsed.data.teacherId ?? lesson.teacherId;
  const startTime = new Date(parsed.data.startTime);
  const endTime = new Date(parsed.data.endTime);

  try {
    // 改期时可以顺带把线下课改成线上（或反过来）；未指定则沿用原样。
    const loc = normalizeLocation(
      parsed.data.deliveryMode ?? lesson.deliveryMode,
      parsed.data.classroomId === undefined ? lesson.classroomId : parsed.data.classroomId,
    );
    const classroomId = loc.classroomId;

    await validateTargets(sessionUser, { studentId: lesson.studentId, classroomId, teacherId });

    const durationHours = lessonHours(startTime, endTime);

    const updated = await prisma.$transaction(async (tx) => {
      // 库存要排除本节课自身，否则「原地微调时间」会把自己的时长重复计入。
      await assertInventory(tx, { pkg: lesson.package, durationHours, excludeLessonId: id });

      const row = await tx.scheduledLesson.update({
        where: { id },
        data: {
          startTime, endTime, teacherId, classroomId,
          deliveryMode: loc.deliveryMode,
          // 改期后是一节全新的课：清掉原来的请假/旷课标记。
          attendance: null, attendanceNote: null, attendanceById: null, attendanceAt: null,
        },
        include: {
          teacher: { select: { name: true } },
          student: { select: { name: true } },
          classroom: true,
          package: { include: { subject: true } },
        },
      });

      await assertNoConflict(tx, {
        startTime, endTime, teacherId, classroomId,
        studentId: lesson.studentId, excludeLessonId: id,
      });
      return row;
    });

    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof ScheduleError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

/**
 * 删除课程。
 *
 * 已提交日志的课一般不给删（那是真实授课记录），但「请假」的课例外：
 * 学生没来上，老师即便写了日志也不构成授课记录，且这类课无法核销，
 * 不许删就会永久卡在教务待办里。此时连同日志一并删除。
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canSchedule(sessionUser)) {
    return NextResponse.json({ error: "无权删除课程" }, { status: 403 });
  }

  const { id } = await params;
  const lesson = await prisma.scheduledLesson.findUnique({
    where: { id },
    include: {
      log: { include: { deductions: true } },
      student: { select: { campusId: true } },
    },
  });
  if (!lesson) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, lesson.student.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  if (lesson.log?.deductions.some((d) => !d.reversedAt)) {
    return NextResponse.json({ error: "已核销的课程不能删除，请先撤销核销" }, { status: 400 });
  }
  const isLeave = lesson.attendance === AttendanceStatus.LEAVE;
  if (lesson.log && !isLeave) {
    return NextResponse.json({ error: "已提交日志的课程不能删除" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    if (lesson.log) {
      await tx.courseDeduction.deleteMany({ where: { logId: lesson.log.id } });
      await tx.lessonLog.delete({ where: { id: lesson.log.id } });
    }
    await tx.scheduledLesson.delete({ where: { id } });
  });

  return NextResponse.json({ ok: true });
}
