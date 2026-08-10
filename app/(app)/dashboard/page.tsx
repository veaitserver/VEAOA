import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import {
  campusScope, canAccessPackages, canManageStudents, canViewLessons,
  canViewSchedule, canViewStudents, ownScheduleScope, studentOwnerScope,
  type SessionUser,
} from "@/lib/permissions";
import { torontoDayRange } from "@/lib/tz";
import { formatDate } from "@/lib/utils";
import Link from "next/link";

/**
 * 仪表盘按角色组装。
 *
 * 这里每一块都是别处某个受限页面的摘要，所以守卫必须和那个页面用同一个函数 ——
 * 早先这页对所有人一视同仁，老师登录就能看到全校区学生总数、有效课包，
 * 以及一份「最近添加的学生」名单和「+ 添加学生」入口，
 * 把 /api/students 那边的收敛整个绕开了。
 */
export default async function DashboardPage() {
  const session = await auth();
  const sessionUser = session?.user as SessionUser | undefined;
  // 未登录理论上进不来（proxy 拦截），真进来了就一律查不到东西。
  if (!sessionUser) return null;

  const scope = campusScope(sessionUser);
  const owner = studentOwnerScope(sessionUser);
  const ownTeacher = ownScheduleScope(sessionUser);

  // 学生维度：校区 + 归属（销售看自己名下、学管看自己负责的）。
  const studentWhere = { ...(scope ? { campusId: scope } : {}), ...(owner ?? {}) };
  // 课程维度：再叠上「只看自己带的课」（纯老师）。
  const lessonWhere = {
    ...(Object.keys(studentWhere).length ? { student: studentWhere } : {}),
    ...(ownTeacher ?? {}),
  };

  const showStudents = canViewStudents(sessionUser);
  const showPackages = canAccessPackages(sessionUser);
  const showSchedule = canViewSchedule(sessionUser);
  const showLessons = canViewLessons(sessionUser);

  const [totalStudents, activePackages, todayLessons, pendingLogs] = await Promise.all([
    showStudents ? prisma.student.count({ where: studentWhere }) : Promise.resolve(0),
    showPackages
      ? prisma.coursePackage.count({
          where: { ...(Object.keys(studentWhere).length ? { student: studentWhere } : {}), status: "ACTIVE" },
        })
      : Promise.resolve(0),
    showSchedule
      ? prisma.scheduledLesson.count({ where: { ...lessonWhere, startTime: torontoDayRange() } })
      : Promise.resolve(0),
    showLessons
      ? prisma.lessonLog.count({
          where: {
            confirmedAt: null,
            ...(Object.keys(lessonWhere).length ? { lesson: lessonWhere } : {}),
          },
        })
      : Promise.resolve(0),
  ]);

  const recentStudents = showStudents
    ? await prisma.student.findMany({
        where: studentWhere,
        include: { grade: true, campus: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      })
    : [];

  const stats = [
    showStudents && { label: "学生总数", value: totalStudents, icon: "👨‍🎓", href: "/students", color: "bg-blue-50 text-blue-700" },
    showPackages && { label: "有效课包", value: activePackages, icon: "📦", href: "/packages", color: "bg-green-50 text-green-700" },
    showSchedule && { label: "今日课程", value: todayLessons, icon: "📅", href: "/schedule", color: "bg-purple-50 text-purple-700" },
    showLessons && { label: "待核销日志", value: pendingLogs, icon: "⏳", href: "/lessons", color: "bg-yellow-50 text-yellow-700" },
  ].filter(Boolean) as { label: string; value: number; icon: string; href: string; color: string }[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">仪表盘</h1>
        <p className="text-slate-500 text-sm mt-1">欢迎回来，{session?.user?.name}</p>
      </div>

      {/* Stats */}
      {stats.length > 0 && (
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
      )}

      {/* Recent Students */}
      {showStudents && (
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800">最近添加的学生</h2>
            {canManageStudents(sessionUser) && (
              <Link href="/students/new" className="text-sm text-blue-600 hover:underline">+ 添加学生</Link>
            )}
          </div>
          <div className="divide-y divide-slate-100">
            {recentStudents.length === 0 && (
              <div className="px-6 py-8 text-center text-slate-400 text-sm">暂无学生数据</div>
            )}
            {recentStudents.map((s) => (
              <Link key={s.id} href={`/students/${s.id}`} className="flex items-center justify-between px-6 py-3 hover:bg-slate-50">
                <div>
                  <p className="font-medium text-slate-800 text-sm">{s.name}</p>
                  <p className="text-xs text-slate-400">{s.grade?.name ?? "待定"} · {s.campus.name}</p>
                </div>
                <span className="text-xs text-slate-400">{formatDate(s.createdAt)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
