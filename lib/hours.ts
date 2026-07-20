/**
 * 课时计算的唯一来源。
 *
 * 课时是 SQLite 里的 REAL（浮点），直接相加减会累积二进制误差 ——
 * 余额可能出现 -0.0000001 这种，既显示难看又会让「>= 0」判断误判。
 * 所有涉及课时的读写都过一遍 roundHours。
 */

/** 保留两位小数（0.01h ≈ 36 秒），足够覆盖 1.5h 这类非整课时。 */
export function roundHours(hours: number): number {
  return Math.round(hours * 100) / 100;
}

/** 一节课的时长（小时），由起止时间算得。用 epoch 毫秒，与时区/DST 无关。 */
export function lessonHours(start: Date, end: Date): number {
  return roundHours((end.getTime() - start.getTime()) / 3_600_000);
}

/** 续费预警阈值：生效课包剩余低于此值即提示续费。 */
export const LOW_HOURS_THRESHOLD = 5;

/** 生效课包剩余是否已耗尽（不可再排课）。 */
export function isDepleted(remaining: number | string): boolean {
  return roundHours(Number(remaining)) <= 0;
}

/** 生效课包剩余是否触发续费预警（0 < 剩余 < 阈值）。已耗尽不算预警，用 isDepleted。 */
export function isLowOnHours(remaining: number | string): boolean {
  const r = roundHours(Number(remaining));
  return r > 0 && r < LOW_HOURS_THRESHOLD;
}
