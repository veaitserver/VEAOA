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

export type LeadInfo = {
  source: string;
  status?: string;
  sourceCategory?: string | null;
  sourceDetail?: string | null;
  subjectsOfInterest?: string | null;
  campaign?: { name: string } | null;
} | null | undefined;

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
