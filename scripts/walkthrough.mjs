/**
 * 全流程真实演练 —— 只走 HTTP 接口，用各角色真实登录，不直接写数据库。
 *
 * 覆盖：添加线索 → 校长分配销售 → 销售跟进 → 建课包 → 校长确认+派学管 →
 *       财务确认生效 → 教务排课 → 老师写反馈 → 教务核销 → 学管申请退费 →
 *       校长审核 → 财务打款 → 账本核对
 *
 * 目的是留下真实操作痕迹（创建人/确认人/时间/账本流水都是接口写的），
 * 便于人工在界面上逐屏核对。默认保留数据；加 --clean 可清除本次生成的数据。
 *
 *   npm run dev
 *   node scripts/walkthrough.mjs
 *   node scripts/walkthrough.mjs --clean   # 清除上一次演练数据
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BASE = process.env.PROBE_BASE ?? "http://localhost:3000";
const CLEAN = process.argv.includes("--clean");

// 本次演练的学生手机号（固定，便于重复运行时先清理）
const STUDENT_PHONE = "6479001234";
const STUDENT_NAME = "演练·王小明";

class Client {
  constructor(label) { this.label = label; this.cookies = {}; }
  #jar() { return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join("; "); }
  #stash(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";"); const i = pair.indexOf("=");
      this.cookies[pair.slice(0, i)] = pair.slice(i + 1);
    }
  }
  async login(phone, password) {
    this.cookies = {};
    const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
    this.#stash(csrfRes);
    const { csrfToken } = await csrfRes.json();
    const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: this.#jar() },
      body: new URLSearchParams({ csrfToken, phone, password }),
      redirect: "manual",
    });
    this.#stash(res);
    const s = await this.req("GET", "/api/auth/session");
    if (!s.body?.user) throw new Error(`${this.label} 登录失败 (${phone})`);
    this.user = s.body.user;
    return this.user;
  }
  async req(method, path, body) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { cookie: this.#jar(), ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "manual",
    });
    let parsed = null;
    try { parsed = await res.json(); } catch { /* 无响应体 */ }
    return { status: res.status, body: parsed };
  }
}

let step = 0;
/** 打印一步操作的结果；失败即中断，避免在错误状态上继续演练。 */
function log(actor, action, res, detail) {
  step += 1;
  const ok = res.status >= 200 && res.status < 300;
  const mark = ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  console.log(`${mark} ${String(step).padStart(2)}. [${actor}] ${action}  → HTTP ${res.status}${detail ? `  ${detail}` : ""}`);
  if (!ok) {
    console.log(`     错误：${res.body?.error ?? "(无错误信息)"}`);
    throw new Error("流程中断");
  }
}

async function cleanup() {
  const s = await prisma.student.findFirst({ where: { phone: STUDENT_PHONE } });
  if (!s) return false;
  await prisma.ledgerEntry.deleteMany({ where: { studentId: s.id } });
  await prisma.refundRequest.deleteMany({ where: { studentId: s.id } });
  await prisma.courseDeduction.deleteMany({ where: { package: { studentId: s.id } } });
  await prisma.lessonLog.deleteMany({ where: { lesson: { studentId: s.id } } });
  await prisma.scheduledLesson.deleteMany({ where: { studentId: s.id } });
  await prisma.coursePackage.deleteMany({ where: { studentId: s.id } });
  await prisma.followUp.deleteMany({ where: { studentId: s.id } });
  await prisma.lead.deleteMany({ where: { studentId: s.id } });
  await prisma.leadImportLog.deleteMany({ where: { studentId: s.id } });
  await prisma.student.delete({ where: { id: s.id } });
  return true;
}

