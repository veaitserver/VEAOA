import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function formatDateTime(date: Date | string | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleString("zh-CN");
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
