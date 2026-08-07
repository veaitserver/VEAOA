/**
 * 课包结算引擎 —— 退费与（后续的）课包转化共用。
 *
 * 两者的共同动作是：算出「还能结算多少课时/多少钱」→ 关闭或减少原课包 →
 * 记账。区别只在钱的去向：退费把钱打给家长，转化把价值转成新课包。
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { lessonHours, roundHours } from "./hours";
import { lineAmount } from "./money";
import { GroupSessionStatus, PackageStatus, RefundStatus } from "./enums";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * 该课包「已排但还没核销」的课时数。
 * 这部分课时虽然还在 remainingHours 里，但已经占用给了具体课程，
 * 不能拿去退费/转化，否则课上完就没课时可扣了。
 *
 * 两张课表都要查。班课的课时不挂在 ScheduledLesson 上，而是通过
 * GroupClassMember → GroupSession 消耗；只查一对一那张表的话，班课课包的
 * 待上课时恒为 0 —— 于是「已排 3 次课」的班课学生能把课时全额退掉，
 * 等教务去核销那几次课时，整个班都会卡在「某某余额不足」上。
 */
export async function pendingScheduledHours(db: Db, packageId: string): Promise<number> {
  const lessons = await db.scheduledLesson.findMany({
    where: { packageId },
    include: { log: { include: { deductions: true } } },
  });
  const oneOnOne = lessons
    .filter((l) => !l.log || !l.log.deductions.some((d) => !d.reversedAt))
    .reduce((sum, l) => sum + lessonHours(l.startTime, l.endTime), 0);

  return roundHours(oneOnOne + (await pendingGroupHours(db, packageId)));
}

/**
 * 该课包因班课而被占用、尚未核销的课时。
 *
 * 以「排课当时固定下来的名单」(GroupSessionAttendance) 为准，而不是当前成员表：
 * 中途退班的人不该再被算，中途插班的人也不该被追溯到之前的课次。
 */
async function pendingGroupHours(db: Db, packageId: string): Promise<number> {
  const attendances = await db.groupSessionAttendance.findMany({
    where: {
      packageId,
      session: { status: { not: GroupSessionStatus.CONFIRMED } },
    },
    select: { session: { select: { startTime: true, endTime: true } } },
  });
  return attendances.reduce((sum, a) => sum + lessonHours(a.session.startTime, a.session.endTime), 0);
}

export type Settlable = {
  /** 最多可结算（退费/转化）的课时。 */
  hours: number;
  /** 剩余课时（含已排未核销）。 */
  remainingHours: number;
  /** 已排未核销、需先处理才能动的课时。 */
  pendingHours: number;
};

/**
 * 课包当前可结算的课时上限 = 剩余 − 已排未核销。
 * 想退更多，得先把已排的课取消或上掉。
 */
export async function settlableHours(
  db: Db,
  pkg: { id: string; remainingHours: number },
): Promise<Settlable> {
  const pendingHours = await pendingScheduledHours(db, pkg.id);
  const remainingHours = roundHours(Number(pkg.remainingHours));
  return {
    hours: Math.max(0, roundHours(remainingHours - pendingHours)),
    remainingHours,
    pendingHours,
  };
}

/** 结算金额 = 课时 × 原单价（退费不收手续费，按原单价直退）。 */
export function settlementAmount(hours: number, pricePerHour: number): number {
  return lineAmount(hours, pricePerHour);
}

/**
 * 这批课包里哪些已经「结算完毕」—— 已转化，或已发生退费打款。
 *
 * 结算过的课包不能再被撤销核销加回课时：转化时剩余价值已结转到新包，
 * 退费时钱已经打给家长，两种情况下把课时加回来都会让
 * 「总课时 = 已消耗 + 剩余」失衡，且账本上没有任何对应流水。
 */
export async function settledPackageIds(db: Db, packageIds: string[]): Promise<Set<string>> {
  if (!packageIds.length) return new Set();
  const [converted, refunded] = await Promise.all([
    db.coursePackage.findMany({
      where: { id: { in: packageIds }, status: PackageStatus.CONVERTED },
      select: { id: true },
    }),
    db.refundRequest.findMany({
      where: { packageId: { in: packageIds }, status: RefundStatus.PAID },
      select: { packageId: true },
    }),
  ]);
  return new Set([...converted.map((c) => c.id), ...refunded.map((r) => r.packageId)]);
}
