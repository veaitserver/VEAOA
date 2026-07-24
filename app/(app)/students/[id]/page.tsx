"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { formatMoney, formatRate, formatDate, formatDateTime, formatPhone } from "@/lib/utils";
import {
  sourceCategoryLabel, deriveStage, stageLabel, STAGE_COLORS, FUNNEL_STAGES, CONTACT_APP_LABELS, type LeadInfo,
} from "@/lib/leadLabels";
import { SIGNING_TYPE_LABELS, LEDGER_TYPE_LABELS } from "@/lib/enums";

const LEDGER_COLORS: Record<string, string> = {
  PAYMENT: "bg-green-100 text-green-700",
  PACKAGE_CHARGE: "bg-blue-100 text-blue-700",
  REFUND_CREDIT: "bg-amber-100 text-amber-700",
  REFUND_PAYOUT: "bg-red-100 text-red-700",
};

type Student = {
  id: string; name: string; phone: string; publicSchool?: string; createdAt: string;
  isEnrolled?: boolean;
  campusId: string;
  postalCode?: string | null;
  preferredContactApp?: string | null;
  contactAppId?: string | null;
  grade: { id: string; name: string } | null;
  campus: { name: string };
  sales: { id: string; name: string } | null;
  studentManager: { id: string; name: string } | null;
  leadInfo: (LeadInfo & { source: string }) | null;
  followUps: FollowUp[];
  packages: Package[];
  lessons: Lesson[];
};

type FollowUp = {
  id: string; contactMethod: string; content: string; followedAt: string;
  nextFollowUp?: string; sales: { name: string };
};

type Package = {
  id: string; status: string; signingType: string; totalHours: string; remainingHours: string;
  pricePerHour: string; totalAmount: string;
  grade: { name: string }; subject: { name: string };
  creator: { name: string }; confirmer: { name: string } | null;
  confirmedAt?: string;
};

type LedgerEntry = {
  id: string; type: string; amount: number; note?: string | null; createdAt: string;
  creator: { name: string };
  package?: { id: string; grade: { name: string }; subject: { name: string } } | null;
};

type Lesson = {
  id: string; startTime: string; endTime: string;
  teacher: { name: string }; classroom: { name: string };
  package: { subject: { name: string } };
  log?: { notes: string; confirmedAt?: string; deduction?: object };
};

const STATUS_LABELS: Record<string, string> = {
  PENDING_APPROVAL: "待校长确认", PENDING_FINANCE: "待财务确认", ACTIVE: "已生效",
};
const STATUS_COLORS: Record<string, string> = {
  PENDING_APPROVAL: "bg-yellow-100 text-yellow-700",
  PENDING_FINANCE: "bg-orange-100 text-orange-700",
  ACTIVE: "bg-green-100 text-green-700",
};

