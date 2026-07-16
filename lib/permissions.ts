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
 * canManageUsers 对 HR 和超管一视同仁，但 HR 不该能造出比自己更大的权限。
 * 校验操作者是否有权授予这批 roles/campusIds，返回 null 表示放行。
 */
export function checkUserGrant(
  actor: SessionUser | null | undefined,
  grant: { roles?: Role[]; campusIds?: string[] },
): string | null {
  if (isSuperAdmin(actor)) return null;
  if (grant.roles?.includes(Role.SUPER_ADMIN)) return "仅超管可授予超级管理员角色";
  const outside = grant.campusIds?.filter((c) => !hasCampusAccess(actor, c));
  if (outside?.length) return "不能授予自己无权管理的校区";
  return null;
}

export function canConfirmPackage(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.PRINCIPAL, Role.SUPER_ADMIN);
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

export function canCreatePackage(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.SALES, Role.PRINCIPAL, Role.SUPER_ADMIN);
}

/** 建档、改档、写跟进记录。老师只上课不碰学生档案，财务/HR 同理。 */
export function canManageStudents(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.SALES, Role.ACADEMIC_ADMIN, Role.PRINCIPAL, Role.SUPER_ADMIN);
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

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "超级管理员",
  HR: "HR",
  SALES: "销售",
  TEACHER: "老师",
  ACADEMIC_ADMIN: "教务",
  PRINCIPAL: "校长",
  FINANCE: "财务",
};
