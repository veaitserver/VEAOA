"use client";

import { useState, useEffect } from "react";
import { formatMoney } from "@/lib/utils";

type SalesSummary = { id: string; name: string; count: number; totalAmount: number };
type Package = {
  id: string; totalAmount: string; confirmedAt?: string;
  student: { name: string; campus: { name: string } };
  grade: { name: string }; subject: { name: string };
  creator: { name: string };
};

export default function SalesReportPage() {
  const [summary, setSummary] = useState<SalesSummary[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ startDate: "", endDate: "", salesId: "", campusId: "" });

  async function load() {
    const params = new URLSearchParams();
    if (filters.startDate) params.set("startDate", filters.startDate);
    if (filters.endDate) params.set("endDate", filters.endDate);
    if (filters.salesId) params.set("salesId", filters.salesId);
    if (filters.campusId) params.set("campusId", filters.campusId);
    const res = await fetch(`/api/reports/sales?${params}`);
    if (res.ok) {
      const data = await res.json();
      setSummary(data.summary);
      setPackages(data.packages);
      setTotal(data.total);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">销售业绩报表</h1>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex gap-4 items-end flex-wrap">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">开始日期</label>
          <input type="date" value={filters.startDate} onChange={e => setFilters({ ...filters, startDate: e.target.value })}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">结束日期</label>
          <input type="date" value={filters.endDate} onChange={e => setFilters({ ...filters, endDate: e.target.value })}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
        </div>
        <button onClick={load} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">查询</button>
      </div>

      {/* Total */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 flex items-center justify-between">
        <div>
          <p className="text-sm text-blue-600">Active 订单总金额</p>
          <p className="text-3xl font-bold text-blue-800">{formatMoney(total)}</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-blue-600">订单数量</p>
          <p className="text-2xl font-bold text-blue-700">{packages.length}</p>
        </div>
      </div>

      {/* By Sales */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200"><h2 className="font-semibold text-slate-800">按销售汇总</h2></div>
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">销售</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase">订单数</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase">总金额</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase">占比</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {summary.map(s => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="px-5 py-3 text-sm font-medium text-slate-800">{s.name}</td>
                <td className="px-5 py-3 text-sm text-slate-500 text-right">{s.count}</td>
                <td className="px-5 py-3 text-sm font-medium text-slate-800 text-right">
                  {formatMoney(s.totalAmount)}
                </td>
                <td className="px-5 py-3 text-sm text-slate-500 text-right">
                  {total > 0 ? ((s.totalAmount / total) * 100).toFixed(1) : 0}%
                </td>
              </tr>
            ))}
            {summary.length === 0 && <tr><td colSpan={4} className="px-5 py-6 text-center text-slate-400 text-sm">暂无数据</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Details */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200"><h2 className="font-semibold text-slate-800">订单明细</h2></div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">学生</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">校区</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">课包</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">销售</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">确认时间</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase">金额</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {packages.map(p => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="px-5 py-3 font-medium text-slate-800">{p.student.name}</td>
                <td className="px-5 py-3 text-slate-500">{p.student.campus.name}</td>
                <td className="px-5 py-3 text-slate-500">{p.grade.name} · {p.subject.name}</td>
                <td className="px-5 py-3 text-slate-500">{p.creator.name}</td>
                <td className="px-5 py-3 text-slate-400 text-xs">
                  {p.confirmedAt ? new Date(p.confirmedAt).toLocaleDateString("zh-CN") : "—"}
                </td>
                <td className="px-5 py-3 font-medium text-slate-800 text-right">
                  {formatMoney(p.totalAmount)}
                </td>
              </tr>
            ))}
            {packages.length === 0 && <tr><td colSpan={6} className="px-5 py-6 text-center text-slate-400 text-sm">暂无数据</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
