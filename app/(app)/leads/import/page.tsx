"use client";

import { useState, useEffect } from "react";
import { parseCsv } from "@/lib/csv";

type Campus = { id: string; name: string };
type RowResult = { line: number; result: string; reason?: string };

const EXPECTED_COLUMNS = [
  "student_name", "phone", "preferred_contact_app", "contact_app_id",
  "grade", "subjects_of_interest", "source_category", "source_detail",
  "postal_code", "campaign_token",
];

// 模板示例行：演示合法取值，上传前请替换为真实数据（或删除这两行）。
const TEMPLATE_EXAMPLES: Record<string, string>[] = [
  {
    student_name: "张三", phone: "647-000-0001", preferred_contact_app: "WECHAT", contact_app_id: "zhangsan_wx",
    grade: "Grade 9", subjects_of_interest: "数学, 物理", source_category: "OFFLINE_EVENT",
    source_detail: "Markham 数学展", postal_code: "L3T 7P9", campaign_token: "",
  },
  {
    student_name: "李四", phone: "+1 905-000-0002", preferred_contact_app: "XIAOHONGSHU", contact_app_id: "lisi_xhs",
    grade: "Grade 11", subjects_of_interest: "化学", source_category: "", source_detail: "",
    postal_code: "L4B 2C3", campaign_token: "mkm-expo-2026",
  },
];

// 字段格式说明行：首格以 # 开头，导入时被解析器自动忽略（不会建成线索）。
const TEMPLATE_HINT: Record<string, string> = {
  student_name: "# 学生姓名 必填",
  phone: "必填 10位手机号(可带+1/空格/横杠)",
  preferred_contact_app: "PHONE/WECHAT/XIAOHONGSHU/WHATSAPP/OTHER",
  contact_app_id: "微信/小红书号 选填",
  grade: "9或G9或Grade 9均可;AP/IB/SAT写全称;选填",
  subjects_of_interest: "选填 逗号分隔",
  source_category: "来源大类 OFFLINE_EVENT线下/ONLINE_CHANNEL线上/REFERRAL转介绍/OTHER其他",
  source_detail: "来源明细(自由填) 如Markham数学展/小红书",
  postal_code: "加拿大邮编如L3T 7P9 选填",
  campaign_token: "营销活动编码 选填(填了则校区/来源随活动)",
};

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function downloadTemplate() {
  const header = EXPECTED_COLUMNS.join(",");
  const hint = EXPECTED_COLUMNS.map((c) => csvCell(TEMPLATE_HINT[c] ?? "")).join(",");
  const lines = TEMPLATE_EXAMPLES.map((r) => EXPECTED_COLUMNS.map((c) => csvCell(r[c] ?? "")).join(","));
  // 加 UTF-8 BOM + CRLF，Excel 打开中文不乱码。表头下第一行为 # 字段说明。
  const content = "﻿" + [header, hint, ...lines].join("\r\n") + "\r\n";
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "线索导入模板.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

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
      if (!h.includes("student_name") || !h.includes("phone")) {
        setParseError("CSV 必须包含 student_name 和 phone 列");
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">线索 CSV 导入</h1>
        <button onClick={downloadTemplate}
          className="bg-slate-100 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-200">
          ⬇ 下载 CSV 模板
        </button>
      </div>
      <div className="text-sm text-slate-500 space-y-2">
        <p>
          CSV 列（首行表头）：<code className="text-xs bg-slate-100 px-1 py-0.5 rounded">{EXPECTED_COLUMNS.join(", ")}</code>。
          模板表头下第一行是 <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">#</code> 字段说明（上传时自动忽略，可保留）；其余为示例行，请替换或删除。校区由上方选择决定，不用写进 CSV。
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li><b>student_name</b>（必填）学生姓名。</li>
          <li><b>phone</b>（必填）10 位加拿大手机号；可带 +1、空格、横杠、括号，如 <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">647-555-0199</code>、<code className="text-xs bg-slate-100 px-1 py-0.5 rounded">+1 (647) 555 0199</code>，系统自动规范化。不是 10 位会被拒。</li>
          <li><b>preferred_contact_app / contact_app_id</b>（选填）偏好联系方式与账号：PHONE / WECHAT / XIAOHONGSHU / WHATSAPP / OTHER，以及对应的微信号/小红书号。</li>
          <li><b>grade</b>（选填）数字年级写 <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">9</code>、<code className="text-xs bg-slate-100 px-1 py-0.5 rounded">G9</code> 或 <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">Grade 9</code> 都行；AP/IB/SAT 需写全称（如 AP Calculus）。识别不了就留空，不影响导入。</li>
          <li><b>source_category / source_detail</b>（来源）<b>大类</b> + <b>明细</b>。大类取值：OFFLINE_EVENT（线下活动）/ ONLINE_CHANNEL（线上渠道）/ REFERRAL（转介绍）/ OTHER（其他）；明细自由填，如「Markham 数学展」「小红书」。</li>
          <li><b>campaign_token</b>（选填）「营销活动」里某个活动的编码。<b>填了它就不用填来源和校区</b>——系统自动取该活动的来源与校区（在 营销活动 页每个活动详情里可复制）。没建活动就留空、改填上面两列来源。</li>
          <li><b>postal_code</b>（选填）加拿大邮编，如 L3T 7P9，用于按区域（FSA）统计。</li>
        </ul>
      </div>

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
