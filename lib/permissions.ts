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

export function canSubmitLog(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.TEACHER, Role.SUPER_ADMIN);
}

export function canConfirmLog(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.ACADEMIC_ADMIN, Role.PRINCIPAL, Role.SUPER_ADMIN);
}

export function canReverseDeduction(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.FINANCE, Role.SUPER_ADMIN);
}

export function canSchedule(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.TEACHER, Role.ACADEMIC_ADMIN, Role.PRINCIPAL, Role.SUPER_ADMIN);
}

// ── 页面/报表的可见性 ────────────────────────────────────────────────────────
// Sidebar 原先自带一张角色表来决定显示哪些导航项，但接口侧完全不校验，
// 那张表纯属化妆品。现在两边共用下面这几个函数，避免第二份事实来源。

export function canViewPackages(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.SALES, Role.PRINCIPAL, Role.FINANCE, Role.SUPER_ADMIN);
}

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
 * 课包列表的归属收敛（下推到 where.student）：
 * 管理层/教务看全校区；销售看自己名下；学管看自己负责的学生。
 */
export function packageOwnerScope(
  user: SessionUser,
): { salesId: string } | { studentManagerId: string } | undefined {
  if (hasRole(user, Role.PRINCIPAL, Role.FINANCE, Role.SUPER_ADMIN, Role.ACADEMIC_ADMIN)) return undefined;
  if (hasRole(user, Role.SALES)) return { salesId: user.id };
  if (hasRole(user, Role.STUDENT_MANAGER)) return { studentManagerId: user.id };
  return { salesId: "__none__" }; // 兜底：其余角色查不到任何课包
}

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
