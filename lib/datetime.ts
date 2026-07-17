/**
 * 时区助手。机构在安大略（America/Toronto），排课/跟进的"次日"以多伦多本地日历为准，
 * 而不是服务器时区（部署在 UTC 上会差一天）。
 */

const TZ = "America/Toronto";

/** 取某个时刻在多伦多的日历年月日。 */
function torontoParts(d: Date): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

/**
 * 多伦多"明天 09:00"对应的 UTC 时刻。活动线索要求 24–48 小时内联系，
 * 次日上午是自然的跟进时点。
 */
export function nextFollowUpDate(from: Date = new Date()): Date {
  const { year, month, day } = torontoParts(from);
  // 用 UTC 构造当天，再 +1 天，避免服务器本地时区干扰日期运算。
  const base = new Date(Date.UTC(year, month - 1, day));
  base.setUTCDate(base.getUTCDate() + 1);
  // 多伦多 09:00 ≈ UTC 13:00/14:00（DST），取 13:00Z 作为稳定近似即可，
  // 跟进日期只精确到"天"，小时不影响业务判断。
  base.setUTCHours(13, 0, 0, 0);
  return base;
}
