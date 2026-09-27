/**
 * 所有 /api 请求的统一出口：自动带登录态 + 401 统一上报。
 *
 * 后端守卫默认开启（WORDEDITOR_AUTH=off 才可关），裸 fetch 会一律 401，
 * 所以业务代码不要自己 fetch，一律走 apiFetch。
 */
import { currentUser } from './docOrder';
import { cloudApiOrigin } from './desktopBridge';

const UNAUTHORIZED_EVENT = 'wordeditor.unauthorized';

/** 有登录态就带 Authorization，没有就原样发（公开端点不受影响） */
export function authHeaders(init: Record<string, string> = {}): Record<string, string> {
  const token = currentUser()?.accessToken;
  return token ? { ...init, Authorization: `Bearer ${token}` } : init;
}

/** 桌面端业务分流：相对路径（登录/工单/下载中心）打向云端；管线请求已是本地绝对地址不受影响 */
function resolveUrl(url: string): string {
  const cloud = cloudApiOrigin();
  if (cloud && url.startsWith('/')) return `${cloud.replace(/\/$/, '')}${url}`;
  return url;
}

export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(resolveUrl(url), {
    ...init,
    headers: authHeaders((init.headers as Record<string, string>) ?? {}),
  });
  // 过期/被挤下线：请求层只负责喊，外壳决定弹登录还是提示
  if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  return res;
}

export function onUnauthorized(handler: () => void): () => void {
  window.addEventListener(UNAUTHORIZED_EVENT, handler);
  return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
}
