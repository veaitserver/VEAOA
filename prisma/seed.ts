import { PrismaClient } from "@prisma/client";
import { Role, LeadSource } from "../lib/enums";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // ── Campuses ────────────────────────────────────────────────────────────────
  const campusMarkham = await prisma.campus.upsert({
    where: { id: "campus-markham" },
    update: { name: "Markham Campus" },
    create: { id: "campus-markham", name: "Markham Campus" },
  });
  const campusRH = await prisma.campus.upsert({
    where: { id: "campus-rh" },
    update: { name: "Richmond Hill Campus" },
    create: { id: "campus-rh", name: "Richmond Hill Campus" },
  });
  const campusScar = await prisma.campus.upsert({
    where: { id: "campus-scar" },
    update: { name: "Scarborough Campus" },
    create: { id: "campus-scar", name: "Scarborough Campus" },
  });
  const campusMiss = await prisma.campus.upsert({
    where: { id: "campus-miss" },
    update: { name: "Mississauga Campus" },
    create: { id: "campus-miss", name: "Mississauga Campus" },
  });

  // ── Grades ──────────────────────────────────────────────────────────────────
  const gradeNames = ["Grade 9", "Grade 10", "Grade 11", "Grade 12", "AP Calculus", "IB Physics HL", "SAT Math"];
  for (const name of gradeNames) {
    await prisma.grade.upsert({ where: { name }, update: {}, create: { name } });
  }
  const g9  = await prisma.grade.findUnique({ where: { name: "Grade 9" } });
  const g10 = await prisma.grade.findUnique({ where: { name: "Grade 10" } });
  const g11 = await prisma.grade.findUnique({ where: { name: "Grade 11" } });
  const g12 = await prisma.grade.findUnique({ where: { name: "Grade 12" } });

  // ── Subjects ────────────────────────────────────────────────────────────────
  const subjectNames = ["Math", "Physics", "Chemistry", "English"];
  for (const name of subjectNames) {
    await prisma.subject.upsert({ where: { name }, update: {}, create: { name } });
  }
  const subMath    = await prisma.subject.findUnique({ where: { name: "Math" } });
  const subPhysics = await prisma.subject.findUnique({ where: { name: "Physics" } });
  const subChem    = await prisma.subject.findUnique({ where: { name: "Chemistry" } });

  // ── Classrooms ──────────────────────────────────────────────────────────────
  const room101 = await prisma.classroom.upsert({
    where: { id: "room-mkm-101" },
    update: {},
    create: { id: "room-mkm-101", name: "Room 101", campusId: campusMarkham.id, capacity: 8 },
  });
  await prisma.classroom.upsert({
    where: { id: "room-mkm-102" },
    update: {},
    create: { id: "room-mkm-102", name: "Room 102", campusId: campusMarkham.id, capacity: 4 },
  });
  const roomRH1 = await prisma.classroom.upsert({
    where: { id: "room-rh-101" },
    update: {},
    create: { id: "room-rh-101", name: "Room A", campusId: campusRH.id, capacity: 6 },
  });
  await prisma.classroom.upsert({
    where: { id: "room-scar-101" },
    update: {},
    create: { id: "room-scar-101", name: "Room 1", campusId: campusScar.id, capacity: 6 },
  });
  await prisma.classroom.upsert({
    where: { id: "room-miss-101" },
    update: {},
    create: { id: "room-miss-101", name: "Room A", campusId: campusMiss.id, capacity: 8 },
  });

  // ── Users ───────────────────────────────────────────────────────────────────
  const pw = (p: string) => bcrypt.hash(p, 12);

  // Super Admin — all campuses
  await prisma.user.upsert({
    where: { phone: "6470000000" },
    update: {},
    create: {
      id: "user-admin",
      name: "System Admin",
      phone: "6470000000",
      passwordHash: await pw("admin123"),
      roles: { create: [{ role: Role.SUPER_ADMIN }] },
      campuses: { create: [
        { campusId: campusMarkham.id },
        { campusId: campusRH.id },
        { campusId: campusScar.id },
        { campusId: campusMiss.id },
      ]},
    },
  });

  // Finance — all campuses
  await prisma.user.upsert({
    where: { phone: "6470000005" },
    update: {},
    create: {
      id: "user-finance",
      name: "Emily Kim",
      phone: "6470000005",
      passwordHash: await pw("finance123"),
      roles: { create: [{ role: Role.FINANCE }] },
      campuses: { create: [
        { campusId: campusMarkham.id },
        { campusId: campusRH.id },
        { campusId: campusScar.id },
        { campusId: campusMiss.id },
      ]},
    },
  });

  // Markham Campus staff
  const salesMkm = await prisma.user.upsert({
    where: { phone: "6470000001" },
    update: {},
    create: {
      id: "user-sales-mkm",
      name: "Sarah Chen",
      phone: "6470000001",
      passwordHash: await pw("sales123"),
      roles: { create: [{ role: Role.SALES }] },
      campuses: { create: [{ campusId: campusMarkham.id }] },
    },
  });
  const teacherMkm = await prisma.user.upsert({
    where: { phone: "6470000002" },
    update: {},
    create: {
      id: "user-teacher-mkm",
      name: "Michael Wang",
      phone: "6470000002",
      passwordHash: await pw("teacher123"),
      roles: { create: [{ role: Role.TEACHER }] },
      campuses: { create: [{ campusId: campusMarkham.id }] },
    },
  });
  await prisma.user.upsert({
    where: { phone: "6470000003" },
    update: {},
    create: {
      id: "user-principal-mkm",
      name: "Jennifer Liu",
      phone: "6470000003",
      passwordHash: await pw("principal123"),
      roles: { create: [{ role: Role.PRINCIPAL }] },
      campuses: { create: [{ campusId: campusMarkham.id }] },
    },
  });
  await prisma.user.upsert({
    where: { phone: "6470000004" },
    update: {},
    create: {
      id: "user-acad-mkm",
      name: "David Zhang",
      phone: "6470000004",
      passwordHash: await pw("acad123"),
      roles: { create: [{ role: Role.ACADEMIC_ADMIN }] },
      campuses: { create: [{ campusId: campusMarkham.id }] },
    },
  });
  await prisma.user.upsert({
    where: { phone: "6470000011" },
    update: {},
    create: {
      id: "user-sm-mkm",
      name: "Grace Tan",
      phone: "6470000011",
      passwordHash: await pw("sm123"),
      roles: { create: [{ role: Role.STUDENT_MANAGER }] },
      campuses: { create: [{ campusId: campusMarkham.id }] },
    },
  });

  // Richmond Hill Campus staff
  const salesRH = await prisma.user.upsert({
    where: { phone: "6470000006" },
    update: {},
    create: {
      id: "user-sales-rh",
      name: "Jessica Park",
      phone: "6470000006",
      passwordHash: await pw("sales123"),
      roles: { create: [{ role: Role.SALES }] },
      campuses: { create: [{ campusId: campusRH.id }] },
    },
  });
  const teacherRH = await prisma.user.upsert({
    where: { phone: "6470000007" },
    update: {},
    create: {
      id: "user-teacher-rh",
      name: "Kevin Li",
      phone: "6470000007",
      passwordHash: await pw("teacher123"),
      roles: { create: [{ role: Role.TEACHER }] },
      campuses: { create: [{ campusId: campusRH.id }] },
    },
  });
  await prisma.user.upsert({
    where: { phone: "6470000008" },
    update: {},
    create: {
      id: "user-principal-rh",
      name: "Lisa Hong",
      phone: "6470000008",
      passwordHash: await pw("principal123"),
      roles: { create: [{ role: Role.PRINCIPAL }] },
      campuses: { create: [{ campusId: campusRH.id }] },
    },
  });
  await prisma.user.upsert({
    where: { phone: "6470000012" },
    update: {},
    create: {
      id: "user-sm-rh",
      name: "Henry Xu",
      phone: "6470000012",
      passwordHash: await pw("sm123"),
      roles: { create: [{ role: Role.STUDENT_MANAGER }] },
      campuses: { create: [{ campusId: campusRH.id }] },
    },
  });

  // Scarborough Campus staff
  const salesScar = await prisma.user.upsert({
    where: { phone: "6470000009" },
    update: {},
    create: {
      id: "user-sales-scar",
      name: "Amy Wu",
      phone: "6470000009",
      passwordHash: await pw("sales123"),
      roles: { create: [{ role: Role.SALES }] },
      campuses: { create: [{ campusId: campusScar.id }] },
    },
  });
  const teacherScar = await prisma.user.upsert({
    where: { phone: "6470000010" },
    update: {},
    create: {
      id: "user-teacher-scar",
      name: "Robert Chen",
      phone: "6470000010",
      passwordHash: await pw("teacher123"),
      roles: { create: [{ role: Role.TEACHER }] },
      campuses: { create: [{ campusId: campusScar.id }] },
    },
  });

  // Mississauga Campus staff
  const salesMiss = await prisma.user.upsert({
    where: { phone: "9050000001" },
    update: {},
    create: {
      id: "user-sales-miss",
      name: "Olivia Brown",
      phone: "9050000001",
      passwordHash: await pw("sales123"),
      roles: { create: [{ role: Role.SALES }] },
      campuses: { create: [{ campusId: campusMiss.id }] },
    },
  });
  const teacherMiss = await prisma.user.upsert({
    where: { phone: "9050000002" },
    update: {},
    create: {
      id: "user-teacher-miss",
      name: "James Nguyen",
      phone: "9050000002",
      passwordHash: await pw("teacher123"),
      roles: { create: [{ role: Role.TEACHER }] },
      campuses: { create: [{ campusId: campusMiss.id }] },
    },
  });

  // ── Students ────────────────────────────────────────────────────────────────
  // Markham students
  const s1 = await prisma.student.upsert({
    where: { id: "student-mkm-1" },
    update: {},
    create: {
      id: "student-mkm-1",
      name: "Alex Thompson",
      phone: "6471000001",
      gradeId: g9!.id,
      publicSchool: "Bayview Secondary School",
      salesId: salesMkm.id,
      campusId: campusMarkham.id,
      leadInfo: { create: { source: LeadSource.REFERRAL } },
    },
  });
  const s2 = await prisma.student.upsert({
    where: { id: "student-mkm-2" },
    update: {},
    create: {
      id: "student-mkm-2",
      name: "Chloe Zhang",
      phone: "6471000002",
      gradeId: g11!.id,
      publicSchool: "Markham District High School",
      salesId: salesMkm.id,
      campusId: campusMarkham.id,
    },
  });
  const s3 = await prisma.student.upsert({
    where: { id: "student-mkm-3" },
    update: {},
    create: {
      id: "student-mkm-3",
      name: "Ethan Park",
      phone: "6471000003",
      gradeId: g12!.id,
      publicSchool: "Bill Crothers Secondary School",
      salesId: salesMkm.id,
      campusId: campusMarkham.id,
      leadInfo: { create: { source: LeadSource.AD } },
    },
  });

  // Richmond Hill students
  const s4 = await prisma.student.upsert({
    where: { id: "student-rh-1" },
    update: {},
    create: {
      id: "student-rh-1",
      name: "Sophia Liu",
      phone: "6472000001",
      gradeId: g10!.id,
      publicSchool: "Richmond Hill High School",
      salesId: salesRH.id,
      campusId: campusRH.id,
      leadInfo: { create: { source: LeadSource.REFERRAL } },
    },
  });
  const s5 = await prisma.student.upsert({
    where: { id: "student-rh-2" },
    update: {},
    create: {
      id: "student-rh-2",
      name: "Noah Kim",
      phone: "6472000002",
      gradeId: g11!.id,
      publicSchool: "Alexander Mackenzie High School",
      salesId: salesRH.id,
      campusId: campusRH.id,
    },
  });

  // Scarborough students
  const s6 = await prisma.student.upsert({
    where: { id: "student-scar-1" },
    update: {},
    create: {
      id: "student-scar-1",
      name: "Mia Johnson",
      phone: "6473000001",
      gradeId: g9!.id,
      publicSchool: "Sir Robert Borden Business and Technical Institute",
      salesId: salesScar.id,
      campusId: campusScar.id,
      leadInfo: { create: { source: LeadSource.OUTREACH } },
    },
  });
  const s7 = await prisma.student.upsert({
    where: { id: "student-scar-2" },
    update: {},
    create: {
      id: "student-scar-2",
      name: "Liam Wu",
      phone: "6473000002",
      gradeId: g12!.id,
      publicSchool: "Cedarbrae Collegiate Institute",
      salesId: salesScar.id,
      campusId: campusScar.id,
    },
  });

  // Mississauga students
  const s8 = await prisma.student.upsert({
    where: { id: "student-miss-1" },
    update: {},
    create: {
      id: "student-miss-1",
      name: "Isabella Brown",
      phone: "9051000001",
      gradeId: g10!.id,
      publicSchool: "Mississauga Secondary School",
      salesId: salesMiss.id,
      campusId: campusMiss.id,
      leadInfo: { create: { source: LeadSource.REFERRAL } },
    },
  });
  const s9 = await prisma.student.upsert({
    where: { id: "student-miss-2" },
    update: {},
    create: {
      id: "student-miss-2",
      name: "Lucas Nguyen",
      phone: "9051000002",
      gradeId: g11!.id,
      publicSchool: "Port Credit Secondary School",
      salesId: salesMiss.id,
      campusId: campusMiss.id,
    },
  });

  // ── Course Packages ─────────────────────────────────────────────────────────
  // Markham — ACTIVE packages (enrolled students)
  await prisma.coursePackage.upsert({
    where: { id: "pkg-mkm-1" },
    update: {},
    create: {
      id: "pkg-mkm-1",
      studentId: s2.id,
      gradeId: g11!.id,
      subjectId: subMath!.id,
      totalHours: 20,
      pricePerHour: 80,
      totalAmount: 1600,
      remainingHours: 15,
      status: "ACTIVE",
      createdById: salesMkm.id,
      confirmedById: "user-principal-mkm",
      confirmedAt: new Date("2026-02-10"),
      notes: "Weekly 2h sessions on weekends",
    },
  });
  await prisma.coursePackage.upsert({
    where: { id: "pkg-mkm-2" },
    update: {},
    create: {
      id: "pkg-mkm-2",
      studentId: s3.id,
      gradeId: g12!.id,
      subjectId: subPhysics!.id,
      totalHours: 30,
      pricePerHour: 90,
      totalAmount: 2700,
      remainingHours: 28,
      status: "ACTIVE",
      createdById: salesMkm.id,
      confirmedById: "user-principal-mkm",
      confirmedAt: new Date("2026-02-15"),
    },
  });
  // Markham — PENDING
  await prisma.coursePackage.upsert({
    where: { id: "pkg-mkm-3" },
    update: {},
    create: {
      id: "pkg-mkm-3",
      studentId: s1.id,
      gradeId: g9!.id,
      subjectId: subMath!.id,
      totalHours: 10,
      pricePerHour: 75,
      totalAmount: 750,
      remainingHours: 10,
      status: "PENDING_APPROVAL",
      createdById: salesMkm.id,
    },
  });

  // Richmond Hill — ACTIVE
  await prisma.coursePackage.upsert({
    where: { id: "pkg-rh-1" },
    update: {},
    create: {
      id: "pkg-rh-1",
      studentId: s5.id,
      gradeId: g11!.id,
      subjectId: subChem!.id,
      totalHours: 24,
      pricePerHour: 85,
      totalAmount: 2040,
      remainingHours: 20,
      status: "ACTIVE",
      createdById: salesRH.id,
      confirmedById: "user-principal-rh",
      confirmedAt: new Date("2026-02-20"),
    },
  });
  // Richmond Hill — PENDING
  await prisma.coursePackage.upsert({
    where: { id: "pkg-rh-2" },
    update: {},
    create: {
      id: "pkg-rh-2",
      studentId: s4.id,
      gradeId: g10!.id,
      subjectId: subMath!.id,
      totalHours: 16,
      pricePerHour: 80,
      totalAmount: 1280,
      remainingHours: 16,
      status: "PENDING_APPROVAL",
      createdById: salesRH.id,
    },
  });

  // Scarborough — 已生效且课时耗尽（已结课示例）
  await prisma.coursePackage.upsert({
    where: { id: "pkg-scar-1" },
    update: {},
    create: {
      id: "pkg-scar-1",
      studentId: s7.id,
      gradeId: g12!.id,
      subjectId: subPhysics!.id,
      totalHours: 40,
      pricePerHour: 90,
      totalAmount: 3600,
      remainingHours: 0,
      status: "ACTIVE",
      createdById: salesScar.id,
      confirmedById: "user-finance",
      confirmedAt: new Date("2026-01-15"),
      financeConfirmedById: "user-finance",
      financeConfirmedAt: new Date("2026-01-16"),
      notes: "已结课",
    },
  });
  await prisma.coursePackage.upsert({
    where: { id: "pkg-scar-2" },
    update: {},
    create: {
      id: "pkg-scar-2",
      studentId: s6.id,
      gradeId: g9!.id,
      subjectId: subMath!.id,
      totalHours: 12,
      pricePerHour: 75,
      totalAmount: 900,
      remainingHours: 12,
      status: "PENDING_APPROVAL",
      createdById: salesScar.id,
    },
  });

  // Mississauga — ACTIVE
  await prisma.coursePackage.upsert({
    where: { id: "pkg-miss-1" },
    update: {},
    create: {
      id: "pkg-miss-1",
      studentId: s9.id,
      gradeId: g11!.id,
      subjectId: subMath!.id,
      totalHours: 20,
      pricePerHour: 80,
      totalAmount: 1600,
      remainingHours: 18,
      status: "ACTIVE",
      createdById: salesMiss.id,
      confirmedById: "user-admin",
      confirmedAt: new Date("2026-03-01"),
    },
  });

  // ── Scheduled Lessons ───────────────────────────────────────────────────────
  // Helper: build a Date for a given day offset from 2026-03-27 (today) at a given hour
  const d = (dayOffset: number, hour: number, minute = 0) => {
    const dt = new Date("2026-03-27T00:00:00");
    dt.setDate(dt.getDate() + dayOffset);
    dt.setHours(hour, minute, 0, 0);
    return dt;
  };

  // ── Michael Wang (Markham) — busy schedule this week & next ─────────────────
  // Past: Mon Mar 23 — Chloe Zhang, Math, already confirmed
  const lessonMkm1 = await prisma.scheduledLesson.upsert({
    where: { id: "lesson-mkm-1" },
    update: {},
    create: {
      id: "lesson-mkm-1",
      teacherId: teacherMkm.id, studentId: s2.id,
      packageId: "pkg-mkm-1", classroomId: room101.id,
      startTime: d(-4, 16), endTime: d(-4, 18), lessonType: "ONE_ON_ONE",
    },
  });
  // Log submitted + confirmed for lesson-mkm-1
  const log1 = await prisma.lessonLog.upsert({
    where: { lessonId: "lesson-mkm-1" },
    update: {},
    create: {
      lessonId: "lesson-mkm-1",
      teacherId: teacherMkm.id, subjectId: subMath!.id,
      notes: "Covered quadratic functions. Student did well on practice problems. HW: p.45 Q1-10.",
      submittedAt: d(-4, 18, 30),
      confirmedById: "user-acad-mkm", confirmedAt: d(-3, 10),
    },
  });
  await prisma.courseDeduction.upsert({
    where: { id: "ded-mkm-1" },
    update: {},
    create: {
      id: "ded-mkm-1", packageId: "pkg-mkm-1", logId: log1.id, hoursDeducted: 2,
    },
  });

  // Past: Wed Mar 25 — Ethan Park, Physics, log submitted but not confirmed yet
  const lessonMkm2 = await prisma.scheduledLesson.upsert({
    where: { id: "lesson-mkm-2" },
    update: {},
    create: {
      id: "lesson-mkm-2",
      teacherId: teacherMkm.id, studentId: s3.id,
      packageId: "pkg-mkm-2", classroomId: room101.id,
      startTime: d(-2, 16), endTime: d(-2, 18), lessonType: "ONE_ON_ONE",
    },
  });
  await prisma.lessonLog.upsert({
    where: { lessonId: "lesson-mkm-2" },
    update: {},
    create: {
      lessonId: "lesson-mkm-2",
      teacherId: teacherMkm.id, subjectId: subPhysics!.id,
      notes: "Kinematics review — projectile motion. Student needs more practice on vector components.",
      submittedAt: d(-2, 18, 15),
    },
  });

  // Today: Fri Mar 27 — Chloe Zhang, Math (no log yet)
  await prisma.scheduledLesson.upsert({
    where: { id: "lesson-mkm-3" },
    update: {},
    create: {
      id: "lesson-mkm-3",
      teacherId: teacherMkm.id, studentId: s2.id,
      packageId: "pkg-mkm-1", classroomId: room101.id,
      startTime: d(0, 15), endTime: d(0, 17), lessonType: "ONE_ON_ONE",
    },
  });

  // Upcoming: Mon Mar 30 — Chloe Zhang
  await prisma.scheduledLesson.upsert({
    where: { id: "lesson-mkm-4" },
    update: {},
    create: {
      id: "lesson-mkm-4",
      teacherId: teacherMkm.id, studentId: s2.id,
      packageId: "pkg-mkm-1", classroomId: room101.id,
      startTime: d(3, 16), endTime: d(3, 18), lessonType: "ONE_ON_ONE",
    },
  });

  // Upcoming: Wed Apr 1 — Ethan Park
  await prisma.scheduledLesson.upsert({
    where: { id: "lesson-mkm-5" },
    update: {},
    create: {
      id: "lesson-mkm-5",
      teacherId: teacherMkm.id, studentId: s3.id,
      packageId: "pkg-mkm-2", classroomId: room101.id,
      startTime: d(5, 16), endTime: d(5, 18), lessonType: "ONE_ON_ONE",
    },
  });

  // Upcoming: Sat Apr 4 — Ethan Park (morning slot)
  await prisma.scheduledLesson.upsert({
    where: { id: "lesson-mkm-6" },
    update: {},
    create: {
      id: "lesson-mkm-6",
      teacherId: teacherMkm.id, studentId: s3.id,
      packageId: "pkg-mkm-2", classroomId: room101.id,
      startTime: d(8, 10), endTime: d(8, 12), lessonType: "ONE_ON_ONE",
    },
  });

  // ── Kevin Li (Richmond Hill) ─────────────────────────────────────────────────
  // Past: Tue Mar 24 — Noah Kim, Chemistry, confirmed
  const lessonRH1 = await prisma.scheduledLesson.upsert({
    where: { id: "lesson-rh-1" },
    update: {},
    create: {
      id: "lesson-rh-1",
      teacherId: teacherRH.id, studentId: s5.id,
      packageId: "pkg-rh-1", classroomId: roomRH1.id,
      startTime: d(-3, 17), endTime: d(-3, 19), lessonType: "ONE_ON_ONE",
    },
  });
  const log2 = await prisma.lessonLog.upsert({
    where: { lessonId: "lesson-rh-1" },
    update: {},
    create: {
      lessonId: "lesson-rh-1",
      teacherId: teacherRH.id, subjectId: subChem!.id,
      notes: "Mole calculations and stoichiometry. Student is progressing well.",
      submittedAt: d(-3, 19, 20),
      confirmedById: "user-principal-rh", confirmedAt: d(-2, 9),
    },
  });
  await prisma.courseDeduction.upsert({
    where: { id: "ded-rh-1" },
    update: {},
    create: {
      id: "ded-rh-1", packageId: "pkg-rh-1", logId: log2.id, hoursDeducted: 2,
    },
  });

  // Upcoming: Tue Apr 1 — Noah Kim
  await prisma.scheduledLesson.upsert({
    where: { id: "lesson-rh-2" },
    update: {},
    create: {
      id: "lesson-rh-2",
      teacherId: teacherRH.id, studentId: s5.id,
      packageId: "pkg-rh-1", classroomId: roomRH1.id,
      startTime: d(5, 17), endTime: d(5, 19), lessonType: "ONE_ON_ONE",
    },
  });

  // Upcoming: Thu Apr 3 — Noah Kim
  await prisma.scheduledLesson.upsert({
    where: { id: "lesson-rh-3" },
    update: {},
    create: {
      id: "lesson-rh-3",
      teacherId: teacherRH.id, studentId: s5.id,
      packageId: "pkg-rh-1", classroomId: roomRH1.id,
      startTime: d(7, 17), endTime: d(7, 19), lessonType: "ONE_ON_ONE",
    },
  });

  // ── Robert Chen (Scarborough) ────────────────────────────────────────────────
  // Past: Sat Mar 22 — Liam Wu, Physics, confirmed
  const lessonScar1 = await prisma.scheduledLesson.upsert({
    where: { id: "lesson-scar-1" },
    update: {},
    create: {
      id: "lesson-scar-1",
      teacherId: teacherScar.id, studentId: s7.id,
      packageId: "pkg-scar-1", classroomId: "room-scar-101",
      startTime: d(-5, 14), endTime: d(-5, 16), lessonType: "ONE_ON_ONE",
    },
  });
  const log3 = await prisma.lessonLog.upsert({
    where: { lessonId: "lesson-scar-1" },
    update: {},
    create: {
      lessonId: "lesson-scar-1",
      teacherId: teacherScar.id, subjectId: subPhysics!.id,
      notes: "Energy conservation problems. Reviewed for upcoming exam.",
      submittedAt: d(-5, 16, 30),
      confirmedById: "user-finance", confirmedAt: d(-4, 11),
    },
  });
  await prisma.courseDeduction.upsert({
    where: { id: "ded-scar-1" },
    update: {},
    create: {
      id: "ded-scar-1", packageId: "pkg-scar-1", logId: log3.id, hoursDeducted: 2,
    },
  });

  // This Sat Mar 29 — Liam Wu (no log yet)
  await prisma.scheduledLesson.upsert({
    where: { id: "lesson-scar-2" },
    update: {},
    create: {
      id: "lesson-scar-2",
      teacherId: teacherScar.id, studentId: s7.id,
      packageId: "pkg-scar-1", classroomId: "room-scar-101",
      startTime: d(2, 14), endTime: d(2, 16), lessonType: "ONE_ON_ONE",
    },
  });

  // Upcoming: Sat Apr 5 — Liam Wu
  await prisma.scheduledLesson.upsert({
    where: { id: "lesson-scar-3" },
    update: {},
    create: {
      id: "lesson-scar-3",
      teacherId: teacherScar.id, studentId: s7.id,
      packageId: "pkg-scar-1", classroomId: "room-scar-101",
      startTime: d(9, 14), endTime: d(9, 16), lessonType: "ONE_ON_ONE",
    },
  });

  // ── James Nguyen (Mississauga) ───────────────────────────────────────────────
  // Past: Sun Mar 23 — Lucas Nguyen, Math, log submitted not confirmed
  const lessonMiss1 = await prisma.scheduledLesson.upsert({
    where: { id: "lesson-miss-1" },
    update: {},
    create: {
      id: "lesson-miss-1",
      teacherId: teacherMiss.id, studentId: s9.id,
      packageId: "pkg-miss-1", classroomId: "room-miss-101",
      startTime: d(-4, 14), endTime: d(-4, 16), lessonType: "ONE_ON_ONE",
    },
  });
  await prisma.lessonLog.upsert({
    where: { lessonId: "lesson-miss-1" },
    update: {},
    create: {
      lessonId: "lesson-miss-1",
      teacherId: teacherMiss.id, subjectId: subMath!.id,
      notes: "Trigonometric identities. Student is ahead of schedule.",
      submittedAt: d(-4, 16, 45),
    },
  });

  // Upcoming: Sun Mar 30 — Lucas Nguyen
  await prisma.scheduledLesson.upsert({
    where: { id: "lesson-miss-2" },
    update: {},
    create: {
      id: "lesson-miss-2",
      teacherId: teacherMiss.id, studentId: s9.id,
      packageId: "pkg-miss-1", classroomId: "room-miss-101",
      startTime: d(3, 14), endTime: d(3, 16), lessonType: "ONE_ON_ONE",
    },
  });

  // ── Campaigns（营销活动 / 线索捕获）──────────────────────────────────────────
  await prisma.campaign.upsert({
    where: { id: "camp-mkm-expo" },
    update: {},
    create: {
      id: "camp-mkm-expo",
      name: "Markham 数学教育展 2026",
      sourceCategory: "OFFLINE_EVENT",
      sourceDetail: "Markham Math Expo 2026",
      campusId: campusMarkham.id,
      defaultOwnerId: salesMkm.id,
      active: true,
      token: "mkm-expo-2026",
    },
  });
  await prisma.campaign.upsert({
    where: { id: "camp-mkm-red" },
    update: {},
    create: {
      id: "camp-mkm-red",
      name: "小红书引流 · Markham",
      sourceCategory: "ONLINE_CHANNEL",
      sourceDetail: "小红书",
      campusId: campusMarkham.id,
      // 无默认负责人：走校区内轮询分配
      active: true,
      token: "mkm-red",
    },
  });

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log("✅ Seed complete");
  console.log("\n📋 Campuses: Markham | Richmond Hill | Scarborough | Mississauga");
  console.log("\n👤 Test accounts:");
  console.log("  [All campuses]  Super Admin:  6470000000 / admin123");
  console.log("  [All campuses]  Finance:      6470000005 / finance123");
  console.log("  [Markham]       Sales:        6470000001 / sales123");
  console.log("  [Markham]       Teacher:      6470000002 / teacher123");
  console.log("  [Markham]       Principal:    6470000003 / principal123");
  console.log("  [Markham]       Acad Admin:   6470000004 / acad123");
  console.log("  [Markham]       学管:         6470000011 / sm123");
  console.log("  [Richmond Hill] 学管:         6470000012 / sm123");
  console.log("  [Richmond Hill] Sales:        6470000006 / sales123");
  console.log("  [Richmond Hill] Teacher:      6470000007 / teacher123");
  console.log("  [Richmond Hill] Principal:    6470000008 / principal123");
  console.log("  [Scarborough]   Sales:        6470000009 / sales123");
  console.log("  [Scarborough]   Teacher:      6470000010 / teacher123");
  console.log("  [Mississauga]   Sales:        9050000001 / sales123");
  console.log("  [Mississauga]   Teacher:      9050000002 / teacher123");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
