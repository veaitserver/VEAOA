"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { formatMoney, formatRate, formatDateTime } from "@/lib/utils";
import { REFUND_STATUS_LABELS } from "@/lib/enums";
import Pagination from "@/components/Pagination";

type Refund = {
  id: string; hours: number; pricePerHour: number; amount: number;
  status: string; reason?: string | null; createdAt: string;
  rejectReason?: string | null;
  student: { id: string; name: string };
  package: { id: string; grade: { name: string }; subject: { name: string } };
  creator: { name: string };
  approver?: { name: string } | null;
  payer?: { name: string } | null;
};

const STATUS_COLORS: Record<string, string> = {
  PENDING_APPROVAL: "bg-yellow-100 text-yellow-700",
  PENDING_FINANCE: "bg-orange-100 text-orange-700",
  PAID: "bg-green-100 text-green-700",
  REJECTED: "bg-slate-100 text-slate-500",
};

const TABS = [
  ["", "全部"], ["PENDING_APPROVAL", "待校长审核"], ["PENDING_FINANCE", "待财务打款"],
  ["PAID", "已退款"], ["REJECTED", "已驳回"],
] as const;

export default function RefundsPage() {
  const { data: session } = useSession();
  const roles: string[] = (session?.user as { roles?: string[] })?.roles ?? [];
  const canApprove = roles.some((r) => ["PRINCIPAL", "SUPER_ADMIN"].includes(r));
  const canPay = roles.some((r) => ["FINANCE", "SUPER_ADMIN"].includes(r));

  const [items, setItems] = useState<Refund[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (filter) params.set("status", filter);
    const res = await fetch(`/api/refunds?${params}`);
    if (res.ok) {
      const d = await res.json();
      setItems(d.items); setTotal(d.total); setTotalPages(d.totalPages);
    }
    setLoading(false);
  }, [filter, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [filter]);

  async function act(id: string, action: "approve" | "pay" | "reject") {
    setBusy(id);
    await fetch(`/api/refunds/${id}/${action}`, {
      method: "POST",
      ...(action === "reject" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) } : {}),
    });
    setBusy("");
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">退费管理</h1>
        <span className="text-sm text-slate-400">学管发起 → 校长审核 → 财务打款</span>
      </div>

      <div className="flex gap-2 flex-wrap">
        {TABS.map(([val, label]) => (
          <button key={val} onClick={() => setFilter(val)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${filter === val ? "bg-blue-600 text-white border-blue-600" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full min-w-[860px]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">学生</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">课包</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">退课时 / 单价</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">退款金额</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">状态</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">发起 / 经手</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-sm">加载中...</td></tr>}
            {!loading && items.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-sm">暂无退费申请</td></tr>}
            {items.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm font-medium text-slate-800">
                  <Link href={`/students/${r.student.id}`} className="hover:text-blue-600">{r.student.name}</Link>
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">
                  <Link href={`/packages/${r.package.id}`} className="hover:text-blue-600">
                    {r.package.grade.name} · {r.package.subject.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-sm text-slate-600 tabular-nums">{Number(r.hours).toFixed(1)}h × {formatRate(r.pricePerHour)}</td>
                <td className="px-4 py-3 text-sm font-bold text-slate-800 tabular-nums">{formatMoney(r.amount)}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[r.status]}`}>
                    {REFUND_STATUS_LABELS[r.status] ?? r.status}
                  </span>
                  {r.reason && <div className="text-xs text-slate-400 mt-1">{r.reason}</div>}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  <div>{r.creator.name} · {formatDateTime(r.createdAt)}</div>
                  {r.approver && <div className="text-slate-400">校长 {r.approver.name}</div>}
                  {r.payer && <div className="text-slate-400">财务 {r.payer.name}</div>}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {canApprove && r.status === "PENDING_APPROVAL" && (
                    <button onClick={() => act(r.id, "approve")} disabled={busy === r.id}
                      className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50 mr-2">
                      ✓ 审核通过
                    </button>
                  )}
                  {canPay && r.status === "PENDING_FINANCE" && (
                    <button onClick={() => act(r.id, "pay")} disabled={busy === r.id}
                      className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50 mr-2">
                      ✓ 复核并打款
                    </button>
                  )}
                  {((canApprove && r.status === "PENDING_APPROVAL") || (canPay && r.status === "PENDING_FINANCE")) && (
                    <button onClick={() => act(r.id, "reject")} disabled={busy === r.id}
                      className="border border-red-300 text-red-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-50 disabled:opacity-50">
                      驳回
                    </button>
                  )}
                  {(r.status === "PAID" || r.status === "REJECTED") && <span className="text-xs text-slate-400">—</span>}
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
