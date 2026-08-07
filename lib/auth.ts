import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { rateLimit, isRateLimited, clientIp } from "./rateLimit";
import type { Role } from "@/lib/enums";

// 失败次数上限 / 窗口。手机号这把更紧：定点猜某个账号的收益远高于广撒网。
const LOGIN_IP_LIMIT = { limit: 20, windowMs: 10 * 60 * 1000 };
const LOGIN_PHONE_LIMIT = { limit: 8, windowMs: 10 * 60 * 1000 };

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

        // 登录限流。两把锁：
        //   按 IP  —— 挡住一台机器把整个手机号段刷一遍；
        //   按手机号 —— 挡住换 IP 猜同一个账号（校长/财务这类账号最值得被猜）。
        // 只有猜错才计数，正常登录不消耗额度，否则共用出口 IP 的办公室会互相拖累。
        const ip = clientIp(request as Request);
        const ipKey = `login:ip:${ip}`;
        const phoneKey = `login:phone:${phone}`;
        if (isRateLimited(ipKey, LOGIN_IP_LIMIT) || isRateLimited(phoneKey, LOGIN_PHONE_LIMIT)) {
          console.warn(`[auth] 登录尝试过于频繁，已拒绝：ip=${ip} phone=${phone}`);
          return null;
        }
        // 失败时统一走这里：不区分「无此账号」「已停用」「密码错」，避免枚举账号。
        const fail = () => {
          rateLimit(ipKey, LOGIN_IP_LIMIT);
          rateLimit(phoneKey, LOGIN_PHONE_LIMIT);
          return null;
        };

        const user = await prisma.user.findUnique({
          where: { phone },
          include: {
            roles: true,
            campuses: { include: { campus: true } },
          },
        });

        if (!user || !user.isActive) return fail();
        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return fail();

        return {
          id: user.id,
          name: user.name,
          phone: user.phone,
          roles: user.roles.map((r) => r.role) as Role[],
          campusIds: user.campuses.map((c) => c.campusId),
        };
      },
    }),
  ],
  callbacks: {
    // proxy.ts 的 matcher 全靠这个回调兜底：next-auth 在没有 authorized 时
    // 一律放行，只刷新会话 cookie，matcher 形同虚设。
    authorized({ auth }) {
      return !!auth?.user;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.phone = (user as { phone: string }).phone;
        token.roles = (user as { roles: Role[] }).roles;
        token.campusIds = (user as { campusIds: string[] }).campusIds;
      }
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
