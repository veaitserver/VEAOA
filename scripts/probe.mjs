/**
 * 安全回归探测 —— 仅用于本地开发数据库。
 *
 * 每条 check 断言的都是「修好之后应有的行为」，所以在修复前会大面积 FAIL，
 * 修复后应全部 PASS。夹具用 Prisma 直接建/删，攻击面一律走真实 HTTP。
 *
 *   npm run dev          # 另开一个终端
 *   node scripts/probe.mjs
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { readFileSync } from "node:fs";

const prisma = new PrismaClient();
const BASE = process.env.PROBE_BASE ?? "http://localhost:3000";

// 从 .env 读取线索导入 API key（探测要拿它构造合法/非法请求）。
function readApiKey() {
  if (process.env.LEAD_IMPORT_API_KEY) return process.env.LEAD_IMPORT_API_KEY;
  try {
    const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
    const m = env.match(/^LEAD_IMPORT_API_KEY="?([^"\r\n]+)"?/m);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

// ── 迷你 HTTP 客户端（每个实例一个独立 cookie jar，可同时持有多个会话）──────
class Client {
  constructor(label) {
    this.label = label;
    this.cookies = {};
  }
  #jar() {
    return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  }
  #stash(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
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
    this.session = await this.req("GET", "/api/auth/session").then((r) => r.body);
    if (!this.session?.user) throw new Error(`${this.label} 登录失败 (${phone})`);
    return this.session;
  }
  async req(method, path, body) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        cookie: this.#jar(),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "manual",
    });
    let parsed;
    const text = await res.text();
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed, location: res.headers.get("location") };
  }
}

// ── 断言 ────────────────────────────────────────────────────────────────────
const results = [];
function check(phase, name, pass, detail) {
  results.push({ phase, name, pass, detail });
  console.log(`  ${pass ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${name}`);
  if (detail) console.log(`        ${detail}`);
}
/**
 * 越权请求应被拒。401/403/404 是接口自己挡的；3xx 是 proxy 兜底重定向到登录页
 * （数据同样没吐出去）。只有 200 才算洞还在。
 */
const blocked = (r) => [401, 403, 404].includes(r.status) || (r.status >= 300 && r.status < 400);

// ── 夹具 ────────────────────────────────────────────────────────────────────
const FIX = { hrPhone: "6479999901", studentPhone: "6479999902" };
let fx = {};

async function setup() {
  // 「HR 重置超管密码」那条探测在洞还没堵上时会真的改掉超管密码，
  // 把下一轮探测锁在门外。每轮开始先把它拉回已知基线。
  await prisma.user.update({
    where: { phone: "6470000000" },
    data: { passwordHash: await bcrypt.hash("admin123", 12) },
  });

  const hrHash = await bcrypt.hash("hrprobe123", 12);
  const hr = await prisma.user.upsert({
    where: { phone: FIX.hrPhone },
    update: { passwordHash: hrHash, isActive: true },
    create: { name: "Probe HR", phone: FIX.hrPhone, passwordHash: hrHash },
  });
  // 每次跑都把 HR 的角色/校区重置回基线（上一轮如果提权成功会残留）
  await prisma.userRole.deleteMany({ where: { userId: hr.id } });
  await prisma.userRole.create({ data: { userId: hr.id, role: "HR" } });
  await prisma.userCampus.deleteMany({ where: { userId: hr.id } });
  await prisma.userCampus.create({ data: { userId: hr.id, campusId: "campus-markham" } });

  const admin = await prisma.user.findUnique({ where: { phone: "6470000000" } });
  const rhTeacher = await prisma.user.findUnique({ where: { phone: "6470000007" } });
  const grade = await prisma.grade.findFirst();
  const subject = await prisma.subject.findFirst();
  const rhRoom = await prisma.classroom.findFirst({ where: { campusId: "campus-rh" } });
  // 第二间 RH 教室：撞课测试要同校区、不同教室不同老师，只让「学生」这一维冲突。
  const rhRoom2 = await prisma.classroom.upsert({
    where: { id: "room-rh-probe" },
    update: {},
    create: { id: "room-rh-probe", name: "Probe Room RH", campusId: "campus-rh", capacity: 4 },
  });

  // Richmond Hill 的一次性学生 + 待审批课包 + 已激活课包 + 未来课程
  const student = await prisma.student.upsert({
    where: { campusId_phone_name: { campusId: "campus-rh", phone: FIX.studentPhone, name: "Probe Student RH" } },
    update: { campusId: "campus-rh" },
    create: {
      name: "Probe Student RH", phone: FIX.studentPhone,
      gradeId: grade.id, campusId: "campus-rh",
    },
  });
  await prisma.scheduledLesson.deleteMany({ where: { studentId: student.id } });
  await prisma.coursePackage.deleteMany({ where: { studentId: student.id } });

  const pending = await prisma.coursePackage.create({
    data: {
      studentId: student.id, gradeId: grade.id, subjectId: subject.id,
      totalHours: 40, pricePerHour: 100, totalAmount: 4000, remainingHours: 40,
      status: "PENDING_APPROVAL", createdById: admin.id,
    },
  });
  const active = await prisma.coursePackage.create({
    data: {
      studentId: student.id, gradeId: grade.id, subjectId: subject.id,
      totalHours: 10, pricePerHour: 100, totalAmount: 1000, remainingHours: 10,
      status: "ACTIVE", createdById: admin.id, confirmedById: admin.id, confirmedAt: new Date(),
    },
  });
  const base = new Date("2026-09-01T14:00:00Z");
  const lesson = await prisma.scheduledLesson.create({
    data: {
      teacherId: rhTeacher.id, studentId: student.id, packageId: active.id,
      classroomId: rhRoom.id, startTime: base, endTime: new Date(base.getTime() + 2 * 3600000),
    },
  });

  fx = { hr, admin, rhTeacher, student, pending, active, lesson, grade, subject, rhRoom, rhRoom2, base };
}

async function teardown() {
  await prisma.scheduledLesson.deleteMany({ where: { studentId: fx.student.id } });
  // 课包生效会写账本流水、退费会建申请，两者都外键指向学生，删学生前先清掉。
  await prisma.ledgerEntry.deleteMany({ where: { studentId: fx.student.id } });
  await prisma.refundRequest.deleteMany({ where: { studentId: fx.student.id } });
  await prisma.coursePackage.deleteMany({ where: { studentId: fx.student.id } });
  await prisma.student.deleteMany({ where: { phone: FIX.studentPhone } });
  await prisma.classroom.deleteMany({ where: { id: "room-rh-probe" } });
  await prisma.userRole.deleteMany({ where: { userId: fx.hr.id } });
  await prisma.userCampus.deleteMany({ where: { userId: fx.hr.id } });
  await prisma.user.deleteMany({ where: { phone: FIX.hrPhone } });
  await prisma.$disconnect();
}

