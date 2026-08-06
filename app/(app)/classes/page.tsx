"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { GROUP_CLASS_STATUS_LABELS } from "@/lib/enums";
import Pagination from "@/components/Pagination";
import LocationTag from "@/components/LocationTag";

type GroupClass = {
  id: string; name: string; status: string; capacity: number | null;
  campus: { name: string };
  subject: { id: string; name: string };
  grade: { name: string } | null;
  teacher: { id: string; name: string } | null;
  classroom: { name: string } | null;
  deliveryMode: string;
  members: { id: string }[];
  _count: { sessions: number };
};

type Opt = { id: string; name: string };
type Campus = { id: string; name: string };

const STATUS_COLORS: Record<string, string> = {
  RECRUITING: "bg-blue-100 text-blue-700",
  ONGOING: "bg-green-100 text-green-700",
  FINISHED: "bg-slate-100 text-slate-500",
};

const TABS = [["", "全部"], ["RECRUITING", "招生中"], ["ONGOING", "进行中"], ["FINISHED", "已结班"]] as const;

export default function ClassesPage() {
  const { data: session } = useSession();
  const roles: string[] = (session?.user as { roles?: string[] })?.roles ?? [];
  const canManage = roles.some((r) => ["ACADEMIC_ADMIN", "PRINCIPAL", "SUPER_ADMIN"].includes(r));

  const [items, setItems] = useState<GroupClass[]>([]);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [teacherFilter, setTeacherFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [showForm, setShowForm] = useState(false);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [subjects, setSubjects] = useState<Opt[]>([]);
  const [grades, setGrades] = useState<Opt[]>([]);
  const [teachers, setTeachers] = useState<Opt[]>([]);
  const [rooms, setRooms] = useState<{ id: string; name: string; campus: { name: string } }[]>([]);
  const [form, setForm] = useState({
    name: "", campusId: "", subjectId: "", gradeId: "", teacherId: "", classroomId: "", capacity: "", deliveryMode: "ONSITE",
  });
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (filter) params.set("status", filter);
    if (search.trim()) params.set("search", search.trim());
    if (subjectFilter) params.set("subjectId", subjectFilter);
    if (teacherFilter) params.set("teacherId", teacherFilter);
    const res = await fetch(`/api/classes?${params}`);
    if (res.ok) {
      const d = await res.json();
      setItems(d.items); setTotal(d.total); setTotalPages(d.totalPages);
    }
    setLoading(false);
  }, [filter, page, search, subjectFilter, teacherFilter]);

  // 搜索输入防抖，避免每敲一个字打一次接口。
  useEffect(() => {
    const t = setTimeout(() => { load(); }, 250);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => { setPage(1); }, [filter, search, subjectFilter, teacherFilter]);

  // 科目/老师筛选项：进页面就要，不等打开新建表单。
  useEffect(() => {
    fetch("/api/admin/subjects").then((r) => (r.ok ? r.json() : [])).then(setSubjects);
    fetch("/api/schedule/teachers").then((r) => (r.ok ? r.json() : [])).then(setTeachers);
  }, []);

  useEffect(() => {
    if (!showForm) return;
    Promise.all([
      fetch("/api/admin/campuses").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/admin/subjects").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/admin/grades").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/schedule/teachers").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/schedule/classrooms").then((r) => (r.ok ? r.json() : [])),
    ]).then(([c, s, g, t, rm]) => {
      setCampuses(c); setSubjects(s); setGrades(g); setTeachers(t); setRooms(rm);
      if (c.length === 1) setForm((f) => ({ ...f, campusId: c[0].id }));
    });
  }, [showForm]);

  async function submit() {
    setError("");
    const res = await fetch("/api/classes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        campusId: form.campusId,
        subjectId: form.subjectId,
        gradeId: form.gradeId || null,
        teacherId: form.teacherId || null,
        classroomId: form.deliveryMode === "ONLINE" ? null : (form.classroomId || null),
        deliveryMode: form.deliveryMode,
        capacity: form.capacity ? Number(form.capacity) : null,
      }),
    });
    if (res.ok) {
      setShowForm(false);
      setForm({ name: "", campusId: "", subjectId: "", gradeId: "", teacherId: "", classroomId: "", capacity: "", deliveryMode: "ONSITE" });
      load();
    } else setError((await res.json()).error ?? "创建失败");
  }

  const inputCls = "w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">班级管理</h1>
        {canManage && (
          <button onClick={() => setShowForm((v) => !v)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
            {showForm ? "取消" : "+ 新建班级"}
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4 max-w-2xl">
          <h2 className="font-semibold text-slate-800">新建班级</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">班级名称 *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="如 G10 数学晚班" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">校区 *</label>
              <select value={form.campusId} onChange={(e) => setForm({ ...form, campusId: e.target.value })} className={inputCls}>
                <option value="">选择校区</option>
                {campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">科目 *</label>
              <select value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })} className={inputCls}>
                <option value="">选择科目</option>
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <p className="text-xs text-slate-400 mt-1">只有同科目的班课课包才能入班</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">年级</label>
              <select value={form.gradeId} onChange={(e) => setForm({ ...form, gradeId: e.target.value })} className={inputCls}>
                <option value="">不限</option>
                {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">默认老师</label>
              <select value={form.teacherId} onChange={(e) => setForm({ ...form, teacherId: e.target.value })} className={inputCls}>
                <option value="">排课时再定</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">默认上课形式</label>
              <select value={form.deliveryMode}
                onChange={(e) => setForm({ ...form, deliveryMode: e.target.value, classroomId: e.target.value === "ONLINE" ? "" : form.classroomId })}
                className={inputCls}>
                <option value="ONSITE">线下</option>
                <option value="ONLINE">线上</option>
              </select>
            </div>
            {form.deliveryMode === "ONSITE" && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">默认教室</label>
                <select value={form.classroomId} onChange={(e) => setForm({ ...form, classroomId: e.target.value })} className={inputCls}>
                  <option value="">排课时再定</option>
                  {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}（{r.campus.name}）</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">容量上限</label>
              <input type="number" min="1" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })}
                placeholder="不填为不限" className={inputCls} />
            </div>
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button onClick={submit} className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
            创建班级
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2">
          {TABS.map(([val, label]) => (
            <button key={val} onClick={() => setFilter(val)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${filter === val ? "bg-blue-600 text-white border-blue-600" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap">
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索班级名或科目..."
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm w-52 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <select value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">全部科目</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={teacherFilter} onChange={(e) => setTeacherFilter(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">全部老师</option>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {(search || subjectFilter || teacherFilter) && (
            <button onClick={() => { setSearch(""); setSubjectFilter(""); setTeacherFilter(""); }}
              className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700">清除</button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full min-w-[820px]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">班级</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">科目 / 年级</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">老师 / 教室</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">人数</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">课次</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">状态</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-sm">加载中...</td></tr>}
            {!loading && items.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-sm">暂无班级</td></tr>}
            {items.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm font-medium text-slate-800">
                  <Link href={`/classes/${c.id}`} className="hover:text-blue-600">{c.name}</Link>
                  <div className="text-xs text-slate-400">{c.campus.name}</div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">
                  {c.subject.name}{c.grade ? ` · ${c.grade.name}` : ""}
                </td>
                <td className="px-4 py-3 text-sm text-slate-500">
                  {c.teacher?.name ?? "—"}
                  <div className="text-xs text-slate-400"><LocationTag deliveryMode={c.deliveryMode} classroomName={c.classroom?.name} /></div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-800 tabular-nums">
                  {c.members.length}{c.capacity ? ` / ${c.capacity}` : ""}
                </td>
                <td className="px-4 py-3 text-sm text-slate-500 tabular-nums">{c._count.sessions}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[c.status]}`}>
                    {GROUP_CLASS_STATUS_LABELS[c.status] ?? c.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/classes/${c.id}`} className="text-blue-600 text-sm hover:underline">详情</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={totalPages} total={total} onChange={setPage} />
    </div>
  );
}
