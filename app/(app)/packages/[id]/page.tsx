"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { formatMoney, formatRate, formatDate, formatDateTime } from "@/lib/utils";

type Package = {
  id: string; status: string; totalHours: string; remainingHours: string;
  pricePerHour: string; totalAmount: string; notes?: string; createdAt: string; confirmedAt?: string;
  student: { id: string; name: string };
  grade: { name: string }; subject: { name: string };
  creator: { name: string }; confirmer: { name: string } | null;
  deductions: Deduction[];
  lessons: LessonRef[];
};

type Deduction = {
  id: string; hoursDeducted: string; createdAt: string;
  reversedAt?: string; reverser?: { name: string };
};

type LessonRef = {
  id: string; startTime: string; endTime: string;
  teacher: { name: string }; classroom: { name: string };
};

const STATUS_LABELS: Record<string, string> = { PENDING_APPROVAL: "待确认", ACTIVE: "已激活", FINANCE_LOCK: "财务锁定" };
const STATUS_COLORS: Record<string, string> = {
  PENDING_APPROVAL: "bg-yellow-100 text-yellow-700",
  ACTIVE: "bg-green-100 text-green-700",
  FINANCE_LOCK: "bg-red-100 text-red-700",
};

export default function PackageDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: session } = useSession();
  const [pkg, setPkg] = useState<Package | null>(null);
  const [confirming, setConfirming] = useState(false);

  const userRoles: string[] = (session?.user as { roles: string[] })?.roles ?? [];
  const canConfirm = userRoles.some(r => ["PRINCIPAL", "SUPER_ADMIN"].includes(r));
  const canEdit = userRoles.some(r => ["FINANCE", "SUPER_ADMIN"].includes(r)) ||
    (pkg?.status === "PENDING_APPROVAL" && userRoles.some(r => ["SALES", "PRINCIPAL"].includes(r)));

  async function load() {
    const res = await fetch(`/api/packages/${id}`);
    if (res.ok) setPkg(await res.json());
  }

  useEffect(() => { load(); }, [id]);

  async function handleConfirm() {
    if (!confirm("确认激活该课包？激活后销售和校长将无法修改。")) return;
    setConfirming(true);
    await fetch(`/api/packages/${id}/confirm`, { method: "POST" });
    setConfirming(false);
    load();
  }

  async function handleDelete() {
    if (!confirm("确定删除该课包？")) return;
    await fetch(`/api/packages/${id}`, { method: "DELETE" });
    window.location.href = "/packages";
  }

  if (!pkg) return <div className="text-slate-400 text-sm p-8 text-center">加载中...</div>;

  const usedHours = pkg.deductions
    .filter(d => !d.reversedAt)
    .reduce((s, d) => s + Number(d.hoursDeducted), 0);

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link href="/packages" className="text-slate-400 hover:text-slate-600 text-lg">←</Link>
        <h1 className="text-2xl font-bold text-slate-800">课包详情</h1>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[pkg.status]}`}>
          {STATUS_LABELS[pkg.status]}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Info Card */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
          <h2 className="font-semibold text-slate-700 text-sm">基本信息</h2>
          {[
            ["学生", <Link key="s" href={`/students/${pkg.student.id}`} className="text-blue-600 hover:underline">{pkg.student.name}</Link>],
            ["年级 / 科目", `${pkg.grade.name} · ${pkg.subject.name}`],
            ["创建人", pkg.creator.name],
            ["确认人", pkg.confirmer?.name ?? "—"],
            ["确认时间", pkg.confirmedAt ? formatDateTime(pkg.confirmedAt) : "—"],
            ["创建时间", formatDate(pkg.createdAt)],
          ].map(([label, value]) => (
            <div key={label as string} className="flex justify-between text-sm">
              <span className="text-slate-400">{label}</span>
              <span className="text-slate-800 font-medium">{value}</span>
            </div>
          ))}
        </div>

        {/* Finance Card */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
          <h2 className="font-semibold text-slate-700 text-sm">财务信息</h2>
          <div className="rounded-lg bg-slate-50 p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">总课时</span>
              <span className="font-bold text-slate-800">{Number(pkg.totalHours).toFixed(1)}h</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">课时单价</span>
              <span className="font-bold text-slate-800">{formatRate(pkg.pricePerHour)}</span>
            </div>
            <div className="flex justify-between text-sm border-t border-slate-200 pt-2">
              <span className="text-slate-500">总金额</span>
              <span className="font-bold text-blue-700 text-lg">{formatMoney(pkg.totalAmount)}</span>
            </div>
            <div className="border-t border-slate-200 pt-2 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">已核销</span>
                <span className="text-slate-700">{usedHours.toFixed(1)}h</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">剩余课时</span>
                <span className={`font-bold ${Number(pkg.remainingHours) < 3 ? "text-red-600" : "text-green-700"}`}>
                  {Number(pkg.remainingHours).toFixed(1)}h
                </span>
              </div>
            </div>
          </div>
          {pkg.notes && <p className="text-xs text-slate-500">备注: {pkg.notes}</p>}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        {canConfirm && pkg.status === "PENDING_APPROVAL" && (
          <button onClick={handleConfirm} disabled={confirming}
            className="bg-green-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
            {confirming ? "确认中..." : "✓ 确认激活"}
          </button>
        )}
        {canEdit && pkg.status === "PENDING_APPROVAL" && (
          <button onClick={handleDelete} className="border border-red-300 text-red-600 px-5 py-2 rounded-lg text-sm font-medium hover:bg-red-50">
            删除课包
          </button>
        )}
      </div>

      {/* Deduction History */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="font-semibold text-slate-800">消课流水</h2>
        </div>
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">时间</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">扣除课时</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">状态</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">反核销人</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pkg.deductions.map(d => (
              <tr key={d.id} className="hover:bg-slate-50">
                <td className="px-5 py-3 text-xs text-slate-500">{formatDateTime(d.createdAt)}</td>
                <td className="px-5 py-3 text-sm font-medium text-slate-800">{Number(d.hoursDeducted).toFixed(1)}h</td>
                <td className="px-5 py-3">
                  {d.reversedAt ? (
                    <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">已撤销</span>
                  ) : (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">有效</span>
                  )}
                </td>
                <td className="px-5 py-3 text-sm text-slate-500">{d.reverser?.name ?? "—"}</td>
              </tr>
            ))}
            {pkg.deductions.length === 0 && (
              <tr><td colSpan={4} className="px-5 py-6 text-center text-slate-400 text-sm">暂无消课记录</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