export default function StudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: session } = useSession();
  const roles = (session?.user as { roles?: string[] } | undefined)?.roles ?? [];
  const canAssign = roles.includes("PRINCIPAL") || roles.includes("SUPER_ADMIN");
  const [student, setStudent] = useState<Student | null>(null);
  const [salesUsers, setSalesUsers] = useState<{ id: string; name: string }[]>([]);
  const [managers, setManagers] = useState<{ id: string; name: string }[]>([]);
  const [activeTab, setActiveTab] = useState<"profile" | "packages" | "followups" | "lessons" | "ledger">("profile");
  const [ledger, setLedger] = useState<{ entries: LedgerEntry[]; balance: number } | null>(null);
  const [showFollowUpForm, setShowFollowUpForm] = useState(false);
  const [followUpForm, setFollowUpForm] = useState({
    contactMethod: "PHONE", content: "", followedAt: new Date().toISOString().slice(0, 16), nextFollowUp: "",
  });

  async function load() {
    const res = await fetch(`/api/students/${id}`);
    if (res.ok) setStudent(await res.json());
  }

  useEffect(() => { load(); }, [id]);

  // 账户流水按需拉取（涉及金额，无权者接口会 403，这里静默留空）。
  useEffect(() => {
    if (activeTab !== "ledger") return;
    fetch(`/api/students/${id}/ledger`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setLedger)
      .catch(() => setLedger(null));
  }, [activeTab, id]);

  // 校长可分配归属销售与学管：拉本校区销售/学管列表。
  useEffect(() => {
    if (canAssign && student?.campusId) {
      fetch(`/api/campaigns/sales?campusId=${student.campusId}`).then((r) => (r.ok ? r.json() : [])).then(setSalesUsers).catch(() => setSalesUsers([]));
      fetch(`/api/students/managers?campusId=${student.campusId}`).then((r) => (r.ok ? r.json() : [])).then(setManagers).catch(() => setManagers([]));
    }
  }, [canAssign, student?.campusId]);

  async function assignField(field: "salesId" | "studentManagerId", value: string) {
    await fetch(`/api/students/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value || null }),
    });
    load();
  }

  async function submitFollowUp(e: React.FormEvent) {
    e.preventDefault();
    await fetch(`/api/students/${id}/followups`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(followUpForm),
    });
    setShowFollowUpForm(false);
    load();
  }

  async function updateLeadStatus(status: string) {
    await fetch(`/api/students/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  }

  if (!student) return <div className="text-slate-400 text-sm p-8 text-center">加载中...</div>;

  const activePackages = student.packages.filter(p => p.status === "ACTIVE");
  const stage = deriveStage(student.packages, student.leadInfo);
  const isFunnel = FUNNEL_STAGES.includes(stage as typeof FUNNEL_STAGES[number]);

  // 建课包权限（与后端一致）：首张=新签(销售归属本人/校长/超管)，之后=续费(该生学管/校长/超管)。
  const myId = (session?.user as { id?: string } | undefined)?.id ?? "";
  const isAdmin = roles.includes("PRINCIPAL") || roles.includes("SUPER_ADMIN");
  const hasPackage = student.packages.length > 0;
  const canCreatePkg = hasPackage
    ? (isAdmin || (roles.includes("STUDENT_MANAGER") && student.studentManager?.id === myId))
    : (isAdmin || (roles.includes("SALES") && student.sales?.id === myId));
  const scheduledHours = student.lessons
    .filter(l => !l.log?.deduction)
    .reduce((sum, l) => {
      const dur = (new Date(l.endTime).getTime() - new Date(l.startTime).getTime()) / 3600000;
      return sum + dur;
    }, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/students" className="text-slate-400 hover:text-slate-600 text-lg">←</Link>
        <h1 className="text-2xl font-bold text-slate-800">{student.name}</h1>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_COLORS[stage] ?? "bg-slate-100 text-slate-500"}`}>
          {stageLabel(stage)}
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
        {([["profile", "基本信息"], ["packages", `课包(${student.packages.length})`], ["followups", `跟进(${student.followUps.length})`], ["lessons", `上课记录(${student.lessons.length})`], ["ledger", "账户"]] as const).map(([val, label]) => (
          <button key={val} onClick={() => setActiveTab(val)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${activeTab === val ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
            {label}
          </button>
        ))}
      </div>

      {activeTab === "profile" && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {[
              ["手机号", formatPhone(student.phone)],
              ["联系方式", student.preferredContactApp
                ? `${CONTACT_APP_LABELS[student.preferredContactApp] ?? student.preferredContactApp}${student.contactAppId ? " · " + student.contactAppId : ""}`
                : "—"],
              ["年级", student.grade?.name ?? "待定"],
              ["校区", student.campus.name],
              ["邮编", student.postalCode || "—"],
              ["归属销售", student.sales?.name || "—"],
              ["学管", student.studentManager?.name || "—"],
              ["学员状态", stageLabel(stage)],
              ["来源大类", sourceCategoryLabel(student.leadInfo)],
              ["来源明细", student.leadInfo?.sourceDetail || "—"],
              ["营销活动", student.leadInfo?.campaign?.name || "—"],
              ["意向科目", student.leadInfo?.subjectsOfInterest || "—"],
              ["公立学校", student.publicSchool || "—"],
              ["注册时间", formatDate(student.createdAt)],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-xs text-slate-400">{label}</p>
                <p className="text-sm font-medium text-slate-800 mt-0.5">{value}</p>
              </div>
            ))}
          </div>
          {/* 校长分配归属销售 / 学管 */}
          {canAssign && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">分配销售</span>
                <select value={student.sales?.id ?? ""} onChange={(e) => assignField("salesId", e.target.value)}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">未分配</option>
                  {salesUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">分配学管</span>
                <select value={student.studentManager?.id ?? ""} onChange={(e) => assignField("studentManagerId", e.target.value)}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">未分配</option>
                  {managers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            </div>
          )}
          <div className="pt-2 flex items-center gap-3">
            {canCreatePkg && (
              <Link href={`/packages/new?studentId=${student.id}`} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 inline-block">
                {hasPackage ? "+ 新建续费课包" : "+ 新建课包"}
              </Link>
            )}
            {/* 销售看到自己名下已签约学生：说明续费不再由销售负责 */}
            {!canCreatePkg && hasPackage && roles.includes("SALES") && (
              <span className="text-xs text-slate-400">该学生已签约，续费课包由学管负责</span>
            )}
            {/* 线索漏斗状态操作：仅纯线索显示（已结课/在读不显示） */}
            {isFunnel && student.leadInfo && (
              stage === "LOST" ? (
                <button onClick={() => updateLeadStatus("CONTACTED")}
                  className="px-4 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">
                  重新激活
                </button>
              ) : (
                <button onClick={() => updateLeadStatus("LOST")}
                  className="px-4 py-2 border border-red-300 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50">
                  标记为已流失
                </button>
              )
            )}
          </div>
        </div>
      )}

      {activeTab === "packages" && (
        <div className="space-y-4">
          {/* Asset overview for enrolled students */}
          {activePackages.length > 0 && (
            <div className="grid grid-cols-2 gap-4">
              {activePackages.map(p => {
                const available = Number(p.remainingHours) - scheduledHours;
                const lowInventory = available < 3;
                return (
                  <div key={p.id} className={`bg-white rounded-xl border p-4 ${lowInventory ? "border-red-300" : "border-slate-200"}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-800">{p.grade.name} · {p.subject.name}</span>
                      {lowInventory && <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">⚠ 库存不足</span>}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-500">
                      <span>剩余课时: <strong className="text-slate-800">{Number(p.remainingHours).toFixed(1)}h</strong></span>
                      <span>可用库存: <strong className={`${lowInventory ? "text-red-600" : "text-slate-800"}`}>{available.toFixed(1)}h</strong></span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {/* Package list */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">课包</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">课时/单价/总额</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">剩余</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">状态</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {student.packages.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm font-medium text-slate-800">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium mr-1.5 ${p.signingType === "RENEWAL" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
                        {SIGNING_TYPE_LABELS[p.signingType] ?? p.signingType}
                      </span>
                      {p.grade.name} · {p.subject.name}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500">{p.totalHours}h / {formatRate(p.pricePerHour)} / {formatMoney(p.totalAmount)}</td>
                    <td className="px-4 py-3 text-sm text-slate-800">{Number(p.remainingHours).toFixed(1)}h</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[p.status]}`}>{STATUS_LABELS[p.status]}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/packages/${p.id}`} className="text-blue-600 text-sm hover:underline">详情</Link>
                    </td>
                  </tr>
                ))}
                {student.packages.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400 text-sm">暂无课包</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "followups" && (
        <div className="space-y-4">
          <button onClick={() => setShowFollowUpForm(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
            + 添加跟进记录
          </button>

          {showFollowUpForm && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
              <div className="bg-white rounded-xl w-full max-w-md p-6">
                <h2 className="font-semibold text-slate-800 mb-4">添加跟进记录</h2>
                <form onSubmit={submitFollowUp} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">联系方式</label>
                    <select value={followUpForm.contactMethod} onChange={e => setFollowUpForm({...followUpForm, contactMethod: e.target.value})}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
                      <option value="PHONE">Phone Call</option>
                      <option value="WECHAT">WeChat</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">跟进时间</label>
                    <input type="datetime-local" value={followUpForm.followedAt}
                      onChange={e => setFollowUpForm({...followUpForm, followedAt: e.target.value})}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">下次提醒</label>
                    <input type="datetime-local" value={followUpForm.nextFollowUp}
                      onChange={e => setFollowUpForm({...followUpForm, nextFollowUp: e.target.value})}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">沟通内容 *</label>
                    <textarea value={followUpForm.content} onChange={e => setFollowUpForm({...followUpForm, content: e.target.value})}
                      required rows={4}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm resize-none" />
                  </div>
                  <div className="flex gap-3 justify-end">
                    <button type="button" onClick={() => setShowFollowUpForm(false)} className="px-4 py-2 border border-slate-300 rounded-lg text-sm">取消</button>
                    <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">保存</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {student.followUps.map(f => (
              <div key={f.id} className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                      {f.contactMethod === "PHONE" ? "📞 Phone" : "💬 WeChat"}
                    </span>
                    <span className="text-xs text-slate-400">{formatDateTime(f.followedAt)}</span>
                    <span className="text-xs text-slate-400">by {f.sales.name}</span>
                  </div>
                  {f.nextFollowUp && (
                    <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                      下次: {formatDate(f.nextFollowUp)}
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-700 whitespace-pre-wrap">{f.content}</p>
              </div>
            ))}
            {student.followUps.length === 0 && (
              <div className="text-center text-slate-400 text-sm py-8">暂无跟进记录</div>
            )}
          </div>
        </div>
      )}

      {activeTab === "lessons" && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">时间</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">科目</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">老师</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">教室</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {student.lessons.map(l => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {formatDateTime(l.startTime)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-800">{l.package.subject.name}</td>
                  <td className="px-4 py-3 text-sm text-slate-500">{l.teacher.name}</td>
                  <td className="px-4 py-3 text-sm text-slate-500">{l.classroom.name}</td>
                  <td className="px-4 py-3">
                    {l.log?.deduction ? (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">已核销</span>
                    ) : l.log ? (
                      <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">待确认</span>
                    ) : (
                      <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">已排课</span>
                    )}
                  </td>
                </tr>
              ))}
              {student.lessons.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400 text-sm">暂无上课记录</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "ledger" && (
        <div className="space-y-4">
          {!ledger ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 text-sm">
              加载中，或你无权查看账户流水
            </div>
          ) : (
            <>
              <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-400">账户余额</div>
                  <div className="text-xs text-slate-400 mt-1">收款、退费、转化差额都记在这里</div>
                </div>
                <div className={`text-2xl font-bold ${Math.abs(ledger.balance) < 0.005 ? "text-slate-800" : ledger.balance > 0 ? "text-green-700" : "text-red-600"}`}>
                  {formatMoney(ledger.balance)}
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">时间</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">类型</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">说明</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">经手人</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">金额</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ledger.entries.map((e) => (
                      <tr key={e.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-xs text-slate-500">{formatDateTime(e.createdAt)}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${LEDGER_COLORS[e.type] ?? "bg-slate-100 text-slate-600"}`}>
                            {LEDGER_TYPE_LABELS[e.type] ?? e.type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">{e.note ?? "—"}</td>
                        <td className="px-4 py-3 text-sm text-slate-500">{e.creator.name}</td>
                        <td className={`px-4 py-3 text-sm text-right font-medium tabular-nums ${Number(e.amount) >= 0 ? "text-green-700" : "text-red-600"}`}>
                          {Number(e.amount) >= 0 ? "+" : "−"}{formatMoney(Math.abs(Number(e.amount)))}
                        </td>
                      </tr>
                    ))}
                    {ledger.entries.length === 0 && (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400 text-sm">暂无账户流水</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
