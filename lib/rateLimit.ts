/**
 * 极简进程内固定窗口限流。用于公开捕获表单的反垃圾（按 IP）。
 *
 * 注意：进程内 Map，多实例部署不共享。属"基础反垃圾"，够挡脚本刷单；
 * 真要抗分布式攻击需换 Redis 之类的共享存储。
 */
type Window = { count: number; resetAt: number };
const buckets = new Map<string, Window>();

export type RateLimitOptions = { limit: number; windowMs: number };

/** 返回 true = 放行；false = 超限。 */
export function rateLimit(key: string, { limit, windowMs }: RateLimitOptions): boolean {
  const now = Date.now();
  const w = buckets.get(key);
  if (!w || now >= w.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (w.count >= limit) return false;
  w.count += 1;
  return true;
}

/** 从请求头取客户端 IP（Railway/代理后取 x-forwarded-for 第一段）。 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
