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

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * 该课包「已排但还没核销」的课时数。
 * 这部分课时虽然还在 remainingHours 里，但已经占用给了具体课程，
 * 不能拿去退费/转化，否则课上完就没课时可扣了。
 */
export async function pendingScheduledHours(db: Db, packageId: string): Promise<number> {
  const lessons = await db.scheduledLesson.findMany({
    where: { packageId },
    include: { log: { include: { deductions: true } } },
  });
  return roundHours(
    lessons
      .filter((l) => !l.log || !l.log.deductions.some((d) => !d.reversedAt))
      .reduce((sum, l) => sum + lessonHours(l.startTime, l.endTime), 0),
  );
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
