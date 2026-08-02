"use client";

import { useState, useEffect, use, useCallback } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { formatDate } from "@/lib/utils";
import {
  GROUP_CLASS_STATUS_LABELS, GROUP_SESSION_STATUS_LABELS, ATTENDANCE_LABELS, GroupClassStatus,
} from "@/lib/enums";
import { torontoDateKey, formatTorontoTime, torontoWallTimeToUtc } from "@/lib/datetime";

type Member = {
  id: string; joinedAt: string; leftAt: string | null;
  student: { id: string; name: string };
  package: {
    id: string; remainingHours: number; totalHours: number; status: string;
    subject: { name: string }; grade: { name: string };
  };
};

type Attendance = {
  id: string; studentId: string; packageId: string; attendance: string; note: string | null;
  student: { id: string; name: string };
};

type Session = {
  id: string; startTime: string; endTime: string; status: string;
  notes: string | null; loggedAt: string | null; confirmedAt: string | null;
  teacher: { name: string }; classroom: { name: string };
  attendances: Attendance[];
};

type ClassDetail = {
  id: string; name: string; status: string; capacity: number | null; notes: string | null;
  campusId: string;
  campus: { id: string; name: string };
  subject: { id: string; name: string };
  grade: { id: string; name: string } | null;
  teacher: { id: string; name: string } | null;
  classroom: { id: string; name: string } | null;
  creator: { name: string };
  members: Member[];
  sessions: Session[];
};

const STATUS_COLORS: Record<string, string> = {
  RECRUITING: "bg-blue-100 text-blue-700",
  ONGOING: "bg-green-100 text-green-700",
  FINISHED: "bg-slate-100 text-slate-500",
};
const SESSION_COLORS: Record<string, string> = {
  SCHEDULED: "bg-blue-100 text-blue-700",
  LOGGED: "bg-amber-100 text-amber-700",
  CONFIRMED: "bg-green-100 text-green-700",
};
const ATT_COLORS: Record<string, string> = {
  PRESENT: "bg-green-100 text-green-700",
  LEAVE: "bg-amber-100 text-amber-700",
  NO_SHOW: "bg-red-100 text-red-700",
};

