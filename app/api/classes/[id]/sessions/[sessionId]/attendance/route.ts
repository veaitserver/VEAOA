import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canConfirmLog, denyCrossCampus, type SessionUser } from "@/lib/permissions";
import { AttendanceStatus } from "@/lib/enums";
import { z } from "zod";

const schema = z.object({
  studentId: z.string().min(1),
  attendance: z.nativeEnum(AttendanceStatus),
  note: z.string().max(500).optional().nullable(),
});

/**
 * 标记班课某个成员的考勤（教务/校长）。
 *
 * 班课请假默认仍扣课时（座位已占），只是留个备注；如需免扣，
 * 核销后用「撤销该成员扣课」单独退回那一笔。
 * 已核销的课次不许改考勤 —— 会与已扣的课时对不上，要改先撤销。
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canConfirmLog(sessionUser)) {
    return NextResponse.json({ error: "仅教务/校长可标记考勤" }, { status: 403 });
  }

  const { id, sessionId } = await params;
  const s = await prisma.groupSession.findUnique({
    where: { id: sessionId },
    include: {
      class: { select: { id: true, campusId: true } },
      deductions: { where: { reversedAt: null }, select: { id: true } },
    },
  });
  if (!s || s.class.id !== id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, s.class.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  if (s.deductions.length > 0) {
    return NextResponse.json({ error: "该课次已核销，请先撤销核销再改考勤" }, { status: 400 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const att = await prisma.groupSessionAttendance.findUnique({
    where: { sessionId_studentId: { sessionId, studentId: parsed.data.studentId } },
  });
  if (!att) return NextResponse.json({ error: "该学生不在本次课的名单中" }, { status: 404 });

  const updated = await prisma.groupSessionAttendance.update({
    where: { id: att.id },
    data: {
      attendance: parsed.data.attendance,
      note: parsed.data.note?.trim() || null,
    },
    include: { student: { select: { id: true, name: true } } },
  });

  return NextResponse.json(updated);
}
