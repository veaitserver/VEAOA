import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canFinanceConfirmPackage, denyCrossCampus, type SessionUser } from "@/lib/permissions";
import { recordEntries, packageActivationDrafts } from "@/lib/ledger";
import { LedgerType } from "@/lib/enums";
import { roundMoney } from "@/lib/money";

/**
 * 财务二次确认课包：校长确认(PENDING_FINANCE) → 财务确认 → 正式生效(ACTIVE)。
 * 生效后才能排课。
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  if (!canFinanceConfirmPackage(sessionUser)) {
    return NextResponse.json({ error: "仅财务或超管可确认生效" }, { status: 403 });
  }

  const { id } = await params;
  const pkg = await prisma.coursePackage.findUnique({
    where: { id },
    include: {
      student: { select: { campusId: true } },
      grade: { select: { name: true } },
      subject: { select: { name: true } },
    },
  });
  if (!pkg) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, pkg.student.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  if (pkg.status !== "PENDING_FINANCE") {
    return NextResponse.json({ error: "课包不是待财务确认状态" }, { status: 400 });
  }

  // 生效与记账在同一事务：财务确认这一刻既是「钱到账」也是「课时可用」，
  // 两者不能只成一半，否则账本和课包对不上。
  const updated = await prisma.$transaction(async (tx) => {
    const gate = await tx.coursePackage.updateMany({
      where: { id, status: "PENDING_FINANCE" },
      data: {
        status: "ACTIVE",
        financeConfirmedById: sessionUser.id,
        financeConfirmedAt: new Date(),
      },
    });
    if (gate.count === 0) throw new AlreadyConfirmed();

    const label = `${pkg.grade.name} · ${pkg.subject.name} ${pkg.totalHours}h`;
    const total = roundMoney(Number(pkg.totalAmount));

    if (pkg.convertedFromId) {
      // 转化来的课包：原包剩余价值在转化那一步已经退回账户，这里只收补款，
      // 否则会把抵扣的钱重复计一次收入，学生余额也平不了。
      const topUp = roundMoney(Number(pkg.topUpAmount ?? 0));
      const drafts = [];
      if (topUp > 0) {
        drafts.push({
          studentId: pkg.studentId, type: LedgerType.PAYMENT, amount: topUp,
          packageId: pkg.id, note: `转化补款：${label}`,
        });
      }
      drafts.push({
        studentId: pkg.studentId, type: LedgerType.PACKAGE_CHARGE, amount: -total,
        packageId: pkg.id, note: `转化新建课包：${label}`,
      });
      await recordEntries(tx, sessionUser.id, drafts);
    } else {
      await recordEntries(tx, sessionUser.id, packageActivationDrafts({
        studentId: pkg.studentId,
        packageId: pkg.id,
        amount: total,
        label,
      }));
    }

    return tx.coursePackage.findUnique({ where: { id } });
  }).catch((e) => {
    if (e instanceof AlreadyConfirmed) return null;
    throw e;
  });

  if (!updated) {
    return NextResponse.json({ error: "课包不是待财务确认状态" }, { status: 400 });
  }
  return NextResponse.json(updated);
}

class AlreadyConfirmed extends Error {}
