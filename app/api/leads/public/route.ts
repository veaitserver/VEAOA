import { NextResponse } from "next/server";
import { importLead, type LeadImportInput } from "@/lib/leadImport";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { z } from "zod";

/**
 * 公开捕获表单的提交端点（无需登录）。校区/来源来自 campaign token，家长不填。
 * 反垃圾：蜜罐字段 + 按 IP 限流；不用 CAPTCHA，保持零摩擦。
 */
// 公开无登录端点：所有字段加长度上限，防止超长字符串灌库。
const schema = z.object({
  token: z.string().min(1).max(200),
  studentName: z.string().min(1).max(100),
  phone: z.string().min(1).max(30),
  preferredContactApp: z.string().max(30).optional().nullable(),
  contactAppId: z.string().max(100).optional().nullable(),
  grade: z.string().max(50).optional().nullable(),
  subjectsOfInterest: z.string().max(200).optional().nullable(),
  postalCode: z.string().max(20).optional().nullable(),
  // 蜜罐：正常用户看不到、不会填；被填了即判为机器人。
  website: z.string().max(200).optional().nullable(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "请填写必要信息" }, { status: 400 });
  }
  const d = parsed.data;

  // 蜜罐命中：假装成功，不建线索、不给机器人任何反馈信号。
  if (d.website && d.website.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  // 按 IP 限流：每 10 分钟最多 5 次提交。
  const ip = clientIp(req);
  if (!rateLimit(`join:${ip}`, { limit: 5, windowMs: 10 * 60 * 1000 })) {
    return NextResponse.json({ error: "提交过于频繁，请稍后再试" }, { status: 429 });
  }

  const input: LeadImportInput = {
    studentName: d.studentName,
    phone: d.phone,
    preferredContactApp: d.preferredContactApp ?? null,
    contactAppId: d.contactAppId ?? null,
    grade: d.grade ?? null,
    subjectsOfInterest: d.subjectsOfInterest ?? null,
    postalCode: d.postalCode ?? null,
    campaignToken: d.token,
  };

  const outcome = await importLead(input, { source: "PUBLIC_FORM" });

  // 对公众只回成功/失败，不泄露内部去重/合并细节。
  if (outcome.result === "REJECTED") {
    return NextResponse.json({ error: "提交失败，请检查信息或稍后再试" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
