"use client";

import { useState, useEffect, useCallback } from "react";

type Campus = { id: string; name: string };
type Lock = { id: string; campusId: string; month: string; lockedBy: { name: string }; lockedAt: string };

// 最近 N 个月的 YYYY-MM（含本月）。
function recentMonths(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    out.push(`${y}-${m}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

export default function MonthLocksPage() {
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [locks, setLocks] = useState<Lock[]>([]);
  const months = recentMonths(6);

  const load = useCallback(async () => {
    const [c, l] = await Promise.all([
      fetch("/api/admin/campuses").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/month-locks").then((r) => (r.ok ? r.json() : [])),
    ]);
    setCampuses(c);
    setLocks(l);
  }, []);

  useEffect(() => { load(); }, [load]);

  const lockOf = (campusId: string, month: string) => locks.find((k) => k.campusId === campusId && k.month === month);

  async function toggle(campusId: string, month: string) {
    const existing = lockOf(campusId, month);
    if (existing) {
      await fetch(`/api/month-locks/${existing.id}`, { method: "DELETE" });
    } else {
      await fetch("/api/month-locks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campusId, month }),
      });
    }
    load();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">月度锁账</h1>
      <p className="text-sm text-slate-500">
        锁定某校区某月后，该月课程的<b>核销确认与撤销将被冻结</b>，校区人员无法再修改。财务当月锁定上月即可结账。
      </p>

      <div className="space-y-4">
        {campuses.map((c) => (
          <div key={c.id} className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="font-semibold text-slate-700 mb-3">{c.name}</h2>
            <div className="flex flex-wrap gap-2">
              {months.map((m) => {
                const lock = lockOf(c.id, m);
                return (
                  <button key={m} onClick={() => toggle(c.id, m)}
                    title={lock ? `${lock.lockedBy.name} 锁定` : "点击锁定"}
                    className={`px-3 py-2 rounded-lg text-sm font-medium border transition ${
                      lock
                        ? "bg-red-50 border-red-300 text-red-700 hover:bg-red-100"
                        : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                    }`}>
                    {m} {lock ? "🔒 已锁账" : "🔓 未锁"}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {campuses.length === 0 && <p className="text-slate-400 text-sm">暂无校区</p>}
      </div>
    </div>
  );
}
