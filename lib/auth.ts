import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import type { Role } from "@/lib/enums";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        phone: { label: "手机号", type: "text" },
        password: { label: "密码", type: "password" },
      },
      async authorize(credentials) {
        const phone = credentials?.phone as string;
        const password = credentials?.password as string;
        if (!phone || !password) return null;

        const user = await prisma.user.findUnique({
          where: { phone },
          include: {
            roles: true,
            campuses: { include: { campus: true } },
          },
        });

        if (!user || !user.isActive) return null;
        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

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
