/**
 * 线索导入的唯一代码路径 —— API、CSV、公开表单三个入口共用。
 *
 * 业务约束（不可变）：线索就是「线索学生」（Student + Lead 记录），
 * 转为在读的唯一途径仍是给该学生建课包。本模块只负责把外部线索
 * 落成「线索学生」，不碰课包/在读那条流程。
 *
 * 流程：规范化 → 去重（电话 或 联系App账号）→ 建档 或 合并 → 校区内轮询分配
 *      → 追加跟进（次日回访）→ 写导入日志。
 */
import { prisma } from "./prisma";
import { nextFollowUpDate } from "./datetime";
import { ImportResult } from "./enums";
import { isAssignableUser } from "./assign";

export type LeadImportInput = {
  studentName: string;
  phone: string;
  preferredContactApp?: string | null;
  contactAppId?: string | null;
  grade?: string | null;               // 年级名称（如 "Grade 9"），匹配已有 Grade，匹配不到留空
  gradeId?: string | null;             // 已知 Grade id（后台表单下拉）时直接用，跳过名称容错
  publicSchool?: string | null;
  subjectsOfInterest?: string | null;
  sourceCategory?: string | null;      // 无 campaign 时使用
  sourceDetail?: string | null;
  postalCode?: string | null;
  campaignToken?: string | null;
};

export type ImportContext = {
  source: "API" | "CSV" | "PUBLIC_FORM" | "MANUAL";
  campusId?: string | null;            // 无 campaign 时必须由调用方提供（CSV=校长校区，API=显式）
  actorId?: string | null;             // 登录用户（CSV/手动），跟进记录归属兜底
  // 重复线索的处理：默认合并（批量导入语义）；手动逐条录入用 "reject"，即时报错不静默合并。
  onDuplicate?: "merge" | "reject";
  // 指定归属销售（手动表单可手选）；有效则优先。
  preferredOwnerId?: string | null;
  // 是否自动分配负责人：默认 true（CSV/表单/API 轮询分配）；手动录入传 false，
  // 未显式指定时留空，等校长在列表里手动（可批量）分配。
  autoAssign?: boolean;
};

export type ImportOutcome =
  | { result: "CREATED"; studentId: string; ownerId: string | null }
  | { result: "MERGED"; studentId: string }
  | { result: "REJECTED"; reason: string };

// ── 规范化（去重前统一格式）─────────────────────────────────────────────────
/** 去掉空格/横杠/括号等，剥离北美国家码 1，只留数字。 */
export function normalizePhone(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

/** 规范化后是否为合法加拿大/北美手机号（10 位，NANP）。 */
export function isValidPhone(normalized: string): boolean {
  return /^\d{10}$/.test(normalized);
}

/** 联系 App 账号（微信号/小红书号）：去空格横杠、转小写，便于宽松去重。 */
export function normalizeAppId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.replace(/[\s-]/g, "").toLowerCase();
  return v || null;
}

/** 加拿大邮编前三位 = FSA（Forward Sortation Area），营销区域单位。 */
export function fsa(postal: string | null | undefined): string | null {
  if (!postal) return null;
  const p = postal.replace(/\s/g, "").toUpperCase();
  return p.length >= 3 ? p.slice(0, 3) : null;
}

function torontoDateStr(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function contactMethodOf(app: string | null | undefined): string {
  return app === "WECHAT" ? "WECHAT" : "PHONE";
}

// ── 分配与兜底 ───────────────────────────────────────────────────────────────
/**
 * 校区内轮询分配：优先 campaign 指定的默认负责人，否则在该校区活跃销售中
 * 取当前名下线索最少的一个（无持久游标的公平轮询），tie-break 用 id 保证确定性。
 */
/** 校验某用户存在且在职，返回其 id，否则 null。 */
async function validateActiveOwner(id: string): Promise<string | null> {
  const o = await prisma.user.findUnique({ where: { id }, select: { id: true, isActive: true } });
  return o?.isActive ? o.id : null;
}

async function pickOwner(campusId: string, defaultOwnerId: string | null): Promise<string | null> {
  if (defaultOwnerId) {
    const valid = await validateActiveOwner(defaultOwnerId);
    if (valid) return valid;
  }
  const sales = await prisma.user.findMany({
    where: { isActive: true, roles: { some: { role: "SALES" } }, campuses: { some: { campusId } } },
    select: { id: true },
  });
  if (!sales.length) return null;

  const counts = await prisma.student.groupBy({
    by: ["salesId"],
    where: { campusId, salesId: { in: sales.map((s) => s.id) } },
    _count: { _all: true },
  });
  const load = new Map(counts.map((c) => [c.salesId, c._count._all]));
  sales.sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || a.id.localeCompare(b.id));
  return sales[0].id;
}

