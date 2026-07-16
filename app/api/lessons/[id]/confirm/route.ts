import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canConfirmLog, denyCrossCampus, type SessionUser } from "@/lib/permissions";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canConfirmLog(sessionUser)) {
    return NextResponse.json({ error: "仅教务/校长可确认核销" }, { status: 403 });
  }

  const { id } = await params;
  const lesson = await prisma.scheduledLesson.findUnique({
    where: { id },
    include: {
      log: { include: { deduction: true } },
      package: true,
      student: { select: { campusId: true } },
    },
  });

  if (!lesson) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // 核销会真金白银地扣课时，跨校区绝不能放行。
  const denied = denyCrossCampus(sessionUser, lesson.student.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  if (!lesson.log) return NextResponse.json({ error: "老师尚未提交日志" }, { status: 400 });
  if (lesson.log.deduction) return NextResponse.json({ error: "该课程已核销" }, { status: 400 });

  const durationHours = (lesson.endTime.getTime() - lesson.startTime.getTime()) / 3600000;

  // Check remaining hours
  if (Number(lesson.package.remainingHours) < durationHours) {
    return NextResponse.json({ error: "课包剩余课时不足，无法核销" }, { status: 400 });
  }

  // Atomic transaction: confirm log + deduct + create deduction record
  const result = await prisma.$transaction(async (tx) => {
    const updatedLog = await tx.lessonLog.update({
      where: { id: lesson.log!.id },
      data: { confirmedById: sessionUser.id, confirmedAt: new Date() },
    });

    const updatedPkg = await tx.coursePackage.update({
      where: { id: lesson.packageId },
      data: { remainingHours: { decrement: durationHours } },
    });

    const deduction = await tx.courseDeduction.create({
      data: {
        packageId: lesson.packageId,
        logId: lesson.log!.id,
        hoursDeducted: durationHours,
      },
    });

    // Low inventory check
    const newRemaining = Number(updatedPkg.remainingHours);
    if (newRemaining < 3) {
      const student = await tx.student.findUnique({
        where: { id: lesson.studentId },
        select: { salesId: true, campusId: true },
      });
      const recipients: string[] = [];
      if (student?.salesId) recipients.push(student.salesId);

      // Find campus principals
      const principals = await tx.userCampus.findMany({
        where: { campusId: student?.campusId ?? "" },
        include: { user: { include: { roles: true } } },
      });
      for (const uc of principals) {
        if (uc.user.roles.some(r => r.role === "PRINCIPAL" || r.role === "SUPER_ADMIN")) {
          recipients.push(uc.userId);
        }
      }

      for (const userId of [...new Set(recipients)]) {
        await tx.notification.create({
          data: {
            userId,
            message: `续费提醒：课包剩余仅 ${newRemaining.toFixed(1)}h，请联系家长续费`,
            link: `/packages/${lesson.packageId}`,
          },
        });
      }
    }

    return { log: updatedLog, deduction };
  });

  return NextResponse.json(result);
}
