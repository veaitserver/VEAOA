import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageStudents, denyCrossCampus, type SessionUser } from "@/lib/permissions";
import { z } from "zod";

const schema = z.object({
  contactMethod: z.enum(["PHONE", "WECHAT"]),
  content: z.string().min(1),
  followedAt: z.string(),
  nextFollowUp: z.string().optional(),
});

/** 跟进记录挂在学生下，权限跟着学生的校区走。 */
async function guardStudent(user: SessionUser, studentId: string) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { campusId: true },
  });
  if (!student) return { error: "Not found", status: 404 as const };
  const denied = denyCrossCampus(user, student.campusId);
  return denied ? { error: denied, status: 403 as const } : null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const denied = await guardStudent(session.user as SessionUser, id);
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });

  const followUps = await prisma.followUp.findMany({
    where: { studentId: id },
    include: { sales: { select: { name: true } } },
    orderBy: { followedAt: "desc" },
  });
  return NextResponse.json(followUps);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canManageStudents(sessionUser)) {
    return NextResponse.json({ error: "无权写入跟进记录" }, { status: 403 });
  }

  const { id } = await params;
  const denied = await guardStudent(sessionUser, id);
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });

  const salesId = sessionUser.id;

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const { contactMethod, content, followedAt, nextFollowUp } = parsed.data;

  const followUp = await prisma.followUp.create({
    data: {
      studentId: id,
      salesId,
      contactMethod,
      content,
      followedAt: new Date(followedAt),
      nextFollowUp: nextFollowUp ? new Date(nextFollowUp) : null,
    },
    include: { sales: { select: { name: true } } },
  });

  // 曾流失的线索一旦有新跟进 → 拉回「已联系」，不再算流失。
  await prisma.lead.updateMany({
    where: { studentId: id, status: "LOST" },
    data: { status: "CONTACTED" },
  });

  return NextResponse.json(followUp, { status: 201 });
}
