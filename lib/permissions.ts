import { Role } from "@/lib/enums";

export type SessionUser = {
  id: string;
  name: string;
  phone?: string;
  roles: Role[];
  campusIds: string[];
};

export function hasRole(user: SessionUser | null | undefined, ...roles: Role[]): boolean {
  if (!user) return false;
  return roles.some((r) => user.roles.includes(r));
}

export function isSuperAdmin(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.SUPER_ADMIN);
}

export function hasCampusAccess(user: SessionUser | null | undefined, campusId: string): boolean {
  if (!user) return false;
  if (isSuperAdmin(user)) return true;
  return user.campusIds.includes(campusId);
}

/**
 * 按 id 取到某条资源后，校验它是否属于本人可见的校区。
 * 返回 null 表示放行，否则返回拒绝文案。
 *
 * 列表接口靠 where 条件过滤，但按 id 查的接口没有这层过滤 —— 必须显式调用。
 */
export function denyCrossCampus(
  user: SessionUser | null | undefined,
  campusId: string,
): string | null {
  return hasCampusAccess(user, campusId) ? null : "无权访问其他校区的数据";
}

/**
 * 列表接口的校区过滤条件。
 *
 * requested 是 URL 上传来的 campusId。它必须和本人可见校区「取交集」——
 * 早先的写法是先 where.campusId = {in: 可见校区} 再 if (campusId) where.campusId = campusId，
 * 后者直接覆盖前者，于是任何人加个 ?campusId= 就能读到别的校区。
 *
 * 返回 undefined 表示不加过滤（仅超管且未指定校区时）。
 */
export function campusScope(
  user: SessionUser,
  requested?: string | null,
): { in: string[] } | undefined {
  if (isSuperAdmin(user)) return requested ? { in: [requested] } : undefined;
  // 越权的 requested 会交集成空数组，查不到任何数据，而不是放行。
  return { in: requested ? user.campusIds.filter((c) => c === requested) : user.campusIds };
}

export function canManageUsers(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.SUPER_ADMIN, Role.HR);
}

/**
 * 非超管（HR）可授予的角色白名单：只能授予运营类角色。
 * 校长/财务/HR/超管这类具备审批或人事权的角色只能由超管授予，
 * 否则 HR 能给自己或他人加校长+财务，打穿「校长确认→财务确认」的双人复核。
 */
export const HR_GRANTABLE_ROLES: Role[] = [
  Role.SALES, Role.TEACHER, Role.ACADEMIC_ADMIN, Role.STUDENT_MANAGER,
];

/**
 * canManageUsers 对 HR 和超管一视同仁，但 HR 不该能造出比自己更大的权限。
 * 校验操作者是否有权授予这批 roles/campusIds，返回 null 表示放行。
 */
export function checkUserGrant(
  actor: SessionUser | null | undefined,
  grant: { roles?: Role[]; campusIds?: string[] },
): string | null {
  if (isSuperAdmin(actor)) return null;
  // 白名单校验：黑名单（只挡超管）会漏掉校长/财务/HR，导致自我提权。
  const disallowed = grant.roles?.filter((r) => !HR_GRANTABLE_ROLES.includes(r));
  if (disallowed?.length) return "仅超管可授予校长/财务/HR/超管角色";
  const outside = grant.campusIds?.filter((c) => !hasCampusAccess(actor, c));
  if (outside?.length) return "不能授予自己无权管理的校区";
  return null;
}

/**
 * 非超管操作某用户时，双方是否有共同校区。防止 HR 跨校区改密码/停用/改角色，
 * 从而接管别校区的校长/财务账号。返回 true 表示允许操作该目标。
 */
export function sharesCampusWith(
  actor: SessionUser | null | undefined,
  targetCampusIds: string[],
): boolean {
  if (isSuperAdmin(actor)) return true;
  if (!actor) return false;
  return targetCampusIds.some((c) => actor.campusIds.includes(c));
}

export function canConfirmPackage(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.PRINCIPAL, Role.SUPER_ADMIN);
}

/** 财务二次确认课包（校长确认后 → 正式生效）。 */
export function canFinanceConfirmPackage(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.FINANCE, Role.SUPER_ADMIN);
}


