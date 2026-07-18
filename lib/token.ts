import { randomBytes } from "node:crypto";

/** URL 安全的短 token，用于 campaign 的公开链接 /join/{token}。 */
export function generateToken(): string {
  return randomBytes(9).toString("base64url"); // 12 个 url-safe 字符
}
