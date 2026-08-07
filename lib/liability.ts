/**
 * 剩余课时负债（预收未消耗）。
 *
 * 口径：**只要还没核销就算负债** —— 家长的钱已经收了，服务还没提供完，
 * 这笔钱在会计上是负债不是收入。所以
 *
 *   负债 = Σ(已生效课包.剩余课时 × 单价)
 *
 * 已排未核销的课也在里面（课没上完，欠着服务的事实不变），只是单独拆一列
 * 「已排待上」，让教务知道其中有多少已经承诺给了具体课程。
 *
 * 只算 ACTIVE：待校长/待财务确认的课包钱还没确认到账，不构成负债；
 * 已转化(CONVERTED)的剩余课时已经归零并结转到新包，不会重复计。
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { lessonHours, roundHours } from "./hours";
import { roundMoney, lineAmount } from "./money";
import { GroupSessionStatus, PackageStatus } from "./enums";

type Db = Prisma.TransactionClient | typeof prisma;

export type LiabilityRow = {
  packageId: string;
  studentId: string;
  studentName: string;
  campusId: string;
  campusName: string;
  subjectName: string;
  gradeName: string;
  classType: string;
  remainingHours: number;
  pricePerHour: number;
  /** 负债金额 = 剩余课时 × 单价 */
  amount: number;
  /** 其中已排未核销的课时（不减少负债，只作提示） */
  pendingHours: number;
};

export type LiabilityGroup = {
  key: string;
  label: string;
  hours: number;
  amount: number;
  pendingHours: number;
  packages: number;
  students: number;
};

export type LiabilityReport = {
  totalHours: number;
  totalAmount: number;
  totalPendingHours: number;
  packages: number;
  students: number;
  byCampus: LiabilityGroup[];
  bySubject: LiabilityGroup[];
  byClassType: LiabilityGroup[];
  rows: LiabilityRow[];
};

/**
 * 每张课包「已排未核销」的课时。
 *
 * 一对一看 ScheduledLesson，班课看 GroupSession —— 班课的课时是按课次
 * 给全班成员各扣一份的，只查一对一那张表会把班课学生的待上课时算成 0。
 */
async function pendingByPackage(db: Db, packageIds: string[]): Promise<Map<string, number>> {
  const pending = new Map<string, number>();
  if (!packageIds.length) return pending;

  const add = (id: string, h: number) => pending.set(id, (pending.get(id) ?? 0) + h);

  const lessons = await db.scheduledLesson.findMany({
    where: { packageId: { in: packageIds } },
    include: { log: { include: { deductions: true } } },
  });
  for (const l of lessons) {
    const settled = l.log?.deductions.some((d) => !d.reversedAt);
    if (!settled) add(l.packageId, lessonHours(l.startTime, l.endTime));
  }

  // 班课：成员在册期间、尚未核销的课次，每次课按课次时长各占一份。
  const members = await db.groupClassMember.findMany({
    where: { packageId: { in: packageIds }, leftAt: null },
    select: { packageId: true, classId: true },
  });
  if (members.length) {
    const sessions = await db.groupSession.findMany({
      where: {
        classId: { in: [...new Set(members.map((m) => m.classId))] },
        status: { not: GroupSessionStatus.CONFIRMED },
      },
      select: { classId: true, startTime: true, endTime: true },
    });
    const byClass = new Map<string, number>();
    for (const s of sessions) {
      byClass.set(s.classId, (byClass.get(s.classId) ?? 0) + lessonHours(s.startTime, s.endTime));
    }
    for (const m of members) add(m.packageId, byClass.get(m.classId) ?? 0);
  }

  for (const [id, h] of pending) pending.set(id, roundHours(h));
  return pending;
}

/** 把明细按某个维度汇总。 */
function groupBy(
  rows: LiabilityRow[],
  keyOf: (r: LiabilityRow) => { key: string; label: string },
): LiabilityGroup[] {
  const acc = new Map<string, LiabilityGroup & { studentIds: Set<string> }>();
  for (const r of rows) {
    const { key, label } = keyOf(r);
    let g = acc.get(key);
    if (!g) {
      g = { key, label, hours: 0, amount: 0, pendingHours: 0, packages: 0, students: 0, studentIds: new Set() };
      acc.set(key, g);
    }
    g.hours += r.remainingHours;
    g.amount += r.amount;
    g.pendingHours += r.pendingHours;
    g.packages += 1;
    g.studentIds.add(r.studentId);
  }
  return [...acc.values()]
    .map(({ studentIds, ...g }) => ({
      ...g,
      hours: roundHours(g.hours),
      amount: roundMoney(g.amount),
      pendingHours: roundHours(g.pendingHours),
      students: studentIds.size,
    }))
    .sort((a, b) => b.amount - a.amount);
}

/**
 * 生成负债报表。campusScope 直接传 permissions.campusScope() 的结果，
 * undefined 表示不限校区（超管）。
 */
export async function buildLiabilityReport(
  db: Db,
  opts: { campusScope?: { in: string[] } } = {},
): Promise<LiabilityReport> {
  const packages = await db.coursePackage.findMany({
    where: {
      status: PackageStatus.ACTIVE,
      remainingHours: { gt: 0 },
      ...(opts.campusScope ? { student: { campusId: opts.campusScope } } : {}),
    },
    include: {
      student: { select: { id: true, name: true, campusId: true, campus: { select: { name: true } } } },
      subject: { select: { name: true } },
      grade: { select: { name: true } },
    },
  });

  const pending = await pendingByPackage(db, packages.map((p) => p.id));

  const rows: LiabilityRow[] = packages.map((p) => {
    const remainingHours = roundHours(Number(p.remainingHours));
    const pricePerHour = roundMoney(Number(p.pricePerHour));
    return {
      packageId: p.id,
      studentId: p.studentId,
      studentName: p.student.name,
      campusId: p.student.campusId,
      campusName: p.student.campus.name,
      subjectName: p.subject.name,
      gradeName: p.grade.name,
      classType: p.classType,
      remainingHours,
      pricePerHour,
      amount: lineAmount(remainingHours, pricePerHour),
      pendingHours: pending.get(p.id) ?? 0,
    };
  }).sort((a, b) => b.amount - a.amount);

  return {
    totalHours: roundHours(rows.reduce((s, r) => s + r.remainingHours, 0)),
    totalAmount: roundMoney(rows.reduce((s, r) => s + r.amount, 0)),
    totalPendingHours: roundHours(rows.reduce((s, r) => s + r.pendingHours, 0)),
    packages: rows.length,
    students: new Set(rows.map((r) => r.studentId)).size,
    byCampus: groupBy(rows, (r) => ({ key: r.campusId, label: r.campusName })),
    bySubject: groupBy(rows, (r) => ({ key: r.subjectName, label: r.subjectName })),
    byClassType: groupBy(rows, (r) => ({ key: r.classType, label: r.classType })),
    rows,
  };
}
