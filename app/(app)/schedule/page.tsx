"use client";

import { useState, useEffect, useCallback } from "react";
import { isDepleted, isLowOnHours, LOW_HOURS_THRESHOLD } from "@/lib/hours";

// ── Constants ─────────────────────────────────────────────────────────────────
const TEACHERS_PER_PAGE = 5;
const DAY_NAMES   = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const DAY_START   = 8;
const DAY_END     = 22;
const HOUR_PX     = 56;
const HOURS       = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);
const GRID_H      = HOUR_PX * (DAY_END - DAY_START);

// ── Types ─────────────────────────────────────────────────────────────────────
type Teacher = {
  id: string;
  name: string;
  roles: { role: string }[];
  campuses: { campus: { id: string; name: string } }[];
};

type Lesson = {
  id: string;
  start: string;
  end: string;
  extendedProps: {
    teacherId: string;
    teacherName: string;
    studentId: string;
    studentName: string;
    subjectName: string;
    classroomName: string;
    packageId: string;
    lessonType: string;
    hasLog: boolean;
    isConfirmed: boolean;
  };
};

type Student   = { id: string; name: string };
type Package   = { id: string; grade: { name: string }; subject: { name: string }; remainingHours: string };
type Classroom = { id: string; name: string; campus: { name: string } };

// ── Helpers ───────────────────────────────────────────────────────────────────
function getMonday(d: Date): Date {
  const date = new Date(d);
  const day  = date.getDay();
  date.setDate(date.getDate() - day + (day === 0 ? -6 : 1));
  date.setHours(0, 0, 0, 0);
  return date;
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth()    === b.getMonth()
      && a.getDate()     === b.getDate();
}

