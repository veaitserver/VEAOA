import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canConfirmLog, denyCrossCampus, type SessionUser } from "@/lib/permissions";
import { AttendanceStatus } from "@/lib/enums";
import { z } from "zod";

const schema = z.object({
  attendance: z.nativeEnum(AttendanceStatus),
  note: z.string().max(500).optional().nullable(),
});

/**
 * 标记某节课的考勤（教务/校长）。
 *
 * 扣不扣课时由 lib/attendance 统一裁决：1对1 请假不扣、旷课照扣。
 * 已核销的课不能改考勤 —— 否则会出现「标了请假但课时已经扣掉」的对不上账，
 * 要改先撤销核销。
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canConfirmLog(sessionUser)) {
    return NextResponse.json({ error: "仅教务/校长可标记考勤" }, { status: 403 });
  }

  const { id } = await params;
  const lesson = await prisma.scheduledLesson.findUnique({
    where: { id },
    include: {
      student: { select: { campusId: true } },
      log: { include: { deductions: true } },
    },
  });
  if (!lesson) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, lesson.student.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  const hasActiveDeduction = lesson.log?.deductions.some((d) => !d.reversedAt) ?? false;
  if (hasActiveDeduction) {
    return NextResponse.json({ error: "该课程已核销，请先撤销核销再改考勤" }, { status: 400 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const updated = await prisma.scheduledLesson.update({
    where: { id },
    data: {
      attendance: parsed.data.attendance,
      attendanceNote: parsed.data.note?.trim() || null,
      attendanceById: sessionUser.id,
      attendanceAt: new Date(),
    },
  });

  return NextResponse.json(updated);
}