export function canEditActivePackage(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.FINANCE, Role.SUPER_ADMIN);
}

/**
 * 待审批课包的修改/删除权限。
 *
 * 原先的守卫是 `if (status !== PENDING_APPROVAL && !canEditActivePackage(u))`，
 * 状态为待审批时整个角色检查被短路，任何登录用户都能改价删单。
 */
export function canEditPendingPackage(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.SALES, Role.PRINCIPAL, Role.FINANCE, Role.SUPER_ADMIN);
}

/** 谁有资格进入建课包流程；具体新签/续费再按 canCreateNewSignPackage/canCreateRenewalPackage 细分。 */
export function canCreatePackage(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.SALES, Role.STUDENT_MANAGER, Role.PRINCIPAL, Role.SUPER_ADMIN);
}

/** 新签（学生首张课包）：销售从线索成交、或校长/超管。学管不建新签。 */
export function canCreateNewSignPackage(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.SALES, Role.PRINCIPAL, Role.SUPER_ADMIN);
}

/**
 * 续费（学生已有课包后的后续课包）：由该生被分配的学管负责；校长/超管可兜底。
 * 销售在学生首签后不能再建课包。
 */
export function canCreateRenewalPackage(
  user: SessionUser | null | undefined,
  studentManagerId: string | null | undefined,
): boolean {
  if (hasRole(user, Role.PRINCIPAL, Role.SUPER_ADMIN)) return true;
  return hasRole(user, Role.STUDENT_MANAGER) && !!studentManagerId && user?.id === studentManagerId;
}

/** 建档、改档、写跟进记录。老师只上课不碰学生档案，财务/HR 同理。 */
export function canManageStudents(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.SALES, Role.ACADEMIC_ADMIN, Role.PRINCIPAL, Role.SUPER_ADMIN);
}

// ── 线索归属隔离 ─────────────────────────────────────────────────────────────
/** 管理层看全校区（校长/教务/财务/学管/超管）；销售只看分配给自己的线索。 */
export function seesCampusWide(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.ACADEMIC_ADMIN, Role.PRINCIPAL, Role.FINANCE, Role.STUDENT_MANAGER, Role.SUPER_ADMIN);
}

/** 分配学管只限校长与超管（确认课包时一并分配）。 */
export function canAssignStudentManager(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.PRINCIPAL, Role.SUPER_ADMIN);
}

/** 分配/改归属销售只限校长与超管。 */
export function canAssignLeadOwner(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.PRINCIPAL, Role.SUPER_ADMIN);
}

/** 列表按归属过滤：销售 → 仅自己名下；管理层 → 不加此过滤（仍受校区限制）。 */
export function ownerFilter(user: SessionUser): { salesId: string } | undefined {
  if (!user || seesCampusWide(user)) return undefined;
  return { salesId: user.id };
}

/** 按 id 取到记录后，校验归属：非管理层的销售只能碰自己的。返回 null 放行。 */
export function denyNotOwner(user: SessionUser, ownerId: string | null | undefined): string | null {
  if (seesCampusWide(user)) return null;
  return ownerId === user.id ? null : "只能操作分配给自己的线索";
}

// ── 学生数据的归属收敛 ───────────────────────────────────────────────────────
// 上面那对 ownerFilter/denyNotOwner 只认 salesId，而 seesCampusWide 把学管
// 算进了「管理层」，于是学管在学生档案、账本、核销上完全不受归属限制，
// 本校区谁的学生都看得到。下面这对按「销售看自己名下、学管看自己负责」收敛，
// 是学生相关接口的唯一事实来源。

/** 不受归属限制的角色：校长/财务/超管看全盘，教务要排课也得看到全校区学生。 */
function seesAllStudents(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.PRINCIPAL, Role.FINANCE, Role.SUPER_ADMIN, Role.ACADEMIC_ADMIN);
}

/**
 * 列表侧的归属条件，可直接下推到 where.student（或学生表自身的 where）。
 * undefined = 不加限制。身兼销售与学管的人取并集，不会因为角色判断的先后顺序丢数据。
 */
