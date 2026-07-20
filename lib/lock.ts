/**
 * 核销的财务锁：确认满一周自动锁定，锁定后不能撤销；财务可对单条解锁以便更正。
 * 纯函数，客户端与服务端共用。
 */
export const LOCK_DAYS = 7;
const LOCK_MS = LOCK_DAYS * 24 * 60 * 60 * 1000;

export type LockableDeduction = {
  createdAt: string | Date;
  financeUnlockedAt?: string | Date | null;
};

/** 该核销是否已自动锁定（确认满 7 天且未被财务解锁）。 */
export function isDeductionLocked(d: LockableDeduction | null | undefined, now: Date = new Date()): boolean {
  if (!d) return false;
  if (d.financeUnlockedAt) return false; // 财务已解锁
  const created = typeof d.createdAt === "string" ? new Date(d.createdAt) : d.createdAt;
  return now.getTime() - created.getTime() >= LOCK_MS;
}
