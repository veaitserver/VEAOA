"use client";

import { useState, useEffect } from "react";
import { formatPhone } from "@/lib/utils";

const ALL_ROLES = [
  { value: "SUPER_ADMIN", label: "超级管理员" },
  { value: "HR", label: "HR" },
  { value: "SALES", label: "销售" },
  { value: "TEACHER", label: "老师" },
  { value: "ACADEMIC_ADMIN", label: "教务" },
  { value: "PRINCIPAL", label: "校长" },
  { value: "FINANCE", label: "财务" },
];

type Campus = { id: string; name: string };
type User = {
  id: string; name: string; phone: string; isActive: boolean;
  roles: { role: string }[];
  campuses: { campus: Campus }[];
};

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", password: "", roles: [] as string[], campusIds: [] as string[] });
  const [error, setError] = useState("");

  async function load() {
    const [u, c] = await Promise.all([
      fetch("/api/admin/users").then(r => r.ok ? r.json() : []),
      fetch("/api/admin/campuses").then(r => r.ok ? r.json() : []),
    ]);
    setUsers(u); setCampuses(c);
  }

  useEffect(() => { load(); }, []);

  function toggleRole(role: string) {
    setForm(f => ({
      ...f,
      roles: f.roles.includes(role) ? f.roles.filter(r => r !== role) : [...f.roles, role],
    }));
  }

  function toggleCampus(campusId: string) {
    setForm(f => ({
      ...f,
      campusIds: f.campusIds.includes(campusId) ? f.campusIds.filter(c => c !== campusId) : [...f.campusIds, campusId],
    }));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/admin/users", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setShowForm(false);
      setForm({ name: "", phone: "", password: "", roles: [], campusIds: [] });
      load();
    } else {
      const d = await res.json();
      setError(d.error);
    }
  }

  async function toggleActive(id: string, isActive: boolean) {
    await fetch(`/api/admin/users/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !isActive }),
    });
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">用户管理</h1>
        <button onClick={() => setShowForm(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
          + 新建账户
        </button>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-lg p-6 shadow-xl">
            <h2 className="font-semibold text-slate-800 text-lg mb-4">创建账户</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">姓名</label>
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">手机号（登录名）</label>
                  <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} required
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">初始密码</label>
                <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-2">角色（可多选）</label>
                <div className="flex flex-wrap gap-2">
                  {ALL_ROLES.map(r => (
                    <button key={r.value} type="button" onClick={() => toggleRole(r.value)}
                      className={`px-3 py-1 rounded-full text-sm border transition ${form.roles.includes(r.value) ? "bg-blue-600 text-white border-blue-600" : "border-slate-300 text-slate-600 hover:border-blue-400"}`}>
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-2">所属校区（可多选）</label>
                <div className="flex flex-wrap gap-2">
                  {campuses.map(c => (
                    <button key={c.id} type="button" onClick={() => toggleCampus(c.id)}
                      className={`px-3 py-1 rounded-full text-sm border transition ${form.campusIds.includes(c.id) ? "bg-blue-600 text-white border-blue-600" : "border-slate-300 text-slate-600 hover:border-blue-400"}`}>
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
              {error && <p className="text-red-600 text-sm">{error}</p>}
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">取消</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">创建</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">姓名</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">手机号</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">角色</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">校区</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">状态</th>
              <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map(u => (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="px-6 py-3 text-sm font-medium text-slate-800">{u.name}</td>
                <td className="px-6 py-3 text-sm text-slate-500">{formatPhone(u.phone)}</td>
                <td className="px-6 py-3">
                  <div className="flex flex-wrap gap-1">
                    {u.roles.map(r => (
                      <span key={r.role} className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                        {ALL_ROLES.find(x => x.value === r.role)?.label ?? r.role}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-6 py-3 text-sm text-slate-500">
                  {u.campuses.map(c => c.campus.name).join(", ") || "—"}
                </td>
                <td className="px-6 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${u.isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                    {u.isActive ? "启用" : "禁用"}
                  </span>
                </td>
                <td className="px-6 py-3 text-right">
                  <button onClick={() => toggleActive(u.id, u.isActive)} className="text-sm text-blue-600 hover:underline">
                    {u.isActive ? "禁用" : "启用"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
