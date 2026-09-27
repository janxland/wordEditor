/**
 * AuthCenter 凭证对接 —— eorder-server 只作为「凭证中心」使用：
 * - 登录/注册请求代理转发（前端密文原样透传给 AuthCenter，与其 bcrypt(密文) 落库口径一致，传输全程无明文）；
 * - 工单接口用 Bearer token 调 /auth-center/profile 鉴权（带 5 分钟缓存）。
 * 不在 AuthCenter 侧新增/修改任何东西。
 */
import crypto from 'node:crypto';

/**
 * AuthCenter 候选列表（按序尝试，网络不通自动降级到下一个）：
 * 1. AUTH_CENTER_URL 环境变量（显式指定时唯一可信，不再降级）；
 * 2. 公网入口 https://edu.roginx.ink/api（nginx 反代 /api/auth-center/ → 8085/auth-center/），
 *    桌面端在制作人机器上没有 Tailscale，必须走公网；
 * 3. Tailscale 直连 100.98.118.42:8085（本机开发更快，公网不可达时兜底）。
 * 统一语义：候选值都是「base」，实际请求 = base + /auth-center/<path>。
 */
const AUTH_CENTER_CANDIDATES: string[] = process.env.AUTH_CENTER_URL
  ? [process.env.AUTH_CENTER_URL]
  : ['https://edu.roginx.ink/api', 'http://100.98.118.42:8085'];
const CREDENTIAL_KEY = 'aoligeimeimaobin'; // 与前端 credentialCrypto.ts 同源

const fromUrlSafe = (s: string): string => s.replace(/-/g, '+').replace(/_/g, '/');

/** 解不开（历史明文）返回 null。仅留作诊断工具，登录/注册链路不再解密（AuthCenter 口径 = bcrypt(密文)）。 */
export function tryDecryptCredential(value: string): string | null {
  if (!value || value.length < 24 || /\s/.test(value)) return null;
  try {
    const raw = Buffer.from(fromUrlSafe(value), 'base64');
    if (raw.length === 0 || raw.length % 16 !== 0) return null;
    const d = crypto.createDecipheriv('aes-128-ecb', Buffer.from(CREDENTIAL_KEY, 'utf8'), null);
    const out = Buffer.concat([d.update(raw), d.final()]).toString('utf8');
    return /^[\x20-\x7e\u4e00-\u9fa5]+$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

export interface AuthedUser {
  userId: number;
  username: string;
  roleCodes: string[];
}

export function isWorkerUser(u: AuthedUser): boolean {
  return u.roleCodes.some((r) => ['doc-worker', 'admin', 'SUPER_ADMIN'].includes(r));
}

interface CacheEntry {
  user: AuthedUser;
  expires: number;
}
const tokenCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * 对 AuthCenter 发请求：按候选列表逐个试，网络级失败（连接不上/超时）才换下一个；
 * 一旦拿到 HTTP 响应（哪怕是 401）就认为该入口可达，直接用它的响应。
 * path 是 8085 宿主机上的完整子路径（如 auth-center/profile、user/register）。
 */
async function authCenterFetch(path: string, init?: RequestInit): Promise<Response> {
  let lastNetworkError: Error | null = null;
  for (const base of AUTH_CENTER_CANDIDATES) {
    const url = `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
    try {
      return await fetch(url, init);
    } catch (e) {
      lastNetworkError = e as Error;
    }
  }
  const e = new Error(`鉴权中心不可达：${lastNetworkError?.message ?? '全部候选地址连接失败'}`) as Error & {
    statusCode: number;
  };
  e.statusCode = 503;
  throw e;
}

/** 校验 Bearer token；无效抛 { statusCode: 401 }。 */
export async function requireUser(authorization: string | undefined): Promise<AuthedUser> {
  const token = authorization?.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    const e = new Error('未登录') as Error & { statusCode: number };
    e.statusCode = 401;
    throw e;
  }

  const hit = tokenCache.get(token);
  if (hit && hit.expires > Date.now()) return hit.user;

  const res = await authCenterFetch('auth-center/profile', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = (await res.json().catch(() => ({}))) as {
    data?: { code?: number; success?: boolean; data?: { id?: number; username?: string; roles?: { code: string }[] } };
  };
  const profile = payload?.data?.data;
  if (!res.ok || payload?.data?.success === false || !profile?.id) {
    const e = new Error('登录态无效，请重新登录') as Error & { statusCode: number };
    e.statusCode = 401;
    throw e;
  }

  const user: AuthedUser = {
    userId: Number(profile.id),
    username: String(profile.username ?? ''),
    roleCodes: (profile.roles ?? []).map((r) => String(r.code)),
  };
  tokenCache.set(token, { user, expires: Date.now() + CACHE_TTL_MS });
  return user;
}

/** 登录代理：前端密文原样转发 AuthCenter（AuthCenter 全生态口径 = bcrypt(密文)，不解密）。返回 AuthCenter 原始双层信封。 */
export async function proxyLogin(username: string, passwordCipher: string): Promise<{ status: number; body: unknown }> {
  const res = await authCenterFetch('auth-center/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: passwordCipher }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** 注册代理：同上（AuthCenter 侧自己负责 bcrypt 落库）。 */
export async function proxyRegister(username: string, passwordCipher: string): Promise<{ status: number; body: unknown }> {
  const res = await authCenterFetch('user/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: passwordCipher }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
