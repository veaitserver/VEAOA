"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

type Grade = { id: string; name: string };
type Campus = { id: string; name: string };
type Sales = { id: string; name: string };

const CONTACT_APPS = [
  { value: "PHONE", label: "电话" }, { value: "WECHAT", label: "微信" },
  { value: "XIAOHONGSHU", label: "小红书" }, { value: "WHATSAPP", label: "WhatsApp" }, { value: "OTHER", label: "其他" },
];
const SOURCE_CATEGORIES = [
  { value: "OFFLINE_EVENT", label: "线下活动" }, { value: "ONLINE_CHANNEL", label: "线上渠道" },
  { value: "REFERRAL", label: "转介绍" }, { value: "OTHER", label: "其他" },
];

export default function NewLeadPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const myId = (session?.user as { id?: string } | undefined)?.id ?? "";

  const [grades, setGrades] = useState<Grade[]>([]);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [salesUsers, setSalesUsers] = useState<Sales[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "", phone: "", campusId: "", gradeId: "", salesId: "",
    preferredContactApp: "PHONE", contactAppId: "", postalCode: "",
    subjectsOfInterest: "", sourceCategory: "OFFLINE_EVENT", sourceDetail: "",
  });

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/grades").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/admin/campuses").then((r) => (r.ok ? r.json() : [])),
    ]).then(([g, c]: [Grade[], Campus[]]) => {
      setGrades(g); setCampuses(c);
      if (c.length === 1) setForm((f) => ({ ...f, campusId: c[0].id }));
    });
  }, []);

  // 负责人下拉：仅校长/超管能拉到销售列表；销售自己新增时默认归属自己。
  useEffect(() => {
    if (!form.campusId) { setSalesUsers([]); return; }
    fetch(`/api/campaigns/sales?campusId=${form.campusId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setSalesUsers)
      .catch(() => setSalesUsers([]));
  }, [form.campusId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    // 销售自己新增：默认归属自己
    const salesId = form.salesId || (salesUsers.length === 0 ? myId : "");
    const res = await fetch("/api/students", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, salesId: salesId || undefined }),
    });
    if (res.ok) {
      const student = await res.json();
      router.push(`/students/${student.id}`);
    } else {
      setError((await res.json()).error ?? "保存失败");
    }
  }

  const inputCls = "w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div className="max-w-xl space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="text-slate-400 hover:text-slate-600 text-lg">←</button>
        <h1 className="text-2xl font-bold text-slate-800">添加线索</h1>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">学生姓名 *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">手机号 *</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required placeholder="647-000-0000" className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">校区 *</label>
              <select value={form.campusId} onChange={(e) => setForm({ ...form, campusId: e.target.value, salesId: "" })} required className={inputCls}>
                <option value="">选择校区</option>
                {campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">年级</label>
              <select value={form.gradeId} onChange={(e) => setForm({ ...form, gradeId: e.target.value })} className={inputCls}>
                <option value="">选填</option>
                {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">联系方式</label>
              <select value={form.preferredContactApp} onChange={(e) => setForm({ ...form, preferredContactApp: e.target.value })} className={inputCls}>
                {CONTACT_APPS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">账号/微信号</label>
              <input value={form.contactAppId} onChange={(e) => setForm({ ...form, contactAppId: e.target.value })} placeholder="选填" className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">邮编</label>
              <input value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} placeholder="如 L3T 7P9" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">意向科目</label>
              <input value={form.subjectsOfInterest} onChange={(e) => setForm({ ...form, subjectsOfInterest: e.target.value })} placeholder="如 数学、物理" className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">来源大类</label>
              <select value={form.sourceCategory} onChange={(e) => setForm({ ...form, sourceCategory: e.target.value })} className={inputCls}>
                {SOURCE_CATEGORIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">来源明细 *</label>
              <input value={form.sourceDetail} onChange={(e) => setForm({ ...form, sourceDetail: e.target.value })} required placeholder="如 门店咨询 / 小红书" className={inputCls} />
            </div>
          </div>

          {salesUsers.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">归属销售</label>
              <select value={form.salesId} onChange={(e) => setForm({ ...form, salesId: e.target.value })} className={inputCls}>
                <option value="">不指定</option>
                {salesUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          )}

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => router.back()} className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">取消</button>
            <button type="submit" className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">保存</button>
          </div>
        </form>
      </div>
    </div>
  );
}