/** 跟进记录必须挂在某个用户名下（FollowUp.salesId 非空）：负责人 → 校区校长 → 操作者。 */
async function followUpAuthor(campusId: string, ownerId: string | null, actorId: string | null | undefined): Promise<string | null> {
  if (ownerId) return ownerId;
  const uc = await prisma.userCampus.findFirst({
    where: { campusId, user: { isActive: true, roles: { some: { role: "PRINCIPAL" } } } },
    select: { userId: true },
  });
  return uc?.userId ?? actorId ?? null;
}

/**
 * 年级容错匹配：
 * - 数字年级接受 "9" / "G9" / "Grade9" / "Grade 9" / "9年级"（忽略大小写）→ Grade 9
 * - 命名年级（AP Calculus / IB Physics HL / SAT Math 等）需写全称，忽略大小写匹配
 * 匹配不到返回 null（年级留空，不算导入失败）。
 */
async function resolveGradeId(name: string | null | undefined): Promise<string | null> {
  const n = name?.trim();
  if (!n) return null;
  const grades = await prisma.grade.findMany({ select: { id: true, name: true } });
  const lower = n.toLowerCase();

  // 1) 忽略大小写精确匹配（覆盖 "Grade 9" 与命名年级）
  const exact = grades.find((g) => g.name.toLowerCase() === lower);
  if (exact) return exact.id;

  // 2) 数字年级容错：从 "9" / "g9" / "grade9" / "9年级" 里取数字，映射到 "Grade N"
  const digits = lower.match(/\d{1,2}/)?.[0];
  const looksNumericGrade = digits && (lower === digits || /^g\s*\d/.test(lower) || /^grade/.test(lower) || lower.includes("年级"));
  if (looksNumericGrade) {
    const target = `grade ${digits}`;
    const byNumber = grades.find((g) => g.name.toLowerCase() === target);
    if (byNumber) return byNumber.id;
  }
  return null;
}

async function logImport(
  source: string,
  result: string,
  studentId: string | null,
  message: string | null,
  payload: string,
): Promise<void> {
  await prisma.leadImportLog.create({ data: { source, result, studentId, message, payload } });
}

