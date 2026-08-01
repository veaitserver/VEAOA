"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { formatPhone } from "@/lib/utils";
import { CLASS_TYPE_LABELS } from "@/lib/enums";

type Grade = { id: string; name: string };
type Subject = { id: string; name: string };
type Student = { id: string; name: string; phone: string };

function NewPackageForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedStudentId = searchParams.get("studentId") ?? "";

  const [grades, setGrades] = useState<Grade[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [studentSearch, setStudentSearch] = useState("");
  const [students, setStudents] = useState<Student[]>([]);
  const [form, setForm] = useState({
    studentId: preselectedStudentId,
    gradeId: "", subjectId: "", notes: "",
    totalHours: "", pricePerHour: "", totalAmount: "",
    classType: "ONE_ON_ONE",
  });
  const [error, setError] = useState("");
  const lastEdited = useRef<"H" | "P" | "M" | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/grades").then(r => r.json()),
      fetch("/api/admin/subjects").then(r => r.json()),
    ]).then(([g, s]) => { setGrades(g); setSubjects(s); });
  }, []);

  useEffect(() => {
    if (studentSearch.length >= 2) {
      fetch(`/api/students?search=${encodeURIComponent(studentSearch)}`).then(r => r.ok ? r.json() : []).then(setStudents);
    }
  }, [studentSearch]);

  // Triangle calculator
  function handleTriangle(field: "totalHours" | "pricePerHour" | "totalAmount", value: string) {
    const updated = { ...form, [field]: value };
    const H = parseFloat(updated.totalHours);
    const P = parseFloat(updated.pricePerHour);
    const M = parseFloat(updated.totalAmount);

    if (field === "totalHours" || field === "pricePerHour") {
      if (!isNaN(H) && !isNaN(P)) updated.totalAmount = (H * P).toFixed(2);
    } else if (field === "totalAmount") {
      if (!isNaN(M) && !isNaN(P) && P > 0) updated.totalHours = (M / P).toFixed(2);
      else if (!isNaN(M) && !isNaN(H) && H > 0) updated.pricePerHour = (M / H).toFixed(2);
    }
    setForm(updated);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/packages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        studentId: form.studentId,
        gradeId: form.gradeId,
        subjectId: form.subjectId,
        totalHours: parseFloat(form.totalHours),
        pricePerHour: parseFloat(form.pricePerHour),
        totalAmount: parseFloat(form.totalAmount),
        classType: form.classType,
        notes: form.notes,
      }),
    });
    if (res.ok) {
      const pkg = await res.json();
      router.push(`/packages/${pkg.id}`);
    } else {
      const d = await res.json();
      setError(d.error);
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="text-slate-400 hover:text-slate-600 text-lg">←</button>
        <h1 className="text-2xl font-bold text-slate-800">新建课包</h1>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Student */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">选择学生 *</label>
            {preselectedStudentId ? (
              <input readOnly value={preselectedStudentId} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-slate-50" />
            ) : (
              <div className="relative">
                <input value={studentSearch} onChange={e => setStudentSearch(e.target.value)}
                  placeholder="输入姓名或手机号搜索..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                {students.length > 0 && (
                  <div className="absolute top-full left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg z-10 mt-1 max-h-48 overflow-y-auto">
                    {students.map(s => (
                      <button key={s.id} type="button"
                        onClick={() => { setForm({ ...form, studentId: s.id }); setStudentSearch(s.name); setStudents([]); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50">
                        {s.name} — {formatPhone(s.phone)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">年级 *</label>
              <select value={form.gradeId} onChange={e => setForm({...form, gradeId: e.target.value})} required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">选择年级</option>
                {grades.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">科目 *</label>
              <select value={form.subjectId} onChange={e => setForm({...form, subjectId: e.target.value})} required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">选择科目</option>
                {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">授课形式 *</label>
            <div className="flex gap-2">
              {(["ONE_ON_ONE", "GROUP"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setForm({ ...form, classType: t })}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition ${
                    form.classType === t
                      ? "bg-blue-600 text-white border-blue-600"
                      : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
                  {CLASS_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {form.classType === "GROUP"
                ? "班课课包需加入班级后随班级排课，不能单独排课。"
                : "一对一课包按学生单独排课。"}
            </p>
          </div>

          {/* Triangle Calculator */}
          <div className="rounded-xl bg-blue-50 border border-blue-200 p-4">
            <p className="text-xs font-semibold text-blue-700 mb-3">💡 智能算费：输入任意两项，自动计算第三项 (H × P = M)</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">总课时 H (小时) *</label>
                <input type="number" step="0.5" min="0.5" value={form.totalHours}
                  onChange={e => handleTriangle("totalHours", e.target.value)}
                  required placeholder="e.g. 20"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">课时单价 P ($) *</label>
                <input type="number" step="1" min="1" value={form.pricePerHour}
                  onChange={e => handleTriangle("pricePerHour", e.target.value)}
                  required placeholder="e.g. 200"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">总金额 M ($) *</label>
                <input type="number" step="1" min="1" value={form.totalAmount}
                  onChange={e => handleTriangle("totalAmount", e.target.value)}
                  required placeholder="e.g. 4000"
                  className="w-full px-3 py-2 border border-blue-400 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">备注</label>
            <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})}
              rows={2} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => router.back()} className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">取消</button>
            <button type="submit" className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">提交课包 (待确认)</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function NewPackagePage() {
  return <Suspense fallback={<div>Loading...</div>}><NewPackageForm /></Suspense>;
}
