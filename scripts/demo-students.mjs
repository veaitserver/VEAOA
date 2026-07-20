/**
 * 生成约 30 个不同类型的演示学员，供核验状态派生逻辑。
 * 学员姓名带类型前缀（演示·新线索/已联系/已流失/在读/已结课），可直接对照状态列。
 * 可重复运行：先清掉上一批「演示·」学员再重建。
 *
 *   node scripts/demo-students.mjs
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const PREFIX = "演示·";
const POSTALS = ["L3T 7P9", "L4B 2C3", "M1B 5K7", "L6C 1A2", "L3R 9X1", "M2N 6L4", "L4C 0A1"];
const SOURCES = [
  { cat: "OFFLINE_EVENT", detail: "Markham 数学展", token: "mkm-expo-2026" },
  { cat: "ONLINE_CHANNEL", detail: "小红书", token: "mkm-red" },
  { cat: "REFERRAL", detail: "老学员推荐", token: null },
  { cat: "OTHER", detail: "门店咨询", token: null },
];
const APPS = [
  { app: "WECHAT", id: "wx_" }, { app: "XIAOHONGSHU", id: "xhs_" },
  { app: "PHONE", id: "" }, { app: "WHATSAPP", id: "wa_" },
];
const GRADES = ["Grade 9", "Grade 10", "Grade 11", "Grade 12"];
const SUBJECTS = ["Math", "Physics", "Chemistry", "English"];

let seq = 0;
const phone = () => String(6490001000 + ++seq); // 10 位，649000xxxx

async function main() {
  // 清理上一批演示学员（先删课包，再删学员级联 lead/followup）
  const olds = await prisma.student.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  const oldIds = olds.map((o) => o.id);
  if (oldIds.length) {
    await prisma.courseDeduction.deleteMany({ where: { package: { studentId: { in: oldIds } } } });
    await prisma.lessonLog.deleteMany({ where: { lesson: { studentId: { in: oldIds } } } });
    await prisma.scheduledLesson.deleteMany({ where: { studentId: { in: oldIds } } });
    await prisma.coursePackage.deleteMany({ where: { studentId: { in: oldIds } } });
    await prisma.followUp.deleteMany({ where: { studentId: { in: oldIds } } });
    await prisma.lead.deleteMany({ where: { studentId: { in: oldIds } } });
    await prisma.student.deleteMany({ where: { id: { in: oldIds } } });
  }

  const campuses = await prisma.campus.findMany({ select: { id: true, name: true } });
  const grades = Object.fromEntries((await prisma.grade.findMany()).map((g) => [g.name, g.id]));
  const subjects = Object.fromEntries((await prisma.subject.findMany()).map((s) => [s.name, s.id]));
  const admin = await prisma.user.findUnique({ where: { phone: "6470000000" } });
  const campaigns = Object.fromEntries((await prisma.campaign.findMany()).map((c) => [c.token, c.id]));

  const salesByCampus = {};
  for (const c of campuses) {
    const uc = await prisma.userCampus.findFirst({
      where: { campusId: c.id, user: { isActive: true, roles: { some: { role: "SALES" } } } },
      select: { userId: true },
    });
    salesByCampus[c.id] = uc?.userId ?? admin.id;
  }

  const pick = (arr, i) => arr[i % arr.length];

  async function makeLead({ name, i, status, withFollowUp }) {
    const campus = pick(campuses, i);
    const src = pick(SOURCES, i);
    const app = pick(APPS, i);
    const student = await prisma.student.create({
      data: {
        name, phone: phone(), campusId: campus.id,
        salesId: salesByCampus[campus.id],
        gradeId: grades[pick(GRADES, i)],
        postalCode: pick(POSTALS, i),
        preferredContactApp: app.app,
        contactAppId: app.id ? app.id + seq : null,
        leadInfo: {
          create: {
            source: src.cat, status, sourceCategory: src.cat, sourceDetail: src.detail,
            subjectsOfInterest: pick(SUBJECTS, i),
            campaignId: src.token ? campaigns[src.token] ?? null : null,
          },
        },
      },
    });
    if (withFollowUp) {
      await prisma.followUp.create({
        data: {
          studentId: student.id, salesId: salesByCampus[campus.id],
          contactMethod: "PHONE", content: "已电话联系，家长有意向，约下周试听。",
          followedAt: new Date(),
        },
      });
    }
    return student;
  }

  async function makeStudentWithPackage({ name, i, kind }) {
    const campus = pick(campuses, i);
    const src = pick(SOURCES, i);
    const gradeName = pick(GRADES, i);
    const subjectName = pick(SUBJECTS, i);
    const student = await prisma.student.create({
      data: {
        name, phone: phone(), campusId: campus.id,
        salesId: salesByCampus[campus.id],
        gradeId: grades[gradeName],
        postalCode: pick(POSTALS, i),
        preferredContactApp: "WECHAT", contactAppId: "wx_stu" + seq,
        leadInfo: {
          create: {
            source: src.cat, status: "CONTACTED", sourceCategory: src.cat, sourceDetail: src.detail,
            subjectsOfInterest: subjectName,
            campaignId: src.token ? campaigns[src.token] ?? null : null,
          },
        },
      },
    });
    // kind: "active"(在读，有剩余) / "consumed"(已结课，课时耗尽)。均为已生效 ACTIVE。
    const totalHours = 40;
    const remaining = kind === "active" ? 20 + (i % 15) : 0;
    await prisma.coursePackage.create({
      data: {
        studentId: student.id, gradeId: grades[gradeName], subjectId: subjects[subjectName],
        totalHours, pricePerHour: 100, totalAmount: totalHours * 100,
        remainingHours: remaining, status: "ACTIVE",
        createdById: admin.id, confirmedById: admin.id, confirmedAt: new Date(),
        financeConfirmedById: admin.id, financeConfirmedAt: new Date(),
      },
    });
    return student;
  }

  const created = { NEW: 0, CONTACTED: 0, LOST: 0, ENROLLED: 0, COMPLETED: 0 };

  // 新线索 ×7
  for (let i = 0; i < 7; i++) { await makeLead({ name: `${PREFIX}新线索${i + 1}`, i, status: "NEW" }); created.NEW++; }
  // 已联系 ×5（带跟进）
  for (let i = 0; i < 5; i++) { await makeLead({ name: `${PREFIX}已联系${i + 1}`, i, status: "CONTACTED", withFollowUp: true }); created.CONTACTED++; }
  // 已流失 ×4
  for (let i = 0; i < 4; i++) { await makeLead({ name: `${PREFIX}已流失${i + 1}`, i, status: "LOST" }); created.LOST++; }
  // 在读 ×8（有剩余课时的生效课包）
  for (let i = 0; i < 8; i++) { await makeStudentWithPackage({ name: `${PREFIX}在读${i + 1}`, i, kind: "active" }); created.ENROLLED++; }
  // 已结课 ×6（生效课包课时耗尽）
  for (let i = 0; i < 6; i++) {
    await makeStudentWithPackage({ name: `${PREFIX}已结课${i + 1}`, i, kind: "consumed" });
    created.COMPLETED++;
  }

  const total = Object.values(created).reduce((a, b) => a + b, 0);
  console.log("演示学员已生成：", created, "合计", total);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
