"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { formatDate, formatTime } from "@/lib/utils";
import { isDeductionLocked } from "@/lib/lock";
import Pagination from "@/components/Pagination";

type Lesson = {
  id: string; startTime: string; endTime: string; lessonType: string;
  teacher: { id: string; name: string };
  student: { id: string; name: string };
  classroom: { name: string };
  package: { subject: { name: string }; id: string };
  log?: {
    id: string; notes: string; submittedAt: string;
    confirmedAt?: string; confirmer?: { name: string };
    subject: { name: string };
    deduction?: {
      id: string; hoursDeducted: string; createdAt: string;
      reversedAt?: string; reverser?: { name: string };
      financeUnlockedAt?: string | null;
    };
  };
};

type Subject = { id: string; name: string };

const PHASES = [
  { key: "pending_log", label: "待提交日志" },
  { key: "pending_confirm", label: "待确认核销" },
  { key: "completed", label: "已核销" },
];

// 当前月的 "YYYY-MM"
function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
// "YYYY-MM" → 本地月份起止 ISO
function monthRange(m: string): { start: string; end: string } {
  const [y, mo] = m.split("-").map(Number);
  return {
    start: new Date(y, mo - 1, 1, 0, 0, 0).toISOString(),
    end: new Date(y, mo, 0, 23, 59, 59).toISOString(),
  };
}

