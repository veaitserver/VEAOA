import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canCreateRenewalPackage, denyCrossCampus, type SessionUser } from "@/lib/permissions";
import { roundHours } from "@/lib/hours";
import { roundMoney, moneyEquals } from "@/lib/money";
import { settlableHours } from "@/lib/settlement";
import { recordEntries, type LedgerDraft } from "@/lib/ledger";
import { ClassType, LedgerType, PackageStatus, SigningType } from "@/lib/enums";
import { z } from "zod";

class ConvertError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** 错误文案里的金额，加币两位小数。 */
function formatShort(amount: number): string {
  return `$${roundMoney(amount).toFixed(2)}`;
}

const schema = z.object({
  subjectId: z.string().min(1),
  gradeId: z.string().min(1),
  classType: z.nativeEnum(ClassType),
  totalHours: z.number().positive().max(10000).finite(),
  pricePerHour: z.number().positive().max(100000).finite(),
  totalAmount: z.number().positive().max(1_000_000_000).finite(),
  notes: z.string().max(2000).optional().nullable(),
  /** 只算不做：返回抵扣与补款金额供界面确认。 */
  dryRun: z.boolean().optional(),
});

/**
 * 课包转化：换科目 / 换年级 / 一对一↔班课互转。
 *
 * 机制（按既定业务规则）：原包剩余价值内部退款（不实际退给家长）→ 家长补差价
 * 凑够新包全额 → 重建一张完整课包。因此永远不会出现碎课时。
 *
 *   抵扣 = 原包剩余课时 × 原单价
 *   补款 = 新包总价 − 抵扣
 *
 * 补款 > 0 时新包为「待财务确认」，财务收到钱才生效；补款 = 0（正好抵平）时直接生效。
 * 补款 < 0 一律拒绝：转成更便宜的，办理人多加课时把金额补齐即可，系统不做
 * 「多出来的挂账户余额」，免得留下永远对不上的悬空余额。
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionUser = session.user as SessionUser;
  const { id } = await params;

  const oldPkg = await prisma.coursePackage.findUnique({
    where: { id },
    include: {
      student: { select: { id: true, name: true, campusId: true, studentManagerId: true } },
      grade: { select: { name: true } },
      subject: { select: { name: true } },
    },
  });
  if (!oldPkg) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const denied = denyCrossCampus(sessionUser, oldPkg.student.campusId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  // 转化本质是「换一张后续课包」，与续费同一批人负责。
  if (!canCreateRenewalPackage(sessionUser, oldPkg.student.studentManagerId)) {
    return NextResponse.json({ error: "转化课包由该学生的学管或校长办理" }, { status: 403 });
  }
  // 只有已生效的能转；已转化过的状态是 CONVERTED，天然被这一条挡住。
  if (oldPkg.status !== PackageStatus.ACTIVE) {
    const why = oldPkg.status === PackageStatus.CONVERTED ? "该课包已经转化过" : "只有已生效的课包才能转化";
    return NextResponse.json({ error: why }, { status: 400 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const d = parsed.data;

  if (!moneyEquals(d.totalAmount, d.totalHours * d.pricePerHour)) {
    return NextResponse.json({ error: "新课包总价必须等于课时 × 单价（折扣请调单价）" }, { status: 400 });
  }

  // 已排未核销的课必须先处理：这部分课时已经许诺给具体课程，不能拿去转化。
  const settlable = await settlableHours(prisma, oldPkg);
  if (settlable.pendingHours > 0) {
    return NextResponse.json(
      { error: `该课包还有 ${settlable.pendingHours}h 已排未核销的课，请先上完或取消后再转化` },
      { status: 400 },
    );
  }

  const creditHours = roundHours(Number(oldPkg.remainingHours));
  if (creditHours <= 0) {
    return NextResponse.json({ error: "该课包已无剩余课时，无需转化（请直接新建课包）" }, { status: 400 });
  }
  const creditAmount = roundMoney(creditHours * Number(oldPkg.pricePerHour));
  const newTotal = roundMoney(d.totalAmount);
  const topUp = roundMoney(newTotal - creditAmount);

  // 新包价值不得低于抵扣：转成更便宜的就多给课时把金额补齐，
  // 系统不做「多退的钱挂账户」那套，账目更简单，也不会留下悬空余额。
  if (topUp < 0) {
    const shortHours = Math.ceil((creditAmount - newTotal) / d.pricePerHour);
    return NextResponse.json({
      error: `新课包价值 ${formatShort(newTotal)} 低于原包抵扣 ${formatShort(creditAmount)}，`
        + `请增加课时（按 ${formatShort(d.pricePerHour)}/h 约需再加 ${shortHours}h）或调整单价，使其不低于抵扣金额。`,
    }, { status: 400 });
  }

  if (d.dryRun) {
    return NextResponse.json({
      dryRun: true,
      creditHours,
      creditAmount,
      newTotal,
      topUp,
      needsFinance: topUp > 0,
    });
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      // 幂等门闩：并发转化只有一次能把原包置为已转化。
      const gate = await tx.coursePackage.updateMany({
        where: { id, status: PackageStatus.ACTIVE },
        data: {
          status: PackageStatus.CONVERTED,
          remainingHours: 0,
          // 同步缩减总课时与总额，保住「剩余 = 总课时 − 已消耗」「总价 = 课时 × 单价」
          totalHours: { decrement: creditHours },
          totalAmount: { decrement: creditAmount },
        },
      });
      if (gate.count === 0) throw new ConvertError(400, "该课包状态已变化，请刷新后重试");

      const needsFinance = topUp > 0;
      const newPkg = await tx.coursePackage.create({
        data: {
          studentId: oldPkg.studentId,
          gradeId: d.gradeId,
          subjectId: d.subjectId,
          classType: d.classType,
          totalHours: d.totalHours,
          pricePerHour: d.pricePerHour,
          totalAmount: newTotal,
          remainingHours: d.totalHours,
          // 转化产生的是后续课包，与续费同性质。
          signingType: SigningType.RENEWAL,
          status: needsFinance ? PackageStatus.PENDING_FINANCE : PackageStatus.ACTIVE,
          createdById: sessionUser.id,
          confirmedById: sessionUser.id,
          confirmedAt: new Date(),
          ...(needsFinance ? {} : { financeConfirmedById: sessionUser.id, financeConfirmedAt: new Date() }),
          convertedFromId: id,
          topUpAmount: topUp,
          notes: d.notes?.trim() || null,
        },
        include: { grade: { select: { name: true } }, subject: { select: { name: true } } },
      });

      const oldLabel = `${oldPkg.grade.name} · ${oldPkg.subject.name}`;
      const newLabel = `${newPkg.grade.name} · ${newPkg.subject.name} ${newPkg.totalHours}h`;

      // 原包剩余价值退回账户 —— 内部退款，钱不出门。
      const drafts: LedgerDraft[] = [{
        studentId: oldPkg.studentId,
        type: LedgerType.REFUND_CREDIT,
        amount: creditAmount,
        packageId: id,
        note: `转化内部退款：${oldLabel} 剩余 ${creditHours}h 结转（不实退）`,
      }];

      // 不需补款时当场生效并入账；需补款则等财务确认收款那一步再记。
      if (!needsFinance) {
        drafts.push({
          studentId: oldPkg.studentId,
          type: LedgerType.PACKAGE_CHARGE,
          amount: -newTotal,
          packageId: newPkg.id,
          note: `转化新建课包：${newLabel}`,
        });
      }
      await recordEntries(tx, sessionUser.id, drafts);

      return newPkg;
    });

    return NextResponse.json({
      package: created,
      creditHours, creditAmount, topUp,
      needsFinance: topUp > 0,
    }, { status: 201 });
  } catch (e) {
    if (e instanceof ConvertError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
