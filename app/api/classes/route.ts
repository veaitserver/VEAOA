import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  campusScope, canManageGroupClass, canViewGroupClass, denyCrossCampus, type SessionUser,
} from "@/lib/permissions";
import { GroupClassStatus } from "@/lib/enums";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  campusId: z.string().min(1),
  subjectId: z.string().min(1),
  gradeId: z.string().min(1).optional().nullable(),
  teacherId: z.string().min(1).optional().nullable(),
  classroomId: z.string().min(1).optional().nullable(),
  capacity: z.number().int().positive().max(200).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

/** 班级列表（按校区收敛，可按状态筛选、分页）。 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canViewGroupClass(sessionUser)) {
    return NextResponse.json({ error: "无权查看班级" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const search = searchParams.get("search")?.trim();
  const teacherId = searchParams.get("teacherId");
  const page = Number(searchParams.get("page")) || 0;

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (teacherId) where.teacherId = teacherId;
  // 班级多起来后下拉找不着，前端用它做搜索：班名或科目名任一命中即可。
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { subject: { name: { contains: search } } },
    ];
  }
  const scope = campusScope(sessionUser);
  if (scope) where.campusId = scope;

  const include = {
    campus: { select: { name: true } },
    subject: { select: { id: true, name: true } },
    grade: { select: { name: true } },
    teacher: { select: { id: true, name: true } },
    classroom: { select: { name: true } },
    // 在册成员数（未退班的）
    _count: { select: { sessions: true } },
    members: { where: { leftAt: null }, select: { id: true } },
  } as const;

  if (page >= 1) {
    const pageSize = 20;
    const [rows, total] = await prisma.$transaction([
      prisma.groupClass.findMany({ where, include, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.groupClass.count({ where }),
    ]);
    return NextResponse.json({ items: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  }

  const rows = await prisma.groupClass.findMany({ where, include, orderBy: { createdAt: "desc" }, take: 200 });
  return NextResponse.json(rows);
}

/** 创建班级（教务/校长）。 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canManageGroupClass(sessionUser)) {
    return NextResponse.json({ error: "仅教务/校长可创建班级" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const d = parsed.data;

  const denied = denyCrossCampus(sessionUser, d.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  // 默认老师/教室必须属于该校区，否则排课时才发现，白填一遍。
  if (d.teacherId) {
    const t = await prisma.user.findUnique({
      where: { id: d.teacherId },
      select: { isActive: true, roles: { select: { role: true } }, campuses: { select: { campusId: true } } },
    });
    if (!t || !t.isActive || !t.roles.some((r) => r.role === "TEACHER") || !t.campuses.some((c) => c.campusId === d.campusId)) {
      return NextResponse.json({ error: "默认老师不是该校区的在职老师" }, { status: 400 });
    }
  }
  if (d.classroomId) {
    const room = await prisma.classroom.findUnique({ where: { id: d.classroomId }, select: { campusId: true } });
    if (!room || room.campusId !== d.campusId) {
      return NextResponse.json({ error: "默认教室不属于该校区" }, { status: 400 });
    }
  }

  const created = await prisma.groupClass.create({
    data: {
      name: d.name.trim(),
      campusId: d.campusId,
      subjectId: d.subjectId,
      gradeId: d.gradeId || null,
      teacherId: d.teacherId || null,
      classroomId: d.classroomId || null,
      capacity: d.capacity ?? null,
      notes: d.notes?.trim() || null,
      status: GroupClassStatus.RECRUITING,
      createdById: sessionUser.id,
    },
    include: {
      campus: { select: { name: true } },
      subject: { select: { name: true } },
      grade: { select: { name: true } },
      teacher: { select: { name: true } },
    },
  });

  return NextResponse.json(created, { status: 201 });
}