async function main() {
  if (CLEAN) {
    const had = await cleanup();
    console.log(had ? "已清除上一次演练数据。" : "没有找到演练数据。");
    return;
  }

  await cleanup(); // 重复运行时先清理，保证从零开始

  console.log("\n══ 全流程真实演练（全部走 HTTP 接口）══\n");

  // 登录各角色（Markham 校区）
  const sales     = new Client("销售");   await sales.login("6470000001", "sales123");
  const principal = new Client("校长");   await principal.login("6470000003", "principal123");
  const finance   = new Client("财务");   await finance.login("6470000005", "finance123");
  const academic  = new Client("教务");   await academic.login("6470000004", "acad123");
  const teacher   = new Client("老师");   await teacher.login("6470000002", "teacher123");
  const manager   = new Client("学管");   await manager.login("6470000011", "sm123");
  console.log(`已登录：销售 ${sales.user.name} / 校长 ${principal.user.name} / 财务 ${finance.user.name} / 教务 ${academic.user.name} / 老师 ${teacher.user.name} / 学管 ${manager.user.name}\n`);

  // 需要的基础数据（年级/科目/教室走只读接口拿）
  const grades = (await academic.req("GET", "/api/admin/grades")).body;
  const subjects = (await academic.req("GET", "/api/admin/subjects")).body;
  const rooms = (await academic.req("GET", "/api/schedule/classrooms")).body;
  const grade = grades.find((g) => g.name === "Grade 10") ?? grades[0];
  const subject = subjects.find((s) => s.name === "Math") ?? subjects[0];
  const room = rooms.find((r) => r.campus?.name?.includes("Markham")) ?? rooms[0];

  // ── 1. 校长添加线索（手动录入，不指定归属 → 留空待分配）
  const created = await principal.req("POST", "/api/students", {
    name: STUDENT_NAME, phone: STUDENT_PHONE, campusId: "campus-markham",
    gradeId: grade.id, preferredContactApp: "WECHAT", contactAppId: "wx_wxm_demo",
    postalCode: "L3R 5G2", subjectsOfInterest: "数学",
    sourceCategory: "OFFLINE_EVENT", sourceDetail: "门店咨询",
  });
  log("校长", "添加线索（不指定归属）", created, `学生 ${created.body?.name}`);
  const studentId = created.body.id;

  // ── 2. 校长把线索分配给销售
  const assigned = await principal.req("POST", "/api/leads/assign", {
    studentIds: [studentId], salesId: sales.user.id,
  });
  log("校长", `分配线索给销售 ${sales.user.name}`, assigned);

  // ── 3. 销售添加跟进记录
  const follow = await sales.req("POST", `/api/students/${studentId}/followups`, {
    contactMethod: "PHONE", content: "电话沟通，家长关注 Grade 10 数学，约周末试听",
    followedAt: new Date().toISOString().slice(0, 16),
    nextFollowUp: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
  });
  log("销售", "添加跟进记录", follow);

  // ── 4. 销售成交，创建课包（20h × $80 = $1600）
  const pkgRes = await sales.req("POST", "/api/packages", {
    studentId, gradeId: grade.id, subjectId: subject.id,
    totalHours: 20, pricePerHour: 80, totalAmount: 1600,
    notes: "演练：周末 2h/次",
  });
  log("销售", "成交，创建课包 20h × $80", pkgRes, `类型 ${pkgRes.body?.signingType}，状态 ${pkgRes.body?.status}`);
  const packageId = pkgRes.body.id;

  // ── 5. 校长确认课包并分配学管
  const confirm = await principal.req("POST", `/api/packages/${packageId}/confirm`, {
    studentManagerId: "user-sm-mkm",
  });
  log("校长", "确认课包 + 分配学管", confirm, `状态 ${confirm.body?.status}`);

  // ── 6. 财务确认，课包正式生效
  const finConfirm = await finance.req("POST", `/api/packages/${packageId}/finance-confirm`);
  log("财务", "复核确认，课包生效", finConfirm, `状态 ${finConfirm.body?.status}`);

  // ── 7. 教务排课（下周一 16:00–18:00，多伦多时间）
  const monday = new Date();
  monday.setUTCDate(monday.getUTCDate() + ((8 - monday.getUTCDay()) % 7 || 7));
  const day = monday.toISOString().slice(0, 10);
  const start = new Date(`${day}T20:00:00.000Z`); // 多伦多 16:00 (EDT)
  const end = new Date(`${day}T22:00:00.000Z`);   // 多伦多 18:00
  const sched = await academic.req("POST", "/api/schedule", {
    teacherId: teacher.user.id, studentId, packageId, classroomId: room.id,
    startTime: start.toISOString(), endTime: end.toISOString(), lessonType: "ONE_ON_ONE",
  });
  log("教务", `排课 ${day} 多伦多 16:00–18:00（2h）`, sched);
  const lessonId = sched.body.id;

  // ── 8. 老师上完课，提交课后反馈
  const lessonLog = await teacher.req("POST", `/api/lessons/${lessonId}/log`, {
    subjectId: subject.id,
    notes: "复习一元二次方程，课堂练习正确率 80%，布置 5 道作业。",
  });
  log("老师", "提交课后反馈", lessonLog);

  // ── 9. 教务核销该节课（扣 2h）
  const deduct = await academic.req("POST", `/api/lessons/${lessonId}/confirm`);
  log("教务", "核销课时（扣 2h）", deduct);

  const afterDeduct = (await finance.req("GET", `/api/packages/${packageId}`)).body;
  console.log(`     └─ 课包现状：总 ${afterDeduct.totalHours}h / 剩余 ${afterDeduct.remainingHours}h / 已核销 2h`);

  // ── 10. 学管发起退费（家长要退 8h）
  const refundReq = await manager.req("POST", "/api/refunds", {
    packageId, hours: 8, reason: "演练：家长搬家，退部分课时",
  });
  log("学管", "发起退费 8h", refundReq, `应退 $${refundReq.body?.amount}，状态 ${refundReq.body?.status}`);
  const refundId = refundReq.body.id;

  // ── 11. 校长审核
  const rApprove = await principal.req("POST", `/api/refunds/${refundId}/approve`);
  log("校长", "审核退费申请", rApprove, `状态 ${rApprove.body?.status}`);

  // ── 12. 财务复核并打款
  const rPay = await finance.req("POST", `/api/refunds/${refundId}/pay`);
  log("财务", "复核并打款", rPay, `状态 ${rPay.body?.status}`);

  // ── 核对账目
  const finalPkg = (await finance.req("GET", `/api/packages/${packageId}`)).body;
  const ledger = (await finance.req("GET", `/api/students/${studentId}/ledger`)).body;
  const stu = (await finance.req("GET", `/api/students/${studentId}`)).body;

  console.log("\n══ 账目核对 ══");
  console.log(`学生：${stu.name}（${stu.campus.name}） 归属销售 ${stu.sales?.name} · 学管 ${stu.studentManager?.name}`);
  console.log(`跟进记录 ${stu.followUps.length} 条 · 上课记录 ${stu.lessons.length} 节`);
  console.log(`课包：总 ${finalPkg.totalHours}h（原 20 − 退 8）/ 剩余 ${finalPkg.remainingHours}h（20 − 核销 2 − 退 8）/ 总额 $${finalPkg.totalAmount}`);
  const consumed = finalPkg.deductions.filter((d) => !d.reversedAt).reduce((s, d) => s + Number(d.hoursDeducted), 0);
  const inv1 = Math.abs(finalPkg.totalAmount - finalPkg.totalHours * finalPkg.pricePerHour) < 0.005;
  const inv2 = Math.abs(finalPkg.remainingHours - (finalPkg.totalHours - consumed)) < 0.005;
  console.log(`不变量 总价 = 总课时 × 单价：${inv1 ? "✓" : "✗"}   剩余 = 总课时 − 已核销：${inv2 ? "✓" : "✗"}`);
  console.log(`账本流水 ${ledger.entries.length} 条，账户余额 $${ledger.balance}`);
  for (const e of ledger.entries) {
    console.log(`   ${String(e.type).padEnd(15)} ${Number(e.amount) >= 0 ? "+" : "−"}$${Math.abs(Number(e.amount))}  ${e.note}`);
  }

  console.log("\n数据已保留，可在界面上核对：");
  console.log(`   学生详情  ${BASE}/students/${studentId}`);
  console.log(`   课包详情  ${BASE}/packages/${packageId}`);
  console.log(`   退费管理  ${BASE}/refunds`);
  console.log(`   核销管理  ${BASE}/lessons`);
  console.log(`\n清除本次数据：node scripts/walkthrough.mjs --clean\n`);
}

main()
  .catch((e) => { console.error("\n演练失败：", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
