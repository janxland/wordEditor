/** 调试用引擎切换：node（默认，vite /api → 8787）/ python（/py-api → 8788），两引擎契约一致 */
import { localApiOrigin } from '@/services/desktopBridge';

export type EngineId = 'node' | 'python';

const STORAGE_KEY = 'wordeditor.engine';

export function getEngine(): EngineId {
  return localStorage.getItem(STORAGE_KEY) === 'python' ? 'python' : 'node';
}

export function setEngine(id: EngineId): void {
  if (id === 'node') localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, id);
}

/**
 * 管线请求基址：
 * - 桌面端（Electron，窗口加载云端站点）：管线走本地后端（pandoc 在本机干活），
 *   返回绝对地址 http://127.0.0.1:<port>/api（或 /py-api，桌面端未装 python 引擎，
 *   切了也回本地 node）；
 * - 浏览器：同源相对地址（vite 代理 / 云端 nginx），行为与原来完全一致。
 */
export function apiBase(): string {
  const local = localApiOrigin();
  if (local) return `${local}${getEngine() === 'python' ? '/py-api' : '/api'}`;
  return getEngine() === 'python' ? '/py-api' : '/api';
}

/** 后端返回的 `/api/...` 下载链接按当前引擎重映射到代理前缀；桌面端补成本地绝对地址 */
export function engineUrl(url: string): string {
  const local = localApiOrigin();
  if (local && url.startsWith('/api')) return `${local}${url}`;
  return getEngine() === 'python' ? url.replace(/^\/api(?=\/)/, '/py-api') : url;
}
