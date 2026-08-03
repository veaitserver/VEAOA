/**
 * 时区助手。机构在安大略（America/Toronto），排课/跟进的"次日"以多伦多本地日历为准，
 * 而不是服务器时区（部署在 UTC 上会差一天）。
 */

const TZ = "America/Toronto";

/** 某 UTC 时刻在多伦多的时区偏移（毫秒）：多伦多墙钟读数 − UTC 读数。 */
function torontoOffsetMs(utcMs: number): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  // hour 可能是 "24"（午夜），归零。
  const hour = p.hour === "24" ? 0 : Number(p.hour);
  const asIfUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute), Number(p.second));
  return asIfUtc - utcMs;
}

/**
 * 把「多伦多墙钟」的日期+时间转成正确的 UTC 时刻。
 * 排课录入的 16:00 指的是多伦多 16:00，不能按录入者浏览器所在时区解释。
 * @param dateStr "YYYY-MM-DD"  @param timeStr "HH:MM"
 */
export function torontoWallTimeToUtc(dateStr: string, timeStr: string): Date {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, mi] = timeStr.split(":").map(Number);
  const guessUtc = Date.UTC(y, mo - 1, d, h, mi);
  // 用「假设为 UTC 的那个时刻」的多伦多偏移反推真实 UTC（DST 切换那一小时内可能差 1h，业务可接受）。
  return new Date(guessUtc - torontoOffsetMs(guessUtc));
}

/** 某时刻在多伦多的墙钟时/分。 */
export function torontoClock(d: Date): { hour: number; minute: number } {
  const off = torontoOffsetMs(d.getTime());
  const local = new Date(d.getTime() + off);
  return { hour: local.getUTCHours(), minute: local.getUTCMinutes() };
}

/** 某时刻在多伦多的日历日 key："YYYY-MM-DD"。用于按天分组/比较。 */
export function torontoDateKey(d: Date): string {
  const off = torontoOffsetMs(d.getTime());
  return new Date(d.getTime() + off).toISOString().slice(0, 10);
}

/**
 * 日历日推算：直接在 "YYYY-MM-DD" 上加减天数。
 * 用 UTC 正午做锚点，跨夏令时也不会掉到前一天或后一天。
 */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" 是周几（0=周日 … 6=周六）。 */
export function weekdayOfDateKey(dateKey: string): number {
  return new Date(`${dateKey}T12:00:00.000Z`).getUTCDay();
}

/** 某时刻在多伦多的墙钟时间字符串 "HH:MM"（24 小时制）。 */
export function formatTorontoTime(d: Date): string {
  const { hour, minute } = torontoClock(d);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

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
