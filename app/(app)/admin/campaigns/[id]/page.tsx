"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";

type Report = {
  campaign: {
    id: string; name: string; sourceCategory: string; sourceDetail: string;
    campus: string; defaultOwner: string | null; active: boolean; token: string;
  };
  captured: number;
  enrolled: number;
  conversionRate: number;
  byStatus: Record<string, number>;
  byFsa: { region: string; count: number }[];
};

const STATUS_LABEL: Record<string, string> = {
  NEW: "新线索", CONTACTED: "已联系", LOST: "已流失", ENROLLED: "在读", COMPLETED: "已结课",
};

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [report, setReport] = useState<Report | null>(null);
  const [publicUrl, setPublicUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`/api/campaigns/${id}/report`).then((r) => (r.ok ? r.json() : null)).then(setReport);
  }, [id]);

  useEffect(() => {
    if (report) setPublicUrl(`${window.location.origin}/join/${report.campaign.token}`);
  }, [report]);

  if (!report) return <div className="text-slate-400 text-sm">加载中...</div>;
  const c = report.campaign;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/campaigns" className="text-slate-400 hover:text-slate-600 text-lg">←</Link>
        <h1 className="text-2xl font-bold text-slate-800">{c.name}</h1>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
          {c.active ? "启用" : "停用"}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">捕获线索</p>
          <p className="text-3xl font-bold text-slate-800 mt-1">{report.captured}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">已转化（在读）</p>
          <p className="text-3xl font-bold text-green-700 mt-1">{report.enrolled}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">转化率</p>
          <p className="text-3xl font-bold text-blue-700 mt-1">{(report.conversionRate * 100).toFixed(1)}%</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* 公开链接 + 二维码 */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <h2 className="font-semibold text-slate-800">公开捕获链接</h2>
          <p className="text-xs text-slate-500">印在海报/传单上，家长扫码直接登记，来源自动归到本活动。</p>
          <div className="flex gap-2">
            <input readOnly value={publicUrl} className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-slate-50" />
            <button onClick={() => { navigator.clipboard.writeText(publicUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              className="px-3 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm hover:bg-slate-200 shrink-0">
              {copied ? "已复制" : "复制"}
            </button>
          </div>
          <div className="flex justify-center pt-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/campaigns/${id}/qr`} alt="活动二维码" width={220} height={220} className="rounded-lg border border-slate-200" />
          </div>
          <a href={`/join/${c.token}`} target="_blank" rel="noopener noreferrer" className="block text-center text-blue-600 text-sm hover:underline">
            预览公开表单 →
          </a>
        </div>

        {/* 活动信息 + 状态分布 */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-2 text-sm">
            <h2 className="font-semibold text-slate-800 mb-2">活动信息</h2>
            <div className="flex justify-between"><span className="text-slate-500">来源明细</span><span className="text-slate-800">{c.sourceDetail}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">校区</span><span className="text-slate-800">{c.campus}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">默认负责人</span><span className="text-slate-800">{c.defaultOwner ?? "轮询分配"}</span></div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-2 text-sm">
            <h2 className="font-semibold text-slate-800 mb-2">线索状态分布</h2>
            {Object.entries(report.byStatus).map(([status, count]) => (
              <div key={status} className="flex justify-between">
                <span className="text-slate-500">{STATUS_LABEL[status] ?? status}</span>
                <span className="text-slate-800">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 按营销区域（邮编 FSA） */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200"><h2 className="font-semibold text-slate-800">按营销区域（邮编 FSA）</h2></div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">区域</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase">线索数</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase">占比</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {report.byFsa.length === 0 && <tr><td colSpan={3} className="px-5 py-6 text-center text-slate-400">暂无数据</td></tr>}
            {report.byFsa.map((r) => (
              <tr key={r.region} className="hover:bg-slate-50">
                <td className="px-5 py-3 font-medium text-slate-800">{r.region}</td>
                <td className="px-5 py-3 text-slate-700 text-right">{r.count}</td>
                <td className="px-5 py-3 text-slate-500 text-right">{report.captured > 0 ? ((r.count / report.captured) * 100).toFixed(1) : 0}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
