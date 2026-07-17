import { NextResponse } from "next/server";
import { importLead, type LeadImportInput } from "@/lib/leadImport";
import { z } from "zod";

/**
 * 线索导入端点（机器对机器，如 Google Forms 的 Apps Script 调用）。
 * 用静态 API key 走请求头校验，不走登录会话（proxy.ts 的 matcher 不含 /api/leads）。
 *
 * 校区来源：优先 campaign_token（campaign 携带校区/来源），否则用 payload 里的
 * 显式 campus（校区 id）。两者都无则拒绝。去重/分配/合并全部走 lib/leadImport。
 */
const payloadSchema = z.object({
  parent_name: z.string().min(1),
  phone: z.string().min(1),
  preferred_contact_app: z.string().optional().nullable(),
  contact_app_id: z.string().optional().nullable(),
  grade: z.string().optional().nullable(),
  subjects_of_interest: z.string().optional().nullable(),
  source_category: z.string().optional().nullable(),
  source_detail: z.string().optional().nullable(),
  postal_code: z.string().optional().nullable(),
  campaign_token: z.string().optional().nullable(),
  campus: z.string().optional().nullable(), // 无 campaign 时的显式校区 id
});

export async function POST(req: Request) {
  const configured = process.env.LEAD_IMPORT_API_KEY;
  if (!configured) {
    return NextResponse.json({ error: "服务端未配置 LEAD_IMPORT_API_KEY" }, { status: 500 });
  }
  const provided = req.headers.get("x-api-key");
  if (!provided || provided !== configured) {
    return NextResponse.json({ error: "无效的 API key" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const p = parsed.data;

  const input: LeadImportInput = {
    parentName: p.parent_name,
    phone: p.phone,
    preferredContactApp: p.preferred_contact_app ?? null,
    contactAppId: p.contact_app_id ?? null,
    grade: p.grade ?? null,
    subjectsOfInterest: p.subjects_of_interest ?? null,
    sourceCategory: p.source_category ?? null,
    sourceDetail: p.source_detail ?? null,
    postalCode: p.postal_code ?? null,
    campaignToken: p.campaign_token ?? null,
  };

  const outcome = await importLead(input, { source: "API", campusId: p.campus ?? null });

  if (outcome.result === "REJECTED") {
    return NextResponse.json({ result: outcome.result, error: outcome.reason }, { status: 422 });
  }
  return NextResponse.json(outcome, { status: outcome.result === "CREATED" ? 201 : 200 });
}
