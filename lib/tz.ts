import { TIMEZONE } from "./utils";

/**
 * 「今天」在服务器端要按多伦多时区算，而不是 new Date().setHours(0,0,0,0)
 * ——后者用的是服务器本地时区，部署到 UTC 机器上午夜前后的「今天」会错一整段。
 *
 * 返回今天（多伦多）零点到次日零点的 UTC 瞬时区间 { gte, lt }。
 */
export function torontoDayRange(now: Date = new Date()): { gte: Date; lt: Date } {
  // 取 now 在多伦多的墙上日期（en-CA 给出 YYYY-MM-DD）。
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now); // e.g. "2026-07-17"

  const start = zonedMidnight(ymd);
  const lt = new Date(start.getTime() + 24 * 3600 * 1000);
  return { gte: start, lt };
}

/** 给定多伦多墙上日期 YYYY-MM-DD，返回那天零点对应的 UTC 瞬时。 */
function zonedMidnight(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  // 先把墙上时间当成 UTC，再用当时的多伦多偏移修正回真正的 UTC 瞬时。
  const asUTC = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offsetMs = torontoOffsetMs(new Date(asUTC));
  return new Date(asUTC - offsetMs);
}

/** date 这一瞬时多伦多相对 UTC 的偏移（毫秒，东为负、西为正的相反数——见下）。 */
function torontoOffsetMs(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asIfUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asIfUTC - date.getTime();
}
