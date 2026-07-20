"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { formatPhone } from "@/lib/utils";
import { sourceShort, stageLabel, STAGE_COLORS, CONTACT_APP_LABELS, type LeadInfo } from "@/lib/leadLabels";
import Pagination from "@/components/Pagination";

type Lead = {
  id: string; name: string; phone: string; stage: string;
  campusId: string;
  grade: { name: string } | null; campus: { name: string };
  sales: { name: string } | null;
  preferredContactApp?: string | null; contactAppId?: string | null;
  leadInfo: (LeadInfo & { source: string }) | null;
  createdAt: string;
};

type SalesOption = { id: string; name: string };

const STATUS_TABS = [
  ["all", "全部"], ["NEW", "新线索"], ["CONTACTED", "已联系"], ["LOST", "已流失"],
] as const;

export default function LeadsPage() {
  const { data: session } = useSession();
  const roles: string[] = (session?.user as { roles?: string[] })?.roles ?? [];
  const canAssign = roles.some((r) => ["PRINCIPAL", "SUPER_ADMIN"].includes(r));

  const [leads, setLeads] = useState<Lead[]>([]);
  const [statusTab, setStatusTab] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // 批量分配：选中集合、目标销售、可选销售列表
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [salesOptions, setSalesOptions] = useState<SalesOption[]>([]);
  const [assignSalesId, setAssignSalesId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ status: "lead", page: String(page) });
    if (search) params.set("search", search);
    if (statusTab !== "all") params.set("leadStatus", statusTab);
    const res = await fetch(`/api/students?${params}`);
    if (res.ok) {
      const d = await res.json();
      setLeads(d.items); setTotal(d.total); setTotalPages(d.totalPages);
    }
    setLoading(false);
  }, [search, statusTab, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, statusTab]);
  // 翻页/筛选/重载后清空选择，避免误分配到已不在视图里的线索。
  useEffect(() => { setSelected(new Set()); setAssignError(""); }, [page, search, statusTab, leads]);

  const visible = leads;

  // 选中线索所属的校区集合：批量分配要求同一校区（销售按校区分配）。
  const selectedCampuses = useMemo(() => {
    const set = new Set<string>();
    for (const l of leads) if (selected.has(l.id)) set.add(l.campusId);
    return set;
  }, [leads, selected]);
  const singleCampusId = selectedCampuses.size === 1 ? [...selectedCampuses][0] : null;

  // 选定单一校区后，拉该校区的销售供分配下拉。
  useEffect(() => {
    if (!canAssign || !singleCampusId) { setSalesOptions([]); setAssignSalesId(""); return; }
    fetch(`/api/campaigns/sales?campusId=${singleCampusId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setSalesOptions)
      .catch(() => setSalesOptions([]));
    setAssignSalesId("");
  }, [canAssign, singleCampusId]);

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => (prev.size === visible.length ? new Set() : new Set(visible.map((l) => l.id))));
  }

  async function handleAssign() {
    if (!assignSalesId || selected.size === 0) return;
    setAssigning(true); setAssignError("");
    const res = await fetch("/api/leads/assign", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentIds: [...selected], salesId: assignSalesId }),
    });
    setAssigning(false);
    if (res.ok) { setSelected(new Set()); load(); }
    else { setAssignError((await res.json()).error ?? "分配失败"); }
  }

  const colCount = canAssign ? 9 : 8;

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

      {/* 批量分配栏：仅校长/超管可见，选中线索后出现 */}
      {canAssign && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
          <span className="text-sm font-medium text-slate-700">已选 {selected.size} 条</span>
          {singleCampusId ? (
            <>
              <span className="text-sm text-slate-400">→</span>
              <select value={assignSalesId} onChange={(e) => setAssignSalesId(e.target.value)}
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">选择销售</option>
                {salesOptions.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <button onClick={handleAssign} disabled={!assignSalesId || assigning}
                className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {assigning ? "分配中..." : "分配"}
              </button>
            </>
          ) : (
            <span className="text-sm text-amber-600">所选线索跨多个校区，请只选同一校区的线索再分配</span>
          )}
          <button onClick={() => setSelected(new Set())} className="text-sm text-slate-500 hover:text-slate-700">清除</button>
          {assignError && <span className="text-sm text-red-600">{assignError}</span>}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {canAssign && (
                <th className="px-4 py-3 w-10">
                  <input type="checkbox" aria-label="全选"
                    checked={visible.length > 0 && selected.size === visible.length}
                    onChange={toggleAll} className="rounded border-slate-300" />
                </th>
              )}
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
            {loading && <tr><td colSpan={colCount} className="px-6 py-8 text-center text-slate-400 text-sm">加载中...</td></tr>}
            {!loading && visible.length === 0 && <tr><td colSpan={colCount} className="px-6 py-8 text-center text-slate-400 text-sm">暂无线索</td></tr>}
            {visible.map((l) => (
              <tr key={l.id} className={`hover:bg-slate-50 ${selected.has(l.id) ? "bg-blue-50/50" : ""}`}>
                {canAssign && (
                  <td className="px-4 py-3">
                    <input type="checkbox" aria-label={`选择 ${l.name}`}
                      checked={selected.has(l.id)} onChange={() => toggleOne(l.id)}
                      className="rounded border-slate-300" />
                  </td>
                )}
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
      <Pagination page={page} totalPages={totalPages} total={total} onChange={setPage} />
    </div>
  );
}
