import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// 机构在安大略；日期时间一律按多伦多时区显示，避免家长/员工从别的时区
// 打开时看到偏移的时间。
export const TIMEZONE = "America/Toronto";

export function formatDate(date: Date | string | null): string {
  if (!date) return "—";
  // en-CA 输出 ISO 风格 2026-07-17，是加拿大通行写法。
  return new Date(date).toLocaleDateString("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function formatTime(date: Date | string | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleTimeString("en-CA", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatDateTime(date: Date | string | null): string {
  if (!date) return "—";
  return `${formatDate(date)} ${formatTime(date)}`;
}

/** 北美电话号码：10 位 → (647) 000-0001，带国家码 1 的 11 位也认。 */
export function formatPhone(phone: string | null): string {
  if (!phone) return "—";
  const d = phone.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length !== 10) return phone; // 非标准长度原样返回
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

export function formatHours(hours: number | string | null): string {
  if (hours === null || hours === undefined) return "—";
  return `${Number(hours).toFixed(1)}h`;
}

// 机构在安大略（GTA），一律加币。
export function formatMoney(amount: number | string | null): string {
  if (amount === null || amount === undefined) return "—";
  return `$${Number(amount).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 课时单价，如 $80/h（整数，无小数）。 */
export function formatRate(amount: number | string | null): string {
  if (amount === null || amount === undefined) return "—";
  return `$${Number(amount).toLocaleString("en-CA", { maximumFractionDigits: 2 })}/h`;
}
