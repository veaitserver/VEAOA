"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { formatMoney, formatRate } from "@/lib/utils";

type Package = {
  id: string; status: string; totalHours: string; remainingHours: string;
  pricePerHour: string; totalAmount: string; createdAt: string;
  student: { id: string; name: string };
  grade: { name: string }; subject: { name: string };
  creator: { name: string }; confirmer: { name: string } | null;
  deductions: { hoursDeducted: string }[];
};

const STATUS_LABELS: Record<string, string> = {
  PENDING_APPROVAL: "待校长确认", PENDING_FINANCE: "待财务确认", ACTIVE: "已生效", FINANCE_LOCK: "财务锁定",
};
const STATUS_COLORS: Record<string, string> = {
  PENDING_APPROVAL: "bg-yellow-100 text-yellow-700",
  PENDING_FINANCE: "bg-orange-100 text-orange-700",
  ACTIVE: "bg-green-100 text-green-700",
  FINANCE_LOCK: "bg-red-100 text-red-700",
};

export default function PackagesPage() {
  const [packages, setPackages] = useState<Package[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const params = filter ? `?status=${filter}` : "";
    const res = await fetch(`/api/packages${params}`);
    if (res.ok) setPackages(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, [filter]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">课包管理</h1>
        <Link href="/packages/new" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
          + 新建课包
        </Link>
      </div>

      <div className="flex gap-2">
        {[["", "全部"], ["PENDING_APPROVAL", "待校长确认"], ["PENDING_FINANCE", "待财务确认"], ["ACTIVE", "已生效"], ["FINANCE_LOCK", "财务锁定"]].map(([val, label]) => (
          <button key={val} onClick={() => setFilter(val)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${filter === val ? "bg-blue-600 text-white border-blue-600" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">学生</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">课包</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">课时/单价/总额</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">剩余</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">状态</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">创建人</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-sm">加载中...</td></tr>}
            {!loading && packages.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-sm">暂无课包</td></tr>}
            {packages.map(p => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm font-medium text-slate-800">
                  <Link href={`/students/${p.student.id}`} className="hover:text-blue-600">{p.student.name}</Link>
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">{p.grade.name} · {p.subject.name}</td>
                <td className="px-4 py-3 text-sm text-slate-500 font-mono text-xs">
                  {Number(p.totalHours).toFixed(1)}h × {formatRate(p.pricePerHour)} = {formatMoney(p.totalAmount)}
                </td>
                <td className="px-4 py-3 text-sm text-slate-800">{Number(p.remainingHours).toFixed(1)}h</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[p.status]}`}>{STATUS_LABELS[p.status]}</span>
                </td>
                <td className="px-4 py-3 text-sm text-slate-500">{p.creator.name}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/packages/${p.id}`} className="text-blue-600 text-sm hover:underline">详情</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
