/**
 * 重复排课的日期展开。
 *
 * 只负责「按规则算出哪些天要上课」，不碰冲突与库存 —— 那些逐次校验由排课
 * 接口做。日期一律按多伦多日历日展开，跨夏令时仍保持同一钟点。
 */
import { addDaysToDateKey, weekdayOfDateKey } from "./datetime";

/** 单次生成的上限，防止手滑排出几百节课。 */
export const MAX_OCCURRENCES = 60;
/** 最长排到多久以后（天）。 */
const MAX_SPAN_DAYS = 366;

export type Frequency = "DAILY" | "WEEKDAYS" | "WEEKLY";

export type RecurrenceRule = {
  /** 起始日历日 "YYYY-MM-DD"（多伦多）。 */
  startDate: string;
  frequency: Frequency;
  /** WEEKLY 时指定周几（0=周日…6=周六），可多选；留空则用起始日那天的星期。 */
  weekdays?: number[];
  /** 结束条件三选一。 */
  until:
    | { type: "weeks"; value: number }
    | { type: "date"; value: string }
    | { type: "count"; value: number };
};

/**
 * 展开成一串日历日。
 * 起始日当天若符合规则也会包含在内。
 */
export function expandRecurrence(rule: RecurrenceRule): string[] {
  const dates: string[] = [];

  const wanted = new Set(
    rule.frequency === "WEEKLY"
      ? (rule.weekdays?.length ? rule.weekdays : [weekdayOfDateKey(rule.startDate)])
      : [],
  );

  const maxCount = rule.until.type === "count"
    ? Math.min(rule.until.value, MAX_OCCURRENCES)
    : MAX_OCCURRENCES;

  const lastDate = rule.until.type === "date"
    ? rule.until.value
    : rule.until.type === "weeks"
      // N 周 = 从起始日算起 N×7 天（含最后一天）
      ? addDaysToDateKey(rule.startDate, rule.until.value * 7 - 1)
      : addDaysToDateKey(rule.startDate, MAX_SPAN_DAYS);

  let cursor = rule.startDate;
  let guard = 0;
  while (dates.length < maxCount && cursor <= lastDate && guard < MAX_SPAN_DAYS) {
    const dow = weekdayOfDateKey(cursor);
    const hit =
      rule.frequency === "DAILY" ? true
      : rule.frequency === "WEEKDAYS" ? dow >= 1 && dow <= 5
      : wanted.has(dow);
    if (hit) dates.push(cursor);
    cursor = addDaysToDateKey(cursor, 1);
    guard += 1;
  }

  return dates;
}

/** 人话描述，用于界面回显与确认。 */
export function describeRecurrence(rule: RecurrenceRule, count: number): string {
  const DOW = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const freq =
    rule.frequency === "DAILY" ? "每天"
    : rule.frequency === "WEEKDAYS" ? "每个工作日"
    : `每${(rule.weekdays?.length ? rule.weekdays : [weekdayOfDateKey(rule.startDate)])
        .slice().sort().map((d) => DOW[d]).join("、")}`;
  return `${freq}，共 ${count} 次`;
}
