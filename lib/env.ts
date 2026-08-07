/**
 * 部署环境标识。
 *
 * NODE_ENV 只有 development/production 两档，测试环境跑的也是 production 构建，
 * 靠它分不出「测试」和「生产」。所以另设 APP_ENV，由部署平台按环境注入。
 *
 * 缺省为 development：漏配时退回最保守的一档，而不是被当成生产。
 */
export type AppEnv = "development" | "staging" | "production";

export function appEnv(): AppEnv {
  const raw = (process.env.APP_ENV ?? "").trim().toLowerCase();
  if (raw === "production" || raw === "staging" || raw === "development") return raw;
  return "development";
}

export function isProduction(): boolean {
  return appEnv() === "production";
}
