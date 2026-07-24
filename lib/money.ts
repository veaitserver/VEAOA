/**
 * 金额计算的唯一来源。
 *
 * 金额是 SQLite 里的 REAL（浮点），10h × $66.7 这类相乘会累积二进制误差，
 * 账本流水一相加就会出现 $0.0000001 的尾巴，导致"余额应为 0"判不平。
 * 所有涉及金额的读写都过一遍 roundMoney。
 */

/** 四舍五入到分。 */
export function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** 两个金额是否相等（容差半分，吸收浮点误差）。 */
export function moneyEquals(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

/** 课时 × 单价 = 金额，统一入口，保证四舍五入口径一致。 */
export function lineAmount(hours: number, pricePerHour: number): number {
  return roundMoney(hours * pricePerHour);
}
