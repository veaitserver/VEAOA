// Enum constants for SQLite (which stores as strings)
export const Role = {
  SUPER_ADMIN: "SUPER_ADMIN",
  HR: "HR",
  SALES: "SALES",
  TEACHER: "TEACHER",
  ACADEMIC_ADMIN: "ACADEMIC_ADMIN",
  PRINCIPAL: "PRINCIPAL",
  FINANCE: "FINANCE",
  STUDENT_MANAGER: "STUDENT_MANAGER", // 学管：校长确认课包时分配，负责学生学业管理
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const LeadSource = {
  OUTREACH: "OUTREACH",
  REFERRAL: "REFERRAL",
  AD: "AD",
  OTHER: "OTHER",
} as const;
export type LeadSource = (typeof LeadSource)[keyof typeof LeadSource];

// 线索转化前的漏斗状态。业务流不变：线索学生仍只能通过「建课包」转为在读，
// 所以 ENROLLED 是派生的（有生效课包即在读，沿用现有 isEnrolled），
// 不由 funnel 写入 —— funnel 只在 NEW / CONTACTED / LOST 之间流转。
export const LeadStatus = {
  NEW: "NEW",
  CONTACTED: "CONTACTED",
  LOST: "LOST",
} as const;
export type LeadStatus = (typeof LeadStatus)[keyof typeof LeadStatus];

// 营销来源大类：线下活动 / 线上渠道 / 转介绍 / 其他。source_detail 是自由文本
// （如「Markham 数学展 2026」「小红书」）。
export const SourceCategory = {
  OFFLINE_EVENT: "OFFLINE_EVENT",
  ONLINE_CHANNEL: "ONLINE_CHANNEL",
  REFERRAL: "REFERRAL",
  OTHER: "OTHER",
} as const;
export type SourceCategory = (typeof SourceCategory)[keyof typeof SourceCategory];

// 家长偏好的联系方式 App。用于去重的 contact_app_id（微信号/小红书号等）。
export const ContactApp = {
  PHONE: "PHONE",
  WECHAT: "WECHAT",
  XIAOHONGSHU: "XIAOHONGSHU",
  WHATSAPP: "WHATSAPP",
  OTHER: "OTHER",
} as const;
export type ContactApp = (typeof ContactApp)[keyof typeof ContactApp];

// 导入来源与结果，写入 LeadImportLog 便于排障。
export const ImportSource = {
  API: "API",
  CSV: "CSV",
  PUBLIC_FORM: "PUBLIC_FORM",
  MANUAL: "MANUAL", // 后台手动逐条录入（与 CSV/表单共用导入核心）
} as const;
export type ImportSource = (typeof ImportSource)[keyof typeof ImportSource];

export const ImportResult = {
  CREATED: "CREATED",
  MERGED: "MERGED",
  REJECTED: "REJECTED",
} as const;
export type ImportResult = (typeof ImportResult)[keyof typeof ImportResult];

export const ContactMethod = {
  PHONE: "PHONE",
  WECHAT: "WECHAT",
} as const;
export type ContactMethod = (typeof ContactMethod)[keyof typeof ContactMethod];

// 课包审批两步：待校长确认 → 待财务确认 → 已生效(ACTIVE)。生效后才能排课。
export const PackageStatus = {
  PENDING_APPROVAL: "PENDING_APPROVAL", // 待校长确认
  PENDING_FINANCE: "PENDING_FINANCE",   // 校长已确认，待财务确认
  ACTIVE: "ACTIVE",                     // 财务确认，正式生效
} as const;
export type PackageStatus = (typeof PackageStatus)[keyof typeof PackageStatus];

export const PACKAGE_STATUS_LABELS: Record<string, string> = {
  PENDING_APPROVAL: "待校长确认",
  PENDING_FINANCE: "待财务确认",
  ACTIVE: "已生效",
};

// 签约类型：学生首张课包为新签（销售从线索成交），之后均为续费（由学管负责）。
export const SigningType = {
  NEW_SIGN: "NEW_SIGN", // 新签
  RENEWAL: "RENEWAL",   // 续费
} as const;
export type SigningType = (typeof SigningType)[keyof typeof SigningType];

export const SIGNING_TYPE_LABELS: Record<string, string> = {
  NEW_SIGN: "新签",
  RENEWAL: "续费",
};

// 授课形式。只有班课(GROUP)课包能加入班级；一对一走单人排课。
export const ClassType = {
  ONE_ON_ONE: "ONE_ON_ONE",
  GROUP: "GROUP",
} as const;
export type ClassType = (typeof ClassType)[keyof typeof ClassType];

export const CLASS_TYPE_LABELS: Record<string, string> = {
  ONE_ON_ONE: "一对一",
  GROUP: "班课",
};

// 账本流水类型。正负号约定：+ 价值进入学生账户，− 价值离开。
// 余额 = 全部流水之和；正常结清后应为 0。
export const LedgerType = {
  PAYMENT: "PAYMENT",               // 收款：签约/续费/补款，家长交钱 (+)
  PACKAGE_CHARGE: "PACKAGE_CHARGE", // 课包扣款：建/生效课包占用账户价值 (−)
  REFUND_CREDIT: "REFUND_CREDIT",   // 退课入账：课包剩余价值退回账户 (+)
  REFUND_PAYOUT: "REFUND_PAYOUT",   // 退款打出：钱实际退给家长 (−)
} as const;
export type LedgerType = (typeof LedgerType)[keyof typeof LedgerType];

export const LEDGER_TYPE_LABELS: Record<string, string> = {
  PAYMENT: "收款",
  PACKAGE_CHARGE: "课包扣款",
  REFUND_CREDIT: "退课入账",
  REFUND_PAYOUT: "退款打出",
};

// 退费两步审批：学管发起 → 校长审核 → 财务复核打款。
export const RefundStatus = {
  PENDING_APPROVAL: "PENDING_APPROVAL", // 待校长审核
  PENDING_FINANCE: "PENDING_FINANCE",   // 校长已审核，待财务复核打款
  PAID: "PAID",                         // 已退款
  REJECTED: "REJECTED",                 // 已驳回
} as const;
export type RefundStatus = (typeof RefundStatus)[keyof typeof RefundStatus];

export const REFUND_STATUS_LABELS: Record<string, string> = {
  PENDING_APPROVAL: "待校长审核",
  PENDING_FINANCE: "待财务打款",
  PAID: "已退款",
  REJECTED: "已驳回",
};

// 考勤状态。扣不扣课时由 lib/attendance 的 shouldDeductHours 统一裁决，
// 不要在各路由里各写一套判断。
export const AttendanceStatus = {
  PRESENT: "PRESENT",   // 到课
  LEAVE: "LEAVE",       // 请假（提前告知）
  NO_SHOW: "NO_SHOW",   // 旷课（未到且未请假）
} as const;
export type AttendanceStatus = (typeof AttendanceStatus)[keyof typeof AttendanceStatus];

export const ATTENDANCE_LABELS: Record<string, string> = {
  PRESENT: "到课",
  LEAVE: "请假",
  NO_SHOW: "旷课",
};

export const LessonType = {
  ONE_ON_ONE: "ONE_ON_ONE",
  GROUP: "GROUP",
} as const;
export type LessonType = (typeof LessonType)[keyof typeof LessonType];
