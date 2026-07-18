"use client";

import { useState } from "react";

const CONTACT_APPS = [
  { value: "PHONE", label: "电话" },
  { value: "WECHAT", label: "微信" },
  { value: "XIAOHONGSHU", label: "小红书" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "OTHER", label: "其他" },
];

export default function JoinForm({ token, campaignName, grades }: { token: string; campaignName: string; grades: string[] }) {
  const [form, setForm] = useState({
    parentName: "", phone: "", preferredContactApp: "PHONE", contactAppId: "",
    grade: "", subjectsOfInterest: "", postalCode: "", website: "",
  });
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [error, setError] = useState("");

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setError("");
    try {
      const res = await fetch("/api/leads/public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, ...form }),
      });
      if (res.ok) {
        setStatus("done");
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "提交失败，请稍后再试");
        setStatus("error");
      }
    } catch {
      setError("网络错误，请稍后再试");
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 p-8 text-center">
          <p className="text-5xl mb-3">✅</p>
          <h1 className="text-xl font-bold text-slate-800">提交成功</h1>
          <p className="text-sm text-slate-500 mt-2">感谢您的登记，我们的老师会在 1–2 个工作日内与您联系。</p>
        </div>
      </div>
    );
  }

  const inputCls = "w-full px-4 py-3 border border-slate-300 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-slate-800">VEA 教育 · 免费学情评估</h1>
          <p className="text-sm text-slate-500 mt-1">{campaignName}</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">家长姓名 *</label>
            <input value={form.parentName} onChange={set("parentName")} required className={inputCls} placeholder="您的称呼" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">手机号 *</label>
            <input value={form.phone} onChange={set("phone")} required inputMode="tel" className={inputCls} placeholder="647-000-0000" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">联系方式</label>
              <select value={form.preferredContactApp} onChange={set("preferredContactApp")} className={inputCls}>
                {CONTACT_APPS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">账号/微信号</label>
              <input value={form.contactAppId} onChange={set("contactAppId")} className={inputCls} placeholder="选填" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">年级</label>
              <select value={form.grade} onChange={set("grade")} className={inputCls}>
                <option value="">选填</option>
                {grades.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">邮编</label>
              <input value={form.postalCode} onChange={set("postalCode")} className={inputCls} placeholder="如 L3T 7P9" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">意向科目</label>
            <input value={form.subjectsOfInterest} onChange={set("subjectsOfInterest")} className={inputCls} placeholder="如 数学、物理（选填）" />
          </div>

          {/* 蜜罐：正常用户不可见，机器人会填 */}
          <div aria-hidden="true" className="absolute left-[-9999px] top-[-9999px]" tabIndex={-1}>
            <label>请勿填写此项<input type="text" tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} /></label>
          </div>

          {status === "error" && <p className="text-red-600 text-sm">{error}</p>}

          <button type="submit" disabled={status === "submitting"}
            className="w-full py-3.5 bg-blue-600 text-white rounded-xl text-base font-semibold hover:bg-blue-700 disabled:opacity-60">
            {status === "submitting" ? "提交中..." : "预约免费评估"}
          </button>
          <p className="text-xs text-slate-400 text-center">提交即表示同意我们与您联系安排评估。</p>
        </form>
      </div>
    </div>
  );
}
