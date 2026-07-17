import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { campusScope, type SessionUser } from "@/lib/permissions";
import { torontoDayRange } from "@/lib/tz";
import { formatDate } from "@/lib/utils";
import Link from "next/link";

export default async function DashboardPage() {
  const session = await auth();
  const sessionUser = session?.user as SessionUser | undefined;

  // 只有 Student 有 campusId；课包/课程/日志都要顺着关系链过滤到学生身上。
  const scope = sessionUser ? campusScope(sessionUser) : { in: [] };
  const onStudent = scope ? { campusId: scope } : {};
  const viaStudent = scope ? { student: { campusId: scope } } : {};

  const [totalStudents, activePackages, todayLessons, pendingLogs] = await Promise.all([
    prisma.student.count({ where: onStudent }),
    prisma.coursePackage.count({ where: { ...viaStudent, status: "ACTIVE" } }),
    prisma.scheduledLesson.count({
      where: {
        ...viaStudent,
        startTime: torontoDayRange(),
      },
    }),
    prisma.lessonLog.count({
      where: {
        confirmedAt: null,
        ...(scope ? { lesson: { student: { campusId: scope } } } : {}),
      },
    }),
  ]);

  const recentStudents = await prisma.student.findMany({
    where: onStudent,
    include: { grade: true, campus: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const stats = [
    { label: "学生总数", value: totalStudents, icon: "👨‍🎓", href: "/students", color: "bg-blue-50 text-blue-700" },
    { label: "有效课包", value: activePackages, icon: "📦", href: "/packages", color: "bg-green-50 text-green-700" },
    { label: "今日课程", value: todayLessons, icon: "📅", href: "/schedule", color: "bg-purple-50 text-purple-700" },
    { label: "待核销日志", value: pendingLogs, icon: "⏳", href: "/lessons", color: "bg-yellow-50 text-yellow-700" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">仪表盘</h1>
        <p className="text-slate-500 text-sm mt-1">欢迎回来，{session?.user?.name}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <div className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md transition-shadow cursor-pointer">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">{s.label}</p>
                  <p className="text-3xl font-bold text-slate-800 mt-1">{s.value}</p>
                </div>
                <span className={`text-3xl p-2 rounded-lg ${s.color}`}>{s.icon}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Recent Students */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">最近添加的学生</h2>
          <Link href="/students/new" className="text-sm text-blue-600 hover:underline">+ 添加学生</Link>
        </div>
        <div className="divide-y divide-slate-100">
          {recentStudents.length === 0 && (
            <div className="px-6 py-8 text-center text-slate-400 text-sm">暂无学生数据</div>
          )}
          {recentStudents.map((s) => (
            <Link key={s.id} href={`/students/${s.id}`} className="flex items-center justify-between px-6 py-3 hover:bg-slate-50">
              <div>
                <p className="font-medium text-slate-800 text-sm">{s.name}</p>
                <p className="text-xs text-slate-400">{s.grade.name} · {s.campus.name}</p>
              </div>
              <span className="text-xs text-slate-400">{formatDate(s.createdAt)}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
