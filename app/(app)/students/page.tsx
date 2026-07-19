"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { formatPhone } from "@/lib/utils";
import { sourceShort, stageLabel, STAGE_COLORS, type LeadInfo } from "@/lib/leadLabels";

type Student = {
  id: string; name: string; phone: string; stage: string;
  grade: { name: string } | null; campus: { name: string };
  sales: { name: string } | null;
  leadInfo: (LeadInfo & { source: string }) | null;
  createdAt: string;
};

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  // 学生管理只看已转化的在读学生；未转化的线索在「线索客户管理」。
  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ status: "enrolled" });
    if (search) params.set("search", search);
    const res = await fetch(`/api/students?${params}`);
    if (res.ok) setStudents(await res.json());
    setLoading(false);
  }, [search]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">学生管理</h1>
        <Link href="/leads" className="text-sm text-blue-600 hover:underline">线索客户管理 →</Link>
      </div>

      {/* Search */}
      <div className="flex gap-3">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="搜索姓名或手机号..."
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button onClick={load} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm hover:bg-slate-200">搜索</button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">姓名</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">手机号</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">年级</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">校区</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">归属销售</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">来源</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">状态</th>
              <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={8} className="px-6 py-8 text-center text-slate-400 text-sm">加载中...</td></tr>
            )}
            {!loading && students.length === 0 && (
              <tr><td colSpan={8} className="px-6 py-8 text-center text-slate-400 text-sm">暂无学生</td></tr>
            )}
            {students.map(s => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="px-6 py-3 text-sm font-medium text-slate-800">{s.name}</td>
                <td className="px-6 py-3 text-sm text-slate-500">{formatPhone(s.phone)}</td>
                <td className="px-6 py-3 text-sm text-slate-500">{s.grade?.name ?? "待定"}</td>
                <td className="px-6 py-3 text-sm text-slate-500">{s.campus.name}</td>
                <td className="px-6 py-3 text-sm text-slate-500">{s.sales?.name ?? "—"}</td>
                <td className="px-6 py-3 text-sm text-slate-500">
                  {sourceShort(s.leadInfo)}
                </td>
                <td className="px-6 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_COLORS[s.stage] ?? "bg-slate-100 text-slate-500"}`}>
                    {stageLabel(s.stage)}
                  </span>
                </td>
                <td className="px-6 py-3 text-right">
                  <Link href={`/students/${s.id}`} className="text-blue-600 text-sm hover:underline">详情</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
