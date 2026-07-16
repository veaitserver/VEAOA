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

export function canCreatePackage(user: SessionUser | null | undefined): boolean {
  return hasRole(user, Role.SALES, Role.PRINCIPAL, Role.SUPER_ADMIN);
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
