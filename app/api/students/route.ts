import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { campusScope, canManageStudents, denyCrossCampus, ownerFilter, type SessionUser } from "@/lib/permissions";
import { importLead } from "@/lib/leadImport";
import { deriveStage } from "@/lib/leadLabels";
import { SourceCategory } from "@/lib/enums";
import { z } from "zod";

// 与线索导入字段统一：来源用 sourceCategory/sourceDetail（明细必填），另加联系方式/邮编/意向科目。
const createSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  gradeId: z.string().optional().nullable(),
  publicSchool: z.string().optional().nullable(),
  salesId: z.string().optional().nullable(),
  campusId: z.string().min(1),
  postalCode: z.string().optional().nullable(),
  preferredContactApp: z.string().optional().nullable(),
  contactAppId: z.string().optional().nullable(),
  sourceCategory: z.nativeEnum(SourceCategory),
  sourceDetail: z.string().min(1, "请填写来源明细"),
  subjectsOfInterest: z.string().optional().nullable(),
});

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const campusId = searchParams.get("campusId");
  const search = searchParams.get("search") ?? "";
  const status = searchParams.get("status");        // "lead" | "enrolled" | null
  const leadStatus = searchParams.get("leadStatus"); // 线索漏斗子筛选：NEW/CONTACTED/LOST
  const page = Number(searchParams.get("page")) || 0; // >=1 时分页并返回信封

  const sessionUser = session.user as SessionUser;

  const where: Record<string, unknown> = {};
  const scope = campusScope(sessionUser, campusId);
  if (scope) where.campusId = scope;
  // 归属隔离：销售只看自己名下的线索/学生；管理层看全校区。
  const owner = ownerFilter(sessionUser);
  if (owner) where.salesId = owner.salesId;
  if (search) where.OR = [
    { name: { contains: search } },
    { phone: { contains: search } },
  ];
  // 学生/线索划分下推到 DB（已生效课包 = ACTIVE），便于分页。
  if (status === "enrolled") where.packages = { some: { status: "ACTIVE" } };
  else if (status === "lead") where.packages = { none: { status: "ACTIVE" } };
  if (leadStatus) where.leadInfo = { status: leadStatus };

  const include = {
    grade: true,
    campus: true,
    sales: { select: { id: true, name: true } },
    leadInfo: true,
    packages: { select: { remainingHours: true, status: true } },
  } satisfies Prisma.StudentInclude;
  type StudentRow = Prisma.StudentGetPayload<{ include: typeof include }>;
  const shape = (rows: StudentRow[]) =>
    rows.map((s) => {
      const stage = deriveStage(s.packages, s.leadInfo);
      return { ...s, stage, isEnrolled: stage === "ENROLLED" };
    });

  if (page >= 1) {
    const pageSize = 20;
    const [rows, total] = await prisma.$transaction([
      prisma.student.findMany({ where, include, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.student.count({ where }),
    ]);
    return NextResponse.json({ items: shape(rows), total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  }

  // 无 page（如下拉搜索）：返回数组，保持向后兼容。
  const rows = await prisma.student.findMany({ where, include, orderBy: { createdAt: "desc" } });
  return NextResponse.json(shape(rows));
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canManageStudents(sessionUser)) {
    return NextResponse.json({ error: "无权建立学生档案" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const { name, phone, gradeId, publicSchool, salesId, campusId,
    postalCode, preferredContactApp, contactAppId, sourceCategory, sourceDetail, subjectsOfInterest } = parsed.data;

  // campusId 来自请求体，不校验就能往任何校区塞学生。
  const denied = denyCrossCampus(sessionUser, campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  // 手动逐条录入与 CSV/公开表单共用同一导入核心（规范化/去重/年级容错/轮询分配/次日回访/导入日志）。
  // 唯一差异：手动重复即报错（onDuplicate: "reject"），不静默合并，符合归属隔离与即时反馈。
  const outcome = await importLead(
    {
      studentName: name, phone,
      gradeId: gradeId || null,
      publicSchool: publicSchool || null,
      preferredContactApp: preferredContactApp || null,
      contactAppId: contactAppId || null,
      subjectsOfInterest: subjectsOfInterest || null,
      sourceCategory, sourceDetail,
      postalCode: postalCode || null,
    },
    { source: "MANUAL", campusId, actorId: sessionUser.id, onDuplicate: "reject", preferredOwnerId: salesId || null },
  );

  if (outcome.result === "REJECTED") {
    const status = outcome.reason.includes("已存在") ? 409 : 400;
    return NextResponse.json({ error: outcome.reason }, { status });
  }

  const student = await prisma.student.findUnique({
    where: { id: outcome.studentId },
    include: { grade: true, campus: true },
  });
  return NextResponse.json(student, { status: 201 });
}