export default function ClassDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: session } = useSession();
  const roles: string[] = (session?.user as { roles?: string[] })?.roles ?? [];
  const canManage = roles.some((r) => ["ACADEMIC_ADMIN", "PRINCIPAL", "SUPER_ADMIN"].includes(r));
  const canReverse = roles.some((r) => ["FINANCE", "SUPER_ADMIN"].includes(r));

  const [cls, setCls] = useState<ClassDetail | null>(null);
  const [tab, setTab] = useState<"members" | "sessions">("members");
  const [error, setError] = useState("");

  // 加成员
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<{ studentName: string; pkg: { id: string; remainingHours: number; subject: { name: string }; grade: { name: string } } }[]>([]);

  // 排课
  const [showSchedule, setShowSchedule] = useState(false);
  const [schedForm, setSchedForm] = useState({ date: "", start: "16:00", end: "18:00" });

  const load = useCallback(async () => {
    const res = await fetch(`/api/classes/${id}`);
    if (res.ok) setCls(await res.json());
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function findCandidates() {
    setError("");
    if (search.trim().length < 1) { setCandidates([]); return; }
    const res = await fetch(`/api/students?search=${encodeURIComponent(search)}&status=enrolled`);
    if (!res.ok) return;
    const students: { id: string; name: string }[] = await res.json();
    const found: typeof candidates = [];
    for (const s of students.slice(0, 8)) {
      const pr = await fetch(`/api/packages?studentId=${s.id}&status=ACTIVE`);
      if (!pr.ok) continue;
      const pkgs = await pr.json();
      for (const p of pkgs as { id: string; classType: string; subject: { id: string }; remainingHours: number; grade: { name: string } }[]) {
        // 只列出真正能入班的：班课 + 同科目 + 有剩余课时
        if (p.classType === "GROUP" && p.subject.id === cls?.subject.id && Number(p.remainingHours) > 0) {
          found.push({ studentName: s.name, pkg: p as never });
        }
      }
    }
    setCandidates(found);
  }

  async function addMember(packageId: string) {
    setError("");
    const res = await fetch(`/api/classes/${id}/members`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageId }),
    });
    if (res.ok) { setSearch(""); setCandidates([]); load(); }
    else setError((await res.json()).error ?? "加入失败");
  }

  async function removeMember(memberId: string) {
    if (!confirm("确认将该成员移出班级？")) return;
    setError("");
    const res = await fetch(`/api/classes/${id}/members/${memberId}`, { method: "DELETE" });
    if (res.ok) load();
    else setError((await res.json()).error ?? "移出失败");
  }

  async function setStatus(status: string) {
    setError("");
    const res = await fetch(`/api/classes/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) load();
    else setError((await res.json()).error ?? "更新失败");
  }

  async function createSession() {
    setError("");
    if (!schedForm.date) { setError("请选择日期"); return; }
    const startTime = torontoWallTimeToUtc(schedForm.date, schedForm.start);
    const endTime = torontoWallTimeToUtc(schedForm.date, schedForm.end);
    const res = await fetch(`/api/classes/${id}/sessions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startTime: startTime.toISOString(), endTime: endTime.toISOString() }),
    });
    if (res.ok) { setShowSchedule(false); load(); }
    else setError((await res.json()).error ?? "排课失败");
  }

  async function markAttendance(sessionId: string, studentId: string, attendance: string) {
    setError("");
    const res = await fetch(`/api/classes/${id}/sessions/${sessionId}/attendance`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId, attendance }),
    });
    if (res.ok) load();
    else setError((await res.json()).error ?? "标记失败");
  }

  async function confirmSession(sessionId: string) {
    if (!confirm("确认核销该次课？全班每人将各扣一次课时。")) return;
    setError("");
    const res = await fetch(`/api/classes/${id}/sessions/${sessionId}/confirm`, { method: "POST" });
    if (res.ok) load();
    else setError((await res.json()).error ?? "核销失败");
  }

  async function reverseOne(sessionId: string, packageId?: string) {
    if (!confirm(packageId ? "确认撤销该成员的扣课？将返还其课时。" : "确认撤销整节课的核销？全班课时将返还。")) return;
    setError("");
    const res = await fetch(`/api/classes/${id}/sessions/${sessionId}/reverse`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(packageId ? { packageId } : {}),
    });
    if (res.ok) load();
    else setError((await res.json()).error ?? "撤销失败");
  }

  async function deleteSession(sessionId: string) {
    if (!confirm("确认删除该次课？")) return;
    setError("");
    const res = await fetch(`/api/classes/${id}/sessions/${sessionId}`, { method: "DELETE" });
    if (res.ok) load();
    else setError((await res.json()).error ?? "删除失败");
  }

  if (!cls) return <div className="text-slate-400 text-sm p-8 text-center">加载中...</div>;

  const activeMembers = cls.members.filter((m) => !m.leftAt);
  const inputCls = "px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/classes" className="text-slate-400 hover:text-slate-600 text-lg">←</Link>
        <h1 className="text-2xl font-bold text-slate-800">{cls.name}</h1>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[cls.status]}`}>
          {GROUP_CLASS_STATUS_LABELS[cls.status]}
        </span>
        {canManage && cls.status !== GroupClassStatus.FINISHED && (
          <div className="ml-auto flex gap-2">
            {cls.status === GroupClassStatus.RECRUITING && (
              <button onClick={() => setStatus(GroupClassStatus.ONGOING)}
                className="border border-slate-300 text-slate-700 px-3 py-1.5 rounded-lg text-sm hover:bg-slate-50">开课</button>
            )}
            <button onClick={() => setStatus(GroupClassStatus.FINISHED)}
              className="border border-slate-300 text-slate-700 px-3 py-1.5 rounded-lg text-sm hover:bg-slate-50">结班</button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        {[
          ["校区", cls.campus.name],
          ["科目", cls.subject.name],
          ["年级", cls.grade?.name ?? "不限"],
          ["默认老师", cls.teacher?.name ?? "—"],
          ["默认教室", cls.classroom?.name ?? "—"],
          ["在册人数", `${activeMembers.length}${cls.capacity ? ` / ${cls.capacity}` : ""}`],
          ["课次", String(cls.sessions.length)],
          ["创建人", cls.creator.name],
        ].map(([k, v]) => (
          <div key={k}>
            <div className="text-xs text-slate-400">{k}</div>
            <div className="font-medium text-slate-800 mt-0.5">{v}</div>
          </div>
        ))}
      </div>

      {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</p>}

      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
        {([["members", `成员(${activeMembers.length})`], ["sessions", `课次(${cls.sessions.length})`]] as const).map(([v, label]) => (
          <button key={v} onClick={() => setTab(v)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${tab === v ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "members" && (
        <div className="space-y-4">
          {canManage && cls.status !== GroupClassStatus.FINISHED && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
              <h2 className="font-semibold text-slate-800 text-sm">加入成员</h2>
              <p className="text-xs text-slate-500">
                只列出「班课课包 · {cls.subject.name} · 已生效 · 有剩余课时」的学生 —— 班级按科目开，其他课包不能入班。
              </p>
              <div className="flex gap-2">
                <input value={search} onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") findCandidates(); }}
                  placeholder="输入学生姓名搜索..." className={`${inputCls} flex-1`} />
                <button onClick={findCandidates}
                  className="bg-slate-100 text-slate-700 px-4 py-2 rounded-lg text-sm hover:bg-slate-200">搜索</button>
              </div>
              {candidates.length > 0 && (
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {candidates.map((c) => (
                    <div key={c.pkg.id} className="flex items-center justify-between px-3 py-2">
                      <div className="text-sm">
                        <span className="font-medium text-slate-800">{c.studentName}</span>
                        <span className="text-slate-500 ml-2">
                          {c.pkg.grade?.name} · {c.pkg.subject.name} · 剩余 {Number(c.pkg.remainingHours).toFixed(1)}h
                        </span>
                      </div>
                      <button onClick={() => addMember(c.pkg.id)}
                        className="bg-blue-600 text-white px-3 py-1 rounded text-xs font-medium hover:bg-blue-700">加入</button>
                    </div>
                  ))}
                </div>
              )}
              {search && candidates.length === 0 && (
                <p className="text-xs text-slate-400">没找到符合条件的课包（需为班课、{cls.subject.name}、已生效且有剩余课时）</p>
              )}
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full min-w-[680px]">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">学生</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">课包剩余</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">入班时间</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">状态</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cls.members.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400 text-sm">还没有成员</td></tr>
                )}
                {cls.members.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm font-medium text-slate-800">
                      <Link href={`/students/${m.student.id}`} className="hover:text-blue-600">{m.student.name}</Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 tabular-nums">
                      {Number(m.package.remainingHours).toFixed(1)}h / {Number(m.package.totalHours).toFixed(1)}h
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{formatDate(m.joinedAt)}</td>
                    <td className="px-4 py-3">
                      {m.leftAt
                        ? <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">已退班 {formatDate(m.leftAt)}</span>
                        : <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">在册</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canManage && !m.leftAt && (
                        <button onClick={() => removeMember(m.id)}
                          className="border border-red-300 text-red-600 px-3 py-1 rounded text-xs font-medium hover:bg-red-50">移出</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "sessions" && (
        <div className="space-y-4">
          {canManage && cls.status !== GroupClassStatus.FINISHED && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-slate-800 text-sm">排课</h2>
                <button onClick={() => {
                  setShowSchedule((v) => !v);
                  setSchedForm({ date: torontoDateKey(new Date()), start: "16:00", end: "18:00" });
                }}
                  className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700">
                  {showSchedule ? "取消" : "+ 新增课次"}
                </button>
              </div>
              {showSchedule && (
                <>
                  <p className="text-xs text-slate-500">
                    时间按多伦多时区。任何一位成员课时不足都无法排课，会提示是谁。
                  </p>
                  <div className="flex gap-3 flex-wrap items-end">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">日期</label>
                      <input type="date" value={schedForm.date}
                        onChange={(e) => setSchedForm({ ...schedForm, date: e.target.value })} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">开始</label>
                      <input type="time" value={schedForm.start}
                        onChange={(e) => setSchedForm({ ...schedForm, start: e.target.value })} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">结束</label>
                      <input type="time" value={schedForm.end}
                        onChange={(e) => setSchedForm({ ...schedForm, end: e.target.value })} className={inputCls} />
                    </div>
                    <button onClick={createSession}
                      className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">确认排课</button>
                  </div>
                </>
              )}
            </div>
          )}

          {cls.sessions.length === 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 text-sm">
              还没有课次
            </div>
          )}

          {cls.sessions.map((s) => (
            <div key={s.id} className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-semibold text-slate-800">
                  {formatDate(s.startTime)} {formatTorontoTime(new Date(s.startTime))}–{formatTorontoTime(new Date(s.endTime))}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SESSION_COLORS[s.status]}`}>
                  {GROUP_SESSION_STATUS_LABELS[s.status]}
                </span>
                <span className="text-xs text-slate-400">{s.teacher.name} · {s.classroom.name}</span>
                <div className="ml-auto flex gap-2">
                  {canManage && s.status === "LOGGED" && (
                    <button onClick={() => confirmSession(s.id)}
                      className="bg-green-600 text-white px-3 py-1 rounded text-xs font-medium hover:bg-green-700">
                      ✓ 全员核销
                    </button>
                  )}
                  {canReverse && s.status === "CONFIRMED" && (
                    <button onClick={() => reverseOne(s.id)}
                      className="border border-red-300 text-red-600 px-3 py-1 rounded text-xs font-medium hover:bg-red-50">
                      撤销整节
                    </button>
                  )}
                  {canManage && s.status !== "CONFIRMED" && (
                    <button onClick={() => deleteSession(s.id)}
                      className="border border-slate-300 text-slate-600 px-3 py-1 rounded text-xs font-medium hover:bg-slate-50">
                      删除
                    </button>
                  )}
                </div>
              </div>

              {s.notes ? (
                <div className="bg-slate-50 rounded-lg px-3 py-2 text-sm text-slate-700">
                  <span className="text-xs text-slate-400 block mb-0.5">老师反馈（整班一条）</span>
                  {s.notes}
                </div>
              ) : (
                <p className="text-xs text-slate-400">老师尚未提交反馈</p>
              )}

              <div className="flex flex-wrap gap-2">
                {s.attendances.map((a) => (
                  <div key={a.id} className="border border-slate-200 rounded-lg px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-800">{a.student.name}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${ATT_COLORS[a.attendance]}`}>
                        {ATTENDANCE_LABELS[a.attendance]}
                      </span>
                    </div>
                    {canManage && s.status !== "CONFIRMED" && (
                      <div className="flex gap-1 mt-1.5">
                        {(["PRESENT", "LEAVE", "NO_SHOW"] as const).map((v) => (
                          <button key={v} onClick={() => markAttendance(s.id, a.student.id, v)}
                            className={`text-xs px-1.5 py-0.5 rounded border ${a.attendance === v ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-300 text-slate-500 hover:bg-slate-50"}`}>
                            {ATTENDANCE_LABELS[v]}
                          </button>
                        ))}
                      </div>
                    )}
                    {canReverse && s.status === "CONFIRMED" && (
                      <button onClick={() => reverseOne(s.id, a.packageId)}
                        className="mt-1.5 text-xs text-red-600 hover:underline">撤销该成员扣课</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
