import type { Prisma } from "@prisma/client";

/**
 * 用户对外字段白名单。
 *
 * 必须用 select 而不是 include —— include 会把 model 上所有标量字段一并返回，
 * 其中包含 passwordHash。凡是把 User 发给客户端的地方都要走这个常量。
 */
export const userSelect = {
  id: true,
  name: true,
  phone: true,
  isActive: true,
  createdAt: true,
  roles: true,
  campuses: { include: { campus: true } },
} satisfies Prisma.UserSelect;
