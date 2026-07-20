import { prisma } from "./prisma";

/** 某时刻在多伦多的月份键 "YYYY-MM"（锁账按此归月）。 */
export function monthKey(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto", year: "numeric", month: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  return `${y}-${m}`;
}

/** 该校区、该课程所在月份是否已被财务锁账。 */
export async function isMonthLocked(campusId: string, lessonStart: Date): Promise<boolean> {
  const lock = await prisma.monthLock.findUnique({
    where: { campusId_month: { campusId, month: monthKey(lessonStart) } },
    select: { id: true },
  });
  return !!lock;
}
