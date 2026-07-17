"use client";

import { useState, useEffect } from "react";
import { formatDate } from "@/lib/utils";

type Campus = { id: string; name: string; createdAt: string };

export default function CampusesPage() {
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [name, setName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch("/api/admin/campuses");
    if (res.ok) setCampuses(await res.json());
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
    else { const d = await res.json(); setError(d.error); }
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
    await fetch(`/api/admin/campuses/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">校区管理</h1>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="font-semibold text-slate-700 mb-4">添加校区</h2>
        <form onSubmit={handleCreate} className="flex gap-3">
          <input
            value={name} onChange={e => setName(e.target.value)}
            placeholder="校区名称"
            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">添加</button>
        </form>
        {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">校区名称</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">创建时间</th>
              <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {campuses.map(c => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-6 py-3 text-sm text-slate-800">
                  {editId === c.id ? (
                    <input value={editName} onChange={e => setEditName(e.target.value)}
                      className="px-2 py-1 border border-blue-400 rounded text-sm w-40" />
                  ) : c.name}
                </td>
                <td className="px-6 py-3 text-sm text-slate-500">
                  {formatDate(c.createdAt)}
                </td>
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
            {campuses.length === 0 && (
              <tr><td colSpan={3} className="px-6 py-8 text-center text-slate-400 text-sm">暂无校区</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
