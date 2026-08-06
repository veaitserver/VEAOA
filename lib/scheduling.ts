/**
 * 排课校验 —— 新建排课与改期共用。
 *
 * 这套校验（校区归属、老师资格、库存、四维冲突）原先只写在 POST 里，
 * 改期若另写一份必然逐渐走样，所以抽出来两边共用。
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { denyCrossCampus, type SessionUser } from "./permissions";
import { lessonHours, roundHours } from "./hours";
import { DeliveryMode } from "./enums";

type Db = Prisma.TransactionClient | typeof prisma;

export class ScheduleError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/**
 * 地点字段的统一处理：线下课必须选教室，线上课一律不留教室。
 *
 * 线上课把 classroomId 抹成 null，是为了让「教室被占用」这件事只有一个含义。
 * 若留着一个名义上的教室，教室冲突检查要么误报（多节线上课撞在同一间），
 * 要么得处处判断形式 —— 迟早漏一处。
 */
export function normalizeLocation(
  deliveryMode: string,
  classroomId: string | null | undefined,
): { deliveryMode: string; classroomId: string | null } {
  if (deliveryMode === DeliveryMode.ONLINE) return { deliveryMode, classroomId: null };
  if (!classroomId) throw new ScheduleError(400, "线下课必须选择教室");
  return { deliveryMode: DeliveryMode.ONSITE, classroomId };
}

/**
 * 校验学生 / 教室 / 老师三者都属于同一校区且操作者有权。
 * 返回学生所在校区，供后续使用。
 */
export async function validateTargets(
  sessionUser: SessionUser,
  args: { studentId: string; classroomId: string | null; teacherId: string },
): Promise<{ campusId: string }> {
  const student = await prisma.student.findUnique({
    where: { id: args.studentId },
    select: { campusId: true },
  });
  if (!student) throw new ScheduleError(404, "学生不存在");
  const studentDenied = denyCrossCampus(sessionUser, student.campusId);
  if (studentDenied) throw new ScheduleError(403, studentDenied);

  // 线上课没有教室（classroomId 为空），跳过这一段；线下课照常校验。
  if (args.classroomId) {
    const classroom = await prisma.classroom.findUnique({
      where: { id: args.classroomId },
      select: { campusId: true },
    });
    if (!classroom) throw new ScheduleError(404, "教室不存在");
    const roomDenied = denyCrossCampus(sessionUser, classroom.campusId);
    if (roomDenied) throw new ScheduleError(403, roomDenied);
    if (classroom.campusId !== student.campusId) {
      throw new ScheduleError(400, "教室与学生不在同一校区");
    }
  }

  // 老师必须是本校区在职老师，否则可跨校区占用别人的老师（越权 + 拒绝服务）。
  const teacher = await prisma.user.findUnique({
    where: { id: args.teacherId },
    select: { isActive: true, roles: { select: { role: true } }, campuses: { select: { campusId: true } } },
  });
  if (!teacher || !teacher.isActive || !teacher.roles.some((r) => r.role === "TEACHER")) {
    throw new ScheduleError(400, "老师不存在或非在职老师");
  }
  if (!teacher.campuses.some((c) => c.campusId === student.campusId)) {
    throw new ScheduleError(400, "老师不属于该学生所在校区");
  }

  return { campusId: student.campusId };
}

/**
 * 课包可用课时校验。
 * 可用量 = 剩余课时 − 已排未核销课时；改期时把被移动的那节排除在外，
 * 否则它自己的时长会被重复计入，导致「原地改时间」也报库存不足。
 */
export async function assertInventory(
  tx: Db,
  args: {
    pkg: { id: string; remainingHours: number };
    durationHours: number;
    excludeLessonId?: string;
  },
): Promise<void> {
  const lessons = await tx.scheduledLesson.findMany({
    where: {
      packageId: args.pkg.id,
      ...(args.excludeLessonId ? { id: { not: args.excludeLessonId } } : {}),
    },
    include: { log: { include: { deductions: true } } },
  });
  const pendingHours = roundHours(
    lessons
      .filter((l) => !l.log || !l.log.deductions.some((d) => !d.reversedAt))
      .reduce((sum, l) => sum + lessonHours(l.startTime, l.endTime), 0),
  );
  const available = roundHours(Number(args.pkg.remainingHours) - pendingHours);
  if (args.durationHours > available) {
    throw new ScheduleError(
      400,
      `课包可用课时不足（剩余 ${roundHours(Number(args.pkg.remainingHours))}h，已排未核销 ${pendingHours}h，可用 ${available}h）`,
    );
  }
}

/**
 * 老师 / 教室 / 学生 三维时段冲突检查。
 * 在事务内「写后复核」使用：excludeLessonId 传本节课自身，避免和自己撞。
 *
 * 线上课不占实体教室（classroomId 为空），只查老师和学生两维 —— 否则
 * 同一时段的多节线上课会互相误报，线上课也会白占一间实体教室。
 */
export async function assertNoConflict(
  tx: Db,
  args: {
    startTime: Date; endTime: Date;
    teacherId: string; classroomId: string | null; studentId: string;
    excludeLessonId: string;
  },
): Promise<void> {
  const overlap = { startTime: { lt: args.endTime }, endTime: { gt: args.startTime } };
  const roomDim = args.classroomId ? [{ classroomId: args.classroomId }] : [];

  const clash = await tx.scheduledLesson.findFirst({
    where: {
      id: { not: args.excludeLessonId },
      ...overlap,
      OR: [{ teacherId: args.teacherId }, ...roomDim, { studentId: args.studentId }],
    },
  });
  if (clash) {
    const dim = clash.teacherId === args.teacherId ? "老师"
      : (args.classroomId && clash.classroomId === args.classroomId) ? "教室" : "学生";
    throw new ScheduleError(409, `该时段${dim}已有课程，存在冲突`);
  }

  // 班课那张课表也要查：老师可能正在带班课，学生可能是某个班级的成员。
  // 班课侧本来就会反查一对一，这边不查就成了单向校验，能排出双占。
  const sessionClash = await tx.groupSession.findFirst({
    where: {
      ...overlap,
      OR: [
        { teacherId: args.teacherId },
        ...roomDim,
        { class: { members: { some: { studentId: args.studentId, leftAt: null } } } },
      ],
    },
    include: { class: { select: { name: true } } },
  });
  if (sessionClash) {
    const dim = sessionClash.teacherId === args.teacherId ? "老师"
      : (args.classroomId && sessionClash.classroomId === args.classroomId) ? "教室" : "学生";
    throw new ScheduleError(409, `该时段${dim}已在班级「${sessionClash.class.name}」有课，存在冲突`);
  }
}
