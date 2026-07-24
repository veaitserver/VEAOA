import { prisma } from "./prisma";
import type { Role } from "./enums";

/**
 * 分配校验：目标用户必须在职、具备指定角色、且校区覆盖目标学生所在校区。
 * 归属销售/学管都用它，避免把学生指给非销售/别校区用户，导致学生从各视图“消失”。
 */
export async function isAssignableUser(
  userId: string,
  role: Role,
  campusId: string,
): Promise<boolean> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true, roles: { select: { role: true } }, campuses: { select: { campusId: true } } },
  });
  return !!u && u.isActive
    && u.roles.some((r) => r.role === role)
    && u.campuses.some((c) => c.campusId === campusId);
}
