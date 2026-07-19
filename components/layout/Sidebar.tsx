"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import type { Role } from "@/lib/enums";
import {
  canManageLeads,
  canManageCampaigns,
  canManageUsers,
  canViewPackages,
  canViewSalesReport,
  canViewTeacherReport,
  isSuperAdmin,
  type SessionUser,
} from "@/lib/permissions";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  /** 与接口共用 lib/permissions 里的同一个函数，避免导航和接口各说各话。 */
  can?: (user: SessionUser) => boolean;
};

type NavGroup = { title?: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  { items: [{ href: "/dashboard", label: "仪表盘", icon: "🏠" }] },
  {
    title: "市场与销售",
    items: [
      { href: "/leads", label: "线索客户管理", icon: "🎯", can: canManageLeads },
      { href: "/admin/campaigns", label: "营销活动", icon: "📣", can: canManageCampaigns },
    ],
  },
  {
    title: "学生与课时管理",
    items: [
      { href: "/students", label: "学生管理", icon: "👨‍🎓" },
      { href: "/packages", label: "课包管理", icon: "📦", can: canViewPackages },
      { href: "/schedule", label: "排课", icon: "📅" },
      { href: "/lessons", label: "核销管理", icon: "✅" },
    ],
  },
  {
    title: "报表系统",
    items: [
      { href: "/reports/sales", label: "销售报表", icon: "📊", can: canViewSalesReport },
      { href: "/reports/teachers", label: "工时报表", icon: "⏱️", can: canViewTeacherReport },
    ],
  },
  {
    title: "系统管理",
    items: [
      { href: "/admin/campuses", label: "校区与教室", icon: "🏫", can: isSuperAdmin },
      { href: "/admin/users", label: "用户管理", icon: "👥", can: canManageUsers },
    ],
  },
];

export default function Sidebar({ userRoles }: { userRoles: Role[] }) {
  const pathname = usePathname();

  // 导航只按角色显隐，campusIds/id/name 与判断无关。
  const asUser: SessionUser = { id: "", name: "", roles: userRoles, campusIds: [] };
  const groups = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((item) => !item.can || item.can(asUser)) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col h-full w-60 bg-slate-800 text-slate-200">
      <div className="px-6 py-5 border-b border-slate-700">
        <h1 className="text-white font-bold text-lg">VEA EMS</h1>
        <p className="text-slate-400 text-xs mt-0.5">教务管理系统</p>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-4 overflow-y-auto">
        {groups.map((group, gi) => (
          <div key={group.title ?? gi} className="space-y-1">
            {group.title && (
              <p className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{group.title}</p>
            )}
            {group.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    active ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-700 hover:text-white"
                  }`}
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="px-3 py-4 border-t border-slate-700">
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
        >
          <span>🚪</span>
          <span>退出登录</span>
        </button>
      </div>
    </div>
  );
}
