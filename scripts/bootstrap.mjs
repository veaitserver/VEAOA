/**
 * 生产环境初始化 —— 与 prisma/seed.ts 严格分开。
 *
 * seed 会造演示学生、演示课包和一堆弱口令账号，那是开发/测试用的。
 * 生产只需要两样东西：基础字典（校区/年级/科目）和一个能登录的超管。
 * 其余数据一律由业务流程真实产生。
 *
 * 用法：
 *   BOOTSTRAP_ADMIN_NAME="张三" \
 *   BOOTSTRAP_ADMIN_PHONE=6470001234 \
 *   BOOTSTRAP_ADMIN_PASSWORD='<强口令>' \
 *   npm run db:bootstrap
 *
 * 幂等：可以重复跑。已存在的超管不会被改密码 —— 否则一次误运行就能把
 * 线上账号的口令重置成环境变量里的值。要改密码请在后台改。
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// 与 seed.ts 里的演示口令一致的，一律拒绝 —— 那些已经写在文档和 git 历史里了。
const DEMO_PASSWORDS = new Set([
  "admin123", "finance123", "sales123", "teacher123",
  "principal123", "acad123", "sm123", "password", "12345678",
]);

const CAMPUSES = [
  { id: "campus-markham", name: "Markham Campus" },
  { id: "campus-rh", name: "Richmond Hill Campus" },
  { id: "campus-scar", name: "Scarborough Campus" },
  { id: "campus-miss", name: "Mississauga Campus" },
];
const GRADES = ["Grade 9", "Grade 10", "Grade 11", "Grade 12", "AP Calculus", "IB Physics HL", "SAT Math"];
const SUBJECTS = ["Math", "Physics", "Chemistry", "English"];

function requireEnv(name) {
  const v = (process.env[name] ?? "").trim();
  if (!v) {
    console.error(`缺少环境变量 ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const name = (process.env.BOOTSTRAP_ADMIN_NAME ?? "").trim() || "Super Admin";
  const phone = requireEnv("BOOTSTRAP_ADMIN_PHONE");
  const password = requireEnv("BOOTSTRAP_ADMIN_PASSWORD");

  if (password.length < 12) {
    console.error("BOOTSTRAP_ADMIN_PASSWORD 至少 12 位。");
    process.exit(1);
  }
  if (DEMO_PASSWORDS.has(password)) {
    console.error("BOOTSTRAP_ADMIN_PASSWORD 是演示口令，已公开在仓库里，不能用。");
    process.exit(1);
  }

  for (const c of CAMPUSES) {
    await prisma.campus.upsert({ where: { id: c.id }, update: { name: c.name }, create: c });
  }
  for (const n of GRADES) {
    await prisma.grade.upsert({ where: { name: n }, update: {}, create: { name: n } });
  }
  for (const n of SUBJECTS) {
    await prisma.subject.upsert({ where: { name: n }, update: {}, create: { name: n } });
  }
  console.log(`字典就绪：${CAMPUSES.length} 校区 / ${GRADES.length} 年级 / ${SUBJECTS.length} 科目`);

  const existing = await prisma.user.findUnique({
    where: { phone },
    include: { roles: true },
  });
  if (existing) {
    // 不改密码：重复运行不该有重置线上口令的副作用。
    const isSuper = existing.roles.some((r) => r.role === "SUPER_ADMIN");
    if (!isSuper) {
      await prisma.userRole.create({ data: { userId: existing.id, role: "SUPER_ADMIN" } });
      console.log(`已有用户 ${phone}，补授 SUPER_ADMIN。`);
    } else {
      console.log(`超管 ${phone} 已存在，未作改动（如需改密码请在后台操作）。`);
    }
  } else {
    const user = await prisma.user.create({
      data: {
        name, phone,
        passwordHash: await bcrypt.hash(password, 12),
        roles: { create: [{ role: "SUPER_ADMIN" }] },
        campuses: { create: CAMPUSES.map((c) => ({ campusId: c.id })) },
      },
    });
    console.log(`已创建超管：${user.name} / ${user.phone}`);
  }

  const students = await prisma.student.count();
  console.log(`完成。当前学生数 ${students}（bootstrap 不会造任何业务数据）。`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
