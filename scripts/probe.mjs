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
  const slot = new Date(fx.base.getTime() + 7 * 86400000);
  const first = await prisma.scheduledLesson.create({
    data: {
      teacherId: fx.rhTeacher.id, studentId: fx.student.id, packageId: fx.active.id,
      classroomId: fx.rhRoom.id, startTime: slot, endTime: new Date(slot.getTime() + 3600000),
    },
  });
  const clash = await t2.req("POST", "/api/schedule", {
    teacherId: fx.admin.id, studentId: fx.student.id, packageId: fx.active.id,
    classroomId: fx.rhRoom2.id,
    startTime: slot.toISOString(), endTime: new Date(slot.getTime() + 3600000).toISOString(),
  });
  check(4, "同一学生同一时段不得被排两节课", clash.status === 409, `实际 ${clash.status}`);
  if (clash.status === 201) await prisma.scheduledLesson.delete({ where: { id: clash.body.id } });
  await prisma.scheduledLesson.delete({ where: { id: first.id } });

  // 19. 排课不得超库存（余额 10h，先排 8h，再排 4h 应被拒）
  const s1 = new Date(fx.base.getTime() + 14 * 86400000);
  const hog = await prisma.scheduledLesson.create({
    data: {
      teacherId: fx.rhTeacher.id, studentId: fx.student.id, packageId: fx.active.id,
      classroomId: fx.rhRoom.id, startTime: s1, endTime: new Date(s1.getTime() + 8 * 3600000),
    },
  });
  const s2 = new Date(fx.base.getTime() + 21 * 86400000);
  const over = await t2.req("POST", "/api/schedule", {
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
  const neg = await t2.req("POST", "/api/schedule", {
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

  const pFin = await rhPrincipal.req("POST", `/api/packages/${twoStepPkg.id}/finance-confirm`);
  check(7, "校长不能做财务确认", blocked(pFin), `实际 ${pFin.status}`);

  const confirmF = await finance.req("POST", `/api/packages/${twoStepPkg.id}/finance-confirm`);
  const afterF = await prisma.coursePackage.findUnique({ where: { id: twoStepPkg.id } });
  check(7, "财务确认后正式生效 ACTIVE", confirmF.status === 200 && afterF.status === "ACTIVE",
    `HTTP ${confirmF.status}，状态 ${afterF.status}`);

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

  const salesRenew = await mkmSales.req("POST", "/api/packages", pkgBody);
  check(9, "学生已签约后销售不能再建课包", salesRenew.status === 403, `实际 ${salesRenew.status}`);

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

  // 清理
  await prisma.coursePackage.deleteMany({ where: { studentId: signStudent.id } });
  await prisma.followUp.deleteMany({ where: { studentId: signStudent.id } });
  await prisma.lead.deleteMany({ where: { studentId: signStudent.id } });
  await prisma.student.delete({ where: { id: signStudent.id } });
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
try {
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
for (const p of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
  const inPhase = results.filter((r) => r.phase === p);
  if (!inPhase.length) continue;
  const ok = inPhase.filter((r) => r.pass).length;
  console.log(`阶段 ${p}: ${ok}/${inPhase.length} 通过`);
}
console.log(`总计: ${results.length - failed.length}/${results.length} 通过，${failed.length} 个洞未堵`);
if (failed.length) process.exitCode = 1;
