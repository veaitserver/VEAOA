/**
 * 为「账本上线前就已生效」的课包补记签约收款流水。
 *
 * 账本是后加的，之前生效的课包只有课时、没有对应的收款/扣款记录，
 * 学生「账户」页会是空的。这里按当前 totalAmount 补两条（收款 + 课包扣款，净 0）。
 *
 * 注意：若该课包之后发生过退费，退费流水已经存在且自成一对，
 * 这里按「当前」金额补记，得到的是净额口径的历史（付了 2000 退了 600
 * → 补记 1400），对账仍然平，只是不还原原始成交价。
 *
 * 幂等：已有 PACKAGE_CHARGE 流水的课包会跳过，可重复运行。
 *
 *   node scripts/backfill-ledger.mjs           # 预览
 *   node scripts/backfill-ledger.mjs --apply   # 实际写入
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

function roundMoney(n) {
  return Math.round(n * 100) / 100;
}

async function main() {
  const packages = await prisma.coursePackage.findMany({
    where: { status: "ACTIVE" },
    include: {
      grade: { select: { name: true } },
      subject: { select: { name: true } },
      ledgerEntries: { where: { type: "PACKAGE_CHARGE" }, select: { id: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const todo = packages.filter((p) => p.ledgerEntries.length === 0);
  console.log(`已生效课包 ${packages.length} 个，其中 ${todo.length} 个缺少签约流水。`);
  if (!todo.length) return;

  // 补记人记作该课包的财务确认人；没有就退回创建人。
  let written = 0;
  for (const p of todo) {
    const actorId = p.financeConfirmedById ?? p.confirmedById ?? p.createdById;
    const amount = roundMoney(Number(p.totalAmount));
    const label = `${p.grade.name} · ${p.subject.name} ${p.totalHours}h`;
    console.log(`  ${APPLY ? "写入" : "待补"} ${p.id}  $${amount}  ${label}`);
    if (!APPLY) continue;

    await prisma.$transaction(async (tx) => {
      await tx.ledgerEntry.create({
        data: {
          studentId: p.studentId, type: "PAYMENT", amount, packageId: p.id,
          note: `签约收款（历史补记）：${label}`, createdById: actorId,
          createdAt: p.financeConfirmedAt ?? p.confirmedAt ?? p.createdAt,
        },
      });
      await tx.ledgerEntry.create({
        data: {
          studentId: p.studentId, type: "PACKAGE_CHARGE", amount: -amount, packageId: p.id,
          note: `课包扣款（历史补记）：${label}`, createdById: actorId,
          createdAt: p.financeConfirmedAt ?? p.confirmedAt ?? p.createdAt,
        },
      });
    });
    written += 1;
  }

  console.log(APPLY ? `\n已补记 ${written} 个课包。` : `\n以上为预览，加 --apply 实际写入。`);
}

main()
  .catch((e) => { console.error("补记失败：", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
