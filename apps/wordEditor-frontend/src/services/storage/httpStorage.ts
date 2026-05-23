import type { TemplatesConfig } from '@/core/types';
import type { IStorageAdapter } from './types';

async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function apiPut(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
}

/** 默认：对接 Vite dev API 或同源 /api 后端 */
export class HttpStorageAdapter implements IStorageAdapter {
  readonly id = 'http';

  constructor(private base = '/api') {}

  getTemplatesConfig(): Promise<TemplatesConfig> {
    return apiGet(`${this.base}/templates`);
  }

  async readText(relativePath: string): Promise<string> {
    const q = new URLSearchParams({ path: relativePath });
    const data = await apiGet<{ content: string }>(`${this.base}/file?${q}`);
    return data.content;
  }

  async writeText(relativePath: string, content: string): Promise<void> {
    const q = new URLSearchParams({ path: relativePath });
    await apiPut(`${this.base}/file?${q}`, { content });
  }

  async readDoc(name: string): Promise<string> {
    const q = new URLSearchParams({ name });
    const data = await apiGet<{ content: string }>(`${this.base}/docs?${q}`);
    return data.content;
  }
}
