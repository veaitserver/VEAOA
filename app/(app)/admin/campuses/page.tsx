"use client";

import { useState, useEffect } from "react";
import { formatDate } from "@/lib/utils";

type Campus = { id: string; name: string; createdAt: string };
type Classroom = { id: string; name: string; capacity: number | null; campusId: string; campus: { name: string }; _count: { lessons: number } };

export default function CampusesPage() {
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [name, setName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState("");

  // 教室管理
  const [roomCampusId, setRoomCampusId] = useState("");
  const [roomName, setRoomName] = useState("");
  const [roomCapacity, setRoomCapacity] = useState("");
  const [roomError, setRoomError] = useState("");

  async function load() {
    const [c, r] = await Promise.all([
      fetch("/api/admin/campuses").then((res) => (res.ok ? res.json() : [])),
      fetch("/api/admin/classrooms").then((res) => (res.ok ? res.json() : [])),
    ]);
    setCampuses(c);
    setClassrooms(r);
    if (c.length && !roomCampusId) setRoomCampusId(c[0].id);
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/admin/campuses", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) { setName(""); load(); }
    else setError((await res.json()).error);
  }

  async function handleUpdate(id: string) {
    const res = await fetch(`/api/admin/campuses/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName }),
    });
    if (res.ok) { setEditId(null); load(); }
  }

  async function handleDelete(id: string) {
    if (!confirm("确定删除该校区？")) return;
    const res = await fetch(`/api/admin/campuses/${id}`, { method: "DELETE" });
    if (!res.ok) alert((await res.json()).error ?? "删除失败");
    load();
  }

  async function handleAddRoom(e: React.FormEvent) {
    e.preventDefault();
    setRoomError("");
    const res = await fetch("/api/admin/classrooms", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: roomName, campusId: roomCampusId, capacity: roomCapacity ? Number(roomCapacity) : null }),
    });
    if (res.ok) { setRoomName(""); setRoomCapacity(""); load(); }
    else setRoomError((await res.json()).error ?? "添加失败");
  }

  async function handleDeleteRoom(id: string) {
    if (!confirm("确定删除该教室？")) return;
    const res = await fetch(`/api/admin/classrooms/${id}`, { method: "DELETE" });
    if (!res.ok) alert((await res.json()).error ?? "删除失败");
    load();
  }

  const roomsOfCampus = classrooms.filter((r) => r.campusId === roomCampusId);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">校区与教室管理</h1>

      {/* ── 校区 ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="font-semibold text-slate-700 mb-4">添加校区</h2>
        <form onSubmit={handleCreate} className="flex gap-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="校区名称"
            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">添加</button>
        </form>
        {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">校区名称</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">教室数</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">创建时间</th>
              <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {campuses.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-6 py-3 text-sm text-slate-800">
                  {editId === c.id ? (
                    <input value={editName} onChange={(e) => setEditName(e.target.value)}
                      className="px-2 py-1 border border-blue-400 rounded text-sm w-40" />
                  ) : c.name}
                </td>
                <td className="px-6 py-3 text-sm text-slate-500">{classrooms.filter((r) => r.campusId === c.id).length}</td>
                <td className="px-6 py-3 text-sm text-slate-500">{formatDate(c.createdAt)}</td>
                <td className="px-6 py-3 text-right space-x-2">
                  {editId === c.id ? (
                    <>
                      <button onClick={() => handleUpdate(c.id)} className="text-blue-600 text-sm hover:underline">保存</button>
                      <button onClick={() => setEditId(null)} className="text-slate-400 text-sm hover:underline">取消</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => { setEditId(c.id); setEditName(c.name); }} className="text-blue-600 text-sm hover:underline">编辑</button>
                      <button onClick={() => handleDelete(c.id)} className="text-red-500 text-sm hover:underline">删除</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {campuses.length === 0 && <tr><td colSpan={4} className="px-6 py-8 text-center text-slate-400 text-sm">暂无校区</td></tr>}
          </tbody>
        </table>
      </div>

      {/* ── 教室 ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-700">教室管理</h2>
          <select value={roomCampusId} onChange={(e) => setRoomCampusId(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <form onSubmit={handleAddRoom} className="flex gap-3">
          <input value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="教室名称，如 Room 101" required
            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input value={roomCapacity} onChange={(e) => setRoomCapacity(e.target.value)} placeholder="容量(选填)" type="number" min="1"
            className="w-28 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button type="submit" disabled={!roomCampusId} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">添加教室</button>
        </form>
        {roomError && <p className="text-red-600 text-sm">{roomError}</p>}

        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500 uppercase">教室</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500 uppercase">容量</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500 uppercase">已排课</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-slate-500 uppercase">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {roomsOfCampus.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-slate-800">{r.name}</td>
                  <td className="px-4 py-2 text-slate-500">{r.capacity ?? "—"}</td>
                  <td className="px-4 py-2 text-slate-500">{r._count.lessons}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => handleDeleteRoom(r.id)} className="text-red-500 text-sm hover:underline">删除</button>
                  </td>
                </tr>
              ))}
              {roomsOfCampus.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400">该校区暂无教室</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
