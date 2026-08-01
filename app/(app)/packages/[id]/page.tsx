"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { formatMoney, formatRate, formatDate, formatDateTime } from "@/lib/utils";
import { isDepleted, isLowOnHours, LOW_HOURS_THRESHOLD } from "@/lib/hours";
import { SIGNING_TYPE_LABELS, CLASS_TYPE_LABELS } from "@/lib/enums";

type Refundable = { hours: number; remainingHours: number; pendingHours: number };

type Package = {
  id: string; status: string; signingType: string; classType: string; totalHours: string; remainingHours: string;
  refundable?: Refundable;
  pricePerHour: string; totalAmount: string; notes?: string; createdAt: string;
  confirmedAt?: string; financeConfirmedAt?: string;
  student: { id: string; name: string; campusId: string };
  grade: { name: string }; subject: { name: string };
  creator: { name: string }; confirmer: { name: string } | null; financeConfirmer: { name: string } | null;
  deductions: Deduction[];
  lessons: LessonRef[];
};

type Deduction = {
  id: string; hoursDeducted: string; createdAt: string;
  reversedAt?: string; reverser?: { name: string };
};

type LessonRef = {
  id: string; startTime: string; endTime: string;
  teacher: { name: string }; classroom: { name: string };
};

const STATUS_LABELS: Record<string, string> = {
  PENDING_APPROVAL: "待校长确认", PENDING_FINANCE: "待财务确认", ACTIVE: "已生效",
};
const STATUS_COLORS: Record<string, string> = {
  PENDING_APPROVAL: "bg-yellow-100 text-yellow-700",
  PENDING_FINANCE: "bg-orange-100 text-orange-700",
  ACTIVE: "bg-green-100 text-green-700",
};

