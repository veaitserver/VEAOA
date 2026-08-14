import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { rateLimit, isRateLimited, clientIp } from "./rateLimit";
import type { Role } from "@/lib/enums";

// 按 IP 的失败上限（进程内，尽力而为）。整间办公室共用一个出口 IP，所以放得比账号松。
const LOGIN_IP_LIMIT = { limit: 20, windowMs: 10 * 60 * 1000 };

// 按账号的失败上限（落库，重启与多实例都算数）。
// 定点猜某个账号的收益远高于广撒网，所以这把更紧。
const ACCOUNT_MAX_FAILURES = 8;
const ACCOUNT_LOCK_MS = 10 * 60 * 1000;

/**
 * 账号级失败计数落库的原因：进程内 Map 一重启就清零，多实例部署也各算各的，
 * 攻击者只要触发一次重启（或换一个实例）就能重开额度。锁定时间到点自动解开，
 * 不需要人工干预。
 */
async function noteLoginFailure(userId: string) {
  const u = await prisma.user.update({
    where: { id: userId },
    data: { failedLoginCount: { increment: 1 } },
    select: { failedLoginCount: true },
  });
  if (u.failedLoginCount >= ACCOUNT_MAX_FAILURES) {
    await prisma.user.update({
      where: { id: userId },
      data: { lockedUntil: new Date(Date.now() + ACCOUNT_LOCK_MS), failedLoginCount: 0 },
    });
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        phone: { label: "手机号", type: "text" },
        password: { label: "密码", type: "password" },
      },
      async authorize(credentials, request) {
        const phone = credentials?.phone as string;
        const password = credentials?.password as string;
        if (!phone || !password) return null;

        const ip = clientIp(request as Request);
        const ipKey = `login:ip:${ip}`;
        if (isRateLimited(ipKey, LOGIN_IP_LIMIT)) {
          console.warn(`[auth] 该 IP 登录失败过多，已拒绝：ip=${ip}`);
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { phone },
          include: {
            roles: true,
            campuses: { include: { campus: true } },
          },
        });

        // 失败一律走同一条路径：不区分「无此账号」「已停用」「已锁定」「密码错」，
        // 免得响应差异被拿来枚举账号。
        const fail = async () => {
          rateLimit(ipKey, LOGIN_IP_LIMIT);
          if (user) await noteLoginFailure(user.id);
          return null;
        };

        if (!user || !user.isActive) return fail();
        if (user.lockedUntil && user.lockedUntil > new Date()) {
          console.warn(`[auth] 账号处于锁定期，已拒绝：phone=${phone}`);
          return null; // 锁定期内不再累加，否则永远解不开
        }
        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return fail();

        // 登录成功即清零，正常使用不会被自己的历史失败拖累。
        if (user.failedLoginCount > 0 || user.lockedUntil) {
          await prisma.user.update({
            where: { id: user.id },
            data: { failedLoginCount: 0, lockedUntil: null },
          });
        }

        return {
          id: user.id,
          name: user.name,
          phone: user.phone,
          roles: user.roles.map((r) => r.role) as Role[],
          campusIds: user.campuses.map((c) => c.campusId),
          tokenVersion: user.tokenVersion,
        };
      },
    }),
  ],
  callbacks: {
    // proxy.ts 的 matcher 全靠这个回调兜底：next-auth 在没有 authorized 时
    // 一律放行，只刷新会话 cookie，matcher 形同虚设。
    authorized({ auth, request }) {
      if (auth?.user) return true;
      // 未登录的接口请求要返回 401 JSON，不能跳登录页。
      // 默认行为是 307 到 /login，前端 fetch 跟随重定向后拿到一张登录页 HTML，
      // res.ok 仍是 true，再去 JSON.parse 就炸在解析上，页面白屏而不是跳登录。
      // 会话现在会中途失效（停用/改密码即时生效），这条路径会被经常走到。
      if (new URL(request.url).pathname.startsWith("/api/")) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      return false;
    },

    /**
     * 每次请求都回源校验会话。
     *
     * JWT 是自包含的，签发之后服务端管不着 —— 停用一个账号、或改掉他的角色，
     * 他手里那张令牌在过期前照样好使（默认 30 天）。所以这里每次都读一次库：
     *   账号没了 / 已停用      → 返回 null，会话当场作废
     *   tokenVersion 对不上    → 返回 null（改密码会 +1，作废所有旧会话）
     *   否则                   → 用库里的角色与校区覆盖令牌，改权限立即生效、不必重登
     *
     * 代价是每次请求一次按主键的点查。Next 的文档提醒 Proxy 会在每个路由（含预取）
     * 上运行、不宜查库，但那是面向公网高流量站点的建议；本系统是几十个员工的内部
     * 后台，一次索引点查换「权限改动立即生效」是划算的。真要嫌重，可以在令牌里
     * 记一个时间戳做几十秒的节流，代价是同样长度的失效窗口。
     */
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.phone = (user as { phone: string }).phone;
        token.roles = (user as { roles: Role[] }).roles;
        token.campusIds = (user as { campusIds: string[] }).campusIds;
        token.tokenVersion = (user as unknown as { tokenVersion: number }).tokenVersion;
        return token;
      }

      if (!token.id) return null;

      const fresh = await prisma.user.findUnique({
        where: { id: token.id as string },
        select: {
          isActive: true,
          tokenVersion: true,
          roles: { select: { role: true } },
          campuses: { select: { campusId: true } },
        },
      });

      if (!fresh || !fresh.isActive) return null;
      if (fresh.tokenVersion !== token.tokenVersion) return null;

      token.roles = fresh.roles.map((r) => r.role) as Role[];
      token.campusIds = fresh.campuses.map((c) => c.campusId);
      return token;
    },

    async session({ session, token }) {
      session.user.id = token.id as string;
      (session.user as { phone: string }).phone = token.phone as string;
      (session.user as { roles: Role[] }).roles = token.roles as Role[];
      (session.user as { campusIds: string[] }).campusIds = token.campusIds as string[];
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET,
});
