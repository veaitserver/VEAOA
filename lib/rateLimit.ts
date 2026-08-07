/**
 * 极简进程内固定窗口限流。用于公开捕获表单的反垃圾（按 IP）。
 *
 * 注意：进程内 Map，多实例部署不共享。属"基础反垃圾"，够挡脚本刷单；
 * 真要抗分布式攻击需换 Redis 之类的共享存储。
 */
type Window = { count: number; resetAt: number };
const buckets = new Map<string, Window>();
// 上限防内存膨胀：伪造 X-Forwarded-For 可制造大量不同 key，超过上限就清一次过期桶。
const MAX_BUCKETS = 10000;

export type RateLimitOptions = { limit: number; windowMs: number };

/** 返回 true = 放行；false = 超限。 */
export function rateLimit(key: string, { limit, windowMs }: RateLimitOptions): boolean {
  const now = Date.now();
  const w = buckets.get(key);
  if (!w || now >= w.resetAt) {
    if (buckets.size >= MAX_BUCKETS) {
      for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (w.count >= limit) return false;
  w.count += 1;
  return true;
}

/**
 * 只看是否已超限，不消耗配额。
 *
 * 登录用「先看、失败才记一笔」的方式：整间办公室共用一个出口 IP 时，
 * 正常上班登录不该把额度耗光，只有猜错密码才计数。
 */
export function isRateLimited(key: string, { limit }: Pick<RateLimitOptions, "limit">): boolean {
  const w = buckets.get(key);
  if (!w || Date.now() >= w.resetAt) return false;
  return w.count >= limit;
}

/**
 * 从请求头取客户端 IP。
 *
 * x-forwarded-for = "客户端, 代理1, 代理2..."，**首段是客户端可控的**，用它做限流 key
 * 会被随机伪造首段绕过。默认信任 1 层反向代理（Railway/Vercel 等）：取由可信边缘
 * 追加的**最后一段**；层数不同可用 TRUSTED_PROXY_HOPS 配置。
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) {
      const hops = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS) || 1);
      // 从末尾数第 hops 段（可信代理链最内侧那台注入的真实客户端 IP）。
      return parts[Math.max(0, parts.length - hops)];
    }
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}
