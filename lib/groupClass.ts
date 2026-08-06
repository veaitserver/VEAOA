/**
 * 班课的库存与冲突校验。
 *
 * 与一对一最大的不同：一节班课牵动全班每个成员的课包，任何一人课时不够
 * 就不能排（业务规则），冲突也要逐个成员查。而且课程分散在两张表里
 * （ScheduledLesson 一对一 / GroupSession 班课），两边都要看。
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { lessonHours, roundHours } from "./hours";
import { ScheduleError } from "./scheduling";

type Db = Prisma.TransactionClient | typeof prisma;

export type MemberLite = {
  id: string;
  studentId: string;
  packageId: string;
  student: { name: string };
  package: { id: string; remainingHours: number };
};

/** 班级当前在册成员（未退班）。 */
export async function activeMembers(db: Db, classId: string): Promise<MemberLite[]> {
  return db.groupClassMember.findMany({
    where: { classId, leftAt: null },
    include: {
      student: { select: { name: true } },
      package: { select: { id: true, remainingHours: true } },
    },
    orderBy: { joinedAt: "asc" },
  }) as unknown as Promise<MemberLite[]>;
}

/**
 * 某张班课课包「已排未核销」的课时。
 * = 该课包所在班级的、尚未为它产生生效扣课的那些课次时长之和。
 */
async function pendingHoursForPackage(
  db: Db,
  packageId: string,
  excludeSessionId?: string,
): Promise<number> {
  const memberships = await db.groupClassMember.findMany({
    where: { packageId, leftAt: null },
    select: { classId: true },
  });
  if (!memberships.length) return 0;

  const sessions = await db.groupSession.findMany({
    where: {
      classId: { in: memberships.map((m) => m.classId) },
      ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}),
    },
    include: { deductions: { where: { packageId, reversedAt: null }, select: { id: true } } },
  });

  return roundHours(
    sessions
      .filter((s) => s.deductions.length === 0)
      .reduce((sum, s) => sum + lessonHours(s.startTime, s.endTime), 0),
  );
}

/**
 * 全员库存校验：任何一个成员课时不足就拦下整节课，并列出是谁。
 * 业务上宁可不排，也不要上完课才发现有人扣不了费。
 */
export async function assertAllMembersHaveHours(
  db: Db,
  members: MemberLite[],
  durationHours: number,
  excludeSessionId?: string,
  /** 预检时用：本批次里前面几节课已经"预定"掉的课时（课包 id → 小时数）。 */
  extraPending?: Map<string, number>,
): Promise<void> {
  const short: string[] = [];
  for (const m of members) {
    const pending = await pendingHoursForPackage(db, m.packageId, excludeSessionId);
    const planned = extraPending?.get(m.packageId) ?? 0;
    const available = roundHours(Number(m.package.remainingHours) - pending - planned);
    if (durationHours > available) {
      short.push(`${m.student.name}（可用 ${available}h）`);
    }
  }
  if (short.length) {
    throw new ScheduleError(
      400,
      `以下成员课时不足 ${durationHours}h，无法排课，请先续费：${short.join("、")}`,
    );
  }
}

/**
 * 班课的时段冲突检查：老师、教室、以及每一个成员学生。
 * 两张课表都要查 —— 成员可能同时有一对一的课，或在别的班级有课。
 *
 * 线上课次不占实体教室（classroomId 为空），教室这一维直接略过。
 */
export async function assertGroupNoConflict(
  db: Db,
  args: {
    startTime: Date; endTime: Date;
    teacherId: string; classroomId: string | null;
    members: MemberLite[];
    excludeSessionId: string;
  },
): Promise<void> {
  const overlapLesson = {
    startTime: { lt: args.endTime },
    endTime: { gt: args.startTime },
  };
  const roomDim = args.classroomId ? [{ classroomId: args.classroomId }] : [];

  // 老师 / 教室：一对一课表
  const lessonClash = await db.scheduledLesson.findFirst({
    where: { ...overlapLesson, OR: [{ teacherId: args.teacherId }, ...roomDim] },
  });
  if (lessonClash) {
    const dim = lessonClash.teacherId === args.teacherId ? "老师" : "教室";
    throw new ScheduleError(409, `该时段${dim}已有一对一课程，存在冲突`);
  }

  // 老师 / 教室：别的班级课次
  const sessionClash = await db.groupSession.findFirst({
    where: {
      id: { not: args.excludeSessionId },
      ...overlapLesson,
      OR: [{ teacherId: args.teacherId }, ...roomDim],
    },
  });
  if (sessionClash) {
    const dim = sessionClash.teacherId === args.teacherId ? "老师" : "教室";
    throw new ScheduleError(409, `该时段${dim}已有班课，存在冲突`);
  }

  if (!args.members.length) return;
  const studentIds = args.members.map((m) => m.studentId);

  // 成员：一对一课表
  const stuLesson = await db.scheduledLesson.findFirst({
    where: { ...overlapLesson, studentId: { in: studentIds } },
    include: { student: { select: { name: true } } },
  });
  if (stuLesson) {
    throw new ScheduleError(409, `${stuLesson.student.name} 该时段已有一对一课程，存在冲突`);
  }

  // 成员：别的班级课次
  const otherSessions = await db.groupSession.findMany({
    where: { id: { not: args.excludeSessionId }, ...overlapLesson },
    include: { class: { select: { name: true, members: { where: { leftAt: null }, select: { studentId: true } } } } },
  });
  for (const s of otherSessions) {
    const hit = s.class.members.find((m) => studentIds.includes(m.studentId));
    if (hit) {
      const name = args.members.find((m) => m.studentId === hit.studentId)?.student.name ?? "有成员";
      throw new ScheduleError(409, `${name} 该时段已在班级「${s.class.name}」有课，存在冲突`);
    }
  }
}