export function studentOwnerScope(
  user: SessionUser,
): { salesId: string } | { studentManagerId: string } | { OR: object[] } | undefined {
  if (seesAllStudents(user)) return undefined;
  const clauses: object[] = [];
  if (hasRole(user, Role.SALES)) clauses.push({ salesId: user.id });
  if (hasRole(user, Role.STUDENT_MANAGER)) clauses.push({ studentManagerId: user.id });
  // 其余角色（老师/HR）与学生归属无关，一律查不到。
  if (!clauses.length) return { salesId: "__none__" };
  return clauses.length === 1
    ? (clauses[0] as { salesId: string } | { studentManagerId: string })
    : { OR: clauses };
}

/** 按 id 取到学生后的归属校验。返回 null 放行。 */
export function denyNotMyStudent(
  user: SessionUser,
  student: { salesId: string | null; studentManagerId: string | null },
): string | null {
  return canSeePackageOfStudent(user, student) ? null : "只能查看分配给自己的学生";
}

// ── 账本与退费 ───────────────────────────────────────────────────────────────
/** 查看学生账户流水（涉及金额）：与课包金额同一批人，教务/老师看不到。 */
export function canViewLedger(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.SALES, Role.PRINCIPAL, Role.FINANCE, Role.SUPER_ADMIN, Role.STUDENT_MANAGER);
}

/** 发起退费：学管负责学生后续，由其发起；校长/超管可代发起。 */
export function canCreateRefund(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.STUDENT_MANAGER, Role.PRINCIPAL, Role.SUPER_ADMIN);
}

/** 退费第一步审核：校长。 */
export function canApproveRefund(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.PRINCIPAL, Role.SUPER_ADMIN);
}

/** 退费第二步复核并实际打款：财务。钱的动作归财务，与课包财务确认一致。 */
export function canPayRefund(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.FINANCE, Role.SUPER_ADMIN);
}

// ── 班课 ────────────────────────────────────────────────────────────────────
/** 建班、改班、加/移成员、给班级排课：教务与管理层。 */
export function canManageGroupClass(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.ACADEMIC_ADMIN, Role.PRINCIPAL, Role.SUPER_ADMIN);
}

/** 查看班级：管理层/教务/学管/销售都要看得到自己学生在哪个班；老师看自己带的班。 */
export function canViewGroupClass(user: SessionUser | null | undefined): boolean {
  return hasRole(
    user, Role.ACADEMIC_ADMIN, Role.PRINCIPAL, Role.SUPER_ADMIN,
    Role.STUDENT_MANAGER, Role.SALES, Role.TEACHER, Role.FINANCE,
  );
}

export function canSubmitLog(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.TEACHER, Role.SUPER_ADMIN);
}

export function canConfirmLog(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.ACADEMIC_ADMIN, Role.PRINCIPAL, Role.SUPER_ADMIN);
}

/**
 * 核销管理（谁上了课、扣了多少课时）。
 *
 * 销售不在其中 —— 成交之后的履约不归销售管，让销售看到全校区谁在上课
 * 也没有业务理由。老师看自己的课，学管看自己负责的学生（下推 studentOwnerScope）。
 */
export function canViewLessons(user: SessionUser | null | undefined): boolean {
  return hasRole(
    user, Role.TEACHER, Role.ACADEMIC_ADMIN, Role.PRINCIPAL,
    Role.FINANCE, Role.SUPER_ADMIN, Role.STUDENT_MANAGER,
  );
}

export function canReverseDeduction(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.FINANCE, Role.SUPER_ADMIN);
}

/**
 * 排课 / 改期 / 删课 —— 教务的活。
 *
 * 老师**不在**这里：曾经在，结果老师 A 能往老师 B 的课表塞课、也能删掉 B 的课，
 * 还能消耗任意学生的课包课时（validateTargets 只校验被排的老师是本校区在职老师，
 * 从不比对操作者自己）。老师只写日志、看自己的课表。
 */
export function canSchedule(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.ACADEMIC_ADMIN, Role.PRINCIPAL, Role.SUPER_ADMIN);
}

/** 谁能打开课表页：排课的人 + 老师（老师只读，且只看得到自己那一列）。 */
export function canViewSchedule(user: SessionUser | null | undefined): boolean {
  return canSchedule(user) || hasRole(user, Role.TEACHER);
}

