"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { formatPhone } from "@/lib/utils";
import { sourceShort, stageLabel, STAGE_COLORS, CONTACT_APP_LABELS, type LeadInfo } from "@/lib/leadLabels";

type Lead = {
  id: string; name: string; phone: string; stage: string;
  grade: { name: string } | null; campus: { name: string };
  sales: { name: string } | null;
  preferredContactApp?: string | null; contactAppId?: string | null;
  leadInfo: (LeadInfo & { source: string }) | null;
  createdAt: string;
};

const STATUS_TABS = [
  ["all", "全部"], ["NEW", "新线索"], ["CONTACTED", "已联系"], ["LOST", "已流失"],
] as const;

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [statusTab, setStatusTab] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ status: "lead" });
    if (search) params.set("search", search);
    const res = await fetch(`/api/students?${params}`);
    const data: Lead[] = res.ok ? await res.json() : [];
    setLeads(data);
    setLoading(false);
  }, [search]);

  useEffect(() => { load(); }, [load]);

  const visible = leads.filter((l) => statusTab === "all" || l.stage === statusTab);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">线索客户管理</h1>
        <div className="flex gap-2">
          <Link href="/leads/import" className="bg-slate-100 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-200">📥 批量导入</Link>
          <Link href="/leads/new" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">+ 添加线索</Link>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
          {STATUS_TABS.map(([val, label]) => (
            <button key={val} onClick={() => setStatusTab(val)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${statusTab === val ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索姓名或手机号..."
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button onClick={load} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm hover:bg-slate-200">搜索</button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">姓名</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">手机号</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">联系方式</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">校区</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">归属销售</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">来源</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">状态</th>
              <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={8} className="px-6 py-8 text-center text-slate-400 text-sm">加载中...</td></tr>}
            {!loading && visible.length === 0 && <tr><td colSpan={8} className="px-6 py-8 text-center text-slate-400 text-sm">暂无线索</td></tr>}
            {visible.map((l) => (
              <tr key={l.id} className="hover:bg-slate-50">
                <td className="px-6 py-3 text-sm font-medium text-slate-800">{l.name}</td>
                <td className="px-6 py-3 text-sm text-slate-500">{formatPhone(l.phone)}</td>
                <td className="px-6 py-3 text-sm text-slate-500">
                  {l.preferredContactApp
                    ? `${CONTACT_APP_LABELS[l.preferredContactApp] ?? l.preferredContactApp}${l.contactAppId ? " · " + l.contactAppId : ""}`
                    : "—"}
                </td>
                <td className="px-6 py-3 text-sm text-slate-500">{l.campus.name}</td>
                <td className="px-6 py-3 text-sm text-slate-500">{l.sales?.name ?? "—"}</td>
                <td className="px-6 py-3 text-sm text-slate-500">{sourceShort(l.leadInfo)}</td>
                <td className="px-6 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_COLORS[l.stage] ?? "bg-slate-100 text-slate-500"}`}>
                    {stageLabel(l.stage)}
                  </span>
                </td>
                <td className="px-6 py-3 text-right">
                  <Link href={`/students/${l.id}`} className="text-blue-600 text-sm hover:underline">详情</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
