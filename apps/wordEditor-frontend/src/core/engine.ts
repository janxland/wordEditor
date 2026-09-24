/** 调试用引擎切换：node（默认，vite /api → 8787）/ python（/py-api → 8788），两引擎契约一致 */
export type EngineId = 'node' | 'python';

const STORAGE_KEY = 'wordeditor.engine';

export function getEngine(): EngineId {
  return localStorage.getItem(STORAGE_KEY) === 'python' ? 'python' : 'node';
}

export function setEngine(id: EngineId): void {
  if (id === 'node') localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, id);
}

export function apiBase(): string {
  return getEngine() === 'python' ? '/py-api' : '/api';
}

/** 后端返回的 `/api/...` 下载链接按当前引擎重映射到代理前缀 */
export function engineUrl(url: string): string {
  return getEngine() === 'python' ? url.replace(/^\/api(?=\/)/, '/py-api') : url;
}
