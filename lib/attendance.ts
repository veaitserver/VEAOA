/**
 * 考勤与扣课政策的唯一来源。
 *
 * 「请假扣不扣课时」原先散在 1对1 与班课两条路里各写一遍，容易两边打架。
 * 现在统一成：考勤状态 + 课包类型 → 是否扣课时。班课上线后复用同一函数，
 * 只是把状态挂在每个班级成员身上。
 */
import { AttendanceStatus } from "./enums";

/** 未标记考勤时按「到课」处理，保持既有核销行为不变。 */
export function effectiveAttendance(status: string | null | undefined): string {
  return status ?? AttendanceStatus.PRESENT;
}

/**
 * 该考勤状态是否应扣课时。
 * - 到课：扣
 * - 请假：1对1 不扣（可改期/删课）；班课照扣（座位已占，可事后手动撤销这笔）
 * - 旷课：扣（未提前告知，时段已被占用）
 */
export function shouldDeductHours(
  status: string | null | undefined,
  classType: "ONE_ON_ONE" | "GROUP" = "ONE_ON_ONE",
): boolean {
  const s = effectiveAttendance(status);
  if (s === AttendanceStatus.LEAVE) return classType === "GROUP";
  return true;
}

/** 界面提示：为什么这节课不扣课时。 */
export function noDeductReason(
  status: string | null | undefined,
  classType: "ONE_ON_ONE" | "GROUP" = "ONE_ON_ONE",
): string | null {
  if (shouldDeductHours(status, classType)) return null;
  return "1对1 请假不扣课时，可改期或删除该节课";
}
