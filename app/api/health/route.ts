import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appEnv } from "@/lib/env";

/**
 * 健康检查。两个用途：
 *  1. Railway 的 healthcheck 探针 —— 数据库连不上就不该放流量进来。
 *  2. 让 scripts/probe.mjs 在开跑前确认目标环境。探测会真删真建数据，
 *     误打到生产就是事故，所以环境由服务端自报，而不是靠人记住域名。
 *
 * 只返回环境名与连通性，不带版本号/依赖清单之类对攻击者有用的信息。
 */
export const dynamic = "force-dynamic";

export async function GET() {
  let db = "down";
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = "up";
  } catch {
    // 保持 db="down"，下面按 503 返回
  }
  const body = { ok: db === "up", env: appEnv(), db };
  return NextResponse.json(body, { status: body.ok ? 200 : 503 });
}