export default function PackageDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: session } = useSession();
  const [pkg, setPkg] = useState<Package | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [managers, setManagers] = useState<{ id: string; name: string }[]>([]);
  const [managerId, setManagerId] = useState("");
  const [showRefund, setShowRefund] = useState(false);
  const [refundHours, setRefundHours] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundMsg, setRefundMsg] = useState("");

  const userRoles: string[] = (session?.user as { roles: string[] })?.roles ?? [];
  const canConfirm = userRoles.some(r => ["PRINCIPAL", "SUPER_ADMIN"].includes(r));
  const canFinanceConfirm = userRoles.some(r => ["FINANCE", "SUPER_ADMIN"].includes(r));
  // 发起退费：学管（负责该生）或校长/超管；后端会再校验归属。
  const canRefund = userRoles.some(r => ["STUDENT_MANAGER", "PRINCIPAL", "SUPER_ADMIN"].includes(r));
  const canEdit = userRoles.some(r => ["FINANCE", "SUPER_ADMIN"].includes(r)) ||
    (pkg?.status === "PENDING_APPROVAL" && userRoles.some(r => ["SALES", "PRINCIPAL"].includes(r)));

  async function load() {
    const res = await fetch(`/api/packages/${id}`);
    if (res.ok) setPkg(await res.json());
  }

  useEffect(() => { load(); }, [id]);

  // 校长确认前拉本校区学管，供确认时分配。
  useEffect(() => {
    if (canConfirm && pkg?.status === "PENDING_APPROVAL" && pkg.student.campusId) {
      fetch(`/api/students/managers?campusId=${pkg.student.campusId}`)
        .then((r) => (r.ok ? r.json() : [])).then(setManagers).catch(() => setManagers([]));
    }
  }, [canConfirm, pkg?.status, pkg?.student.campusId]);

  async function handleConfirm() {
    setConfirming(true);
    await fetch(`/api/packages/${id}/confirm`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentManagerId: managerId || null }),
    });
    setConfirming(false);
    load();
  }

  async function handleFinanceConfirm() {
    setConfirming(true);
    await fetch(`/api/packages/${id}/finance-confirm`, { method: "POST" });
    setConfirming(false);
    load();
  }

  async function submitRefund() {
    setRefundMsg("");
    const h = Number(refundHours);
    if (!(h > 0)) { setRefundMsg("请填写要退的课时"); return; }
    const res = await fetch("/api/refunds", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageId: id, hours: h, reason: refundReason || null }),
    });
    if (res.ok) {
      setShowRefund(false); setRefundHours(""); setRefundReason("");
      setRefundMsg("");
      load();
    } else {
      setRefundMsg((await res.json()).error ?? "提交失败");
    }
  }

  async function handleDelete() {
    if (!confirm("确定删除该课包？")) return;
    await fetch(`/api/packages/${id}`, { method: "DELETE" });
    window.location.href = "/packages";
  }

  if (!pkg) return <div className="text-slate-400 text-sm p-8 text-center">加载中...</div>;

  const usedHours = pkg.deductions
    .filter(d => !d.reversedAt)
    .reduce((s, d) => s + Number(d.hoursDeducted), 0);

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link href="/packages" className="text-slate-400 hover:text-slate-600 text-lg">←</Link>
        <h1 className="text-2xl font-bold text-slate-800">课包详情</h1>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[pkg.status]}`}>
          {STATUS_LABELS[pkg.status]}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${pkg.signingType === "RENEWAL" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
          {SIGNING_TYPE_LABELS[pkg.signingType] ?? pkg.signingType}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${pkg.classType === "GROUP" ? "bg-teal-100 text-teal-700" : "bg-slate-100 text-slate-600"}`}>
          {CLASS_TYPE_LABELS[pkg.classType] ?? pkg.classType}
        </span>
      </div>

      {pkg.status === "ACTIVE" && isDepleted(pkg.remainingHours) && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          课时已耗尽，无法继续排课。请提醒学生续费后新建课包。
        </div>
      )}
      {pkg.status === "ACTIVE" && isLowOnHours(pkg.remainingHours) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          ⚠️ 续费预警：剩余课时不足 {LOW_HOURS_THRESHOLD}h（当前 {Number(pkg.remainingHours).toFixed(1)}h），建议尽快联系学生续费。
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {/* Info Card */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
          <h2 className="font-semibold text-slate-700 text-sm">基本信息</h2>
          {[
            ["学生", <Link key="s" href={`/students/${pkg.student.id}`} className="text-blue-600 hover:underline">{pkg.student.name}</Link>],
            ["年级 / 科目", `${pkg.grade.name} · ${pkg.subject.name}`],
            ["创建人", pkg.creator.name],
            ["校长确认", pkg.confirmer?.name ? `${pkg.confirmer.name}${pkg.confirmedAt ? " · " + formatDateTime(pkg.confirmedAt) : ""}` : "—"],
            ["财务确认", pkg.financeConfirmer?.name ? `${pkg.financeConfirmer.name}${pkg.financeConfirmedAt ? " · " + formatDateTime(pkg.financeConfirmedAt) : ""}` : "—"],
            ["创建时间", formatDate(pkg.createdAt)],
          ].map(([label, value]) => (
            <div key={label as string} className="flex justify-between text-sm">
              <span className="text-slate-400">{label}</span>
              <span className="text-slate-800 font-medium">{value}</span>
            </div>
          ))}
        </div>

        {/* Finance Card */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
          <h2 className="font-semibold text-slate-700 text-sm">财务信息</h2>
          <div className="rounded-lg bg-slate-50 p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">总课时</span>
              <span className="font-bold text-slate-800">{Number(pkg.totalHours).toFixed(1)}h</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">课时单价</span>
              <span className="font-bold text-slate-800">{formatRate(pkg.pricePerHour)}</span>
            </div>
            <div className="flex justify-between text-sm border-t border-slate-200 pt-2">
              <span className="text-slate-500">总金额</span>
              <span className="font-bold text-blue-700 text-lg">{formatMoney(pkg.totalAmount)}</span>
            </div>
            <div className="border-t border-slate-200 pt-2 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">已核销</span>
                <span className="text-slate-700">{usedHours.toFixed(1)}h</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">剩余课时</span>
                <span className={`font-bold ${Number(pkg.remainingHours) < 3 ? "text-red-600" : "text-green-700"}`}>
                  {Number(pkg.remainingHours).toFixed(1)}h
                </span>
              </div>
            </div>
          </div>
          {pkg.notes && <p className="text-xs text-slate-500">备注: {pkg.notes}</p>}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        {canConfirm && pkg.status === "PENDING_APPROVAL" && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">分配学管</span>
              <select value={managerId} onChange={(e) => setManagerId(e.target.value)}
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">暂不分配</option>
                {managers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <button onClick={handleConfirm} disabled={confirming}
              className="bg-green-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
              {confirming ? "处理中..." : "✓ 校长确认"}
            </button>
          </>
        )}
        {canFinanceConfirm && pkg.status === "PENDING_FINANCE" && (
          <button onClick={handleFinanceConfirm} disabled={confirming}
            className="bg-green-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
            {confirming ? "处理中..." : "✓ 财务确认生效"}
          </button>
        )}
        {canEdit && pkg.status === "PENDING_APPROVAL" && (
          <button onClick={handleDelete} className="border border-red-300 text-red-600 px-5 py-2 rounded-lg text-sm font-medium hover:bg-red-50">
            删除课包
          </button>
        )}
        {canRefund && pkg.status === "ACTIVE" && (pkg.refundable?.hours ?? 0) > 0 && !showRefund && (
          <button onClick={() => setShowRefund(true)}
            className="border border-slate-300 text-slate-700 px-5 py-2 rounded-lg text-sm font-medium hover:bg-slate-50">
            申请退费
          </button>
        )}
      </div>

      {/* 退费申请表单 */}
      {showRefund && pkg.refundable && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4 max-w-lg">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-800">申请退费</h2>
            <button onClick={() => { setShowRefund(false); setRefundMsg(""); }} className="text-slate-400 hover:text-slate-600">✕</button>
          </div>
          <p className="text-xs text-slate-500">
            按原单价 {formatRate(pkg.pricePerHour)} 退，不收手续费。最多可退 <b className="text-slate-700">{pkg.refundable.hours}h</b>
            （剩余 {pkg.refundable.remainingHours}h，已排未核销 {pkg.refundable.pendingHours}h 需先处理）。
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">退多少课时 *</label>
              <input type="number" min="0" step="0.5" max={pkg.refundable.hours}
                value={refundHours} onChange={(e) => setRefundHours(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">应退金额</label>
              <div className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 font-medium text-slate-800">
                {formatMoney(Math.round(Number(refundHours || 0) * Number(pkg.pricePerHour) * 100) / 100)}
              </div>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">退费原因</label>
            <input value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="如 转学 / 时间冲突"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          {refundMsg && <p className="text-red-600 text-sm">{refundMsg}</p>}
          <div className="flex items-center gap-3">
            <button onClick={submitRefund}
              className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
              提交申请
            </button>
            <span className="text-xs text-slate-400">提交后需校长审核、财务打款</span>
          </div>
        </div>
      )}

      {/* Deduction History */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="font-semibold text-slate-800">消课流水</h2>
        </div>
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">时间</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">扣除课时</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">状态</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">反核销人</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pkg.deductions.map(d => (
              <tr key={d.id} className="hover:bg-slate-50">
                <td className="px-5 py-3 text-xs text-slate-500">{formatDateTime(d.createdAt)}</td>
                <td className="px-5 py-3 text-sm font-medium text-slate-800">{Number(d.hoursDeducted).toFixed(1)}h</td>
                <td className="px-5 py-3">
                  {d.reversedAt ? (
                    <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">已撤销</span>
                  ) : (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">有效</span>
                  )}
                </td>
                <td className="px-5 py-3 text-sm text-slate-500">{d.reverser?.name ?? "—"}</td>
              </tr>
            ))}
            {pkg.deductions.length === 0 && (
              <tr><td colSpan={4} className="px-5 py-6 text-center text-slate-400 text-sm">暂无消课记录</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