// ── 探测 ────────────────────────────────────────────────────────────────────
async function run() {
  const anon = new Client("anon");
  const admin = new Client("超管");   await admin.login("6470000000", "admin123");
  const mkmSales = new Client("Markham 销售"); await mkmSales.login("6470000001", "sales123");
  const mkmTeacher = new Client("Markham 老师"); await mkmTeacher.login("6470000002", "teacher123");
  const hr = new Client("HR"); await hr.login(FIX.hrPhone, "hrprobe123");

  // ── 阶段 1：兜底 + 密码哈希 + HR 提权 ────────────────────────────────────
  console.log("\n阶段 1 — 止血");

  for (const p of ["/api/admin/grades", "/api/admin/subjects"]) {
    const r = await anon.req("GET", p);
    check(1, `未登录访问 ${p} 应被拒`, blocked(r),
      r.status === 200
        ? `实际 200 — 泄露 ${Array.isArray(r.body) ? r.body.length : "?"} 行`
        : `实际 ${r.status}${r.location ? ` → ${r.location}` : ""}`);
  }

  const usersRes = await admin.req("GET", "/api/admin/users");
  const leaked = (Array.isArray(usersRes.body) ? usersRes.body : []).filter((u) => "passwordHash" in u);
  check(1, "GET /api/admin/users 不应返回 passwordHash", leaked.length === 0,
    leaked.length ? `${leaked.length}/${usersRes.body.length} 个用户的哈希被返回` : undefined);

  const created = await admin.req("POST", "/api/admin/users", {
    name: "Probe Throwaway", phone: "6479999903", password: "throwaway123",
    roles: ["SALES"], campusIds: ["campus-markham"],
  });
  check(1, "POST /api/admin/users 响应不应含 passwordHash",
    created.status !== 201 || !("passwordHash" in created.body),
    created.status === 201 ? undefined : `创建失败 ${created.status}`);
  if (created.status === 201) {
    const put = await admin.req("PUT", `/api/admin/users/${created.body.id}`, { name: "Probe Renamed" });
    check(1, "PUT /api/admin/users/[id] 响应不应含 passwordHash",
      !("passwordHash" in (put.body ?? {})));
    await prisma.userRole.deleteMany({ where: { userId: created.body.id } });
    await prisma.userCampus.deleteMany({ where: { userId: created.body.id } });
    await prisma.user.delete({ where: { id: created.body.id } });
  }

  const esc = await hr.req("PUT", `/api/admin/users/${fx.hr.id}`, { roles: ["HR", "SUPER_ADMIN"] });
  const hrRolesNow = await prisma.userRole.findMany({ where: { userId: fx.hr.id } });
  check(1, "HR 不得把自己提权为 SUPER_ADMIN",
    !hrRolesNow.some((r) => r.role === "SUPER_ADMIN"),
    `HTTP ${esc.status}，库内角色现为 [${hrRolesNow.map((r) => r.role).join(", ")}]`);

  const pwAttack = await hr.req("PUT", `/api/admin/users/${fx.admin.id}`, { password: "pwned12345" });
  const adminRow = await prisma.user.findUnique({ where: { id: fx.admin.id } });
  const adminPwned = await bcrypt.compare("pwned12345", adminRow.passwordHash);
  check(1, "HR 不得重置 SUPER_ADMIN 的密码", !adminPwned, `HTTP ${pwAttack.status}`);
  if (adminPwned) {
    await prisma.user.update({
      where: { id: fx.admin.id },
      data: { passwordHash: await bcrypt.hash("admin123", 12) },
    });
  }

  const garbage = await hr.req("PUT", `/api/admin/users/${fx.hr.id}`, { roles: ["NOT_A_REAL_ROLE"] });
  check(1, "roles 应做枚举校验，非法值返回 400", garbage.status === 400, `实际 ${garbage.status}`);

  const grab = await hr.req("PUT", `/api/admin/users/${fx.hr.id}`, {
    campusIds: ["campus-markham", "campus-rh", "campus-scar", "campus-miss"],
  });
  const hrCampusNow = await prisma.userCampus.findMany({ where: { userId: fx.hr.id } });
  check(1, "HR 不得给自己授予无权的校区", hrCampusNow.length === 1,
    `HTTP ${grab.status}，库内校区数 ${hrCampusNow.length}`);

  // 一般规则（不止「超管」这个特例）：HR 不得自我提权为校长/财务
  const escRole = await hr.req("PUT", `/api/admin/users/${fx.hr.id}`, { roles: ["HR", "PRINCIPAL", "FINANCE"] });
  const hrRole2 = await prisma.userRole.findMany({ where: { userId: fx.hr.id } });
  check(1, "HR 不得把自己提权为校长/财务",
    !hrRole2.some((r) => r.role === "PRINCIPAL" || r.role === "FINANCE"),
    `HTTP ${escRole.status}，库内角色 [${hrRole2.map((r) => r.role).join(", ")}]`);

  // HR（Markham）不得跨校区重置别校区（RH）用户的密码 —— 否则可接管账号
  const rhPrin = await prisma.user.findUnique({ where: { phone: "6470000008" } });
  const rhHashBefore = rhPrin.passwordHash;
  const xReset = await hr.req("PUT", `/api/admin/users/${rhPrin.id}`, { password: "pwned-crosscampus" });
  const rhRow = await prisma.user.findUnique({ where: { id: rhPrin.id } });
  const rhPwned = await bcrypt.compare("pwned-crosscampus", rhRow.passwordHash);
  check(1, "HR 不得重置别校区用户的密码", !rhPwned, `HTTP ${xReset.status}`);
  if (rhPwned) await prisma.user.update({ where: { id: rhPrin.id }, data: { passwordHash: rhHashBefore } });

  // 正向回归：修复不能误伤 —— HR 仍可管理本校区运营角色用户
  const okName = await hr.req("PUT", `/api/admin/users/${mkmSales.session.user.id}`, { name: "Sarah Chen" });
  check(1, "HR 仍可改本校区销售的资料（未误伤）", okName.status === 200, `实际 ${okName.status}`);

  // ── 阶段 2：校区隔离 ────────────────────────────────────────────────────
  console.log("\n阶段 2 — 校区隔离");

  const crossList = await mkmSales.req("GET", "/api/students?campusId=campus-rh");
  const leakedStudents = (Array.isArray(crossList.body) ? crossList.body : [])
    .filter((s) => s.campusId !== "campus-markham");
  check(2, "campusId 参数不得越过校区隔离（students）", leakedStudents.length === 0,
    leakedStudents.length ? `Markham 销售看到了 ${leakedStudents.length} 个外校区学生` : undefined);

  const crossRpt = await mkmSales.req("GET", "/api/reports/sales?campusId=campus-rh");
  const leakedPkgs = (crossRpt.body?.packages ?? []).filter((p) => p.student?.campusId !== "campus-markham");
  check(2, "campusId 参数不得越过校区隔离（reports/sales）", leakedPkgs.length === 0,
    leakedPkgs.length ? `泄露 ${leakedPkgs.length} 个外校区课包，营收 $${crossRpt.body.total}` : undefined);

  const idorStudent = await mkmSales.req("GET", `/api/students/${fx.student.id}`);
  check(2, "按 id 读外校区学生应被拒", blocked(idorStudent), `实际 ${idorStudent.status}`);

  const idorPkg = await mkmSales.req("GET", `/api/packages/${fx.active.id}`);
  check(2, "按 id 读外校区课包应被拒", blocked(idorPkg), `实际 ${idorPkg.status}`);

  const idorFollow = await mkmSales.req("GET", `/api/students/${fx.student.id}/followups`);
  check(2, "读外校区学生跟进记录应被拒", blocked(idorFollow), `实际 ${idorFollow.status}`);

  const migrate = await mkmTeacher.req("PUT", `/api/students/${fx.student.id}`, { campusId: "campus-markham" });
  const studentNow = await prisma.student.findUnique({ where: { id: fx.student.id } });
  check(2, "不得把外校区学生迁移到自己校区", studentNow.campusId === "campus-rh",
    `HTTP ${migrate.status}，学生现属 ${studentNow.campusId}`);
  await prisma.student.update({ where: { id: fx.student.id }, data: { campusId: "campus-rh" } });

  // ── 阶段 3：角色校验 ────────────────────────────────────────────────────
  console.log("\n阶段 3 — 角色校验");

  const teacherRpt = await mkmTeacher.req("GET", "/api/reports/sales");
  check(3, "老师不得读销售报表", blocked(teacherRpt),
    `实际 ${teacherRpt.status}${teacherRpt.status === 200 ? ` — 营收 $${teacherRpt.body.total}` : ""}`);

  const teacherEdit = await mkmTeacher.req("PUT", `/api/packages/${fx.pending.id}`, {
    totalHours: 500, pricePerHour: 1, totalAmount: 500,
  });
  const pkgNow = await prisma.coursePackage.findUnique({ where: { id: fx.pending.id } });
  check(3, "老师不得改待审批课包的价格/课时", Number(pkgNow.totalHours) === 40,
    `HTTP ${teacherEdit.status}，课包现为 ${pkgNow.totalHours}h @ $${pkgNow.pricePerHour}`);

  // H1: 老师不得读课包详情（此前拿到 packageId 即可读全量单价/总额/扣课台账）
  const teacherReadPkg = await mkmTeacher.req("GET", `/api/packages/${fx.pending.id}`);
  check(3, "老师不得读课包详情", blocked(teacherReadPkg), `实际 ${teacherReadPkg.status}`);

  const salesSchedule = await mkmSales.req("POST", "/api/schedule", {
    teacherId: fx.rhTeacher.id, studentId: fx.student.id, packageId: fx.active.id,
    classroomId: fx.rhRoom.id,
    startTime: new Date(fx.base.getTime() + 86400000).toISOString(),
    endTime: new Date(fx.base.getTime() + 86400000 + 3600000).toISOString(),
  });
  check(3, "销售不得排课（canSchedule 未授权）", blocked(salesSchedule), `实际 ${salesSchedule.status}`);
  if (salesSchedule.status === 201) await prisma.scheduledLesson.delete({ where: { id: salesSchedule.body.id } });

  const teacherDel = await mkmTeacher.req("DELETE", `/api/schedule/${fx.lesson.id}`);
  const lessonNow = await prisma.scheduledLesson.findUnique({ where: { id: fx.lesson.id } });
  check(3, "老师不得删除外校区课程", lessonNow !== null, `HTTP ${teacherDel.status}`);
  if (!lessonNow) {
    fx.lesson = await prisma.scheduledLesson.create({
      data: {
        teacherId: fx.rhTeacher.id, studentId: fx.student.id, packageId: fx.active.id,
        classroomId: fx.rhRoom.id, startTime: fx.base, endTime: new Date(fx.base.getTime() + 2 * 3600000),
      },
    });
  }

  // 校区列表是建档下拉框的数据源，销售要用，不能一刀切禁掉；
  // 但每个人只应看到自己有权的校区。
  const teacherCampuses = await mkmTeacher.req("GET", "/api/admin/campuses");
  const foreign = (Array.isArray(teacherCampuses.body) ? teacherCampuses.body : [])
    .filter((c) => c.id !== "campus-markham");
  check(3, "校区列表应收敛到本人校区", teacherCampuses.status === 200 && foreign.length === 0,
    `HTTP ${teacherCampuses.status}，看到 ${Array.isArray(teacherCampuses.body) ? teacherCampuses.body.length : "?"} 个校区，其中 ${foreign.length} 个是外校区`);

  const stealLog = await mkmTeacher.req("POST", `/api/lessons/${fx.lesson.id}/log`, {
    subjectId: fx.subject.id, notes: "probe: 别人的课",
  });
  const logNow = await prisma.lessonLog.findUnique({ where: { lessonId: fx.lesson.id } });
  check(3, "老师不得给别人的课提交日志", logNow === null,
    `HTTP ${stealLog.status}${logNow ? ` — 工时被记到 ${logNow.teacherId}` : ""}`);
  if (logNow) await prisma.lessonLog.delete({ where: { id: logNow.id } });

  // 校区/教室管理仅限超级管理员（校长这种高权限角色也不行）
  const principal = new Client("Markham 校长"); await principal.login("6470000003", "principal123");
  const roomBlocked = await principal.req("POST", "/api/admin/classrooms", { name: "x", campusId: "campus-markham" });
  check(3, "非超管（校长）不得新建教室", blocked(roomBlocked), `实际 ${roomBlocked.status}`);
  const campusBlocked = await principal.req("POST", "/api/admin/campuses", { name: "x" });
  check(3, "非超管（校长）不得新建校区", blocked(campusBlocked), `实际 ${campusBlocked.status}`);

  const roomCreate = await admin.req("POST", "/api/admin/classrooms", { name: "Probe Room", campusId: "campus-markham", capacity: 5 });
  check(3, "超管可新建教室", roomCreate.status === 201, `实际 ${roomCreate.status}`);
  const busyRoom = await prisma.classroom.findFirst({ where: { lessons: { some: {} } }, select: { id: true } });
  const delBusy = await admin.req("DELETE", `/api/admin/classrooms/${busyRoom.id}`);
  check(3, "有排课记录的教室不得删除", delBusy.status === 400, `实际 ${delBusy.status}`);
  if (roomCreate.status === 201) await admin.req("DELETE", `/api/admin/classrooms/${roomCreate.body.id}`);

  // ── 阶段 4：业务逻辑 ────────────────────────────────────────────────────
  console.log("\n阶段 4 — 业务逻辑");

  const finance = new Client("财务"); await finance.login("6470000005", "finance123");

  // 15. 改 totalHours 不应还原已消耗课时。用真实扣课记录模拟已消耗 6h
  //     （已消耗以扣课台账为准，不是信 remainingHours）。
  const consumedSlot = new Date(fx.base.getTime() + 3 * 86400000);
  const consumedLesson = await prisma.scheduledLesson.create({
    data: {
      teacherId: fx.rhTeacher.id, studentId: fx.student.id, packageId: fx.active.id,
      classroomId: fx.rhRoom.id, startTime: consumedSlot, endTime: new Date(consumedSlot.getTime() + 6 * 3600000),
    },
  });
  const consumedLog = await prisma.lessonLog.create({
    data: { lessonId: consumedLesson.id, teacherId: fx.rhTeacher.id, subjectId: fx.subject.id, notes: "probe consumed" },
  });
  await prisma.courseDeduction.create({
    data: { packageId: fx.active.id, logId: consumedLog.id, hoursDeducted: 6 },
  });
  await prisma.coursePackage.update({ where: { id: fx.active.id }, data: { remainingHours: 4 } });

  // 改总课时 10→12，剩余应变成 12−6=6，而不是被重置成 12。
  const bump = await finance.req("PUT", `/api/packages/${fx.active.id}`, {
    totalHours: 12, pricePerHour: 100, totalAmount: 1200,
  });
  const afterBump = await prisma.coursePackage.findUnique({ where: { id: fx.active.id } });
  check(4, "改 totalHours 后余额应按已消耗重算（12−6=6）", Number(afterBump.remainingHours) === 6,
    `HTTP ${bump.status}，剩余课时 ${afterBump.remainingHours}h`);

  // 不得把总课时改到低于已消耗（6h）。
  const shrink = await finance.req("PUT", `/api/packages/${fx.active.id}`, {
    totalHours: 4, pricePerHour: 100, totalAmount: 400,
  });
  check(4, "总课时不得改到低于已消耗", shrink.status === 400, `实际 ${shrink.status}`);

  // 清理，把 fx.active 恢复成 10h/10h 供后续测试复用
  await prisma.courseDeduction.deleteMany({ where: { logId: consumedLog.id } });
  await prisma.lessonLog.delete({ where: { id: consumedLog.id } });
  await prisma.scheduledLesson.delete({ where: { id: consumedLesson.id } });
  await prisma.coursePackage.update({
    where: { id: fx.active.id }, data: { totalHours: 10, pricePerHour: 100, totalAmount: 1000, remainingHours: 10 },
  });

  // 21. 总价必须 = 总课时 × 单价
  const badMath = await finance.req("PUT", `/api/packages/${fx.active.id}`, {
    totalHours: 10, pricePerHour: 100, totalAmount: 800,
  });
  check(4, "总价 ≠ 总课时 × 单价 应被拒", badMath.status === 400, `实际 ${badMath.status}`);

  // 18. 学生撞课（同校区、不同教室不同老师，只让「学生」这一维冲突）
  const t2 = new Client("RH 老师"); await t2.login("6470000007", "teacher123");
  // 排课已收归教务/校长（老师只读自己的课表），以下排课类断言用 RH 校长作为操作者。
  const rhSched = new Client("RH 校长（排课）"); await rhSched.login("6470000008", "principal123");
  const slot = new Date(fx.base.getTime() + 7 * 86400000);
  const first = await prisma.scheduledLesson.create({
    data: {
      teacherId: fx.rhTeacher.id, studentId: fx.student.id, packageId: fx.active.id,
      classroomId: fx.rhRoom.id, startTime: slot, endTime: new Date(slot.getTime() + 3600000),
    },
  });
  // 用「另一名 RH 老师 + 另一间 RH 教室」隔离出「学生」这一维（老师/教室都不冲突）。
  await prisma.user.deleteMany({ where: { phone: "6470000099" } });
  const rhTeacher2 = await prisma.user.create({
    data: {
      name: "Probe RH Teacher2", phone: "6470000099", passwordHash: await bcrypt.hash("teacher123", 12),
      roles: { create: [{ role: "TEACHER" }] }, campuses: { create: [{ campusId: "campus-rh" }] },
    },
  });
  const clash = await rhSched.req("POST", "/api/schedule", {
    teacherId: rhTeacher2.id, studentId: fx.student.id, packageId: fx.active.id,
    classroomId: fx.rhRoom2.id,
    startTime: slot.toISOString(), endTime: new Date(slot.getTime() + 3600000).toISOString(),
  });
  check(4, "同一学生同一时段不得被排两节课", clash.status === 409, `实际 ${clash.status}`);
  if (clash.status === 201) await prisma.scheduledLesson.delete({ where: { id: clash.body.id } });
  await prisma.scheduledLesson.delete({ where: { id: first.id } });
  await prisma.userRole.deleteMany({ where: { userId: rhTeacher2.id } });
  await prisma.userCampus.deleteMany({ where: { userId: rhTeacher2.id } });
  await prisma.user.delete({ where: { id: rhTeacher2.id } });

  // M2: 排课不得指定别校区老师（此前 teacherId 直接落库，可跨校区占用老师）
  const mkmT = await prisma.user.findFirst({ where: { phone: "6470000002" } });
  const xTeacher = await admin.req("POST", "/api/schedule", {
    teacherId: mkmT.id, studentId: fx.student.id, packageId: fx.active.id, classroomId: fx.rhRoom.id,
    startTime: new Date(fx.base.getTime() + 40 * 86400000).toISOString(),
    endTime: new Date(fx.base.getTime() + 40 * 86400000 + 3600000).toISOString(),
  });
  check(4, "排课不得指定别校区老师", xTeacher.status === 400, `实际 ${xTeacher.status}`);
  if (xTeacher.status === 201) await prisma.scheduledLesson.delete({ where: { id: xTeacher.body.id } });

  // 19. 排课不得超库存（余额 10h，先排 8h，再排 4h 应被拒）
  const s1 = new Date(fx.base.getTime() + 14 * 86400000);
  const hog = await prisma.scheduledLesson.create({
    data: {
      teacherId: fx.rhTeacher.id, studentId: fx.student.id, packageId: fx.active.id,
      classroomId: fx.rhRoom.id, startTime: s1, endTime: new Date(s1.getTime() + 8 * 3600000),
    },
  });
  const s2 = new Date(fx.base.getTime() + 21 * 86400000);
  const over = await rhSched.req("POST", "/api/schedule", {
    teacherId: fx.rhTeacher.id, studentId: fx.student.id, packageId: fx.active.id,
    classroomId: fx.rhRoom.id,
    startTime: s2.toISOString(), endTime: new Date(s2.getTime() + 4 * 3600000).toISOString(),
  });
  check(4, "排课总量不得超过课包剩余课时（10h 已排 8h，再排 4h）", over.status === 400,
    `实际 ${over.status} — 可用应为 2h`);
  if (over.status === 201) await prisma.scheduledLesson.delete({ where: { id: over.body.id } });
  await prisma.scheduledLesson.delete({ where: { id: hog.id } });

  // 20. 排课必须「结束晚于开始」：负时长课会绕过库存校验，核销时 decrement 负数反给课包加课时
  const negStart = new Date(fx.base.getTime() + 28 * 86400000);
  const neg = await rhSched.req("POST", "/api/schedule", {
    teacherId: fx.rhTeacher.id, studentId: fx.student.id, packageId: fx.active.id,
    classroomId: fx.rhRoom.id,
    startTime: negStart.toISOString(), endTime: new Date(negStart.getTime() - 2 * 3600000).toISOString(),
  });
  check(4, "排课必须结束晚于开始（负时长被拒）", neg.status === 400, `实际 ${neg.status}`);
  if (neg.status === 201) await prisma.scheduledLesson.delete({ where: { id: neg.body.id } });

  // 17. 撤销核销后应能重新核销
  const acad = new Client("教务"); await acad.login("6470000004", "acad123");
  const mkmStudent = await prisma.student.findFirst({ where: { campusId: "campus-markham" } });
  const mkmTeacherRow = await prisma.user.findUnique({ where: { phone: "6470000002" } });
  const mkmRoom = await prisma.classroom.findFirst({ where: { campusId: "campus-markham" } });
  const cyclePkg = await prisma.coursePackage.create({
    data: {
      studentId: mkmStudent.id, gradeId: fx.grade.id, subjectId: fx.subject.id,
      totalHours: 10, pricePerHour: 100, totalAmount: 1000, remainingHours: 10,
      status: "ACTIVE", createdById: fx.admin.id, confirmedById: fx.admin.id, confirmedAt: new Date(),
    },
  });
  const cs = new Date(fx.base.getTime() + 28 * 86400000);
  const cycleLesson = await prisma.scheduledLesson.create({
    data: {
      teacherId: mkmTeacherRow.id, studentId: mkmStudent.id, packageId: cyclePkg.id,
      classroomId: mkmRoom.id, startTime: cs, endTime: new Date(cs.getTime() + 2 * 3600000),
    },
  });
  await prisma.lessonLog.create({
    data: { lessonId: cycleLesson.id, teacherId: mkmTeacherRow.id, subjectId: fx.subject.id, notes: "probe" },
  });
  const c1 = await acad.req("POST", `/api/lessons/${cycleLesson.id}/confirm`);
  const r1 = await finance.req("POST", `/api/lessons/${cycleLesson.id}/reverse`);
  const c2 = await acad.req("POST", `/api/lessons/${cycleLesson.id}/confirm`);
  const cycleNow = await prisma.coursePackage.findUnique({ where: { id: cyclePkg.id } });
  check(4, "撤销核销后应能重新核销", c2.status === 200,
    `核销 ${c1.status} → 撤销 ${r1.status} → 重新核销 ${c2.status}；剩余 ${cycleNow.remainingHours}h（应为 8）`);
  check(4, "核销→撤销→重新核销后余额应为 8h", Number(cycleNow.remainingHours) === 8,
    `实际 ${cycleNow.remainingHours}h`);
  await prisma.courseDeduction.deleteMany({ where: { packageId: cyclePkg.id } });
  await prisma.lessonLog.deleteMany({ where: { lessonId: cycleLesson.id } });
  await prisma.scheduledLesson.delete({ where: { id: cycleLesson.id } });
  await prisma.coursePackage.delete({ where: { id: cyclePkg.id } });

  // 16. remainingHours 不得为负（并发核销）
  const racePkg = await prisma.coursePackage.create({
    data: {
      studentId: mkmStudent.id, gradeId: fx.grade.id, subjectId: fx.subject.id,
      totalHours: 2, pricePerHour: 100, totalAmount: 200, remainingHours: 2,
      status: "ACTIVE", createdById: fx.admin.id, confirmedById: fx.admin.id, confirmedAt: new Date(),
    },
  });
  const raceLessons = [];
  for (let i = 0; i < 2; i++) {
    const rs = new Date(fx.base.getTime() + (35 + i * 7) * 86400000);
    const rl = await prisma.scheduledLesson.create({
      data: {
        teacherId: mkmTeacherRow.id, studentId: mkmStudent.id, packageId: racePkg.id,
        classroomId: mkmRoom.id, startTime: rs, endTime: new Date(rs.getTime() + 2 * 3600000),
      },
    });
    await prisma.lessonLog.create({
      data: { lessonId: rl.id, teacherId: mkmTeacherRow.id, subjectId: fx.subject.id, notes: "probe race" },
    });
    raceLessons.push(rl);
  }
  await Promise.all(raceLessons.map((l) => acad.req("POST", `/api/lessons/${l.id}/confirm`)));
  const raceNow = await prisma.coursePackage.findUnique({ where: { id: racePkg.id } });
  check(4, "并发核销不得把剩余课时扣成负数", Number(raceNow.remainingHours) >= 0,
    `2h 的课包并发核销两节 2h 课 → 剩余 ${raceNow.remainingHours}h`);
  await prisma.courseDeduction.deleteMany({ where: { packageId: racePkg.id } });
  for (const l of raceLessons) {
    await prisma.lessonLog.deleteMany({ where: { lessonId: l.id } });
    await prisma.scheduledLesson.delete({ where: { id: l.id } });
  }
  await prisma.coursePackage.delete({ where: { id: racePkg.id } });

  // H4: 同一节课并发/重复核销只扣一次（幂等门闩）
  const dblPkg = await prisma.coursePackage.create({
    data: {
      studentId: fx.student.id, gradeId: fx.grade.id, subjectId: fx.subject.id,
      totalHours: 10, pricePerHour: 100, totalAmount: 1000, remainingHours: 10,
      status: "ACTIVE", createdById: fx.admin.id, confirmedById: fx.admin.id, confirmedAt: new Date(),
    },
  });
  const dblStart = new Date(fx.base.getTime() + 35 * 86400000);
  const dblLesson = await prisma.scheduledLesson.create({
    data: {
      teacherId: fx.rhTeacher.id, studentId: fx.student.id, packageId: dblPkg.id,
      classroomId: fx.rhRoom.id, startTime: dblStart, endTime: new Date(dblStart.getTime() + 2 * 3600000),
    },
  });
  const dblLog = await prisma.lessonLog.create({
    data: { lessonId: dblLesson.id, teacherId: fx.rhTeacher.id, subjectId: fx.subject.id, notes: "dbl-confirm" },
  });
  await Promise.all([
    admin.req("POST", `/api/lessons/${dblLesson.id}/confirm`),
    admin.req("POST", `/api/lessons/${dblLesson.id}/confirm`),
  ]);
  const dblDeds = await prisma.courseDeduction.count({ where: { logId: dblLog.id, reversedAt: null } });
  const dblPkgNow = await prisma.coursePackage.findUnique({ where: { id: dblPkg.id } });
  check(4, "同一节课并发核销只扣一次（H4）", dblDeds === 1 && Number(dblPkgNow.remainingHours) === 8,
    `生效扣课 ${dblDeds} 条，剩余 ${dblPkgNow.remainingHours}h（应 1 条 / 8h）`);
  await prisma.courseDeduction.deleteMany({ where: { packageId: dblPkg.id } });
  await prisma.lessonLog.deleteMany({ where: { lessonId: dblLesson.id } });
  await prisma.scheduledLesson.delete({ where: { id: dblLesson.id } });
  await prisma.coursePackage.delete({ where: { id: dblPkg.id } });

  // ── 阶段 5：线索导入 API ────────────────────────────────────────────────
  console.log("\n阶段 5 — 线索导入 API");

  const apiKey = readApiKey();
  const PHONE = "6478880001";
  const PHONE_APP = "6478880002"; // 不同电话、相同 contactAppId、同名 → 应合并
  const PHONE_SIB = "6478880003"; // 相同 contactAppId 但不同名（兄弟姐妹）→ 应各自建档
  const cleanupLeads = async () => {
    for (const ph of [PHONE, PHONE_APP, PHONE_SIB]) {
      await prisma.followUp.deleteMany({ where: { student: { phone: ph } } });
      await prisma.lead.deleteMany({ where: { student: { phone: ph } } });
      await prisma.student.deleteMany({ where: { phone: ph } });
    }
    await prisma.leadImportLog.deleteMany({ where: { studentId: null } });
  };
  await cleanupLeads();

  const importReq = (key, body) =>
    fetch(`${BASE}/api/leads/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key ? { "x-api-key": key } : {}) },
      body: JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

  const noKey = await importReq(null, { student_name: "X", phone: PHONE, campaign_token: "mkm-expo-2026" });
  check(5, "无 API key 应 401", noKey.status === 401, `实际 ${noKey.status}`);

  const badKey = await importReq("wrong-key", { student_name: "X", phone: PHONE, campaign_token: "mkm-expo-2026" });
  check(5, "错误 API key 应 401", badKey.status === 401, `实际 ${badKey.status}`);

  const leadCreated = await importReq(apiKey, {
    student_name: "Probe Parent", phone: `+1 (647) 888-0001`, grade: "Grade 9", postal_code: "L3T 7P9",
    preferred_contact_app: "WECHAT", contact_app_id: "probe_app_01", subjects_of_interest: "Math",
    campaign_token: "mkm-expo-2026",
  });
  const createdStudent = await prisma.student.findFirst({
    where: { phone: PHONE }, include: { leadInfo: true, sales: true, followUps: true },
  });
  check(5, "合法 key + campaign 建档应 201", leadCreated.status === 201 && leadCreated.body.result === "CREATED",
    `实际 ${leadCreated.status} ${leadCreated.body.result ?? ""}`);
  check(5, "建档校区/来源取自 campaign，状态 NEW，邮编入库",
    createdStudent?.campusId === "campus-markham" && createdStudent?.leadInfo?.status === "NEW" &&
    createdStudent?.leadInfo?.sourceDetail === "Markham Math Expo 2026" && createdStudent?.postalCode === "L3T 7P9",
    `校区 ${createdStudent?.campusId} / 状态 ${createdStudent?.leadInfo?.status} / 负责人 ${createdStudent?.sales?.name ?? "无"}`);
  check(5, "新线索获次日回访跟进", (createdStudent?.followUps.length ?? 0) === 1 && !!createdStudent?.followUps[0]?.nextFollowUp,
    `跟进数 ${createdStudent?.followUps.length}`);

  const merged = await importReq(apiKey, { student_name: "Probe Parent", phone: "647-888-0001", campaign_token: "mkm-red" });
  const afterMerge = await prisma.student.findMany({ where: { phone: PHONE }, include: { followUps: true } });
  check(5, "同电话再导入应合并不新建（200 MERGED）",
    merged.status === 200 && merged.body.result === "MERGED" && afterMerge.length === 1 && afterMerge[0].followUps.length === 2,
    `实际 ${merged.status} ${merged.body.result ?? ""}，该电话学生数 ${afterMerge.length}`);

  await prisma.lead.update({ where: { studentId: createdStudent.id }, data: { status: "LOST" } });
  await importReq(apiKey, { student_name: "Probe Parent", phone: PHONE, campaign_token: "mkm-red" });
  const afterFlip = await prisma.lead.findUnique({ where: { studentId: createdStudent.id } });
  check(5, "流失线索重新触达应翻回 CONTACTED", afterFlip?.status === "CONTACTED", `实际 ${afterFlip?.status}`);

  const noCampus = await importReq(apiKey, { student_name: "No Campus", phone: "6478889999", source_category: "OTHER", source_detail: "x" });
  check(5, "无 campaign 且无显式校区应 422 拒绝", noCampus.status === 422, `实际 ${noCampus.status}`);

  // 同名 + 相同 App 账号（不同电话）→ 合并（同一学生换了号码）
  const appDedup = await importReq(apiKey, {
    student_name: "Probe Parent", phone: `+1 647-888-0002`, contact_app_id: "PROBE_APP_01", campaign_token: "mkm-expo-2026",
  });
  const appDupCount = await prisma.student.count({ where: { phone: PHONE_APP } });
  check(5, "同名+相同App账号（不同电话）应合并",
    appDedup.body.result === "MERGED" && appDupCount === 0,
    `实际 ${appDedup.body.result ?? appDedup.status}，PHONE_APP 学生数(应为0) ${appDupCount}`);

  // 不同名 + 相同 App 账号（家长微信号被兄弟姐妹共用）→ 不合并，各自建档
  const sibling = await importReq(apiKey, {
    student_name: "Probe Sibling", phone: `+1 647-888-0003`, contact_app_id: "PROBE_APP_01", campaign_token: "mkm-expo-2026",
  });
  const sibCount = await prisma.student.count({ where: { phone: PHONE_SIB } });
  check(5, "不同名+相同App账号（兄弟姐妹）应各自建档不合并",
    sibling.body.result === "CREATED" && sibCount === 1,
    `实际 ${sibling.body.result ?? sibling.status}，PHONE_SIB 学生数(应为1) ${sibCount}`);

  await cleanupLeads();

  // ── 阶段 6：线索归属隔离 ────────────────────────────────────────────────
  console.log("\n阶段 6 — 线索归属隔离");
  const probeSalesPhone = "6477770003";
  const leadPhones = ["6477770001", "6477770002"];
  const cleanupOwner = async () => {
    await prisma.student.deleteMany({ where: { phone: { in: leadPhones } } });
    const ps = await prisma.user.findUnique({ where: { phone: probeSalesPhone } });
    if (ps) {
      await prisma.userRole.deleteMany({ where: { userId: ps.id } });
      await prisma.userCampus.deleteMany({ where: { userId: ps.id } });
    }
  };
  await cleanupOwner();

  const probeSales = await prisma.user.upsert({
    where: { phone: probeSalesPhone },
    update: { passwordHash: await bcrypt.hash("probesales123", 12), isActive: true },
    create: { name: "Probe Sales MKM", phone: probeSalesPhone, passwordHash: await bcrypt.hash("probesales123", 12) },
  });
  await prisma.userRole.create({ data: { userId: probeSales.id, role: "SALES" } });
  await prisma.userCampus.create({ data: { userId: probeSales.id, campusId: "campus-markham" } });
  const sarahId = "user-sales-mkm";
  const leadSarah = await prisma.student.create({
    data: { name: "归属-Sarah", phone: leadPhones[0], campusId: "campus-markham", salesId: sarahId, leadInfo: { create: { source: "OTHER", status: "NEW" } } },
  });
  const leadProbe = await prisma.student.create({
    data: { name: "归属-Probe", phone: leadPhones[1], campusId: "campus-markham", salesId: probeSales.id, leadInfo: { create: { source: "OTHER", status: "NEW" } } },
  });

  const listSarah = await mkmSales.req("GET", "/api/students?status=lead");
  const sarahIds = (Array.isArray(listSarah.body) ? listSarah.body : []).map((s) => s.id);
  check(6, "销售列表只含自己名下线索", sarahIds.includes(leadSarah.id) && !sarahIds.includes(leadProbe.id),
    `含自己 ${sarahIds.includes(leadSarah.id)} / 含他人 ${sarahIds.includes(leadProbe.id)}`);

  const getOther = await mkmSales.req("GET", `/api/students/${leadProbe.id}`);
  check(6, "销售不能查看他人名下线索详情", blocked(getOther), `实际 ${getOther.status}`);

  await mkmSales.req("PUT", `/api/students/${leadSarah.id}`, { salesId: probeSales.id });
  const afterReassign = await prisma.student.findUnique({ where: { id: leadSarah.id } });
  check(6, "销售不能改线索归属", afterReassign.salesId === sarahId, `现归属 ${afterReassign.salesId}`);

  const mkmPrincipal = new Client("Markham 校长2"); await mkmPrincipal.login("6470000003", "principal123");
  const getByP = await mkmPrincipal.req("GET", `/api/students/${leadProbe.id}`);
  check(6, "校长能查看本校区任意线索", getByP.status === 200, `实际 ${getByP.status}`);
  await mkmPrincipal.req("PUT", `/api/students/${leadProbe.id}`, { salesId: sarahId });
  const afterAssign = await prisma.student.findUnique({ where: { id: leadProbe.id } });
  check(6, "校长能分配/变更归属", afterAssign.salesId === sarahId, `现归属 ${afterAssign.salesId}`);

  await cleanupOwner();
  await prisma.user.deleteMany({ where: { phone: probeSalesPhone } });

  // ── 阶段 7：课包两步审批（校长确认 → 财务确认 → 生效）────────────────────
  console.log("\n阶段 7 — 课包两步审批");
  const twoStepPkg = await prisma.coursePackage.create({
    data: {
      studentId: fx.student.id, gradeId: fx.grade.id, subjectId: fx.subject.id,
      totalHours: 10, pricePerHour: 100, totalAmount: 1000, remainingHours: 10,
      status: "PENDING_APPROVAL", createdById: fx.admin.id,
    },
  });
  const rhPrincipal = new Client("RH 校长"); await rhPrincipal.login("6470000008", "principal123");

  const skip = await finance.req("POST", `/api/packages/${twoStepPkg.id}/finance-confirm`);
  check(7, "财务不能跳过校长确认待审批课包", skip.status === 400, `实际 ${skip.status}`);

  // 校长确认并分配学管（RH 学管 user-sm-rh）
  const confirmP = await rhPrincipal.req("POST", `/api/packages/${twoStepPkg.id}/confirm`, { studentManagerId: "user-sm-rh" });
  const afterP = await prisma.coursePackage.findUnique({ where: { id: twoStepPkg.id } });
  const studentAfter = await prisma.student.findUnique({ where: { id: fx.student.id }, select: { studentManagerId: true } });
  check(7, "校长确认后为待财务、未直接生效", confirmP.status === 200 && afterP.status === "PENDING_FINANCE",
    `HTTP ${confirmP.status}，状态 ${afterP.status}`);
  check(7, "校长确认时分配学管生效", studentAfter.studentManagerId === "user-sm-rh", `学管 ${studentAfter.studentManagerId}`);

  // 非校长（教务，能访问学生但无分配权）不能分配学管
  const acadMkm = new Client("Markham 教务"); await acadMkm.login("6470000004", "acad123");
  const acadAssign = await acadMkm.req("PUT", "/api/students/student-mkm-1", { studentManagerId: "user-sm-mkm" });
  const mkm1After = await prisma.student.findUnique({ where: { id: "student-mkm-1" }, select: { studentManagerId: true } });
  check(7, "非校长(教务)不能分配学管", acadAssign.status === 403 && mkm1After.studentManagerId === null,
    `HTTP ${acadAssign.status}，学管 ${mkm1After.studentManagerId}`);

  // M1: 分配归属销售的目标必须是本校区在职销售（别校区销售应被拒，否则学生会“消失”）
  const xAssign = await rhPrincipal.req("PUT", `/api/students/${fx.student.id}`, { salesId: mkmSales.session.user.id });
  const fxStuAfter = await prisma.student.findUnique({ where: { id: fx.student.id }, select: { salesId: true } });
  check(7, "分配归属不得指向别校区销售", xAssign.status === 400 && fxStuAfter.salesId !== mkmSales.session.user.id,
    `HTTP ${xAssign.status}，现归属 ${fxStuAfter.salesId}`);

  const pFin = await rhPrincipal.req("POST", `/api/packages/${twoStepPkg.id}/finance-confirm`);
  check(7, "校长不能做财务确认", blocked(pFin), `实际 ${pFin.status}`);

  const confirmF = await finance.req("POST", `/api/packages/${twoStepPkg.id}/finance-confirm`);
  const afterF = await prisma.coursePackage.findUnique({ where: { id: twoStepPkg.id } });
  check(7, "财务确认后正式生效 ACTIVE", confirmF.status === 200 && afterF.status === "ACTIVE",
    `HTTP ${confirmF.status}，状态 ${afterF.status}`);

  // 生效即入账：收款 + 课包扣款两条，净额为 0
  const actEntries = await prisma.ledgerEntry.findMany({ where: { packageId: twoStepPkg.id } });
  const actNet = Math.round(actEntries.reduce((s, e) => s + Number(e.amount), 0) * 100) / 100;
  const hasPay = actEntries.some((e) => e.type === "PAYMENT" && Number(e.amount) === 1000);
  const hasCharge = actEntries.some((e) => e.type === "PACKAGE_CHARGE" && Number(e.amount) === -1000);
  check(7, "课包生效即写签约收款与课包扣款（净 0）",
    actEntries.length === 2 && hasPay && hasCharge && actNet === 0,
    `流水 ${actEntries.length} 条，净额 $${actNet}（应 2 条 / $0）`);

  await prisma.ledgerEntry.deleteMany({ where: { packageId: twoStepPkg.id } });
  await prisma.coursePackage.delete({ where: { id: twoStepPkg.id } });

  // ── 阶段 8：核销财务锁（确认满一周自动锁，财务可解锁）────────────────────
  console.log("\n阶段 8 — 核销财务锁");
  const lockPkg = await prisma.coursePackage.create({
    data: {
      studentId: fx.student.id, gradeId: fx.grade.id, subjectId: fx.subject.id,
      totalHours: 20, pricePerHour: 100, totalAmount: 2000, remainingHours: 20,
      status: "ACTIVE", createdById: fx.admin.id, confirmedById: fx.admin.id, confirmedAt: new Date(),
    },
  });
  const mkLesson = async (offsetDays) => {
    const s = new Date(fx.base.getTime() + offsetDays * 86400000);
    const les = await prisma.scheduledLesson.create({
      data: { teacherId: fx.rhTeacher.id, studentId: fx.student.id, packageId: lockPkg.id, classroomId: fx.rhRoom.id, startTime: s, endTime: new Date(s.getTime() + 2 * 3600000) },
    });
    await prisma.lessonLog.create({ data: { lessonId: les.id, teacherId: fx.rhTeacher.id, subjectId: fx.subject.id, notes: "lock test" } });
    return les;
  };

  // A) 满一周 → 锁定：核销后把扣课记录回拨 8 天
  const lesA = await mkLesson(60);
  await rhPrincipal.req("POST", `/api/lessons/${lesA.id}/confirm`);
  const dedA = await prisma.courseDeduction.findFirst({ where: { log: { lessonId: lesA.id }, reversedAt: null } });
  await prisma.courseDeduction.update({ where: { id: dedA.id }, data: { createdAt: new Date(Date.now() - 8 * 86400000) } });

  const revLocked = await finance.req("POST", `/api/lessons/${lesA.id}/reverse`);
  check(8, "确认满一周自动锁定，不能撤销", revLocked.status === 403, `实际 ${revLocked.status}`);

  const pUnlock = await rhPrincipal.req("POST", `/api/lessons/${lesA.id}/unlock`);
  check(8, "非财务不能解锁", blocked(pUnlock), `实际 ${pUnlock.status}`);

  const unlock = await finance.req("POST", `/api/lessons/${lesA.id}/unlock`);
  check(8, "财务可解锁", unlock.status === 200, `实际 ${unlock.status}`);

  const revOk = await finance.req("POST", `/api/lessons/${lesA.id}/reverse`);
  check(8, "解锁后可撤销核销", revOk.status === 200, `实际 ${revOk.status}`);

  // B) 未满一周 → 可直接撤销
  const lesB = await mkLesson(67);
  await rhPrincipal.req("POST", `/api/lessons/${lesB.id}/confirm`);
  const revFresh = await finance.req("POST", `/api/lessons/${lesB.id}/reverse`);
  check(8, "确认未满一周可直接撤销", revFresh.status === 200, `实际 ${revFresh.status}`);

  // 清理
  await prisma.courseDeduction.deleteMany({ where: { packageId: lockPkg.id } });
  await prisma.lessonLog.deleteMany({ where: { lesson: { packageId: lockPkg.id } } });
  await prisma.scheduledLesson.deleteMany({ where: { packageId: lockPkg.id } });
  await prisma.coursePackage.delete({ where: { id: lockPkg.id } });

  // ── 阶段 9：签约类型与续费权限（新签销售建，续费学管/校长建，销售首签后锁定）──
  console.log("\n阶段 9 — 签约类型与续费权限");
  const signPhone = "6470009901";
  await prisma.coursePackage.deleteMany({ where: { student: { phone: signPhone } } });
  await prisma.followUp.deleteMany({ where: { student: { phone: signPhone } } });
  await prisma.lead.deleteMany({ where: { student: { phone: signPhone } } });
  await prisma.student.deleteMany({ where: { phone: signPhone } });
  const signStudent = await prisma.student.create({
    data: {
      name: "签约-Probe", phone: signPhone, campusId: "campus-markham",
      gradeId: fx.grade.id, salesId: mkmSales.session.user.id,
      leadInfo: { create: { source: "OTHER", status: "NEW" } },
    },
  });
  const pkgBody = { studentId: signStudent.id, gradeId: fx.grade.id, subjectId: fx.subject.id, totalHours: 10, pricePerHour: 100, totalAmount: 1000 };

  const newSign = await mkmSales.req("POST", "/api/packages", pkgBody);
  check(9, "销售建首张课包为新签(NEW_SIGN)", newSign.status === 201 && newSign.body.signingType === "NEW_SIGN",
    `HTTP ${newSign.status}，类型 ${newSign.body?.signingType}`);

  // 一次成交多科目：生效前销售可继续建，仍为新签（不被误判成续费）
  const newSign2 = await mkmSales.req("POST", "/api/packages", { ...pkgBody, subjectId: fx.subject.id });
  check(9, "生效前销售可建多张新签（多科目同时成交）", newSign2.status === 201 && newSign2.body.signingType === "NEW_SIGN",
    `HTTP ${newSign2.status}，类型 ${newSign2.body?.signingType}`);

  // 首张课包生效后，学生进入续费阶段：销售不能再建课包
  await prisma.coursePackage.update({ where: { id: newSign.body.id }, data: { status: "ACTIVE" } });
  const salesRenew = await mkmSales.req("POST", "/api/packages", pkgBody);
  check(9, "已有生效课包后销售不能再建课包", salesRenew.status === 403, `实际 ${salesRenew.status}`);

  // 分配 Markham 学管（Grace）后，学管可建续费
  await prisma.student.update({ where: { id: signStudent.id }, data: { studentManagerId: "user-sm-mkm" } });
  const smClient = new Client("Markham 学管"); await smClient.login("6470000011", "sm123");
  const smRenew = await smClient.req("POST", "/api/packages", pkgBody);
  check(9, "被分配学管可建续费(RENEWAL)", smRenew.status === 201 && smRenew.body.signingType === "RENEWAL",
    `HTTP ${smRenew.status}，类型 ${smRenew.body?.signingType}`);

  // 取消分配后，同一学管不能再建续费（必须是被分配的那位）
  await prisma.student.update({ where: { id: signStudent.id }, data: { studentManagerId: null } });
  const smUnassigned = await smClient.req("POST", "/api/packages", pkgBody);
  check(9, "未被分配的学管不能建续费", smUnassigned.status === 403, `实际 ${smUnassigned.status}`);

  // 校长兜底可建续费
  const pRenew = await mkmPrincipal.req("POST", "/api/packages", pkgBody);
  check(9, "校长可兜底建续费", pRenew.status === 201 && pRenew.body.signingType === "RENEWAL",
    `HTTP ${pRenew.status}，类型 ${pRenew.body?.signingType}`);

  // 授课形式：默认一对一；班课课包不能走单人排课
  const grpPkgRes = await mkmPrincipal.req("POST", "/api/packages", { ...pkgBody, classType: "GROUP" });
  check(9, "可创建班课课包(classType=GROUP)",
    grpPkgRes.status === 201 && grpPkgRes.body?.classType === "GROUP",
    `HTTP ${grpPkgRes.status}，形式 ${grpPkgRes.body?.classType}`);
  check(9, "课包默认授课形式为一对一", newSign.body?.classType === "ONE_ON_ONE",
    `实际 ${newSign.body?.classType}`);

  await prisma.coursePackage.update({ where: { id: grpPkgRes.body.id }, data: { status: "ACTIVE" } });
  const grpRoom = await prisma.classroom.findFirst({ where: { campusId: "campus-markham" } });
  const grpSchedStart = new Date(fx.base.getTime() + 130 * 86400000);
  const grpSched = await acadMkm.req("POST", "/api/schedule", {
    teacherId: mkmTeacherRow.id, studentId: signStudent.id, packageId: grpPkgRes.body.id,
    classroomId: grpRoom.id,
    startTime: grpSchedStart.toISOString(),
    endTime: new Date(grpSchedStart.getTime() + 2 * 3600000).toISOString(),
  });
  check(9, "班课课包不得单独排课", grpSched.status === 400, `实际 ${grpSched.status}`);
  if (grpSched.status === 201) await prisma.scheduledLesson.deleteMany({ where: { id: grpSched.body.id } });

  // 清理
  await prisma.ledgerEntry.deleteMany({ where: { studentId: signStudent.id } });
  await prisma.coursePackage.deleteMany({ where: { studentId: signStudent.id } });
  await prisma.followUp.deleteMany({ where: { studentId: signStudent.id } });
  await prisma.lead.deleteMany({ where: { studentId: signStudent.id } });
  await prisma.student.delete({ where: { id: signStudent.id } });

  // ── 阶段 10：退费与账本（学管发起 → 校长审核 → 财务打款）────────────────────
  console.log("\n阶段 10 — 退费与账本");
  const refPhone = "6470009902";
  const cleanupRefund = async () => {
    const s = await prisma.student.findFirst({ where: { phone: refPhone } });
    if (!s) return;
    await prisma.ledgerEntry.deleteMany({ where: { studentId: s.id } });
    await prisma.refundRequest.deleteMany({ where: { studentId: s.id } });
    await prisma.coursePackage.deleteMany({ where: { studentId: s.id } });
    await prisma.followUp.deleteMany({ where: { studentId: s.id } });
    await prisma.lead.deleteMany({ where: { studentId: s.id } });
    await prisma.student.delete({ where: { id: s.id } });
  };
  await cleanupRefund();

  // RH 学生，学管 = user-sm-rh；课包 20h @ $100，已消耗 4h → 剩余 16h
  const refStudent = await prisma.student.create({
    data: {
      name: "退费-Probe", phone: refPhone, campusId: "campus-rh",
      gradeId: fx.grade.id, studentManagerId: "user-sm-rh",
      leadInfo: { create: { source: "OTHER", status: "NEW" } },
    },
  });
  const refPkg = await prisma.coursePackage.create({
    data: {
      studentId: refStudent.id, gradeId: fx.grade.id, subjectId: fx.subject.id,
      totalHours: 20, pricePerHour: 100, totalAmount: 2000, remainingHours: 16,
      status: "ACTIVE", createdById: fx.admin.id, confirmedById: fx.admin.id, confirmedAt: new Date(),
    },
  });

  const smRh = new Client("RH 学管"); await smRh.login("6470000012", "sm123");
  const smMkm = new Client("Markham 学管"); await smMkm.login("6470000011", "sm123");

  // 别校区学管不能给该生发起（校区隔离）
  const xCampus = await smMkm.req("POST", "/api/refunds", { packageId: refPkg.id, hours: 2 });
  check(10, "别校区学管不能发起退费", blocked(xCampus), `实际 ${xCampus.status}`);

  // 超过可退上限应被拒
  const tooMuch = await smRh.req("POST", "/api/refunds", { packageId: refPkg.id, hours: 99 });
  check(10, "退费不得超过可退课时", tooMuch.status === 400, `实际 ${tooMuch.status}`);

  // 学管发起 6h = $600
  const reqCreated = await smRh.req("POST", "/api/refunds", { packageId: refPkg.id, hours: 6, reason: "转学" });
  check(10, "学管可为自己负责的学生发起退费",
    reqCreated.status === 201 && Number(reqCreated.body?.amount) === 600,
    `HTTP ${reqCreated.status}，金额 ${reqCreated.body?.amount}`);
  const refId = reqCreated.body?.id;

  // 同课包不得有第二笔在途申请
  const dupReq = await smRh.req("POST", "/api/refunds", { packageId: refPkg.id, hours: 1 });
  check(10, "同课包不得重复发起在途退费", dupReq.status === 409, `实际 ${dupReq.status}`);

  // 财务不能跳过校长审核直接打款
  const skipP = await finance.req("POST", `/api/refunds/${refId}/pay`);
  check(10, "财务不能跳过校长审核打款", skipP.status === 400, `实际 ${skipP.status}`);

  // 学管不能自审
  const selfApprove = await smRh.req("POST", `/api/refunds/${refId}/approve`);
  check(10, "学管不能自己审核退费", blocked(selfApprove), `实际 ${selfApprove.status}`);

  // 校长审核
  const apprRes = await rhPrincipal.req("POST", `/api/refunds/${refId}/approve`);
  check(10, "校长审核后转待财务打款",
    apprRes.status === 200 && apprRes.body?.status === "PENDING_FINANCE",
    `HTTP ${apprRes.status}，状态 ${apprRes.body?.status}`);

  // 校长不能打款
  const payByP = await rhPrincipal.req("POST", `/api/refunds/${refId}/pay`);
  check(10, "校长不能打款", blocked(payByP), `实际 ${payByP.status}`);

  // 财务并发打款两次，只能结算一次
  const [pay1, pay2] = await Promise.all([
    finance.req("POST", `/api/refunds/${refId}/pay`),
    finance.req("POST", `/api/refunds/${refId}/pay`),
  ]);
  const okCount = [pay1, pay2].filter((r) => r.status === 200).length;
  const refPkgAfter = await prisma.coursePackage.findUnique({ where: { id: refPkg.id } });
  const refEntries = await prisma.ledgerEntry.findMany({ where: { studentId: refStudent.id } });
  const refBalance = Math.round(refEntries.reduce((s, e) => s + Number(e.amount), 0) * 100) / 100;
  check(10, "财务并发打款只结算一次", okCount === 1, `成功 ${okCount} 次（应 1）`);
  check(10, "打款后课包同步减总课时/剩余/总额",
    Number(refPkgAfter.totalHours) === 14 && Number(refPkgAfter.remainingHours) === 10 && Number(refPkgAfter.totalAmount) === 1400,
    `总 ${refPkgAfter.totalHours}h / 剩余 ${refPkgAfter.remainingHours}h / 总额 $${refPkgAfter.totalAmount}（应 14/10/1400）`);
  check(10, "打款写两条账本流水且余额归零",
    refEntries.length === 2 && refBalance === 0,
    `流水 ${refEntries.length} 条，余额 $${refBalance}（应 2 条 / $0）`);
  check(10, "课包不变量：总价 = 总课时 × 单价",
    Math.abs(Number(refPkgAfter.totalAmount) - Number(refPkgAfter.totalHours) * Number(refPkgAfter.pricePerHour)) < 0.005,
    `$${refPkgAfter.totalAmount} vs ${refPkgAfter.totalHours}h × $${refPkgAfter.pricePerHour}`);

  // 课包生效即入账：待审批阶段不记账（钱还没收），财务确认那一刻记
  // 「签约收款 + 课包扣款」两条，净额为 0。
  const ledStudent = await prisma.student.create({
    data: { name: "入账-Probe", phone: "6470009903", campusId: "campus-markham", gradeId: fx.grade.id, salesId: mkmSales.session.user.id },
  });
  const ledPkgRes = await mkmSales.req("POST", "/api/packages", {
    studentId: ledStudent.id, gradeId: fx.grade.id, subjectId: fx.subject.id,
    totalHours: 10, pricePerHour: 100, totalAmount: 1000,
  });
  const beforeLedger = await prisma.ledgerEntry.count({ where: { studentId: ledStudent.id } });
  check(10, "课包待审批阶段不记账（钱还没收）", beforeLedger === 0, `流水 ${beforeLedger} 条（应 0）`);

  await mkmPrincipal.req("POST", `/api/packages/${ledPkgRes.body.id}/confirm`, {});
  await finance.req("POST", `/api/packages/${ledPkgRes.body.id}/finance-confirm`);

  // 生效后改金额要补记差额，否则账本停留在旧价（生效即入账已在阶段 7 断言）
  await finance.req("PUT", `/api/packages/${ledPkgRes.body.id}`, { totalHours: 12, pricePerHour: 100, totalAmount: 1200 });
  const adjEntries = await prisma.ledgerEntry.findMany({ where: { studentId: ledStudent.id } });
  const adjBalance = Math.round(adjEntries.reduce((s, e) => s + Number(e.amount), 0) * 100) / 100;
  check(10, "生效后改金额补记差额且余额仍为零",
    adjEntries.length === 4 && adjBalance === 0,
    `流水 ${adjEntries.length} 条（应 4），余额 $${adjBalance}`);

  await prisma.ledgerEntry.deleteMany({ where: { studentId: ledStudent.id } });
  await prisma.coursePackage.deleteMany({ where: { studentId: ledStudent.id } });
  await prisma.student.delete({ where: { id: ledStudent.id } });

  // 教务无权查看账户流水（涉及金额）
  const acadLedger = await acad.req("GET", `/api/students/${refStudent.id}/ledger`);
  check(10, "教务不得查看学生账户流水", blocked(acadLedger), `实际 ${acadLedger.status}`);

  await cleanupRefund();

  // ── 阶段 11：考勤与请假扣课政策 ──────────────────────────────────────────
  console.log("\n阶段 11 — 考勤与请假");
  const attPkg = await prisma.coursePackage.create({
    data: {
      studentId: fx.student.id, gradeId: fx.grade.id, subjectId: fx.subject.id,
      totalHours: 20, pricePerHour: 100, totalAmount: 2000, remainingHours: 20,
      status: "ACTIVE", createdById: fx.admin.id, confirmedById: fx.admin.id, confirmedAt: new Date(),
    },
  });
  const mkAttLesson = async (offsetDays) => {
    const s = new Date(fx.base.getTime() + offsetDays * 86400000);
    const les = await prisma.scheduledLesson.create({
      data: {
        teacherId: fx.rhTeacher.id, studentId: fx.student.id, packageId: attPkg.id,
        classroomId: fx.rhRoom.id, startTime: s, endTime: new Date(s.getTime() + 2 * 3600000),
      },
    });
    await prisma.lessonLog.create({
      data: { lessonId: les.id, teacherId: fx.rhTeacher.id, subjectId: fx.subject.id, notes: "考勤测试" },
    });
    return les;
  };

  // 老师无权标考勤
  const attA = await mkAttLesson(80);
  const teacherMark = await t2.req("POST", `/api/lessons/${attA.id}/attendance`, { attendance: "LEAVE" });
  check(11, "老师不得标记考勤", blocked(teacherMark), `实际 ${teacherMark.status}`);

  // 别校区教务（Markham）不得标 RH 的课
  const xCampusMark = await acad.req("POST", `/api/lessons/${attA.id}/attendance`, { attendance: "PRESENT" });
  check(11, "别校区教务不得标记考勤", blocked(xCampusMark), `实际 ${xCampusMark.status}`);

  // 本校区管理层标请假 → 1对1 不扣课时，核销被拒
  const markLeave = await rhPrincipal.req("POST", `/api/lessons/${attA.id}/attendance`, { attendance: "LEAVE", note: "家长提前请假" });
  check(11, "本校区管理层可标记请假", markLeave.status === 200 && markLeave.body?.attendance === "LEAVE",
    `HTTP ${markLeave.status}，考勤 ${markLeave.body?.attendance}`);

  const confirmLeave = await rhPrincipal.req("POST", `/api/lessons/${attA.id}/confirm`);
  const pkgAfterLeave = await prisma.coursePackage.findUnique({ where: { id: attPkg.id } });
  check(11, "1对1 请假不扣课时（核销被拒、余额不动）",
    confirmLeave.status === 400 && Number(pkgAfterLeave.remainingHours) === 20,
    `HTTP ${confirmLeave.status}，剩余 ${pkgAfterLeave.remainingHours}h（应 20）`);

  // 旷课照扣
  const attB = await mkAttLesson(81);
  await rhPrincipal.req("POST", `/api/lessons/${attB.id}/attendance`, { attendance: "NO_SHOW" });
  const confirmNoShow = await rhPrincipal.req("POST", `/api/lessons/${attB.id}/confirm`);
  const pkgAfterNoShow = await prisma.coursePackage.findUnique({ where: { id: attPkg.id } });
  check(11, "旷课照扣课时", confirmNoShow.status === 200 && Number(pkgAfterNoShow.remainingHours) === 18,
    `HTTP ${confirmNoShow.status}，剩余 ${pkgAfterNoShow.remainingHours}h（应 18）`);

  // 已核销的课不能改考勤（否则会出现「标了请假但课时已扣」）
  const lateMark = await rhPrincipal.req("POST", `/api/lessons/${attB.id}/attendance`, { attendance: "LEAVE" });
  check(11, "已核销的课不得改考勤", lateMark.status === 400, `实际 ${lateMark.status}`);

  // 未标考勤按到课处理，核销照常（保持既有行为）
  const attC = await mkAttLesson(82);
  const confirmDefault = await rhPrincipal.req("POST", `/api/lessons/${attC.id}/confirm`);
  const pkgDefault = await prisma.coursePackage.findUnique({ where: { id: attPkg.id } });
  check(11, "未标考勤默认按到课核销", confirmDefault.status === 200 && Number(pkgDefault.remainingHours) === 16,
    `HTTP ${confirmDefault.status}，剩余 ${pkgDefault.remainingHours}h（应 16）`);

  // 跨校区不得标考勤
  const xAtt = await mkmSales.req("POST", `/api/lessons/${attA.id}/attendance`, { attendance: "PRESENT" });
  check(11, "销售不得标记考勤", blocked(xAtt), `实际 ${xAtt.status}`);

  // 清理
  await prisma.courseDeduction.deleteMany({ where: { packageId: attPkg.id } });
  await prisma.lessonLog.deleteMany({ where: { lesson: { packageId: attPkg.id } } });
  await prisma.scheduledLesson.deleteMany({ where: { packageId: attPkg.id } });
  await prisma.coursePackage.delete({ where: { id: attPkg.id } });

  // ── 阶段 12：改期与删除（请假后的出口）──────────────────────────────────
  console.log("\n阶段 12 — 改期与删除");
  const rsPkg = await prisma.coursePackage.create({
    data: {
      studentId: fx.student.id, gradeId: fx.grade.id, subjectId: fx.subject.id,
      totalHours: 10, pricePerHour: 100, totalAmount: 1000, remainingHours: 10,
      status: "ACTIVE", createdById: fx.admin.id, confirmedById: fx.admin.id, confirmedAt: new Date(),
    },
  });
  const mkRsLesson = async (offsetDays, hours = 2) => {
    const s = new Date(fx.base.getTime() + offsetDays * 86400000);
    return prisma.scheduledLesson.create({
      data: {
        teacherId: fx.rhTeacher.id, studentId: fx.student.id, packageId: rsPkg.id,
        classroomId: fx.rhRoom.id, startTime: s, endTime: new Date(s.getTime() + hours * 3600000),
      },
    });
  };

  const rsA = await mkRsLesson(100);
  // 销售无权改期
  const salesMove = await mkmSales.req("PUT", `/api/schedule/${rsA.id}`, {
    startTime: new Date(fx.base.getTime() + 101 * 86400000).toISOString(),
    endTime: new Date(fx.base.getTime() + 101 * 86400000 + 2 * 3600000).toISOString(),
  });
  check(12, "销售不得改期", blocked(salesMove), `实际 ${salesMove.status}`);

  // 结束早于开始应被拒
  const badTime = await rhPrincipal.req("PUT", `/api/schedule/${rsA.id}`, {
    startTime: new Date(fx.base.getTime() + 101 * 86400000 + 2 * 3600000).toISOString(),
    endTime: new Date(fx.base.getTime() + 101 * 86400000).toISOString(),
  });
  check(12, "改期结束时间须晚于开始", badTime.status === 400, `实际 ${badTime.status}`);

  // 正常改期（同时长挪时间）：库存要排除自身，不能报「课时不足」
  const newStart = new Date(fx.base.getTime() + 102 * 86400000);
  const moved = await rhPrincipal.req("PUT", `/api/schedule/${rsA.id}`, {
    startTime: newStart.toISOString(),
    endTime: new Date(newStart.getTime() + 2 * 3600000).toISOString(),
  });
  const rsAAfter = await prisma.scheduledLesson.findUnique({ where: { id: rsA.id } });
  check(12, "可改期（库存排除自身，不误报不足）",
    moved.status === 200 && rsAAfter.startTime.getTime() === newStart.getTime(),
    `HTTP ${moved.status}${moved.body?.error ? " " + moved.body.error : ""}`);

  // 改期到与另一节课冲突的时段 → 409
  const rsB = await mkRsLesson(105);
  const clashMove = await rhPrincipal.req("PUT", `/api/schedule/${rsA.id}`, {
    startTime: rsB.startTime.toISOString(),
    endTime: rsB.endTime.toISOString(),
  });
  check(12, "改期撞课应被拒", clashMove.status === 409, `实际 ${clashMove.status}`);

  // 改期后考勤重置
  await rhPrincipal.req("POST", `/api/lessons/${rsA.id}/attendance`, { attendance: "LEAVE" });
  await rhPrincipal.req("PUT", `/api/schedule/${rsA.id}`, {
    startTime: new Date(fx.base.getTime() + 110 * 86400000).toISOString(),
    endTime: new Date(fx.base.getTime() + 110 * 86400000 + 2 * 3600000).toISOString(),
  });
  const rsAReset = await prisma.scheduledLesson.findUnique({ where: { id: rsA.id } });
  check(12, "改期后考勤重置为未标记", rsAReset.attendance === null, `实际 ${rsAReset.attendance}`);

  // 请假 + 已有老师日志的课可以删除（否则永久卡在待办里）
  const rsC = await mkRsLesson(115);
  await prisma.lessonLog.create({
    data: { lessonId: rsC.id, teacherId: fx.rhTeacher.id, subjectId: fx.subject.id, notes: "学生请假未到" },
  });
  await rhPrincipal.req("POST", `/api/lessons/${rsC.id}/attendance`, { attendance: "LEAVE" });
  const delLeave = await rhPrincipal.req("DELETE", `/api/schedule/${rsC.id}`);
  const rsCGone = await prisma.scheduledLesson.findUnique({ where: { id: rsC.id } });
  check(12, "请假且有日志的课可删除（连同日志）", delLeave.status === 200 && rsCGone === null,
    `HTTP ${delLeave.status}，记录 ${rsCGone ? "仍在" : "已删"}`);

  // 已核销的课不得改期、不得删除
  const rsD = await mkRsLesson(120);
  await prisma.lessonLog.create({
    data: { lessonId: rsD.id, teacherId: fx.rhTeacher.id, subjectId: fx.subject.id, notes: "正常上课" },
  });
  await rhPrincipal.req("POST", `/api/lessons/${rsD.id}/confirm`);
  const moveConfirmed = await rhPrincipal.req("PUT", `/api/schedule/${rsD.id}`, {
    startTime: new Date(fx.base.getTime() + 125 * 86400000).toISOString(),
    endTime: new Date(fx.base.getTime() + 125 * 86400000 + 2 * 3600000).toISOString(),
  });
  check(12, "已核销的课不得改期", moveConfirmed.status === 400, `实际 ${moveConfirmed.status}`);
  const delConfirmed = await rhPrincipal.req("DELETE", `/api/schedule/${rsD.id}`);
  check(12, "已核销的课不得删除", delConfirmed.status === 400, `实际 ${delConfirmed.status}`);

  // 一对一重复排课：预检只算不建；每周二连排，课时用完自动停
  const recPkg = await prisma.coursePackage.create({
    data: {
      studentId: fx.student.id, gradeId: fx.grade.id, subjectId: fx.subject.id,
      totalHours: 8, pricePerHour: 100, totalAmount: 800, remainingHours: 8,
      status: "ACTIVE", createdById: fx.admin.id, confirmedById: fx.admin.id, confirmedAt: new Date(),
    },
  });
  const recBase = {
    teacherId: fx.rhTeacher.id, studentId: fx.student.id, packageId: recPkg.id,
    classroomId: fx.rhRoom.id, startDate: "2027-10-05", start: "16:00", end: "18:00",
    frequency: "WEEKLY", weekdays: [2], until: { type: "weeks", value: 8 },
  };
  const recDry = await rhPrincipal.req("POST", "/api/schedule/batch", { ...recBase, dryRun: true });
  const afterDry = await prisma.scheduledLesson.count({ where: { packageId: recPkg.id } });
  check(12, "重复排课预检只算不建",
    recDry.status === 200 && recDry.body?.requested === 8 && afterDry === 0,
    `计划 ${recDry.body?.requested} 次，预检后落库 ${afterDry} 条（应 0）`);

  const recReal = await rhPrincipal.req("POST", "/api/schedule/batch", recBase);
  const recCount = await prisma.scheduledLesson.count({ where: { packageId: recPkg.id } });
  check(12, "一对一重复排课课时用完自动停（8h ÷ 2h = 4 节）",
    recReal.status === 201 && recCount === 4 && recReal.body?.skipped?.length === 4,
    `建了 ${recCount} 节，跳过 ${recReal.body?.skipped?.length} 次`);

  // 班课课包不得走一对一批量
  const recGroupPkg = await prisma.coursePackage.create({
    data: {
      studentId: fx.student.id, gradeId: fx.grade.id, subjectId: fx.subject.id,
      totalHours: 10, pricePerHour: 50, totalAmount: 500, remainingHours: 10,
      status: "ACTIVE", classType: "GROUP", createdById: fx.admin.id,
    },
  });
  const wrongType = await rhPrincipal.req("POST", "/api/schedule/batch", { ...recBase, packageId: recGroupPkg.id, dryRun: true });
  check(12, "班课课包不得走一对一重复排课", wrongType.status === 400, `实际 ${wrongType.status}`);

  await prisma.scheduledLesson.deleteMany({ where: { packageId: recPkg.id } });
  await prisma.coursePackage.delete({ where: { id: recPkg.id } });
  await prisma.coursePackage.delete({ where: { id: recGroupPkg.id } });

  // 清理
  await prisma.courseDeduction.deleteMany({ where: { packageId: rsPkg.id } });
  await prisma.lessonLog.deleteMany({ where: { lesson: { packageId: rsPkg.id } } });
  await prisma.scheduledLesson.deleteMany({ where: { packageId: rsPkg.id } });
  await prisma.coursePackage.delete({ where: { id: rsPkg.id } });

  // ── 阶段 13：班课（同科目、全员库存、全员扣课、单人撤销）──────────────────
  console.log("\n阶段 13 — 班课");
  const gcPhones = ["6479998801", "6479998802"];
  const cleanupGroup = async () => {
    const classes = await prisma.groupClass.findMany({ where: { name: { startsWith: "探测班·" } } });
    for (const c of classes) {
      const ss = await prisma.groupSession.findMany({ where: { classId: c.id } });
      for (const s of ss) {
        await prisma.courseDeduction.deleteMany({ where: { groupSessionId: s.id } });
        await prisma.groupSessionAttendance.deleteMany({ where: { sessionId: s.id } });
      }
      await prisma.groupSession.deleteMany({ where: { classId: c.id } });
      await prisma.groupClassMember.deleteMany({ where: { classId: c.id } });
      await prisma.groupClass.delete({ where: { id: c.id } });
    }
    for (const ph of gcPhones) {
      const s = await prisma.student.findFirst({ where: { phone: ph } });
      if (!s) continue;
      await prisma.ledgerEntry.deleteMany({ where: { studentId: s.id } });
      await prisma.coursePackage.deleteMany({ where: { studentId: s.id } });
      await prisma.student.delete({ where: { id: s.id } });
    }
  };
  await cleanupGroup();

  const mkmSubject = await prisma.subject.findFirst({ where: { name: "Math" } });
  const altSubject = await prisma.subject.findFirst({ where: { name: "Physics" } });
  const gcRoom = await prisma.classroom.findFirst({ where: { campusId: "campus-markham" } });
  const mkGroupStudent = async (name, phone, subjectId, classType, remaining) => {
    const s = await prisma.student.create({
      data: { name, phone, campusId: "campus-markham", gradeId: fx.grade.id },
    });
    const p = await prisma.coursePackage.create({
      data: {
        studentId: s.id, gradeId: fx.grade.id, subjectId,
        totalHours: 20, pricePerHour: 60, totalAmount: 1200, remainingHours: remaining,
        status: "ACTIVE", classType, createdById: fx.admin.id,
      },
    });
    return { s, p };
  };
  const gA = await mkGroupStudent("探测·甲", gcPhones[0], mkmSubject.id, "GROUP", 20);
  const gB = await mkGroupStudent("探测·乙", gcPhones[1], altSubject.id, "GROUP", 1);

  // 销售不得建班
  const salesClass = await mkmSales.req("POST", "/api/classes", {
    name: "探测班·越权", campusId: "campus-markham", subjectId: mkmSubject.id,
  });
  check(13, "销售不得创建班级", blocked(salesClass), `实际 ${salesClass.status}`);

  const gcCreate = await acadMkm.req("POST", "/api/classes", {
    name: "探测班·数学", campusId: "campus-markham", subjectId: mkmSubject.id,
    gradeId: fx.grade.id, teacherId: mkmTeacherRow.id, classroomId: gcRoom.id, capacity: 5,
  });
  check(13, "教务可创建班级", gcCreate.status === 201, `实际 ${gcCreate.status}`);
  const gcId = gcCreate.body.id;

  const addOk = await acadMkm.req("POST", `/api/classes/${gcId}/members`, { packageId: gA.p.id });
  check(13, "同科目班课课包可入班", addOk.status === 201, `实际 ${addOk.status} ${addOk.body?.error ?? ""}`);

  // 科目不符被拒（业务硬规则）
  const addWrongSubject = await acadMkm.req("POST", `/api/classes/${gcId}/members`, { packageId: gB.p.id });
  check(13, "科目不符的课包不得入班", addWrongSubject.status === 400, `实际 ${addWrongSubject.status}`);

  // 改成同科目但只有 1h → 用于全员库存校验
  await prisma.coursePackage.update({ where: { id: gB.p.id }, data: { subjectId: mkmSubject.id } });
  await acadMkm.req("POST", `/api/classes/${gcId}/members`, { packageId: gB.p.id });

  const gcStart = new Date(fx.base.getTime() + 200 * 86400000);
  const gcTimes = (offsetDays, hrs) => {
    const st = new Date(gcStart.getTime() + offsetDays * 86400000);
    return { startTime: st.toISOString(), endTime: new Date(st.getTime() + hrs * 3600000).toISOString() };
  };

  const shortHours = await acadMkm.req("POST", `/api/classes/${gcId}/sessions`, gcTimes(0, 2));
  check(13, "有成员课时不足则整节课排不了", shortHours.status === 400, `实际 ${shortHours.status}`);

  await prisma.coursePackage.update({ where: { id: gB.p.id }, data: { remainingHours: 20 } });
  const gcSession = await acadMkm.req("POST", `/api/classes/${gcId}/sessions`, gcTimes(0, 2));
  check(13, "全员课时充足可排课并生成全员名单",
    gcSession.status === 201 && gcSession.body?.attendances?.length === 2,
    `HTTP ${gcSession.status}，名单 ${gcSession.body?.attendances?.length}`);
  const gsId = gcSession.body.id;

  const gcClash = await acadMkm.req("POST", `/api/classes/${gcId}/sessions`, gcTimes(0, 2));
  check(13, "同时段重复排课应冲突", gcClash.status === 409, `实际 ${gcClash.status}`);

  const noLog = await acadMkm.req("POST", `/api/classes/${gcId}/sessions/${gsId}/confirm`);
  check(13, "老师未写反馈不得核销", noLog.status === 400, `实际 ${noLog.status}`);

  const gcLog = await mkmTeacher.req("POST", `/api/classes/${gcId}/sessions/${gsId}/log`, { notes: "探测：整班一条反馈" });
  check(13, "老师可提交整班反馈", gcLog.status === 200, `实际 ${gcLog.status} ${gcLog.body?.error ?? ""}`);

  // 乙请假 → 班课请假默认仍扣
  await acadMkm.req("POST", `/api/classes/${gcId}/sessions/${gsId}/attendance`, { studentId: gB.s.id, attendance: "LEAVE" });
  const gcConfirm = await acadMkm.req("POST", `/api/classes/${gcId}/sessions/${gsId}/confirm`);
  const gAAfter = await prisma.coursePackage.findUnique({ where: { id: gA.p.id } });
  const gBAfter = await prisma.coursePackage.findUnique({ where: { id: gB.p.id } });
  check(13, "核销后全班各扣一次（请假照扣）",
    gcConfirm.status === 200 && Number(gAAfter.remainingHours) === 18 && Number(gBAfter.remainingHours) === 18,
    `甲 ${gAAfter.remainingHours}h / 乙 ${gBAfter.remainingHours}h（应各 18）`);

  const lateAtt = await acadMkm.req("POST", `/api/classes/${gcId}/sessions/${gsId}/attendance`, { studentId: gB.s.id, attendance: "PRESENT" });
  check(13, "已核销的课次不得改考勤", lateAtt.status === 400, `实际 ${lateAtt.status}`);

  const acadReverse = await acadMkm.req("POST", `/api/classes/${gcId}/sessions/${gsId}/reverse`, {});
  check(13, "教务不得撤销班课扣课", blocked(acadReverse), `实际 ${acadReverse.status}`);

  // 重复排课：每周一/三连续 4 周 = 8 次；甲乙各剩 18h，每节 2h → 只够 9 节，
  // 但这里 8 次都排得下，验证日期展开与逐次校验。
  const batch = await acadMkm.req("POST", `/api/classes/${gcId}/sessions/batch`, {
    startDate: "2027-03-01", start: "18:00", end: "20:00",
    frequency: "WEEKLY", weekdays: [1, 3], until: { type: "weeks", value: 4 },
  });
  check(13, "重复排课按每周指定日展开", batch.status === 201 && batch.body?.requested === 8,
    `HTTP ${batch.status}，计划 ${batch.body?.requested} 次（应 8）`);

  // 课时会被上面这批吃掉，再排一批应逐次因课时不足被跳过（而非整批报错）
  const batch2 = await acadMkm.req("POST", `/api/classes/${gcId}/sessions/batch`, {
    startDate: "2027-06-01", start: "18:00", end: "20:00",
    frequency: "WEEKLY", weekdays: [1], until: { type: "count", value: 5 },
  });
  const shortSkip = (batch2.body?.skipped ?? []).some((s) => String(s.reason).includes("课时不足"));
  check(13, "重复排课课时耗尽后逐次跳过并说明原因",
    shortSkip && (batch2.body?.created ?? 0) < 5,
    `成功 ${batch2.body?.created} 次，跳过 ${batch2.body?.skipped?.length} 次`);

  const oneReverse = await finance.req("POST", `/api/classes/${gcId}/sessions/${gsId}/reverse`, { packageId: gB.p.id });
  const gBBack = await prisma.coursePackage.findUnique({ where: { id: gB.p.id } });
  const gAKept = await prisma.coursePackage.findUnique({ where: { id: gA.p.id } });
  check(13, "可单独撤销某成员扣课（请假免扣）",
    oneReverse.status === 200 && Number(gBBack.remainingHours) === 20 && Number(gAKept.remainingHours) === 18,
    `乙 ${gBBack.remainingHours}h（应 20）/ 甲 ${gAKept.remainingHours}h（应 18）`);

  await cleanupGroup();

  // ── 阶段 14：课包转化（抵扣 + 补款 + 重建整包）────────────────────────────
  console.log("\n阶段 14 — 课包转化");
  const cvPhone = "6479998811";
  const cleanupConvert = async () => {
    const s = await prisma.student.findFirst({ where: { phone: cvPhone } });
    if (!s) return;
    await prisma.ledgerEntry.deleteMany({ where: { studentId: s.id } });
    await prisma.coursePackage.updateMany({ where: { studentId: s.id }, data: { convertedFromId: null } });
    await prisma.scheduledLesson.deleteMany({ where: { studentId: s.id } });
    await prisma.coursePackage.deleteMany({ where: { studentId: s.id } });
    await prisma.student.delete({ where: { id: s.id } });
  };
  await cleanupConvert();

  const cvStudent = await prisma.student.create({
    data: {
      name: "转化-Probe", phone: cvPhone, campusId: "campus-markham",
      gradeId: fx.grade.id, studentManagerId: "user-sm-mkm",
    },
  });
  const mkCvPkg = (rate, hours) => prisma.coursePackage.create({
    data: {
      studentId: cvStudent.id, gradeId: fx.grade.id, subjectId: fx.subject.id,
      totalHours: hours, pricePerHour: rate, totalAmount: hours * rate, remainingHours: hours,
      status: "ACTIVE", createdById: fx.admin.id,
      financeConfirmedById: "user-finance", financeConfirmedAt: new Date(),
    },
  });
  const cvBalance = async () => {
    const e = await prisma.ledgerEntry.findMany({ where: { studentId: cvStudent.id } });
    return Math.round(e.reduce((s, x) => s + Number(x.amount), 0) * 100) / 100;
  };

  const cvPkgA = await mkCvPkg(60, 10); // 10h × $60 = $600
  const cvBody = {
    subjectId: fx.subject.id, gradeId: fx.grade.id, classType: "ONE_ON_ONE",
    totalHours: 20, pricePerHour: 100, totalAmount: 2000,
  };

  // 销售无权转化（转化=后续课包，归学管/校长）
  const cvBySales = await mkmSales.req("POST", `/api/packages/${cvPkgA.id}/convert`, cvBody);
  check(14, "销售不得转化课包", blocked(cvBySales), `实际 ${cvBySales.status}`);

  // 总价与课时×单价不符应被拒
  const cvBadMath = await smMkm.req("POST", `/api/packages/${cvPkgA.id}/convert`, { ...cvBody, totalAmount: 1500 });
  check(14, "新课包总价必须等于课时 × 单价", cvBadMath.status === 400, `实际 ${cvBadMath.status}`);

  // 试算：抵扣 $600、新包 $2000、补款 $1400，需走财务
  const cvDry = await smMkm.req("POST", `/api/packages/${cvPkgA.id}/convert`, { ...cvBody, dryRun: true });
  const beforeCv = await prisma.coursePackage.count({ where: { studentId: cvStudent.id } });
  check(14, "转化试算只算不做",
    cvDry.status === 200 && cvDry.body?.creditAmount === 600 && cvDry.body?.topUp === 1400 && beforeCv === 1,
    `抵扣 $${cvDry.body?.creditAmount} 补款 $${cvDry.body?.topUp}，课包数 ${beforeCv}（应 1）`);

  // 正式转化
  const cvDo = await smMkm.req("POST", `/api/packages/${cvPkgA.id}/convert`, cvBody);
  const oldAfter = await prisma.coursePackage.findUnique({ where: { id: cvPkgA.id } });
  check(14, "转化后原包置为已转化且剩余归零",
    cvDo.status === 201 && oldAfter.status === "CONVERTED" && Number(oldAfter.remainingHours) === 0
      && Number(oldAfter.totalAmount) === 0,
    `状态 ${oldAfter.status}，剩余 ${oldAfter.remainingHours}h，总额 $${oldAfter.totalAmount}`);

  const newPkgId = cvDo.body.package.id;
  const newAfter = await prisma.coursePackage.findUnique({ where: { id: newPkgId } });
  const balPending = await cvBalance();
  check(14, "需补款时新包待财务确认，抵扣先挂在账户上",
    newAfter.status === "PENDING_FINANCE" && balPending === 600,
    `新包状态 ${newAfter.status}，余额 $${balPending}（应 $600）`);

  // 已转化的包不能再转
  const cvAgain = await smMkm.req("POST", `/api/packages/${cvPkgA.id}/convert`, cvBody);
  check(14, "已转化的课包不得重复转化", cvAgain.status === 400, `实际 ${cvAgain.status}`);

  // 财务确认收到补款 → 新包生效，余额归零（抵扣不被重复计收）
  await finance.req("POST", `/api/packages/${newPkgId}/finance-confirm`);
  const newActive = await prisma.coursePackage.findUnique({ where: { id: newPkgId } });
  const balAfter = await cvBalance();
  check(14, "补款到账后新包生效且账户余额归零",
    newActive.status === "ACTIVE" && balAfter === 0,
    `新包 ${newActive.status}，余额 $${balAfter}（应 $0）`);

  // 新包价值低于抵扣：拒绝，提示补课时。系统不留悬空余额。
  const cvPkgB = await mkCvPkg(100, 10); // $1000
  const cheapBody = {
    subjectId: fx.subject.id, gradeId: fx.grade.id, classType: "GROUP",
    totalHours: 10, pricePerHour: 60, totalAmount: 600,
  };
  const cvCheap = await smMkm.req("POST", `/api/packages/${cvPkgB.id}/convert`, cheapBody);
  const stillB = await prisma.coursePackage.findUnique({ where: { id: cvPkgB.id } });
  check(14, "新包价值低于抵扣一律拒绝，并提示补课时",
    cvCheap.status === 400 && /增加课时/.test(cvCheap.body?.error ?? "") && stillB.status === "ACTIVE",
    `实际 ${cvCheap.status}：${cvCheap.body?.error}；原包 ${stillB.status}`);

  // 试算同样拒绝，界面在提交前就能看到提示
  const cvCheapDry = await smMkm.req("POST", `/api/packages/${cvPkgB.id}/convert`, { ...cheapBody, dryRun: true });
  check(14, "低于抵扣的转化试算也被拒", cvCheapDry.status === 400, `实际 ${cvCheapDry.status}`);

  // 加够课时正好抵平：无需补款直接生效，账户不留余额
  const cvEven = await smMkm.req("POST", `/api/packages/${cvPkgB.id}/convert`, {
    ...cheapBody, totalHours: 20, pricePerHour: 50, totalAmount: 1000,
  });
  const evenPkg = await prisma.coursePackage.findUnique({ where: { id: cvEven.body?.package?.id ?? "none" } });
  const balEven = await cvBalance();
  check(14, "抵平后直接生效且账户余额归零",
    cvEven.status === 201 && cvEven.body.topUp === 0 && evenPkg?.status === "ACTIVE" && balEven === 0,
    `新包 ${evenPkg?.status}，补款 $${cvEven.body?.topUp}，余额 $${balEven}（应 $0）`);

  // 有已排未核销的课时不能转化
  const cvPkgC = await mkCvPkg(80, 10);
  await prisma.scheduledLesson.create({
    data: {
      teacherId: mkmTeacherRow.id, studentId: cvStudent.id, packageId: cvPkgC.id,
      classroomId: "room-mkm-101",
      startTime: new Date(fx.base.getTime() + 300 * 86400000),
      endTime: new Date(fx.base.getTime() + 300 * 86400000 + 2 * 3600000),
    },
  });
  const cvPending = await smMkm.req("POST", `/api/packages/${cvPkgC.id}/convert`, {
    subjectId: fx.subject.id, gradeId: fx.grade.id, classType: "ONE_ON_ONE",
    totalHours: 5, pricePerHour: 100, totalAmount: 500,
  });
  check(14, "有已排未核销的课时不得转化", cvPending.status === 400, `实际 ${cvPending.status}`);

  await cleanupConvert();

  // ── 阶段 15：线上/线下（线上不占教室，但仍查老师/学生冲突）────────────────
  console.log("\n阶段 15 — 线上/线下");
  const dmPhone = "6479998821";
  const cleanupDelivery = async () => {
    const cls = await prisma.groupClass.findMany({ where: { name: { startsWith: "探测班·地点" } } });
    for (const c of cls) {
      await prisma.groupSessionAttendance.deleteMany({ where: { session: { classId: c.id } } });
      await prisma.groupSession.deleteMany({ where: { classId: c.id } });
      await prisma.groupClassMember.deleteMany({ where: { classId: c.id } });
      await prisma.groupClass.delete({ where: { id: c.id } });
    }
    const st = await prisma.student.findFirst({ where: { phone: dmPhone } });
    if (st) {
      await prisma.scheduledLesson.deleteMany({ where: { studentId: st.id } });
      await prisma.ledgerEntry.deleteMany({ where: { studentId: st.id } });
      await prisma.coursePackage.deleteMany({ where: { studentId: st.id } });
      await prisma.student.delete({ where: { id: st.id } });
    }
    await prisma.userRole.deleteMany({ where: { user: { phone: "6470000098" } } });
    await prisma.userCampus.deleteMany({ where: { user: { phone: "6470000098" } } });
    await prisma.user.deleteMany({ where: { phone: "6470000098" } });
  };
  await cleanupDelivery();

  const dmStudent = await prisma.student.create({
    data: { name: "探测·地点", phone: dmPhone, campusId: "campus-rh", gradeId: fx.grade.id },
  });
  const dmPkg = await prisma.coursePackage.create({
    data: {
      studentId: dmStudent.id, gradeId: fx.grade.id, subjectId: fx.subject.id,
      totalHours: 40, pricePerHour: 100, totalAmount: 4000, remainingHours: 40,
      status: "ACTIVE", classType: "ONE_ON_ONE", createdById: fx.admin.id,
    },
  });
  const dmTeacher2 = await prisma.user.create({
    data: {
      name: "Probe RH Teacher3", phone: "6470000098", passwordHash: await bcrypt.hash("teacher123", 12),
      roles: { create: [{ role: "TEACHER" }] }, campuses: { create: [{ campusId: "campus-rh" }] },
    },
  });
  const dmAt = (days, hours = 2) => {
    const st = new Date(fx.base.getTime() + days * 86400000);
    return { startTime: st.toISOString(), endTime: new Date(st.getTime() + hours * 3600000).toISOString() };
  };

  // 线下课必须选教室
  const dmNoRoom = await rhPrincipal.req("POST", "/api/schedule", {
    teacherId: fx.rhTeacher.id, studentId: dmStudent.id, packageId: dmPkg.id,
    deliveryMode: "ONSITE", ...dmAt(400),
  });
  check(15, "线下课必须选择教室", dmNoRoom.status === 400, `实际 ${dmNoRoom.status}：${dmNoRoom.body?.error}`);

  // 线上课不用教室
  const dmOnline = await rhPrincipal.req("POST", "/api/schedule", {
    teacherId: fx.rhTeacher.id, studentId: dmStudent.id, packageId: dmPkg.id,
    deliveryMode: "ONLINE", ...dmAt(400),
  });
  const dmOnlineRow = dmOnline.status === 201
    ? await prisma.scheduledLesson.findUnique({ where: { id: dmOnline.body.id } }) : null;
  check(15, "线上课无需教室，且落库时教室为空",
    dmOnline.status === 201 && dmOnlineRow?.classroomId === null && dmOnlineRow?.deliveryMode === "ONLINE",
    `HTTP ${dmOnline.status}，教室 ${dmOnlineRow?.classroomId}，形式 ${dmOnlineRow?.deliveryMode}`);

  // 即便传了教室，线上课也不许占：服务端抹掉
  const dmOnlineWithRoom = await rhPrincipal.req("POST", "/api/schedule", {
    teacherId: dmTeacher2.id, studentId: dmStudent.id, packageId: dmPkg.id,
    classroomId: fx.rhRoom.id, deliveryMode: "ONLINE", ...dmAt(401),
  });
  const dmWRRow = dmOnlineWithRoom.status === 201
    ? await prisma.scheduledLesson.findUnique({ where: { id: dmOnlineWithRoom.body.id } }) : null;
  check(15, "线上课即使传了教室也会被抹掉",
    dmOnlineWithRoom.status === 201 && dmWRRow?.classroomId === null,
    `HTTP ${dmOnlineWithRoom.status}，教室 ${dmWRRow?.classroomId}`);

  // 同一教室同一时段：先占一节线下
  const dmOnsite = await rhPrincipal.req("POST", "/api/schedule", {
    teacherId: fx.rhTeacher.id, studentId: dmStudent.id, packageId: dmPkg.id,
    classroomId: fx.rhRoom.id, deliveryMode: "ONSITE", ...dmAt(402),
  });
  check(15, "线下课可正常排", dmOnsite.status === 201, `实际 ${dmOnsite.status}：${dmOnsite.body?.error}`);

  // 同时段另一老师另一学生的线上课不受该教室占用影响
  const dmParallel = await rhPrincipal.req("POST", "/api/schedule", {
    teacherId: dmTeacher2.id, studentId: fx.student.id, packageId: fx.active.id,
    deliveryMode: "ONLINE", ...dmAt(402),
  });
  check(15, "线上课不占教室，可与同教室的线下课并行",
    dmParallel.status === 201, `实际 ${dmParallel.status}：${dmParallel.body?.error}`);
  if (dmParallel.status === 201) await prisma.scheduledLesson.delete({ where: { id: dmParallel.body.id } });

  // 但同一老师同一时段仍然冲突 —— 线上不是免检通道
  const dmTeacherClash = await rhPrincipal.req("POST", "/api/schedule", {
    teacherId: fx.rhTeacher.id, studentId: fx.student.id, packageId: fx.active.id,
    deliveryMode: "ONLINE", ...dmAt(402),
  });
  check(15, "线上课仍受老师时段冲突约束", dmTeacherClash.status === 409, `实际 ${dmTeacherClash.status}`);

  // 同一学生同一时段也仍然冲突
  const dmStudentClash = await rhPrincipal.req("POST", "/api/schedule", {
    teacherId: dmTeacher2.id, studentId: dmStudent.id, packageId: dmPkg.id,
    deliveryMode: "ONLINE", ...dmAt(402),
  });
  check(15, "线上课仍受学生时段冲突约束", dmStudentClash.status === 409, `实际 ${dmStudentClash.status}`);

  // 改期时把线下改成线上，教室要被清空
  const dmToOnline = await rhPrincipal.req("PUT", `/api/schedule/${dmOnsite.body.id}`, {
    deliveryMode: "ONLINE", ...dmAt(403),
  });
  const dmMovedRow = await prisma.scheduledLesson.findUnique({ where: { id: dmOnsite.body.id } });
  check(15, "改期可从线下改线上，教室被清空",
    dmToOnline.status === 200 && dmMovedRow.classroomId === null && dmMovedRow.deliveryMode === "ONLINE",
    `HTTP ${dmToOnline.status}，教室 ${dmMovedRow.classroomId}，形式 ${dmMovedRow.deliveryMode}`);

  // 改回线下但不给教室 → 拒绝（不能留下没有地点的线下课）
  const dmBackNoRoom = await rhPrincipal.req("PUT", `/api/schedule/${dmOnsite.body.id}`, {
    deliveryMode: "ONSITE", ...dmAt(404),
  });
  check(15, "改回线下必须重新指定教室", dmBackNoRoom.status === 400, `实际 ${dmBackNoRoom.status}`);

  // 老师在带班课时，不能再被排一对一（两张课表要互相看见）
  const dmClass = await prisma.groupClass.create({
    data: {
      name: "探测班·地点", campusId: "campus-rh", subjectId: fx.subject.id,
      teacherId: fx.rhTeacher.id, createdById: fx.admin.id, status: "ONGOING",
    },
  });
  const dmSessionAt = dmAt(410);
  await prisma.groupSession.create({
    data: {
      classId: dmClass.id, teacherId: fx.rhTeacher.id, classroomId: fx.rhRoom.id,
      startTime: new Date(dmSessionAt.startTime), endTime: new Date(dmSessionAt.endTime),
    },
  });
  const dmCrossTeacher = await rhPrincipal.req("POST", "/api/schedule", {
    teacherId: fx.rhTeacher.id, studentId: dmStudent.id, packageId: dmPkg.id,
    deliveryMode: "ONLINE", ...dmSessionAt,
  });
  check(15, "老师在带班课时不得再被排一对一",
    dmCrossTeacher.status === 409, `实际 ${dmCrossTeacher.status}：${dmCrossTeacher.body?.error}`);

  // 学生在班课里，同时段也不能再排一对一
  await prisma.groupClassMember.create({
    data: { classId: dmClass.id, studentId: dmStudent.id, packageId: dmPkg.id },
  });
  const dmCrossStudent = await rhPrincipal.req("POST", "/api/schedule", {
    teacherId: dmTeacher2.id, studentId: dmStudent.id, packageId: dmPkg.id,
    deliveryMode: "ONLINE", ...dmSessionAt,
  });
  check(15, "学生在班课上课时不得再被排一对一",
    dmCrossStudent.status === 409, `实际 ${dmCrossStudent.status}：${dmCrossStudent.body?.error}`);

  await cleanupDelivery();

  // ── 阶段 16：剩余课时负债报表（口径：未核销的都算）────────────────────────
  console.log("\n阶段 16 — 剩余课时负债报表");
  const lbPhone = "6479998831";
  const cleanupLiab = async () => {
    const st = await prisma.student.findFirst({ where: { phone: lbPhone } });
    if (!st) return;
    const logs = await prisma.lessonLog.findMany({ where: { lesson: { studentId: st.id } } });
    for (const lg of logs) await prisma.courseDeduction.deleteMany({ where: { logId: lg.id } });
    await prisma.lessonLog.deleteMany({ where: { lesson: { studentId: st.id } } });
    await prisma.courseDeduction.deleteMany({ where: { package: { studentId: st.id } } });
    await prisma.scheduledLesson.deleteMany({ where: { studentId: st.id } });
    await prisma.ledgerEntry.deleteMany({ where: { studentId: st.id } });
    await prisma.coursePackage.deleteMany({ where: { studentId: st.id } });
    await prisma.student.delete({ where: { id: st.id } });
  };
  await cleanupLiab();

  // 销售/学管无权看负债（这是财务口径的钱，且跨全校区）
  const lbBySales = await mkmSales.req("GET", "/api/reports/liability");
  check(16, "销售不得查看负债报表", blocked(lbBySales), `实际 ${lbBySales.status}`);

  const lbBase = await finance.req("GET", "/api/reports/liability");
  check(16, "财务可查看负债报表", lbBase.status === 200, `实际 ${lbBase.status}`);
  const baseAmount = lbBase.body?.totalAmount ?? 0;

  const lbStudent = await prisma.student.create({
    data: { name: "探测·负债", phone: lbPhone, campusId: "campus-rh", gradeId: fx.grade.id },
  });
  const mkLbPkg = (status, remaining, price = 100, total = 20) =>
    prisma.coursePackage.create({
      data: {
        studentId: lbStudent.id, gradeId: fx.grade.id, subjectId: fx.subject.id,
        totalHours: total, pricePerHour: price, totalAmount: total * price,
        remainingHours: remaining, status, classType: "ONE_ON_ONE", createdById: fx.admin.id,
      },
    });

  // 生效课包 10h × $100 = $1000 计入负债
  const lbActive = await mkLbPkg("ACTIVE", 10);
  // 待财务确认的不计（钱还没确认到账）
  await mkLbPkg("PENDING_FINANCE", 20);
  // 待校长确认的也不计
  await mkLbPkg("PENDING_APPROVAL", 20);
  // 已耗尽的不计（剩余 0）
  await mkLbPkg("ACTIVE", 0);

  const lbAfter = await finance.req("GET", "/api/reports/liability");
  check(16, "负债 = 已生效课包剩余课时 × 单价，只算 ACTIVE",
    Math.abs((lbAfter.body.totalAmount - baseAmount) - 1000) < 0.01,
    `增量 ${(lbAfter.body.totalAmount - baseAmount).toFixed(2)}（应 $1000）`);

  const lbRow = lbAfter.body.rows.find((r) => r.packageId === lbActive.id);
  check(16, "明细含该课包且金额正确",
    lbRow && lbRow.remainingHours === 10 && lbRow.amount === 1000 && lbRow.pendingHours === 0,
    `剩余 ${lbRow?.remainingHours}h，金额 ${lbRow?.amount}，待上 ${lbRow?.pendingHours}h`);

  // 已排未核销：负债不变（未核销的都算），但要拆出「已排待上」
  const lbSlot = new Date(fx.base.getTime() + 500 * 86400000);
  await prisma.scheduledLesson.create({
    data: {
      teacherId: fx.rhTeacher.id, studentId: lbStudent.id, packageId: lbActive.id,
      classroomId: fx.rhRoom.id, startTime: lbSlot, endTime: new Date(lbSlot.getTime() + 2 * 3600000),
    },
  });
  const lbSched = await finance.req("GET", "/api/reports/liability");
  const lbRow2 = lbSched.body.rows.find((r) => r.packageId === lbActive.id);
  check(16, "已排未核销不减少负债，只拆到「已排待上」",
    Math.abs((lbSched.body.totalAmount - baseAmount) - 1000) < 0.01 && lbRow2.pendingHours === 2,
    `增量 ${(lbSched.body.totalAmount - baseAmount).toFixed(2)}，待上 ${lbRow2?.pendingHours}h（应 2h）`);

  // 核销后负债才下降
  await prisma.$transaction(async (tx) => {
    const les = await tx.scheduledLesson.findFirst({ where: { packageId: lbActive.id } });
    const log = await tx.lessonLog.create({
      data: {
        lessonId: les.id, teacherId: fx.rhTeacher.id, subjectId: fx.subject.id,
        notes: "探测·负债核销", confirmedAt: new Date(), confirmedById: fx.admin.id,
      },
    });
    await tx.courseDeduction.create({
      data: { packageId: lbActive.id, logId: log.id, hoursDeducted: 2 },
    });
    await tx.coursePackage.update({
      where: { id: lbActive.id }, data: { remainingHours: { decrement: 2 } },
    });
  });
  const lbDone = await finance.req("GET", "/api/reports/liability");
  const lbRow3 = lbDone.body.rows.find((r) => r.packageId === lbActive.id);
  check(16, "核销后负债按已消耗课时下降",
    Math.abs((lbDone.body.totalAmount - baseAmount) - 800) < 0.01 && lbRow3.pendingHours === 0,
    `增量 ${(lbDone.body.totalAmount - baseAmount).toFixed(2)}（应 $800），待上 ${lbRow3?.pendingHours}h`);

  // 校长只看本校区：Markham 校长看不到 RH 的这笔
  const lbMkmPrincipal = new Client("Markham 校长");
  await lbMkmPrincipal.login("6470000003", "principal123");
  const lbScoped = await lbMkmPrincipal.req("GET", "/api/reports/liability");
  check(16, "校长的负债报表只含本校区",
    lbScoped.status === 200
      && !lbScoped.body.rows.some((r) => r.campusId === "campus-rh")
      && lbScoped.body.byCampus.every((g) => g.key !== "campus-rh"),
    `HTTP ${lbScoped.status}，含 RH 明细 ${lbScoped.body?.rows?.some((r) => r.campusId === "campus-rh")}`);

  // 汇总与明细必须自洽，否则表面数字好看、点开对不上
  const sumRows = lbDone.body.rows.reduce((s, r) => s + r.amount, 0);
  const sumCampus = lbDone.body.byCampus.reduce((s, g) => s + g.amount, 0);
  const sumSubject = lbDone.body.bySubject.reduce((s, g) => s + g.amount, 0);
  check(16, "总额 = 明细之和 = 各维度汇总之和",
    Math.abs(sumRows - lbDone.body.totalAmount) < 0.05
      && Math.abs(sumCampus - lbDone.body.totalAmount) < 0.05
      && Math.abs(sumSubject - lbDone.body.totalAmount) < 0.05,
    `总额 ${lbDone.body.totalAmount}，明细 ${sumRows.toFixed(2)}，校区 ${sumCampus.toFixed(2)}，科目 ${sumSubject.toFixed(2)}`);

  await cleanupLiab();

  // ── 阶段 17：代码复审修复的回归 ────────────────────────────────────────────
  console.log("\n阶段 17 — 复审修复");
  const rvPhone = "6479998841";
  const cleanupReview = async () => {
    const cls = await prisma.groupClass.findMany({ where: { name: { startsWith: "探测班·复审" } } });
    for (const c of cls) {
      await prisma.courseDeduction.deleteMany({ where: { groupSession: { classId: c.id } } });
      await prisma.groupSessionAttendance.deleteMany({ where: { session: { classId: c.id } } });
      await prisma.groupSession.deleteMany({ where: { classId: c.id } });
      await prisma.groupClassMember.deleteMany({ where: { classId: c.id } });
      await prisma.groupClass.delete({ where: { id: c.id } });
    }
    await prisma.classroom.deleteMany({ where: { name: { startsWith: "探测教室·复审" } } });
    for (const ph of [rvPhone, rvPhone + "1"]) {
      const st = await prisma.student.findFirst({ where: { phone: ph } });
      if (!st) continue;
      const logs = await prisma.lessonLog.findMany({ where: { lesson: { studentId: st.id } } });
      for (const lg of logs) await prisma.courseDeduction.deleteMany({ where: { logId: lg.id } });
      await prisma.lessonLog.deleteMany({ where: { lesson: { studentId: st.id } } });
      await prisma.courseDeduction.deleteMany({ where: { package: { studentId: st.id } } });
      await prisma.scheduledLesson.deleteMany({ where: { studentId: st.id } });
      await prisma.refundRequest.deleteMany({ where: { studentId: st.id } });
      await prisma.ledgerEntry.deleteMany({ where: { studentId: st.id } });
      await prisma.coursePackage.deleteMany({ where: { studentId: st.id } });
      await prisma.student.delete({ where: { id: st.id } });
    }
  };
  await cleanupReview();

  const rvTeacher = new Client("Markham 老师");
  await rvTeacher.login("6470000002", "teacher123");

  // ① 老师不能排课 / 改期 / 删课，只能看自己的课表
  const rvPkgAny = await prisma.coursePackage.findFirst({
    where: { status: "ACTIVE", classType: "ONE_ON_ONE", remainingHours: { gte: 2 }, student: { campusId: "campus-markham" } },
  });
  const rvRoom = await prisma.classroom.findFirst({ where: { campusId: "campus-markham" } });
  const rvSlot = new Date(fx.base.getTime() + 600 * 86400000);
  const teacherSchedule = await rvTeacher.req("POST", "/api/schedule", {
    teacherId: mkmTeacherRow.id, studentId: rvPkgAny.studentId, packageId: rvPkgAny.id,
    classroomId: rvRoom.id, deliveryMode: "ONSITE",
    startTime: rvSlot.toISOString(), endTime: new Date(rvSlot.getTime() + 2 * 3600000).toISOString(),
  });
  check(17, "老师不得排课", blocked(teacherSchedule), `实际 ${teacherSchedule.status}`);

  const rvVictimLesson = await prisma.scheduledLesson.create({
    data: {
      teacherId: mkmTeacherRow.id, studentId: rvPkgAny.studentId, packageId: rvPkgAny.id,
      classroomId: rvRoom.id, startTime: rvSlot, endTime: new Date(rvSlot.getTime() + 2 * 3600000),
    },
  });
  const teacherMove = await rvTeacher.req("PUT", `/api/schedule/${rvVictimLesson.id}`, {
    startTime: new Date(rvSlot.getTime() + 86400000).toISOString(),
    endTime: new Date(rvSlot.getTime() + 86400000 + 2 * 3600000).toISOString(),
  });
  check(17, "老师不得改期", blocked(teacherMove), `实际 ${teacherMove.status}`);

  const teacherDelete = await rvTeacher.req("DELETE", `/api/schedule/${rvVictimLesson.id}`);
  const stillThere = await prisma.scheduledLesson.findUnique({ where: { id: rvVictimLesson.id } });
  check(17, "老师不得删课", blocked(teacherDelete) && !!stillThere,
    `HTTP ${teacherDelete.status}，课程${stillThere ? "仍在" : "已被删"}`);

  // 老师仍看得到课表，但只有自己的
  const teacherView = await rvTeacher.req("GET", "/api/schedule");
  const rvForeign = (teacherView.body ?? []).filter((e) => e.extendedProps?.teacherId !== mkmTeacherRow.id);
  check(17, "老师能看课表，但只看得到自己的课",
    teacherView.status === 200 && rvForeign.length === 0,
    `HTTP ${teacherView.status}，别人的课 ${rvForeign.length} 条`);

  // 即使指定别人的 teacherId 也翻不出来
  const rhTeacherId = fx.rhTeacher.id;
  const teacherPeek = await rvTeacher.req("GET", `/api/schedule?teacherId=${rhTeacherId}`);
  const peeked = (teacherPeek.body ?? []).filter((e) => e.extendedProps?.teacherId === rhTeacherId);
  check(17, "老师改 teacherId 参数也翻不到别人的课表", peeked.length === 0, `翻到 ${peeked.length} 条`);

  await prisma.scheduledLesson.delete({ where: { id: rvVictimLesson.id } });

  // ② 删教室要连班课一起数
  const rvNewRoom = await prisma.classroom.create({
    data: { name: "探测教室·复审", campusId: "campus-markham" },
  });
  const rvSubject = await prisma.subject.findFirst({ where: { name: "Math" } });
  const rvClass = await prisma.groupClass.create({
    data: {
      name: "探测班·复审", campusId: "campus-markham", subjectId: rvSubject.id,
      createdById: fx.admin.id, status: "ONGOING",
    },
  });
  const rvSessAt = new Date(fx.base.getTime() + 610 * 86400000);
  const rvSess = await prisma.groupSession.create({
    data: {
      classId: rvClass.id, teacherId: mkmTeacherRow.id, classroomId: rvNewRoom.id,
      startTime: rvSessAt, endTime: new Date(rvSessAt.getTime() + 2 * 3600000),
    },
  });
  const delRoom = await admin.req("DELETE", `/api/admin/classrooms/${rvNewRoom.id}`);
  const sessAfter = await prisma.groupSession.findUnique({ where: { id: rvSess.id } });
  check(17, "被班课占用的教室不得删除，班课的教室不会被清空",
    delRoom.status === 400 && sessAfter?.classroomId === rvNewRoom.id,
    `HTTP ${delRoom.status}：${delRoom.body?.error}；课次教室 ${sessAfter?.classroomId === rvNewRoom.id ? "完好" : "被清空"}`);

  // ③ 班课课包的「已排未核销」要算进可退上限
  const rvStudent = await prisma.student.create({
    data: { name: "探测·复审班课生", phone: rvPhone, campusId: "campus-markham", gradeId: fx.grade.id, studentManagerId: "user-sm-mkm" },
  });
  const rvGroupPkg = await prisma.coursePackage.create({
    data: {
      studentId: rvStudent.id, gradeId: fx.grade.id, subjectId: rvSubject.id, classType: "GROUP",
      totalHours: 10, pricePerHour: 100, totalAmount: 1000, remainingHours: 10,
      status: "ACTIVE", createdById: fx.admin.id,
    },
  });
  await prisma.groupClassMember.create({
    data: { classId: rvClass.id, studentId: rvStudent.id, packageId: rvGroupPkg.id },
  });
  await prisma.groupSessionAttendance.create({
    data: { sessionId: rvSess.id, studentId: rvStudent.id, packageId: rvGroupPkg.id },
  });

  const rvRefundAll = await smMkm.req("POST", "/api/refunds", { packageId: rvGroupPkg.id, hours: 10 });
  check(17, "班课已排未核销的课时不得退掉",
    rvRefundAll.status === 400 && /已排未核销 2h/.test(rvRefundAll.body?.error ?? ""),
    `HTTP ${rvRefundAll.status}：${rvRefundAll.body?.error}`);

  const rvRefundOk = await smMkm.req("POST", "/api/refunds", { packageId: rvGroupPkg.id, hours: 8 });
  check(17, "扣掉已排的 2h 后，剩下 8h 可正常退",
    rvRefundOk.status === 201, `HTTP ${rvRefundOk.status}：${rvRefundOk.body?.error}`);

  // ④ 已结算的课包不得撤销核销
  const rvStu2 = await prisma.student.create({
    data: { name: "探测·复审撤销", phone: rvPhone + "1", campusId: "campus-markham", gradeId: fx.grade.id, studentManagerId: "user-sm-mkm" },
  });
  const rvPkg2 = await prisma.coursePackage.create({
    data: {
      studentId: rvStu2.id, gradeId: fx.grade.id, subjectId: rvSubject.id, classType: "ONE_ON_ONE",
      totalHours: 10, pricePerHour: 100, totalAmount: 1000, remainingHours: 8,
      status: "ACTIVE", createdById: fx.admin.id,
    },
  });
  const rvLesAt = new Date(fx.base.getTime() + 620 * 86400000);
  const rvLes = await prisma.scheduledLesson.create({
    data: {
      teacherId: mkmTeacherRow.id, studentId: rvStu2.id, packageId: rvPkg2.id,
      classroomId: rvRoom.id, startTime: rvLesAt, endTime: new Date(rvLesAt.getTime() + 2 * 3600000),
    },
  });
  const rvLog = await prisma.lessonLog.create({
    data: {
      lessonId: rvLes.id, teacherId: mkmTeacherRow.id, subjectId: rvSubject.id,
      notes: "探测·复审", confirmedAt: new Date(), confirmedById: fx.admin.id,
    },
  });
  await prisma.courseDeduction.create({ data: { packageId: rvPkg2.id, logId: rvLog.id, hoursDeducted: 2 } });

  const rvConv = await smMkm.req("POST", `/api/packages/${rvPkg2.id}/convert`, {
    subjectId: rvSubject.id, gradeId: fx.grade.id, classType: "ONE_ON_ONE",
    totalHours: 12, pricePerHour: 100, totalAmount: 1200,
  });
  const rvRev = await finance.req("POST", `/api/lessons/${rvLes.id}/reverse`);
  const rvPkgAfter = await prisma.coursePackage.findUnique({ where: { id: rvPkg2.id } });
  check(17, "已转化的课包不得撤销核销（否则课时凭空复活）",
    rvConv.status === 201 && rvRev.status === 400 && Number(rvPkgAfter.remainingHours) === 0,
    `转化 ${rvConv.status}，撤销 ${rvRev.status}，原包剩余 ${rvPkgAfter?.remainingHours}h（应 0）`);

  await prisma.coursePackage.deleteMany({ where: { id: rvConv.body?.package?.id } });
  await cleanupReview();

  // ── 阶段 18：销售不管核销、学管只看自己负责的学生 ──────────────────────────
  console.log("\n阶段 18 — 归属收敛");
  const owPhones = ["6479998851", "6479998852"];
  const cleanupOwnerScope = async () => {
    for (const ph of owPhones) {
      const st = await prisma.student.findFirst({ where: { phone: ph } });
      if (!st) continue;
      const logs = await prisma.lessonLog.findMany({ where: { lesson: { studentId: st.id } } });
      for (const lg of logs) await prisma.courseDeduction.deleteMany({ where: { logId: lg.id } });
      await prisma.lessonLog.deleteMany({ where: { lesson: { studentId: st.id } } });
      await prisma.courseDeduction.deleteMany({ where: { package: { studentId: st.id } } });
      await prisma.scheduledLesson.deleteMany({ where: { studentId: st.id } });
      await prisma.followUp.deleteMany({ where: { studentId: st.id } });
      await prisma.refundRequest.deleteMany({ where: { studentId: st.id } });
      await prisma.ledgerEntry.deleteMany({ where: { studentId: st.id } });
      await prisma.coursePackage.deleteMany({ where: { studentId: st.id } });
      await prisma.student.delete({ where: { id: st.id } });
    }
  };
  await cleanupOwnerScope();

  // 甲归 Markham 学管，乙归 RH 学管 —— 两人同校区(Markham)，只差归属。
  const owMine = await prisma.student.create({
    data: {
      name: "探测·我的学生", phone: owPhones[0], campusId: "campus-markham",
      gradeId: fx.grade.id, studentManagerId: "user-sm-mkm",
    },
  });
  const owOthers = await prisma.student.create({
    data: {
      name: "探测·别人的学生", phone: owPhones[1], campusId: "campus-markham",
      gradeId: fx.grade.id, studentManagerId: "user-sm-rh",
    },
  });
  const mkOwPkg = (studentId) => prisma.coursePackage.create({
    data: {
      studentId, gradeId: fx.grade.id, subjectId: fx.subject.id, classType: "ONE_ON_ONE",
      totalHours: 10, pricePerHour: 100, totalAmount: 1000, remainingHours: 10,
      status: "ACTIVE", createdById: fx.admin.id,
    },
  });
  const owPkgMine = await mkOwPkg(owMine.id);
  const owPkgOthers = await mkOwPkg(owOthers.id);
  const owSlot = new Date(fx.base.getTime() + 700 * 86400000);
  const mkOwLesson = (studentId, packageId, offset) => prisma.scheduledLesson.create({
    data: {
      teacherId: mkmTeacherRow.id, studentId, packageId,
      classroomId: "room-mkm-101",
      startTime: new Date(owSlot.getTime() + offset * 86400000),
      endTime: new Date(owSlot.getTime() + offset * 86400000 + 2 * 3600000),
    },
  });
  await mkOwLesson(owMine.id, owPkgMine.id, 0);
  await mkOwLesson(owOthers.id, owPkgOthers.id, 1);

  // ① 销售完全不碰核销
  const salesLessons = await mkmSales.req("GET", "/api/lessons");
  check(18, "销售不得查看核销记录", blocked(salesLessons), `实际 ${salesLessons.status}`);

  // ② 学管能看核销，但只看得到自己负责的学生
  const smLessons = await smMkm.req("GET", "/api/lessons");
  const smSeesOthers = (smLessons.body ?? []).some((l) => l.student?.id === owOthers.id);
  const smSeesMine = (smLessons.body ?? []).some((l) => l.student?.id === owMine.id);
  check(18, "学管的核销列表只含自己负责的学生",
    smLessons.status === 200 && smSeesMine && !smSeesOthers,
    `HTTP ${smLessons.status}，自己的 ${smSeesMine}，别人的 ${smSeesOthers}`);

  // ③ 财务不是老师，核销列表不该被筛成空
  const finLessons = await finance.req("GET", "/api/lessons");
  check(18, "财务能看到全校区核销（不被误当成老师筛空）",
    finLessons.status === 200 && (finLessons.body ?? []).length > 0,
    `HTTP ${finLessons.status}，${(finLessons.body ?? []).length} 条`);

  // ④ 学生列表：学管只列自己负责的
  const smStudents = await smMkm.req("GET", "/api/students");
  const smList = Array.isArray(smStudents.body) ? smStudents.body : (smStudents.body?.items ?? []);
  check(18, "学管的学生列表只含自己负责的",
    smStudents.status === 200
      && smList.some((x) => x.id === owMine.id)
      && !smList.some((x) => x.id === owOthers.id),
    `HTTP ${smStudents.status}，共 ${smList.length} 人`);

  // ⑤ 学生档案：直接按 id 也翻不到别人的
  const smPeekOwn = await smMkm.req("GET", `/api/students/${owMine.id}`);
  const smPeekOther = await smMkm.req("GET", `/api/students/${owOthers.id}`);
  check(18, "学管按 id 取自己的学生可以、取别人的被拒",
    smPeekOwn.status === 200 && blocked(smPeekOther),
    `自己的 ${smPeekOwn.status}，别人的 ${smPeekOther.status}`);

  // ⑥ 账本同理 —— 这是钱，越权看得到最要命
  const smLedgerOwn = await smMkm.req("GET", `/api/students/${owMine.id}/ledger`);
  const smLedgerOther = await smMkm.req("GET", `/api/students/${owOthers.id}/ledger`);
  check(18, "学管只能看自己负责学生的账本",
    smLedgerOwn.status === 200 && blocked(smLedgerOther),
    `自己的 ${smLedgerOwn.status}，别人的 ${smLedgerOther.status}`);

  // ⑦ 跟进记录同理
  const smFollowOther = await smMkm.req("GET", `/api/students/${owOthers.id}/followups`);
  check(18, "学管不得查看别人学生的跟进记录", blocked(smFollowOther), `实际 ${smFollowOther.status}`);

  // ⑧ 校长仍看全校区 —— 收敛不能把管理层一起收进去
  const prinStudents = await mkmPrincipal.req("GET", "/api/students");
  const prinList = Array.isArray(prinStudents.body) ? prinStudents.body : (prinStudents.body?.items ?? []);
  check(18, "校长仍能看到本校区全部学生",
    prinStudents.status === 200
      && prinList.some((x) => x.id === owMine.id)
      && prinList.some((x) => x.id === owOthers.id),
    `HTTP ${prinStudents.status}，共 ${prinList.length} 人`);

  // ⑨ 教务要排课，仍需看到全校区学生
  const acadStudents = await acadMkm.req("GET", "/api/students");
  const acadList = Array.isArray(acadStudents.body) ? acadStudents.body : (acadStudents.body?.items ?? []);
  check(18, "教务仍能看到本校区全部学生（排课要用）",
    acadStudents.status === 200 && acadList.some((x) => x.id === owOthers.id),
    `HTTP ${acadStudents.status}，共 ${acadList.length} 人`);

  await cleanupOwnerScope();

  // ── 阶段 19：老师只看得到自己的东西 ────────────────────────────────────────
  console.log("\n阶段 19 — 老师视野收敛");
  const cleanupTeacherView = async () => {
    const cs = await prisma.groupClass.findMany({ where: { name: "探测班·同事的班" } });
    for (const c of cs) {
      await prisma.groupSessionAttendance.deleteMany({ where: { session: { classId: c.id } } });
      await prisma.groupSession.deleteMany({ where: { classId: c.id } });
      await prisma.groupClassMember.deleteMany({ where: { classId: c.id } });
      await prisma.groupClass.delete({ where: { id: c.id } });
    }
    const peer = await prisma.user.findUnique({ where: { phone: "6470000096" } });
    if (peer) {
      const logs = await prisma.lessonLog.findMany({ where: { teacherId: peer.id } });
      for (const lg of logs) await prisma.courseDeduction.deleteMany({ where: { logId: lg.id } });
      await prisma.lessonLog.deleteMany({ where: { teacherId: peer.id } });
      await prisma.scheduledLesson.deleteMany({ where: { teacherId: peer.id } });
      await prisma.userRole.deleteMany({ where: { userId: peer.id } });
      await prisma.userCampus.deleteMany({ where: { userId: peer.id } });
      await prisma.user.delete({ where: { id: peer.id } });
    }
  };
  await cleanupTeacherView();

  // 同校区的另一位老师：带一个班，且有一节已核销的课
  const tvPeer = await prisma.user.create({
    data: {
      name: "探测·同事老师", phone: "6470000096", passwordHash: await bcrypt.hash("teacher123", 12),
      roles: { create: [{ role: "TEACHER" }] }, campuses: { create: [{ campusId: "campus-markham" }] },
    },
  });
  const tvSubject = await prisma.subject.findFirst({ where: { name: "Math" } });
  const tvClass = await prisma.groupClass.create({
    data: {
      name: "探测班·同事的班", campusId: "campus-markham", subjectId: tvSubject.id,
      teacherId: tvPeer.id, createdById: fx.admin.id, status: "ONGOING",
    },
  });
  const tvPkg = await prisma.coursePackage.findFirst({
    where: { status: "ACTIVE", student: { campusId: "campus-markham" } },
  });
  const tvAt = new Date(fx.base.getTime() + 800 * 86400000);
  const tvLes = await prisma.scheduledLesson.create({
    data: {
      teacherId: tvPeer.id, studentId: tvPkg.studentId, packageId: tvPkg.id,
      classroomId: "room-mkm-102", startTime: tvAt, endTime: new Date(tvAt.getTime() + 2 * 3600000),
    },
  });
  await prisma.lessonLog.create({
    data: {
      lessonId: tvLes.id, teacherId: tvPeer.id, subjectId: tvSubject.id,
      notes: "探测·同事的课", confirmedAt: new Date(), confirmedById: fx.admin.id,
    },
  });

  const tvTeacher = new Client("Markham 老师（视野）");
  await tvTeacher.login("6470000002", "teacher123");

  // 班级：列表看不到同事的班
  const tvClasses = await tvTeacher.req("GET", "/api/classes");
  const tvArr = Array.isArray(tvClasses.body) ? tvClasses.body : (tvClasses.body?.items ?? []);
  check(19, "老师的班级列表不含同事带的班",
    tvClasses.status === 200 && !tvArr.some((c) => c.id === tvClass.id),
    `HTTP ${tvClasses.status}，共 ${tvArr.length} 个班`);

  // 班级：按 id 直取也挡住（详情带完整花名册）
  const tvDetail = await tvTeacher.req("GET", `/api/classes/${tvClass.id}`);
  check(19, "老师按 id 直取同事的班详情被拒", blocked(tvDetail), `实际 ${tvDetail.status}`);

  // 工时：只看自己的
  const tvReport = await tvTeacher.req("GET", "/api/reports/teachers");
  const tvNames = (tvReport.body?.teachers ?? []).map((t) => t.name);
  check(19, "老师的工时报表只含自己",
    tvReport.status === 200 && tvNames.length === 1 && tvNames[0] === "Michael Wang",
    `HTTP ${tvReport.status}，含 ${tvNames.join("/") || "(空)"}`);

  // 工时：改 teacherId 参数也翻不到同事
  const tvPeek = await tvTeacher.req("GET", `/api/reports/teachers?teacherId=${tvPeer.id}`);
  check(19, "老师改 teacherId 也查不到同事工时",
    !(tvPeek.body?.teachers ?? []).some((t) => t.name === "探测·同事老师"),
    `含 ${(tvPeek.body?.teachers ?? []).map((t) => t.name).join("/") || "(空)"}`);

  // 学生档案对老师整体关闭（收敛归属后本就一个都匹配不到）
  const tvStudents = await tvTeacher.req("GET", "/api/students");
  const tvStuArr = Array.isArray(tvStudents.body) ? tvStudents.body : (tvStudents.body?.items ?? []);
  check(19, "老师看不到任何学生档案", tvStuArr.length === 0, `共 ${tvStuArr.length} 人`);

  // 反向：教务仍看得到全校区的班与工时，收敛不能过头
  const tvAcadClasses = await acadMkm.req("GET", "/api/classes");
  const tvAcadArr = Array.isArray(tvAcadClasses.body) ? tvAcadClasses.body : (tvAcadClasses.body?.items ?? []);
  const tvAcadReport = await acadMkm.req("GET", "/api/reports/teachers");
  check(19, "教务仍看得到全校区的班级与各老师工时",
    tvAcadArr.some((c) => c.id === tvClass.id)
      && (tvAcadReport.body?.teachers ?? []).some((t) => t.name === "探测·同事老师"),
    `班级 ${tvAcadArr.length} 个，工时含 ${(tvAcadReport.body?.teachers ?? []).length} 位老师`);

  // 仪表盘是各受限页面的摘要，最容易绕开收敛：老师那版不该出现学生名单/总数
  const tvDash = await tvTeacher.req("GET", "/dashboard");
  const tvHtml = typeof tvDash.body === "string" ? tvDash.body : "";
  const tvLeaks = ["最近添加的学生", "添加学生", "学生总数", "有效课包"].filter((k) => tvHtml.includes(k));
  check(19, "老师的仪表盘不含学生名单与课包统计",
    tvDash.status === 200 && tvLeaks.length === 0,
    `HTTP ${tvDash.status}，泄露 ${tvLeaks.join("/") || "无"}`);

  // 反向：教务的仪表盘该有的还在
  const tvAcadDash = await acadMkm.req("GET", "/dashboard");
  const tvAcadHtml = typeof tvAcadDash.body === "string" ? tvAcadDash.body : "";
  check(19, "教务的仪表盘仍含学生名单",
    tvAcadDash.status === 200 && tvAcadHtml.includes("最近添加的学生"),
    `HTTP ${tvAcadDash.status}`);

  await cleanupTeacherView();
}

/**
 * 生产护栏。
 *
 * 本脚本会真实创建和删除学生、课包、用户 —— 打到生产就是数据事故。
 * 目标环境不靠人记域名，由服务端 /api/health 自报。
 *
 * 对远程目标一律 fail closed：问不出环境就当成生产拒绝。本机 localhost 放行，
 * 否则日常开发每次都要多起一个服务。
 */
async function assertSafeTarget() {
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE);
  if (isLocal) return;

  let env = null;
  try {
    const res = await fetch(`${BASE}/api/health`);
    if (res.ok) env = (await res.json())?.env ?? null;
  } catch {
    // 连不上，下面按「问不出」处理
  }

  if (env === "production") {
    console.error(`\n拒绝执行：${BASE} 自报为生产环境。`);
    console.error("探测脚本会真实增删数据，只能打到测试环境。");
    process.exit(1);
  }
  if (env !== "staging" && env !== "development") {
    console.error(`\n拒绝执行：无法从 ${BASE}/api/health 确认目标环境（读到 ${JSON.stringify(env)}）。`);
    console.error("远程目标必须能自报环境，否则一律按生产对待。");
    process.exit(1);
  }
  console.log(`目标环境：${env} @ ${BASE}`);
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
try {
  await assertSafeTarget();
  await setup();
  await run();
} catch (e) {
  console.error("\n探测脚本自身出错：", e);
  process.exitCode = 1;
} finally {
  await teardown().catch((e) => console.error("清理失败：", e));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${"─".repeat(60)}`);
for (const p of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]) {
  const inPhase = results.filter((r) => r.phase === p);
  if (!inPhase.length) continue;
  const ok = inPhase.filter((r) => r.pass).length;
  console.log(`阶段 ${p}: ${ok}/${inPhase.length} 通过`);
}
console.log(`总计: ${results.length - failed.length}/${results.length} 通过，${failed.length} 个洞未堵`);
if (failed.length) process.exitCode = 1;