/**
 * 「只看自己带的课」这一维。课表和核销共用。
 *
 * 只对**纯老师**生效：兼任教务/校长的老师要看全校区，财务/学管压根不是老师，
 * 给他们套上 teacherId 会把列表筛成空。这里只管老师这一维，
 * 「能不能访问这个接口」由各接口自己的角色门负责。
 */
export function ownScheduleScope(user: SessionUser): { teacherId: string } | undefined {
  if (canSchedule(user)) return undefined;
  if (!hasRole(user, Role.TEACHER)) return undefined;
  return { teacherId: user.id };
}

// ── 页面/报表的可见性 ────────────────────────────────────────────────────────
// Sidebar 原先自带一张角色表来决定显示哪些导航项，但接口侧完全不校验，
// 那张表纯属化妆品。现在两边共用下面这几个函数，避免第二份事实来源。

/**
 * @deprecated 用 canAccessPackages —— 导航曾用这个、接口用 canAccessPackages，
 * 两份名单不一致：学管负责续费却看不到「课包管理」入口。已并成一处。
 */
export const canViewPackages = canAccessPackages;

// ── 课包接口的访问与可见性 ────────────────────────────────────────────────────
/**
 * 谁能访问课包接口（列表/详情）：
 * 销售/校长/财务/超管 + 学管(负责的学生续费) + 教务(排课要选课包)。
 * 老师/HR 无权（老师此前能拿到 packageId 直接读全量财务，属越权信息泄露）。
 */
export function canAccessPackages(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.SALES, Role.PRINCIPAL, Role.FINANCE, Role.SUPER_ADMIN, Role.STUDENT_MANAGER, Role.ACADEMIC_ADMIN);
}

/** 谁能看到课包金额（单价/总额）：教务只排课、看不到钱。 */
export function canViewPackageFinancials(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.SALES, Role.PRINCIPAL, Role.FINANCE, Role.SUPER_ADMIN, Role.STUDENT_MANAGER);
}

/**
 * 课包列表的归属收敛（下推到 where.student）。
 * 与学生档案/账本/核销共用同一套判断，避免几处各写一份逐渐走样。
 */
export const packageOwnerScope = studentOwnerScope;

/** 按 id 取到课包后，校验能否查看该学生的课包。管理层/教务放行(校区已单独校验)。 */
export function canSeePackageOfStudent(
  user: SessionUser,
  student: { salesId: string | null; studentManagerId: string | null },
): boolean {
  if (hasRole(user, Role.PRINCIPAL, Role.FINANCE, Role.SUPER_ADMIN, Role.ACADEMIC_ADMIN)) return true;
  if (hasRole(user, Role.SALES) && student.salesId === user.id) return true;
  if (hasRole(user, Role.STUDENT_MANAGER) && student.studentManagerId === user.id) return true;
  return false;
}

export function canViewSalesReport(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.SALES, Role.PRINCIPAL, Role.FINANCE, Role.SUPER_ADMIN);
}

export function canViewTeacherReport(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.TEACHER, Role.ACADEMIC_ADMIN, Role.PRINCIPAL, Role.FINANCE, Role.SUPER_ADMIN);
}

/**
 * 剩余课时负债报表：这是财务口径的钱（预收未消耗），
 * 只给财务/校长/超管看。销售、学管看到全校区负债没有意义，也涉及别人的业绩。
 */
export function canViewLiabilityReport(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.FINANCE, Role.PRINCIPAL, Role.SUPER_ADMIN);
}

// 营销活动由校区校长管理（导入线索的正是校长），超管全权。
export function canManageCampaigns(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.PRINCIPAL, Role.SUPER_ADMIN);
}

// 线索客户管理（列表/添加/批量导入）：市场与销售都能上传，含校长/超管。
// 校区取自操作者（多校区时前端弹选）。
export function canManageLeads(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.SALES, Role.PRINCIPAL, Role.SUPER_ADMIN);
}
/** @deprecated 用 canManageLeads */
export const canImportLeads = canManageLeads;

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "超级管理员",
  HR: "HR",
  SALES: "销售",
  TEACHER: "老师",
  ACADEMIC_ADMIN: "教务",
  PRINCIPAL: "校长",
  FINANCE: "财务",
  STUDENT_MANAGER: "学管",
};