export default function LessonsPage() {
  const { data: session } = useSession();
  const [phase, setPhase] = useState("pending_log");
  const [month, setMonth] = useState(currentMonth());
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [logModal, setLogModal] = useState<{ lessonId: string } | null>(null);
  const [logForm, setLogForm] = useState({ subjectId: "", notes: "" });
  const [error, setError] = useState("");

  const userRoles: string[] = (session?.user as { roles: string[] })?.roles ?? [];
  const isTeacher = userRoles.includes("TEACHER");
  const canConfirm = userRoles.some(r => ["ACADEMIC_ADMIN", "PRINCIPAL", "SUPER_ADMIN"].includes(r));
  const canReverse = userRoles.some(r => ["FINANCE", "SUPER_ADMIN"].includes(r));

  const load = useCallback(async () => {
    setLoading(true);
    const { start, end } = monthRange(month);
    const res = await fetch(`/api/lessons?phase=${phase}&start=${start}&end=${end}&page=${page}`);
    if (res.ok) {
      const d = await res.json();
      setLessons(d.items); setTotal(d.total); setTotalPages(d.totalPages);
    }
    setLoading(false);
  }, [phase, month, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [phase, month]);

  useEffect(() => {
    fetch("/api/admin/subjects").then(r => r.json()).then(setSubjects);
  }, []);

  async function unlockLesson(lessonId: string) {
    const res = await fetch(`/api/lessons/${lessonId}/unlock`, { method: "POST" });
    if (res.ok) load();
    else { const d = await res.json(); alert(d.error); }
  }

  async function submitLog(lessonId: string) {
    setError("");
    const res = await fetch(`/api/lessons/${lessonId}/log`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(logForm),
    });
    if (res.ok) { setLogModal(null); load(); }
    else { const d = await res.json(); setError(d.error); }
  }

  async function confirmLesson(lessonId: string) {
    if (!confirm("确认核销该课程？将扣除相应课时。")) return;
    const res = await fetch(`/api/lessons/${lessonId}/confirm`, { method: "POST" });
    if (res.ok) load();
    else { const d = await res.json(); alert(d.error); }
  }

  async function reverseLesson(lessonId: string) {
    if (!confirm("确认撤销该核销？将返还课时。")) return;
    const res = await fetch(`/api/lessons/${lessonId}/reverse`, { method: "POST" });
    if (res.ok) load();
    else { const d = await res.json(); alert(d.error); }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">核销管理</h1>

      <div className="flex items-center justify-between flex-wrap gap-3">
        {/* Phase tabs */}
        <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
          {PHASES.map(p => (
            <button key={p.key} onClick={() => setPhase(p.key)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${phase === p.key ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
              {p.label}
            </button>
          ))}
        </div>
        {/* 时间范围（按上课月份，默认当月）*/}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">月份</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value || currentMonth())}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button onClick={() => setMonth(currentMonth())} className="text-xs text-blue-600 hover:underline">回到当月</button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">时间</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">学生</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">老师</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">科目 / 课时</th>
              {phase !== "pending_log" && <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">日志</th>}
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400 text-sm">加载中...</td></tr>}
            {!loading && lessons.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400 text-sm">暂无记录</td></tr>}
            {lessons.map(l => {
              const durationH = (new Date(l.endTime).getTime() - new Date(l.startTime).getTime()) / 3600000;
              return (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-xs text-slate-600">
                    <div>{formatDate(l.startTime)}</div>
                    <div className="text-slate-400">
                      {formatTime(l.startTime)} - {formatTime(l.endTime)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-slate-800">{l.student.name}</td>
                  <td className="px-4 py-3 text-sm text-slate-500">{l.teacher.name}</td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {l.package.subject.name} · {durationH.toFixed(1)}h
                    <div className="text-xs text-slate-400">{l.classroom.name}</div>
                  </td>
                  {phase !== "pending_log" && (
                    <td className="px-4 py-3 text-xs text-slate-600 max-w-xs">
                      {l.log ? (
                        <div>
                          <p className="text-slate-700 line-clamp-2">{l.log.notes}</p>
                          <p className="text-slate-400 mt-0.5">提交: {formatDate(l.log.submittedAt)}</p>
                          {l.log.confirmedAt && l.log.confirmer && (
                            <p className="text-green-600">确认: {l.log.confirmer.name}</p>
                          )}
                          {l.log.deduction?.reversedAt && (
                            <p className="text-red-600">已撤销 by {l.log.deduction.reverser?.name}</p>
                          )}
                          {l.log.deduction && !l.log.deduction.reversedAt && isDeductionLocked(l.log.deduction) && (
                            <p className="text-slate-500">🔒 已锁定（确认满一周）</p>
                          )}
                        </div>
                      ) : "—"}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right space-x-2">
                    {phase === "pending_log" && (isTeacher || userRoles.includes("SUPER_ADMIN")) && (
                      <button onClick={() => { setLogModal({ lessonId: l.id }); setLogForm({ subjectId: "", notes: "" }); setError(""); }}
                        className="bg-blue-600 text-white px-3 py-1 rounded text-xs font-medium hover:bg-blue-700">
                        提交日志
                      </button>
                    )}
                    {phase === "pending_confirm" && canConfirm && (
                      <button onClick={() => confirmLesson(l.id)}
                        className="bg-green-600 text-white px-3 py-1 rounded text-xs font-medium hover:bg-green-700">
                        确认核销
                      </button>
                    )}
                    {phase === "completed" && canReverse && l.log?.deduction && !l.log.deduction.reversedAt && (
                      isDeductionLocked(l.log.deduction) ? (
                        <button onClick={() => unlockLesson(l.id)}
                          className="border border-amber-300 text-amber-700 px-3 py-1 rounded text-xs font-medium hover:bg-amber-50">
                          解锁
                        </button>
                      ) : (
                        <button onClick={() => reverseLesson(l.id)}
                          className="border border-red-300 text-red-600 px-3 py-1 rounded text-xs font-medium hover:bg-red-50">
                          撤销核销
                        </button>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={totalPages} total={total} onChange={setPage} />

      {/* Log submission modal */}
      {logModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-md p-6">
            <h2 className="font-semibold text-slate-800 mb-4">提交上课日志</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">科目 *</label>
                <select value={logForm.subjectId} onChange={e => setLogForm({ ...logForm, subjectId: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
                  <option value="">选择科目</option>
                  {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">上课日志 *（表现、作业等）</label>
                <textarea value={logForm.notes} onChange={e => setLogForm({ ...logForm, notes: e.target.value })}
                  rows={5} placeholder="请详细记录本次课程内容、学生表现、布置的作业等..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm resize-none" />
              </div>
              {error && <p className="text-red-600 text-sm">{error}</p>}
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setLogModal(null)} className="px-4 py-2 border border-slate-300 rounded-lg text-sm">取消</button>
                <button type="button" onClick={() => submitLog(logModal.lessonId)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">提交</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
