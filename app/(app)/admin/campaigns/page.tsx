"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type Campus = { id: string; name: string };
type Sales = { id: string; name: string };
type Campaign = {
  id: string; name: string; sourceCategory: string; sourceDetail: string;
  active: boolean; token: string;
  campus: { name: string }; defaultOwner: { name: string } | null;
  _count: { leads: number };
};

const SOURCE_CATEGORIES = [
  { value: "OFFLINE_EVENT", label: "线下活动" },
  { value: "ONLINE_CHANNEL", label: "线上渠道" },
  { value: "REFERRAL", label: "转介绍" },
  { value: "OTHER", label: "其他" },
];
const SOURCE_LABEL: Record<string, string> = Object.fromEntries(SOURCE_CATEGORIES.map((s) => [s.value, s.label]));

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [salesUsers, setSalesUsers] = useState<Sales[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "", sourceCategory: "OFFLINE_EVENT", sourceDetail: "", campusId: "", defaultOwnerId: "",
  });

  const load = useCallback(async () => {
    const [c, cam] = await Promise.all([
      fetch("/api/campaigns").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/admin/campuses").then((r) => (r.ok ? r.json() : [])),
    ]);
    setCampaigns(c);
    setCampuses(cam);
    // 默认选中唯一校区
    if (cam.length === 1) setForm((f) => ({ ...f, campusId: cam[0].id }));
  }, []);

  useEffect(() => { load(); }, [load]);

  // 选了校区后加载该校区活跃销售（默认负责人下拉）
  useEffect(() => {
    if (!form.campusId) { setSalesUsers([]); return; }
    fetch(`/api/campaigns/sales?campusId=${form.campusId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setSalesUsers);
  }, [form.campusId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, defaultOwnerId: form.defaultOwnerId || null }),
    });
    if (res.ok) {
      setShowForm(false);
      setForm({ name: "", sourceCategory: "OFFLINE_EVENT", sourceDetail: "", campusId: campuses.length === 1 ? campuses[0].id : "", defaultOwnerId: "" });
      load();
    } else {
      setError((await res.json()).error ?? "创建失败");
    }
  }

  async function toggleActive(c: Campaign) {
    await fetch(`/api/campaigns/${c.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !c.active }),
    });
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">营销活动</h1>
        <button onClick={() => setShowForm((s) => !s)} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
          {showForm ? "取消" : "+ 新建活动"}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">活动名称 *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">校区 *</label>
                <select value={form.campusId} onChange={(e) => setForm({ ...form, campusId: e.target.value, defaultOwnerId: "" })} required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">选择校区</option>
                  {campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">来源大类 *</label>
                <select value={form.sourceCategory} onChange={(e) => setForm({ ...form, sourceCategory: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {SOURCE_CATEGORIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">来源明细 *</label>
                <input value={form.sourceDetail} onChange={(e) => setForm({ ...form, sourceDetail: e.target.value })} required
                  placeholder="如 Markham 数学展 2026 / 小红书"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">默认负责人（可选，留空则校区内轮询分配）</label>
              <select value={form.defaultOwnerId} onChange={(e) => setForm({ ...form, defaultOwnerId: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">轮询分配</option>
                {salesUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="flex gap-3 pt-1">
              <button type="submit" className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">创建</button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">活动</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">来源</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">校区</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">负责人</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase">线索数</th>
              <th className="text-center px-5 py-3 text-xs font-semibold text-slate-500 uppercase">状态</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {campaigns.length === 0 && (
              <tr><td colSpan={7} className="px-5 py-8 text-center text-slate-400 text-sm">暂无活动</td></tr>
            )}
            {campaigns.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-5 py-3 text-sm font-medium text-slate-800">
                  <Link href={`/admin/campaigns/${c.id}`} className="hover:text-blue-600">{c.name}</Link>
                </td>
                <td className="px-5 py-3 text-sm text-slate-500">{SOURCE_LABEL[c.sourceCategory] ?? c.sourceCategory} · {c.sourceDetail}</td>
                <td className="px-5 py-3 text-sm text-slate-500">{c.campus.name}</td>
                <td className="px-5 py-3 text-sm text-slate-500">{c.defaultOwner?.name ?? "轮询"}</td>
                <td className="px-5 py-3 text-sm text-slate-700 text-right">{c._count.leads}</td>
                <td className="px-5 py-3 text-center">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                    {c.active ? "启用" : "停用"}
                  </span>
                </td>
                <td className="px-5 py-3 text-right space-x-3">
                  <Link href={`/admin/campaigns/${c.id}`} className="text-blue-600 text-sm hover:underline">详情/报表</Link>
                  <button onClick={() => toggleActive(c)} className="text-slate-500 text-sm hover:underline">{c.active ? "停用" : "启用"}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
