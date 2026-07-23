import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canConfirmLog, denyCrossCampus, type SessionUser } from "@/lib/permissions";
import { lessonHours, roundHours } from "@/lib/hours";

class InsufficientHours extends Error {}

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
      log: { include: { deductions: true } },
      package: true,
      student: { select: { campusId: true } },
    },
  });

  if (!lesson) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // 核销会真金白银地扣课时，跨校区绝不能放行。
  const denied = denyCrossCampus(sessionUser, lesson.student.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  if (!lesson.log) return NextResponse.json({ error: "老师尚未提交日志" }, { status: 400 });
  // 判「生效中的」扣课记录，而不是判存在性 —— 撤销后允许重新核销。
  if (lesson.log.deductions.some((d) => !d.reversedAt)) {
    return NextResponse.json({ error: "该课程已核销" }, { status: 400 });
  }
  if (lesson.package.status !== "ACTIVE") {
    return NextResponse.json({ error: "课包未激活，无法核销" }, { status: 400 });
  }

  const durationHours = lessonHours(lesson.startTime, lesson.endTime);
  // 纵深防御：非正时长的课绝不核销，否则 decrement 负数会给课包倒增课时。
  if (!(durationHours > 0)) {
    return NextResponse.json({ error: "课程时长非法，无法核销" }, { status: 400 });
  }
  const log = lesson.log;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 余额检查与扣减在同一条 updateMany 里完成：gte 谓词保证并发核销
      // 不会把余额扣成负数（count === 0 即余额不足，回滚）。
      const decremented = await tx.coursePackage.updateMany({
        where: { id: lesson.packageId, remainingHours: { gte: durationHours } },
        data: { remainingHours: { decrement: durationHours } },
      });
      if (decremented.count === 0) throw new InsufficientHours();

      const updatedLog = await tx.lessonLog.update({
        where: { id: log.id },
        data: { confirmedById: sessionUser.id, confirmedAt: new Date() },
      });

      const deduction = await tx.courseDeduction.create({
        data: { packageId: lesson.packageId, logId: log.id, hoursDeducted: durationHours },
      });

      const pkg = await tx.coursePackage.findUnique({
        where: { id: lesson.packageId },
        select: { remainingHours: true },
      });
      const newRemaining = roundHours(Number(pkg!.remainingHours));

      // 低库存续费提醒：通知销售与本校区校长/超管。
      if (newRemaining < 3) {
        const student = await tx.student.findUnique({
          where: { id: lesson.studentId },
          select: { salesId: true, campusId: true },
        });
        const recipients: string[] = [];
        if (student?.salesId) recipients.push(student.salesId);

        const principals = await tx.userCampus.findMany({
          where: { campusId: student?.campusId ?? "" },
          include: { user: { include: { roles: true } } },
        });
        for (const uc of principals) {
          if (uc.user.roles.some((r) => r.role === "PRINCIPAL" || r.role === "SUPER_ADMIN")) {
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
  } catch (e) {
    if (e instanceof InsufficientHours) {
      return NextResponse.json({ error: "课包剩余课时不足，无法核销" }, { status: 400 });
    }
    throw e;
  }
}
