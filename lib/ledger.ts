/**
 * 学生账户账本。
 *
 * 每个学生一串流水，余额 = 全部流水 amount 之和：
 *   + 价值进入账户（家长交钱 PAYMENT、课包剩余价值退回 REFUND_CREDIT）
 *   − 价值离开账户（建课包占用 PACKAGE_CHARGE、实际退款打出 REFUND_PAYOUT）
 *
 * 一次业务动作可能写多条流水，必须在同一事务里完成，否则会出现
 * 「退了课时却没记退款」这类对不上账的中间态：
 *   退费   = REFUND_CREDIT(+) + REFUND_PAYOUT(−)              → 余额不变，钱出去了
 *   转化   = REFUND_CREDIT(+) + PAYMENT(补款 +) + PACKAGE_CHARGE(−) → 余额不变，钱没出去
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { roundMoney } from "./money";
import { LedgerType } from "./enums";

/** 事务内外通用的 Prisma 客户端。 */
type Db = Prisma.TransactionClient | typeof prisma;

export type LedgerDraft = {
  studentId: string;
  type: LedgerType;
  /** 正负号由调用方给定，写入前统一四舍五入到分。 */
  amount: number;
  packageId?: string | null;
  refundId?: string | null;
  note?: string | null;
};

/** 批量写入流水（须在业务事务内调用，与课时变更同生共死）。 */
export async function recordEntries(
  tx: Prisma.TransactionClient,
  actorId: string,
  drafts: LedgerDraft[],
): Promise<void> {
  for (const d of drafts) {
    await tx.ledgerEntry.create({
      data: {
        studentId: d.studentId,
        type: d.type,
        amount: roundMoney(d.amount),
        packageId: d.packageId ?? null,
        refundId: d.refundId ?? null,
        note: d.note ?? null,
        createdById: actorId,
      },
    });
  }
}

/** 学生账户余额 = 流水累加（四舍五入到分，消除浮点尾巴）。 */
export async function studentBalance(db: Db, studentId: string): Promise<number> {
  const agg = await db.ledgerEntry.aggregate({
    where: { studentId },
    _sum: { amount: true },
  });
  return roundMoney(Number(agg._sum.amount ?? 0));
}

/**
 * 退费的两条流水：剩余价值退回账户，再把钱打出去。
 * 余额净变化为 0 —— 账面上「课时没了、钱也出去了」，两边都留痕。
 */
export function refundDrafts(args: {
  studentId: string;
  packageId: string;
  refundId: string;
  amount: number;
  hours: number;
}): LedgerDraft[] {
  const note = `退费 ${args.hours}h`;
  return [
    { studentId: args.studentId, type: LedgerType.REFUND_CREDIT, amount: args.amount, packageId: args.packageId, refundId: args.refundId, note: `${note}：课包剩余价值退回账户` },
    { studentId: args.studentId, type: LedgerType.REFUND_PAYOUT, amount: -args.amount, packageId: args.packageId, refundId: args.refundId, note: `${note}：退款打给家长` },
  ];
}
