/**
 * 线索字段的中文标签（客户端可用，纯函数）。
 * 让学生列表/详情展示的信息与导入时的字段一致。
 */

// 来源大类：兼容新枚举与旧数据（OUTREACH/AD）。
export const SOURCE_CATEGORY_LABELS: Record<string, string> = {
  OFFLINE_EVENT: "线下活动",
  ONLINE_CHANNEL: "线上渠道",
  REFERRAL: "转介绍",
  OTHER: "其他",
  OUTREACH: "地推", // 旧数据
  AD: "广告",       // 旧数据
};

export const CONTACT_APP_LABELS: Record<string, string> = {
  PHONE: "电话", WECHAT: "微信", XIAOHONGSHU: "小红书", WHATSAPP: "WhatsApp", OTHER: "其他",
};

export const LEAD_STATUS_LABELS: Record<string, string> = {
  NEW: "新线索", CONTACTED: "已联系", LOST: "已流失",
};

// 学员完整生命周期：漏斗三态（派生自 leadInfo.status）+ 由课包派生的在读/已结课。
export const STAGE_LABELS: Record<string, string> = {
  NEW: "新线索", CONTACTED: "已联系", LOST: "已流失",
  ENROLLED: "在读", COMPLETED: "已结课",
};
export const STAGE_COLORS: Record<string, string> = {
  NEW: "bg-indigo-100 text-indigo-700",
  CONTACTED: "bg-amber-100 text-amber-700",
  LOST: "bg-slate-100 text-slate-500",
  ENROLLED: "bg-green-100 text-green-700",
  COMPLETED: "bg-sky-100 text-sky-700",
};
/** 是否漏斗态（纯线索，可标记流失/激活）。 */
export const FUNNEL_STAGES = ["NEW", "CONTACTED", "LOST"] as const;

export type LeadInfo = {
  source: string;
  status?: string;
  sourceCategory?: string | null;
  sourceDetail?: string | null;
  subjectsOfInterest?: string | null;
  campaign?: { name: string } | null;
} | null | undefined;

export type PackageLite = { status: string; remainingHours: number | string };

/**
 * 学员当前阶段（唯一判定，业务流不变）：
 * - 有生效课包(ACTIVE 且剩余>0) → 在读（在读优先，不会同时是已流失）
 * - 曾开过生效课包但课时已耗尽(剩余 0) → 已结课
 * - 从没生效过课包 → 纯线索，用漏斗状态 NEW/CONTACTED/LOST
 */
export function deriveStage(packages: PackageLite[] | undefined, lead: LeadInfo): string {
  const pkgs = packages ?? [];
  const hasActive = pkgs.some((p) => p.status === "ACTIVE" && Number(p.remainingHours) > 0);
  if (hasActive) return "ENROLLED";
  const hadConfirmed = pkgs.some((p) => p.status === "ACTIVE");
  if (hadConfirmed) return "COMPLETED";
  return lead?.status ?? "NEW";
}

export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

/** 来源大类的中文名（详情页用）。 */
export function sourceCategoryLabel(lead: LeadInfo): string {
  if (!lead) return "—";
  const code = lead.sourceCategory ?? lead.source;
  return SOURCE_CATEGORY_LABELS[code] ?? code ?? "—";
}

/** 列表用的精简来源：优先显示明细，否则大类中文名。 */
export function sourceShort(lead: LeadInfo): string {
  if (!lead) return "—";
  if (lead.sourceDetail) return lead.sourceDetail;
  return sourceCategoryLabel(lead);
}

/** 状态标签：已报名显示「在读」，否则显示漏斗状态。 */
export function leadStatusLabel(isEnrolled: boolean | undefined, lead: LeadInfo): string {
  if (isEnrolled) return "在读";
  return LEAD_STATUS_LABELS[lead?.status ?? "NEW"] ?? "线索";
}
