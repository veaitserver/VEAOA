import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canImportLeads, denyCrossCampus, type SessionUser } from "@/lib/permissions";
import { importLead, type LeadImportInput } from "@/lib/leadImport";
import { z } from "zod";

/**
 * CSV 批量导入线索（登录校长操作）。校区由校长选定（多校区时前端弹选），
 * 每行走与 API/公开表单相同的共享导入核心。返回逐行结果供前端显示成败。
 */
const rowSchema = z.object({
  student_name: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  preferred_contact_app: z.string().optional().nullable(),
  contact_app_id: z.string().optional().nullable(),
  grade: z.string().optional().nullable(),
  subjects_of_interest: z.string().optional().nullable(),
  source_category: z.string().optional().nullable(),
  source_detail: z.string().optional().nullable(),
  postal_code: z.string().optional().nullable(),
  campaign_token: z.string().optional().nullable(),
}).passthrough();

const bodySchema = z.object({
  campusId: z.string().min(1),
  rows: z.array(rowSchema).min(1).max(1000),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sessionUser = session.user as SessionUser;
  if (!canImportLeads(sessionUser)) return NextResponse.json({ error: "无权导入线索" }, { status: 403 });

  const body = await req.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const { campusId, rows } = parsed.data;

  // 校区必须是本人有权的（前端弹选，这里兜底）。
  const denied = denyCrossCampus(sessionUser, campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  const results: { line: number; result: string; reason?: string; studentId?: string }[] = [];
  const summary = { created: 0, merged: 0, rejected: 0 };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const input: LeadImportInput = {
      studentName: r.student_name ?? "",
      phone: r.phone ?? "",
      preferredContactApp: r.preferred_contact_app ?? null,
      contactAppId: r.contact_app_id ?? null,
      grade: r.grade ?? null,
      subjectsOfInterest: r.subjects_of_interest ?? null,
      sourceCategory: r.source_category ?? null,
      sourceDetail: r.source_detail ?? null,
      postalCode: r.postal_code ?? null,
      campaignToken: r.campaign_token ?? null,
    };
    const outcome = await importLead(input, { source: "CSV", campusId, actorId: sessionUser.id });
    if (outcome.result === "CREATED") { summary.created++; results.push({ line: i + 1, result: "CREATED", studentId: outcome.studentId }); }
    else if (outcome.result === "MERGED") { summary.merged++; results.push({ line: i + 1, result: "MERGED", studentId: outcome.studentId }); }
    else { summary.rejected++; results.push({ line: i + 1, result: "REJECTED", reason: outcome.reason }); }
  }

  return NextResponse.json({ summary, results });
}