function fmtTime(d: Date) {
  return d.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function lessonTopPx(startIso: string) {
  const d = new Date(startIso);
  return Math.max(0, (d.getHours() + d.getMinutes() / 60 - DAY_START) * HOUR_PX);
}

function lessonHeightPx(startIso: string, endIso: string) {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  return Math.max(20, (ms / 3_600_000) * HOUR_PX);
}

function lessonColor(ep: Lesson["extendedProps"]) {
  if (ep.isConfirmed) return "bg-green-100 border-green-400 text-green-900";
  if (ep.hasLog)      return "bg-amber-100 border-amber-400 text-amber-900";
  return "bg-blue-100 border-blue-400 text-blue-900";
}

function lessonDot(ep: Lesson["extendedProps"]) {
  if (ep.isConfirmed) return "bg-green-500";
  if (ep.hasLog)      return "bg-amber-400";
  return "bg-blue-500";
}

// ── Desktop: single-teacher timetable ────────────────────────────────────────
function TeacherTimetable({
  teacher, weekDays, lessons, onCellClick, onLessonClick,
}: {
  teacher: Teacher;
  weekDays: Date[];
  lessons: Lesson[];
  onCellClick: (teacherId: string, day: Date, hour: number) => void;
  onLessonClick: (lesson: Lesson) => void;
}) {
  const today = new Date();
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden shadow-sm">
      {/* Teacher bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-700 text-white">
        <span className="font-semibold text-sm">{teacher.name}</span>
        {teacher.campuses[0] && (
          <span className="text-xs text-slate-300 bg-slate-600 rounded px-2 py-0.5">
            {teacher.campuses[0].campus.name}
          </span>
        )}
      </div>
      {/* Day headers */}
      <div className="flex border-b border-slate-200 bg-slate-50">
        <div className="w-14 shrink-0 border-r border-slate-200" />
        {weekDays.map((day, i) => {
          const isToday = isSameDay(day, today);
          return (
            <div key={i} className={`flex-1 text-center py-2 border-r border-slate-200 last:border-r-0 text-xs font-semibold
              ${isToday ? "bg-blue-50 text-blue-600" : "text-slate-500"}`}>
              <div>{DAY_NAMES[i]}</div>
              <div className={`text-base font-bold mt-0.5 ${isToday ? "text-blue-600" : "text-slate-800"}`}>
                {day.getDate()}
              </div>
            </div>
          );
        })}
      </div>
      {/* Grid */}
      <div className="flex" style={{ height: GRID_H }}>
        {/* Hour labels */}
        <div className="w-14 shrink-0 border-r border-slate-200 relative">
          {HOURS.map(h => (
            <div key={h} className="absolute w-full text-right pr-2 text-xs text-slate-400 select-none"
              style={{ top: (h - DAY_START) * HOUR_PX - 7 }}>
              {h}:00
            </div>
          ))}
        </div>
        {/* Day columns */}
        {weekDays.map((day, di) => {
          const isToday = isSameDay(day, today);
          const dayLessons = lessons.filter(
            l => l.extendedProps.teacherId === teacher.id && isSameDay(new Date(l.start), day)
          );
          return (
            <div key={di}
              className={`flex-1 relative border-r border-slate-200 last:border-r-0 cursor-pointer
                ${isToday ? "bg-blue-50/20" : "bg-white"} hover:bg-blue-50/40 transition-colors`}
              onClick={e => {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const hour = Math.min(Math.floor((e.clientY - rect.top) / HOUR_PX) + DAY_START, DAY_END - 1);
                onCellClick(teacher.id, day, hour);
              }}
            >
              {HOURS.map(h => (
                <div key={h} className="absolute inset-x-0 border-t border-slate-100 pointer-events-none"
                  style={{ top: (h - DAY_START) * HOUR_PX }} />
              ))}
              {dayLessons.map(lesson => (
                <div key={lesson.id}
                  className={`absolute inset-x-0.5 rounded border-l-2 px-1.5 py-1 text-xs overflow-hidden
                    shadow-sm cursor-pointer hover:opacity-80 transition-opacity ${lessonColor(lesson.extendedProps)}`}
                  style={{ top: lessonTopPx(lesson.start), height: lessonHeightPx(lesson.start, lesson.end) }}
                  onClick={e => { e.stopPropagation(); onLessonClick(lesson); }}
                >
                  <div className="font-semibold truncate leading-tight">{lesson.extendedProps.studentName}</div>
                  {lessonHeightPx(lesson.start, lesson.end) >= 36 && (
                    <div className="truncate opacity-75 leading-tight">{lesson.extendedProps.subjectName}</div>
                  )}
                  {lessonHeightPx(lesson.start, lesson.end) >= 50 && (
                    <div className="opacity-60 leading-tight">
                      {fmtTime(new Date(lesson.start))}–{fmtTime(new Date(lesson.end))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Mobile: day-view card list for one teacher ────────────────────────────────
function TeacherDayCard({
  teacher, day, lessons, onAdd, onLessonClick,
}: {
  teacher: Teacher;
  day: Date;
  lessons: Lesson[];
  onAdd: (teacherId: string, day: Date) => void;
  onLessonClick: (lesson: Lesson) => void;
}) {
  const dayLessons = lessons
    .filter(l => l.extendedProps.teacherId === teacher.id && isSameDay(new Date(l.start), day))
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden shadow-sm">
      {/* Teacher bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-700 text-white">
        <div>
          <span className="font-semibold text-sm">{teacher.name}</span>
          {teacher.campuses[0] && (
            <span className="ml-2 text-xs text-slate-300">· {teacher.campuses[0].campus.name}</span>
          )}
        </div>
        <span className="text-xs text-slate-400">{dayLessons.length} 节课</span>
      </div>

      {/* Lesson list */}
      <div className="divide-y divide-slate-100 bg-white">
        {dayLessons.length === 0 ? (
          <div className="px-4 py-5 text-center text-slate-400 text-sm">今日暂无排课</div>
        ) : (
          dayLessons.map(lesson => {
            const ep = lesson.extendedProps;
            return (
              <button key={lesson.id} onClick={() => onLessonClick(lesson)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 active:bg-slate-100 transition-colors">
                {/* Time column */}
                <div className="w-14 shrink-0 text-xs text-slate-500 font-mono text-center">
                  <div className="font-semibold text-slate-700">{fmtTime(new Date(lesson.start))}</div>
                  <div className="text-slate-400">{fmtTime(new Date(lesson.end))}</div>
                </div>
                {/* Color dot */}
                <div className={`w-2 h-2 rounded-full shrink-0 ${lessonDot(ep)}`} />
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-800 text-sm truncate">{ep.studentName}</div>
                  <div className="text-xs text-slate-500 truncate">{ep.subjectName} · {ep.classroomName}</div>
                </div>
                {/* Status badge */}
                <div className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium
                  ${ep.isConfirmed ? "bg-green-100 text-green-700"
                  : ep.hasLog     ? "bg-amber-100 text-amber-700"
                                  : "bg-blue-100 text-blue-700"}`}>
                  {ep.isConfirmed ? "已核销" : ep.hasLog ? "待确认" : "已排课"}
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Add button */}
      <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-100">
        <button onClick={() => onAdd(teacher.id, day)}
          className="w-full flex items-center justify-center gap-2 py-2 text-sm text-blue-600 font-medium
            rounded-lg border border-dashed border-blue-300 hover:bg-blue-50 active:bg-blue-100 transition-colors">
          <span className="text-lg leading-none">＋</span> 添加排课
        </button>
      </div>
    </div>
  );
}

// ── Create / Detail modal shared ──────────────────────────────────────────────
function CreateModal({
  teachers, classrooms, teacherId, date, startTime, endTime,
  onStartChange, onEndChange, onClose, onSave, error,
}: {
  teachers: Teacher[];
  classrooms: Classroom[];
  teacherId: string;
  date: string;
  startTime: string;
  endTime: string;
  onStartChange: (v: string) => void;
  onEndChange:   (v: string) => void;
  onClose: () => void;
  onSave:  (data: { studentId: string; packageId: string; classroomId: string; lessonType: string }) => void;
  error: string;
}) {
  const [studentSearch,   setStudentSearch]   = useState("");
  const [studentResults,  setStudentResults]  = useState<Student[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [studentPackages, setStudentPackages] = useState<Package[]>([]);
  const [form, setForm] = useState({ studentId: "", packageId: "", classroomId: "", lessonType: "ONE_ON_ONE" });

  async function search(q: string) {
    setStudentSearch(q);
    if (q.length < 2) { setStudentResults([]); return; }
    const res = await fetch(`/api/students?search=${encodeURIComponent(q)}&status=enrolled`);
    if (res.ok) setStudentResults(await res.json());
  }

  async function pickStudent(s: Student) {
    setSelectedStudent(s);
    setStudentSearch(s.name);
    setStudentResults([]);
    setForm(f => ({ ...f, studentId: s.id, packageId: "" }));
    const res = await fetch(`/api/packages?studentId=${s.id}&status=ACTIVE`);
    if (res.ok) setStudentPackages(await res.json());
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50"
      onClick={onClose}>
      {/* Sheet slides up on mobile, centered dialog on desktop */}
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-xl p-5 shadow-xl
        max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-slate-800 text-lg">新建排课</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          {teachers.find(t => t.id === teacherId)?.name} · {date}
        </p>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">开始时间 *</label>
              <input type="time" value={startTime} onChange={e => onStartChange(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">结束时间 *</label>
              <input type="time" value={endTime} onChange={e => onEndChange(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">学生 * (在读)</label>
            <div className="relative">
              <input value={studentSearch} onChange={e => search(e.target.value)}
                placeholder="输入姓名搜索..."
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              {studentResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg z-10 mt-1 max-h-40 overflow-y-auto">
                  {studentResults.map(s => (
                    <button key={s.id} type="button" onClick={() => pickStudent(s)}
                      className="w-full text-left px-3 py-2.5 text-sm hover:bg-slate-50">{s.name}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {selectedStudent && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">课包 *</label>
              <select value={form.packageId} onChange={e => setForm(f => ({ ...f, packageId: e.target.value }))}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">选择课包</option>
                {studentPackages.map(p => {
                  const depleted = isDepleted(p.remainingHours);
                  const suffix = depleted ? "（已耗尽，不可排课）" : isLowOnHours(p.remainingHours) ? "⚠️ 续费预警" : "";
                  return (
                    <option key={p.id} value={p.id} disabled={depleted}>
                      {p.grade?.name} · {p.subject.name} — 剩余 {Number(p.remainingHours).toFixed(1)}h {suffix}
                    </option>
                  );
                })}
              </select>
              {(() => {
                const sel = studentPackages.find(p => p.id === form.packageId);
                if (!sel) return null;
                if (isDepleted(sel.remainingHours))
                  return <p className="mt-1.5 text-xs text-red-600">该课包课时已耗尽，需先续费方可排课。</p>;
                if (isLowOnHours(sel.remainingHours))
                  return <p className="mt-1.5 text-xs text-amber-600">⚠️ 剩余不足 {LOW_HOURS_THRESHOLD}h，请提醒学生续费。</p>;
                return null;
              })()}
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">教室 *</label>
            <select value={form.classroomId} onChange={e => setForm(f => ({ ...f, classroomId: e.target.value }))}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">选择教室</option>
              {classrooms.map(c => <option key={c.id} value={c.id}>{c.name}（{c.campus.name}）</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">课程类型</label>
            <select value={form.lessonType} onChange={e => setForm(f => ({ ...f, lessonType: e.target.value }))}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="ONE_ON_ONE">1 对 1</option>
              <option value="GROUP">班课</option>
            </select>
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button onClick={() => onSave(form)}
            className="w-full py-3 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 active:bg-blue-800 transition-colors mt-1">
            保存排课
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SchedulePage() {
  const [teachers,   setTeachers]   = useState<Teacher[]>([]);
  const [teacherPage, setTeacherPage] = useState(0);
  const [weekStart,  setWeekStart]  = useState<Date>(() => getMonday(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date>(() => {
    const t = new Date(); t.setHours(0, 0, 0, 0); return t;
  });
  const [lessons,    setLessons]    = useState<Lesson[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [loading,    setLoading]    = useState(false);

  // Modal state
  const [showModal,      setShowModal]      = useState(false);
  const [modalTeacherId, setModalTeacherId] = useState("");
  const [modalDate,      setModalDate]      = useState("");
  const [modalStart,     setModalStart]     = useState("16:00");
  const [modalEnd,       setModalEnd]       = useState("18:00");
  const [modalError,     setModalError]     = useState("");

  // Detail popup
  const [detail, setDetail] = useState<Lesson | null>(null);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const visibleTeachers = teachers.slice(
    teacherPage * TEACHERS_PER_PAGE,
    (teacherPage + 1) * TEACHERS_PER_PAGE
  );
  const totalPages = Math.ceil(teachers.length / TEACHERS_PER_PAGE);

  useEffect(() => {
    fetch("/api/admin/users")
      .then(r => r.ok ? r.json() : [])
      .then((u: Teacher[]) => setTeachers(u.filter(x => x.roles.some(r => r.role === "TEACHER"))));
    fetch("/api/schedule/classrooms")
      .then(r => r.ok ? r.json() : [])
      .then(setClassrooms);
  }, []);

  const loadLessons = useCallback(async () => {
    setLoading(true);
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 7);
    const res = await fetch(`/api/schedule?start=${weekStart.toISOString()}&end=${end.toISOString()}`);
    if (res.ok) setLessons(await res.json());
    setLoading(false);
  }, [weekStart]);

  useEffect(() => { loadLessons(); }, [loadLessons]);

  // Keep selectedDay in sync when week changes
  useEffect(() => {
    if (!weekDays.some(d => isSameDay(d, selectedDay))) {
      setSelectedDay(new Date(weekStart));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  function prevWeek() { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(d); }
  function nextWeek() { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(d); }
  function goToday()  { setWeekStart(getMonday(new Date())); const t = new Date(); t.setHours(0,0,0,0); setSelectedDay(t); }

  function openModal(teacherId: string, day: Date, hour = 16) {
    const sh = String(hour).padStart(2, "0");
    const eh = String(Math.min(hour + 2, DAY_END)).padStart(2, "0");
    setModalTeacherId(teacherId);
    setModalDate(day.toISOString().slice(0, 10));
    setModalStart(`${sh}:00`);
    setModalEnd(`${eh}:00`);
    setModalError("");
    setShowModal(true);
  }

  async function handleSave(formData: { studentId: string; packageId: string; classroomId: string; lessonType: string }) {
    if (!modalTeacherId || !formData.studentId || !formData.packageId || !formData.classroomId) {
      setModalError("请填写所有必填字段"); return;
    }
    const startTime = new Date(`${modalDate}T${modalStart}:00`);
    const endTime   = new Date(`${modalDate}T${modalEnd}:00`);
    if (endTime <= startTime) { setModalError("结束时间须晚于开始时间"); return; }
    setModalError("");
    const res = await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teacherId: modalTeacherId, ...formData, startTime: startTime.toISOString(), endTime: endTime.toISOString() }),
    });
    if (res.ok) { setShowModal(false); loadLessons(); }
    else { const d = await res.json(); setModalError(d.error); }
  }

  const weekLabel = `${weekDays[0].toLocaleDateString("en-CA", { month: "long", day: "numeric" })} – ${weekDays[6].toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" })}`;
  const today = new Date();

  return (
    <div className="space-y-4">
      {/* ── Top bar (shared) ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-800">排课日历</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Legend (hidden on very small screens) */}
          <div className="hidden sm:flex gap-3 text-xs text-slate-500 mr-1">
            {[["bg-blue-400","已排课"],["bg-amber-400","待核销"],["bg-green-500","已核销"]].map(([c, l]) => (
              <span key={l} className="flex items-center gap-1">
                <span className={`w-2.5 h-2.5 rounded-sm ${c} inline-block`} />{l}
              </span>
            ))}
          </div>
          <button onClick={prevWeek} className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm hover:bg-slate-50">←</button>
          <span className="text-sm font-medium text-slate-700 hidden sm:inline min-w-52 text-center">{weekLabel}</span>
          <button onClick={nextWeek} className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm hover:bg-slate-50">→</button>
          <button onClick={goToday}  className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm hover:bg-slate-50 text-blue-600">本周</button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          MOBILE VIEW  (block on <md, hidden on ≥md)
      ══════════════════════════════════════════════════════════════ */}
      <div className="md:hidden space-y-4">
        {/* Week label for mobile */}
        <div className="text-center text-xs text-slate-500">{weekLabel}</div>

        {/* Day selector strip */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 scroll-smooth snap-x">
          {weekDays.map((day, i) => {
            const isToday    = isSameDay(day, today);
            const isSelected = isSameDay(day, selectedDay);
            return (
              <button key={i} onClick={() => setSelectedDay(day)}
                className={`flex-shrink-0 snap-start flex flex-col items-center px-3 py-2 rounded-xl text-xs font-medium transition-colors
                  ${isSelected
                    ? "bg-blue-600 text-white"
                    : isToday
                    ? "bg-blue-50 text-blue-600 border border-blue-200"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                <span>{DAY_NAMES[i]}</span>
                <span className="text-base font-bold mt-0.5">{day.getDate()}</span>
              </button>
            );
          })}
        </div>

        {/* Selected day headline */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">
            {selectedDay.toLocaleDateString("en-CA", { month: "long", day: "numeric", weekday: "long" })}
          </h2>
          {/* Mobile legend */}
          <div className="flex gap-2 text-xs text-slate-400">
            {[["bg-blue-400","排"],["bg-amber-400","待"],["bg-green-500","核"]].map(([c, l]) => (
              <span key={l} className="flex items-center gap-0.5">
                <span className={`w-2 h-2 rounded-full ${c} inline-block`} />{l}
              </span>
            ))}
          </div>
        </div>

        {/* Loading */}
        {loading && <div className="text-center text-slate-400 py-10 text-sm">加载中...</div>}

        {/* Teacher day cards */}
        {!loading && teachers.length === 0 && (
          <div className="text-center text-slate-400 py-10 text-sm">暂无老师数据</div>
        )}
        {!loading && teachers.map(teacher => (
          <TeacherDayCard
            key={teacher.id}
            teacher={teacher}
            day={selectedDay}
            lessons={lessons}
            onAdd={(tid, day) => openModal(tid, day)}
            onLessonClick={setDetail}
          />
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════
          DESKTOP VIEW  (hidden on <md, block on ≥md)
      ══════════════════════════════════════════════════════════════ */}
      <div className="hidden md:block space-y-4">
        {/* Teacher pagination */}
        {totalPages > 1 && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500">
              老师 {teacherPage * TEACHERS_PER_PAGE + 1}–{Math.min((teacherPage + 1) * TEACHERS_PER_PAGE, teachers.length)} / 共 {teachers.length} 位
            </span>
            <button disabled={teacherPage === 0} onClick={() => setTeacherPage(p => p - 1)}
              className="px-3 py-1 border border-slate-300 rounded-lg disabled:opacity-40 hover:bg-slate-50">← 上页</button>
            <button disabled={teacherPage >= totalPages - 1} onClick={() => setTeacherPage(p => p + 1)}
              className="px-3 py-1 border border-slate-300 rounded-lg disabled:opacity-40 hover:bg-slate-50">下页 →</button>
          </div>
        )}

        {loading && <div className="text-center text-slate-400 py-10 text-sm">加载中...</div>}
        {!loading && visibleTeachers.length === 0 && (
          <div className="text-center text-slate-400 py-20">暂无老师数据</div>
        )}
        {!loading && visibleTeachers.map(teacher => (
          <TeacherTimetable
            key={teacher.id}
            teacher={teacher}
            weekDays={weekDays}
            lessons={lessons}
            onCellClick={openModal}
            onLessonClick={setDetail}
          />
        ))}
      </div>

      {/* ── Create modal ── */}
      {showModal && (
        <CreateModal
          teachers={teachers}
          classrooms={classrooms}
          teacherId={modalTeacherId}
          date={modalDate}
          startTime={modalStart}
          endTime={modalEnd}
          onStartChange={setModalStart}
          onEndChange={setModalEnd}
          onClose={() => setShowModal(false)}
          onSave={handleSave}
          error={modalError}
        />
      )}

      {/* ── Detail popup ── */}
      {detail && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50"
          onClick={() => setDetail(null)}>
          <div className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-xl p-5 shadow-xl"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-slate-800">课程详情</h2>
              <button onClick={() => setDetail(null)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
            </div>
            <div className="space-y-3 text-sm">
              {[
                ["学生", detail.extendedProps.studentName],
                ["老师", detail.extendedProps.teacherName],
                ["科目", detail.extendedProps.subjectName],
                ["教室", detail.extendedProps.classroomName],
                ["时间", `${fmtTime(new Date(detail.start))} – ${fmtTime(new Date(detail.end))}`],
                ["类型", detail.extendedProps.lessonType === "ONE_ON_ONE" ? "1 对 1" : "班课"],
                ["状态", detail.extendedProps.isConfirmed ? "✅ 已核销" : detail.extendedProps.hasLog ? "⏳ 待确认" : "📅 已排课"],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between items-center py-1 border-b border-slate-50 last:border-0">
                  <span className="text-slate-400">{label}</span>
                  <span className="font-medium text-slate-800">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
