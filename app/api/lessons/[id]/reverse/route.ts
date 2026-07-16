import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canReverseDeduction, denyCrossCampus, type SessionUser } from "@/lib/permissions";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canReverseDeduction(sessionUser)) {
    return NextResponse.json({ error: "仅财务/超管可撤销核销" }, { status: 403 });
  }

  const { id } = await params;
  const lesson = await prisma.scheduledLesson.findUnique({
    where: { id },
    include: {
      log: { include: { deduction: true } },
      student: { select: { campusId: true } },
    },
  });

  if (!lesson) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, lesson.student.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  if (!lesson.log?.deduction) return NextResponse.json({ error: "该课程未核销" }, { status: 400 });
  if (lesson.log.deduction.reversedAt) return NextResponse.json({ error: "该核销已撤销" }, { status: 400 });

  const hoursDeducted = Number(lesson.log.deduction.hoursDeducted);

  const result = await prisma.$transaction(async (tx) => {
    const updatedDeduction = await tx.courseDeduction.update({
      where: { id: lesson.log!.deduction!.id },
      data: { reversedAt: new Date(), reversedById: sessionUser.id },
    });

    await tx.coursePackage.update({
      where: { id: lesson.packageId },
      data: { remainingHours: { increment: hoursDeducted } },
    });

    await tx.lessonLog.update({
      where: { id: lesson.log!.id },
      data: { confirmedById: null, confirmedAt: null },
    });

    return updatedDeduction;
  });

  return NextResponse.json(result);
}
