"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { formatMoney, formatRate } from "@/lib/utils";
import { isLowOnHours, LOW_HOURS_THRESHOLD } from "@/lib/hours";
import { CLASS_TYPE_LABELS } from "@/lib/enums";

type Group = {
  key: string; label: string;
  hours: number; amount: number; pendingHours: number;
  packages: number; students: number;
};

type Row = {
  packageId: string; studentId: string; studentName: string;
  campusName: string; subjectName: string; gradeName: string; classType: string;
  remainingHours: number; pricePerHour: number; amount: number; pendingHours: number;
};

type Report = {
  totalHours: number; totalAmount: number; totalPendingHours: number;
  packages: number; students: number;
  byCampus: Group[]; bySubject: Group[]; byClassType: Group[];
  rows: Row[];
};

const DIMENSIONS = [
  { key: "byCampus", label: "按校区" },
  { key: "bySubject", label: "按科目" },
  { key: "byClassType", label: "按班型" },
] as const;

export default function LiabilityReportPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [dim, setDim] = useState<(typeof DIMENSIONS)[number]["key"]>("byCampus");
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch("/api/reports/liability")
      .then(async (r) => (r.ok ? setReport(await r.json()) : setError((await r.json()).error ?? "加载失败")))
      .catch(() => setError("加载失败"));
  }, []);

  if (error) return <p className="text-sm text-red-600 p-8 text-center">{error}</p>;
  if (!report) return <p className="text-slate-400 text-sm p-8 text-center">加载中...</p>;

  const groups = report[dim];
  const kw = q.trim().toLowerCase();
  const rows = kw
    ? report.rows.filter((r) =>
        [r.studentName, r.subjectName, r.gradeName, r.campusName].some((v) => v.toLowerCase().includes(kw)))
    : report.rows;

  const label = (g: Group) => (dim === "byClassType" ? (CLASS_TYPE_LABELS[g.label] ?? g.label) : g.label);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">剩余课时负债</h1>
        <p className="text-sm text-slate-500 mt-1">
          已收款但还没上完的课 —— 会计上是负债不是收入。口径：<b>只要还没核销就算</b>，
          即 已生效课包的剩余课时 × 单价。
        </p>
      </div>

      {/* 总览 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-500">负债总额</div>
          <div className="text-2xl font-bold text-slate-800 mt-1">{formatMoney(report.totalAmount)}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-500">未消耗课时</div>
          <div className="text-2xl font-bold text-slate-800 mt-1">{report.totalHours.toFixed(1)}h</div>
          <div className="text-xs text-slate-400 mt-0.5">其中已排待上 {report.totalPendingHours.toFixed(1)}h</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-500">在读学生</div>
          <div className="text-2xl font-bold text-slate-800 mt-1">{report.students}</div>
          <div className="text-xs text-slate-400 mt-0.5">{report.packages} 张生效课包</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-500">人均负债</div>
          <div className="text-2xl font-bold text-slate-800 mt-1">
            {formatMoney(report.students ? report.totalAmount / report.students : 0)}
          </div>
        </div>
      </div>

      {/* 分维度汇总 */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex gap-2 px-4 py-3 border-b border-slate-200">
          {DIMENSIONS.map((d) => (
            <button key={d.key} onClick={() => setDim(d.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${
                dim === d.key ? "bg-blue-600 text-white border-blue-600" : "border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}>
              {d.label}
            </button>
          ))}
        </div>
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">分组</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">负债金额</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">占比</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">未消耗课时</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">已排待上</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">学生/课包</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {groups.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400 text-sm">暂无生效课包</td></tr>
            )}
            {groups.map((g) => {
              const pct = report.totalAmount ? (g.amount / report.totalAmount) * 100 : 0;
              return (
                <tr key={g.key} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm font-medium text-slate-800">{label(g)}</td>
                  <td className="px-4 py-3 text-sm text-right font-semibold text-slate-800">{formatMoney(g.amount)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-slate-500 tabular-nums w-10 text-right">{pct.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-right text-slate-600">{g.hours.toFixed(1)}h</td>
                  <td className="px-4 py-3 text-sm text-right text-slate-400">{g.pendingHours.toFixed(1)}h</td>
                  <td className="px-4 py-3 text-sm text-right text-slate-500">{g.students} / {g.packages}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 明细 */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 flex-wrap">
          <h2 className="text-sm font-semibold text-slate-700">课包明细（按金额降序）</h2>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索学生 / 科目 / 校区"
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm w-56" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">学生</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">课包</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">剩余</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">已排待上</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">单价</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">负债金额</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400 text-sm">没有匹配的课包</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.packageId} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm">
                    <Link href={`/students/${r.studentId}`} className="font-medium text-slate-800 hover:text-blue-600">
                      {r.studentName}
                    </Link>
                    <div className="text-xs text-slate-400">{r.campusName}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium mr-1.5 ${
                      r.classType === "GROUP" ? "bg-teal-100 text-teal-700" : "bg-slate-100 text-slate-600"
                    }`}>
                      {CLASS_TYPE_LABELS[r.classType] ?? r.classType}
                    </span>
                    {r.gradeName} · {r.subjectName}
                  </td>
                  <td className="px-4 py-3 text-sm text-right text-slate-800">
                    {r.remainingHours.toFixed(1)}h
                    {isLowOnHours(r.remainingHours) && (
                      <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
                        不足 {LOW_HOURS_THRESHOLD}h
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-right text-slate-400">{r.pendingHours.toFixed(1)}h</td>
                  <td className="px-4 py-3 text-sm text-right text-slate-500 font-mono text-xs">{formatRate(r.pricePerHour)}</td>
                  <td className="px-4 py-3 text-sm text-right font-semibold text-slate-800">{formatMoney(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