// ── 主流程 ───────────────────────────────────────────────────────────────────
export async function importLead(input: LeadImportInput, ctx: ImportContext): Promise<ImportOutcome> {
  const payload = JSON.stringify({ input, ctx: { source: ctx.source, campusId: ctx.campusId, actorId: ctx.actorId } });

  const reject = async (reason: string): Promise<ImportOutcome> => {
    await logImport(ctx.source, ImportResult.REJECTED, null, reason, payload);
    return { result: "REJECTED", reason };
  };

  try {
    if (!input.studentName?.trim() || !input.phone?.trim()) {
      return reject("缺少必填字段：student_name / phone");
    }

    // campaign（若有）决定校区与来源，家长/表单不填这些。
    let campaign: { id: string; campusId: string; defaultOwnerId: string | null; sourceCategory: string; sourceDetail: string } | null = null;
    if (input.campaignToken) {
      const c = await prisma.campaign.findUnique({ where: { token: input.campaignToken } });
      if (!c) return reject("campaign token 无效");
      if (!c.active) return reject("campaign 已停用");
      campaign = c;
    }

    const campusId = campaign?.campusId ?? ctx.campusId ?? null;
    if (!campusId) return reject("无法确定校区：需 campaign_token 或显式 campus");

    const sourceCategory = campaign?.sourceCategory ?? input.sourceCategory ?? null;
    const sourceDetail = campaign?.sourceDetail ?? input.sourceDetail ?? null;
    if (!sourceCategory || !sourceDetail) return reject("缺少必填字段：source_category / source_detail");

    const normPhone = normalizePhone(input.phone);
    if (!isValidPhone(normPhone)) {
      return reject("电话号码格式不正确：需为 10 位加拿大手机号（可含 +1、空格、横杠、括号）");
    }
    const normAppId = normalizeAppId(input.contactAppId);
    const normName = input.studentName.trim();

    // 去重：限定在本校区内（杜绝跨校区合并），且必须同名 —— 家长手机号/微信号会被
    // 多个在读孩子共用，只有「同校区 + 同名 + 同号(或同App账号)」才算同一学生，
    // 否则兄弟姐妹会被误并成一条。
    const existing = await prisma.student.findFirst({
      where: {
        campusId,
        name: normName,
        OR: [{ phone: normPhone }, ...(normAppId ? [{ contactAppId: normAppId }] : [])],
      },
      include: { leadInfo: true },
    });

    const now = new Date();
    const tomorrow = nextFollowUpDate(now);

    if (existing) {
      if (ctx.onDuplicate === "reject") return reject("该学生已存在（同校区同名同号）");
      return mergeInto(existing, sourceDetail, ctx, now, tomorrow, payload);
    }

    // ── 建档 ──
    const ownerHint = campaign?.defaultOwnerId ?? ctx.preferredOwnerId ?? null;
    // 手动录入(autoAssign:false)：不轮询；仅当显式指定了「本校区在职销售」时归属，
    // 否则留空待校长手动分配（防止把学生指给别校区/非销售用户而从各视图消失）。
    const ownerId = ctx.autoAssign === false
      ? (ownerHint && (await isAssignableUser(ownerHint, "SALES", campusId)) ? ownerHint : null)
      : await pickOwner(campusId, ownerHint);
    const authorId = await followUpAuthor(campusId, ownerId, ctx.actorId);
    const gradeId = input.gradeId ?? await resolveGradeId(input.grade);

    let studentId: string;
    try {
      const created = await prisma.$transaction(async (tx) => {
        const student = await tx.student.create({
          data: {
            name: input.studentName.trim(),
            phone: normPhone,
            gradeId,
            publicSchool: input.publicSchool?.trim() || null,
            campusId,
            salesId: ownerId,
            postalCode: input.postalCode?.trim() || null,
            preferredContactApp: input.preferredContactApp?.trim() || null,
            contactAppId: normAppId,
            leadInfo: {
              create: {
                source: sourceCategory,
                status: "NEW",
                sourceCategory,
                sourceDetail,
                subjectsOfInterest: input.subjectsOfInterest?.trim() || null,
                campaignId: campaign?.id ?? null,
              },
            },
          },
        });
        // 次日回访：活动线索要求 24–48 小时内联系。跟进记录需挂在某用户名下。
        if (authorId) {
          await tx.followUp.create({
            data: {
              studentId: student.id,
              salesId: authorId,
              contactMethod: contactMethodOf(input.preferredContactApp),
              content: `线索导入（${sourceDetail}），待首次联系`,
              followedAt: now,
              nextFollowUp: tomorrow,
            },
          });
        }
        return student;
      });
      studentId = created.id;
    } catch (e: unknown) {
      // 并发下 (campusId, phone, name) 唯一约束可能撞车：退回按合并处理（仍限本校区同名）。
      if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") {
        const dup = await prisma.student.findFirst({
          where: {
            campusId,
            name: normName,
            OR: [{ phone: normPhone }, ...(normAppId ? [{ contactAppId: normAppId }] : [])],
          },
          include: { leadInfo: true },
        });
        if (dup) {
          if (ctx.onDuplicate === "reject") return reject("该学生已存在（同校区同名同号）");
          return mergeInto(dup, sourceDetail, ctx, now, tomorrow, payload);
        }
      }
      throw e;
    }

    await logImport(ctx.source, ImportResult.CREATED, studentId, ownerId ? null : "无可分配销售，暂未指派负责人", payload);
    return { result: "CREATED", studentId, ownerId };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return reject(`内部错误：${msg}`);
  }
}

// ── 合并到已有线索 ───────────────────────────────────────────────────────────
async function mergeInto(
  existing: { id: string; campusId: string; salesId: string | null; leadInfo: { status: string } | null },
  sourceDetail: string,
  ctx: ImportContext,
  now: Date,
  tomorrow: Date,
  payload: string,
): Promise<ImportOutcome> {
  // 公开表单（无登录、内容不可信）命中已有线索时：只记导入日志，不写跟进、不改状态。
  // 否则任何人拿到公开 campaign token + 猜到某学生姓名/电话，就能往其档案塞跟进、把
  // 「已流失」刷回「已联系」，污染归属方的待办与转化报表。
  if (ctx.source === "PUBLIC_FORM") {
    await logImport(ctx.source, ImportResult.MERGED, existing.id, "公开表单命中已有学生，仅记录未改档", payload);
    return { result: "MERGED", studentId: existing.id };
  }

  // 已登录导入（CSV/手动/API）：跟进记录挂在操作者名下（不冒用归属方身份）。
  const authorId = ctx.actorId ?? (await followUpAuthor(existing.campusId, existing.salesId, ctx.actorId));

  await prisma.$transaction(async (tx) => {
    if (authorId) {
      await tx.followUp.create({
        data: {
          studentId: existing.id,
          salesId: authorId,
          contactMethod: "PHONE",
          content: `再次触达（${sourceDetail}）· ${torontoDateStr(now)}`,
          followedAt: now,
          nextFollowUp: tomorrow,
        },
      });
    }
    // 曾流失的线索重新触达 → 拉回 CONTACTED。在读/其他状态不动。
    if (existing.leadInfo && existing.leadInfo.status === "LOST") {
      await tx.lead.update({ where: { studentId: existing.id }, data: { status: "CONTACTED" } });
    }
  });

  await logImport(ctx.source, ImportResult.MERGED, existing.id, null, payload);
  return { result: "MERGED", studentId: existing.id };
}
