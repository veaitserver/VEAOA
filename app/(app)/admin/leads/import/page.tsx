"use client";

import { useState, useEffect } from "react";
import { parseCsv } from "@/lib/csv";

type Campus = { id: string; name: string };
type RowResult = { line: number; result: string; reason?: string };

const EXPECTED_COLUMNS = [
  "parent_name", "phone", "preferred_contact_app", "contact_app_id",
  "grade", "subjects_of_interest", "source_category", "source_detail",
  "postal_code", "campaign_token",
];

export default function LeadCsvImportPage() {
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [campusId, setCampusId] = useState("");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<{ created: number; merged: number; rejected: number } | null>(null);
  const [results, setResults] = useState<RowResult[]>([]);

  useEffect(() => {
    fetch("/api/admin/campuses").then((r) => (r.ok ? r.json() : [])).then((c: Campus[]) => {
      setCampuses(c);
      if (c.length === 1) setCampusId(c[0].id);
    });
  }, []);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setParseError(""); setSummary(null); setResults([]);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const text = await file.text();
    try {
      const { headers: h, rows: r } = parseCsv(text);
      if (!h.includes("parent_name") || !h.includes("phone")) {
        setParseError("CSV 必须包含 parent_name 和 phone 列");
        setRows([]); setHeaders([]);
        return;
      }
      setHeaders(h); setRows(r);
    } catch {
      setParseError("CSV 解析失败，请检查文件格式");
    }
  }

  async function handleImport() {
    if (!campusId || rows.length === 0) return;
    setImporting(true); setSummary(null); setResults([]);
    const res = await fetch("/api/leads/import-csv", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campusId, rows }),
    });
    if (res.ok) {
      const d = await res.json();
      setSummary(d.summary);
      setResults(d.results);
    } else {
      setParseError((await res.json()).error ?? "导入失败");
    }
    setImporting(false);
  }

  const needCampusChoice = campuses.length > 1;

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">线索 CSV 导入</h1>
      <p className="text-sm text-slate-500">
        CSV 列（首行表头）：<code className="text-xs bg-slate-100 px-1 py-0.5 rounded">{EXPECTED_COLUMNS.join(", ")}</code>。
        <br />必填 <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">parent_name</code>、
        <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">phone</code>；
        来源可用 <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">source_category/source_detail</code> 列，
        或用 <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">campaign_token</code> 列（则来源随活动）。
      </p>

      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        {/* 多校区校长：必须先选导入到哪个校区 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            导入到校区 *{needCampusChoice && <span className="text-amber-600 text-xs ml-2">你有多个校区权限，请选择</span>}
          </label>
          <select value={campusId} onChange={(e) => setCampusId(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">选择校区</option>
            {campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">CSV 文件 *</label>
          <input type="file" accept=".csv,text/csv" onChange={onFile}
            className="block w-full text-sm text-slate-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
          {fileName && <p className="text-xs text-slate-400 mt-1">{fileName} · 解析到 {rows.length} 行</p>}
        </div>

        {parseError && <p className="text-red-600 text-sm">{parseError}</p>}

        {rows.length > 0 && (
          <div className="border border-slate-200 rounded-lg overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>{headers.map((h) => <th key={h} className="text-left px-3 py-2 font-semibold text-slate-500 whitespace-nowrap">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.slice(0, 5).map((r, i) => (
                  <tr key={i}>{headers.map((h) => <td key={h} className="px-3 py-2 text-slate-600 whitespace-nowrap">{r[h]}</td>)}</tr>
                ))}
              </tbody>
            </table>
            {rows.length > 5 && <p className="text-xs text-slate-400 px-3 py-2">… 共 {rows.length} 行，仅预览前 5 行</p>}
          </div>
        )}

        <button onClick={handleImport} disabled={importing || !campusId || rows.length === 0}
          className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {importing ? "导入中..." : `导入 ${rows.length} 条线索`}
        </button>
      </div>

      {summary && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <div className="flex gap-6 text-sm">
            <span className="text-green-700 font-medium">新建 {summary.created}</span>
            <span className="text-blue-700 font-medium">合并 {summary.merged}</span>
            <span className="text-red-600 font-medium">拒绝 {summary.rejected}</span>
          </div>
          {summary.rejected > 0 && (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">行</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">原因</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {results.filter((r) => r.result === "REJECTED").map((r) => (
                    <tr key={r.line}><td className="px-4 py-2 text-slate-600">{r.line}</td><td className="px-4 py-2 text-red-600">{r.reason}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
